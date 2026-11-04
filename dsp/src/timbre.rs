//! Ladder, DualVCO and Wavetable/WavePad voices (Groove machines and Synth patches).
//!
//! Oscillator bank → drive → either the Biquad path (2× tanh waveshaper and two lowpass
//! biquads) or the Rust ladder at 2×, then a DC blocker. The host keeps the amplitude
//! envelope and stops the voice; continuous controls are smoothed here the way the Web
//! Audio graph smoothed them with setTargetAtTime.
use crate::{
    biquad::{Angle, Biquad},
    fastmath::sine,
    halfband::{Downsampler, Upsampler},
    ladder::{soft_clip, Ladder},
    wavetable::{Shape, Wavetable},
    BLOCK,
};

/// Control planes: gate (−1 stops), pitch detune in cents, and one modulation input whose
/// target is chosen per note (configuration index 7).
pub const PARAMETERS: usize = 3;
pub const CONFIG_SIZE: usize = 16;
pub const DEFAULT_CONFIG: [f32; CONFIG_SIZE] = [
    0.0, 0.0, 110.0, 3.0, 1.0, 0.0, 0.3, 0.0, 1800.0, 2.0, 0.5, 0.5, 1.6, 0.0, 0.0, 0.0,
];
const LFO_HZ: f64 = 0.16;
const LADDER_DRIVE: f32 = 1.4;

fn finite(value: f32, min: f32, max: f32, default: f32) -> f64 {
    f64::from(if value.is_finite() {
        value.clamp(min, max)
    } else {
        default
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Family {
    Ladder,
    Dual,
    Wave,
}

/// setTargetAtTime as a per-sample one-pole.
#[derive(Clone, Copy)]
struct Smooth {
    value: f64,
    coefficient: f64,
}

impl Smooth {
    fn new(value: f64, seconds: f64, rate: f64) -> Self {
        Self {
            value,
            coefficient: 1.0 - (-1.0 / (seconds * rate)).exp(),
        }
    }
    fn tick(&mut self, target: f64) -> f64 {
        let difference = target - self.value;
        // Like Web Audio, settle exactly once within 1.5e-6 of the target.
        if difference.abs() < 1.5e-6 * target.abs().max(1e-14) {
            self.value = target;
        } else {
            self.value += difference * self.coefficient;
        }
        self.value
    }
}

/// Exponential sweep multiplier: 1 → peak over 12 ms, then back to 1 by `decay`.
struct Sweep {
    value: f64,
    rise: f64,
    fall: f64,
    rising: u32,
    falling: u32,
}

impl Sweep {
    fn new(peak: f64, decay: f64, rate: f64) -> Self {
        let rising = (0.012 * rate).round().max(1.0);
        let falling = ((decay.max(0.025) - 0.012) * rate).round().max(1.0);
        Self {
            value: 1.0,
            rise: peak.powf(1.0 / rising),
            fall: (1.0 / peak).powf(1.0 / falling),
            rising: rising as u32,
            falling: falling as u32,
        }
    }
    fn tick(&mut self) -> f64 {
        let value = self.value;
        if self.rising > 0 {
            self.rising -= 1;
            self.value *= self.rise;
        } else if self.falling > 0 {
            self.falling -= 1;
            self.value = if self.falling == 0 {
                1.0
            } else {
                self.value * self.fall
            };
        }
        value
    }
}

/// An oscillator with its frequency ratio and fixed detune.
struct Partial {
    oscillator: Wavetable,
    ratio: f64,
}

pub struct TimbreVoice {
    rate: f64,
    family: Family,
    ladder_filter: bool,
    hz: f64,
    envelope: f64,
    decay: f64,
    started: bool,
    /// Oscillator pairs crossfaded by position: (A, B) for each pair.
    pairs: Vec<(Partial, Partial)>,
    /// Fixed-level sub oscillator.
    sub: Option<(Partial, f64)>,
    level: f64,
    levels: Vec<[Smooth; 2]>,
    depths: [Smooth; 2],
    lfo: f64,
    cutoff: Smooth,
    sweep: Sweep,
    resonance: [Smooth; 2],
    filters: [Biquad; 2],
    filter_state: (f64, [f64; 2]),
    filter_q: [f64; 2],
    up: Upsampler,
    curve: &'static Curve,
    down: Downsampler,
    ladder: Ladder,
    ladder_hz: f64,
    ladder_g: f32,
    dc: Biquad,
    detune: f32,
    ratio: f64,
    filter_detune: f32,
    filter_ratio: f64,
    modulation: u8,
    /// Cutoff, resonance, position and motion: set by configuration and `update`.
    controls: [f64; 4],
    drive: f64,
    pub config: [f32; CONFIG_SIZE],
    pub parameters: [f32; PARAMETERS * BLOCK],
    pub output: [f32; BLOCK],
}

impl TimbreVoice {
    pub fn new(rate: f32) -> Self {
        let rate = finite(rate, 8000.0, 192000.0, 48000.0);
        let mut voice = Self {
            rate,
            family: Family::Ladder,
            ladder_filter: false,
            hz: 110.0,
            envelope: 0.0,
            decay: 0.3,
            started: false,
            pairs: Vec::with_capacity(3),
            sub: None,
            level: 0.35,
            levels: Vec::with_capacity(3),
            depths: [Smooth::new(0.0, 0.02, rate); 2],
            lfo: 0.0,
            cutoff: Smooth::new(1000.0, 0.02, rate),
            sweep: Sweep::new(1.0, 0.3, rate),
            resonance: [Smooth::new(1.0, 0.015, rate); 2],
            filters: [Biquad::default(), Biquad::default()],
            filter_state: (f64::NAN, [f64::NAN; 2]),
            filter_q: [1.0; 2],
            up: Upsampler::new(),
            curve: curve(),
            down: Downsampler::new(),
            ladder: Ladder::new(),
            ladder_hz: f64::NAN,
            ladder_g: 0.0,
            dc: Biquad::default(),
            detune: 0.0,
            ratio: 1.0,
            filter_detune: 0.0,
            filter_ratio: 1.0,
            modulation: 0,
            controls: [1800.0, 2.0, 0.5, 0.5],
            drive: 1.6,
            config: DEFAULT_CONFIG,
            parameters: [0.0; PARAMETERS * BLOCK],
            output: [0.0; BLOCK],
        };
        voice.configure();
        voice
    }

    pub fn configure(&mut self) {
        let c = &self.config;
        let rate = self.rate;
        self.family = match finite(c[0], 0.0, 2.0, 0.0) as u32 {
            1 => Family::Dual,
            2 => Family::Wave,
            _ => Family::Ladder,
        };
        self.ladder_filter = finite(c[1], 0.0, 1.0, 0.0) > 0.5;
        self.hz = finite(c[2], 8.0, 20000.0, 110.0);
        let spread = finite(c[3], 0.0, 100.0, 3.0);
        let second = finite(c[4], 0.25, 4.0, 1.0);
        self.envelope = finite(c[5], 0.0, 10.0, 0.0);
        self.decay = finite(c[6], 0.0, 30.0, 0.3);
        let partial = |shape, ratio: f64, cents: f64| Partial {
            oscillator: Wavetable::new(shape, rate),
            ratio: ratio * (cents / 1200.0).exp2(),
        };
        self.pairs.clear();
        self.sub = None;
        match self.family {
            Family::Wave => {
                for layer in 0..3 {
                    let cents = (layer as f64 - 1.0) * spread;
                    self.pairs.push((
                        partial(Shape::Dark, 1.0, cents),
                        partial(Shape::Bright, 1.0, cents),
                    ));
                }
                self.level = 0.28;
            }
            Family::Dual => {
                for (ratio, cents) in [(1.0, -spread), (second, spread)] {
                    self.pairs.push((
                        partial(Shape::Triangle, ratio, cents),
                        partial(Shape::Saw, ratio, cents),
                    ));
                }
                self.sub = Some((partial(Shape::Square, 0.5, 0.0), 0.09));
                self.level = 0.35;
            }
            Family::Ladder => {
                self.pairs.push((
                    partial(Shape::Saw, 1.0, -spread),
                    partial(Shape::Square, second, spread),
                ));
                self.sub = Some((partial(Shape::Triangle, 0.5, 0.0), 0.14));
                self.level = 0.35;
            }
        }
        // Levels and modulation depths rise from zero; Q from Web Audio's default of 1 dB.
        self.levels.clear();
        self.levels
            .resize(self.pairs.len(), [Smooth::new(0.0, 0.02, rate); 2]);
        self.depths = [Smooth::new(0.0, 0.02, rate); 2];
        let start = if self.ladder_filter { 0.0 } else { 1.0 };
        self.resonance = [Smooth::new(start, 0.015, rate); 2];
        self.filters = [Biquad::default(), Biquad::default()];
        self.filter_state = (f64::NAN, [f64::NAN; 2]);
        self.up = Upsampler::new();
        self.down = Downsampler::new();
        self.ladder = Ladder::new();
        self.ladder_hz = f64::NAN;
        self.dc = Biquad::default();
        self.dc.set(true, 20.0, Biquad::q(0.5), rate);
        self.lfo = 0.0;
        self.started = false;
        self.detune = 0.0;
        self.ratio = 1.0;
        self.filter_detune = 0.0;
        self.filter_ratio = 1.0;
        self.modulation = finite(self.config[7], 0.0, 3.0, 0.0) as u8;
        self.drive = finite(self.config[12], -16.0, 16.0, 1.0);
        self.update();
    }

    /// Applies cutoff, resonance, position and motion from configuration indices 8–11. They
    /// move rarely (Synth panel changes), so they are not per-sample control planes.
    pub fn update(&mut self) {
        let c = &self.config;
        self.controls = [
            finite(c[8], 40.0, 24000.0, 1800.0).min(self.rate * 0.42),
            finite(c[9], 0.1, 12.0, 2.0),
            finite(c[10], 0.0, 1.0, 0.5),
            finite(c[11], 0.0, 1.0, 0.0),
        ];
    }

    fn oscillators(&mut self, position: f64, motion: f64) -> f64 {
        let rate = self.rate;
        let hz = self.hz * self.ratio;
        let wave = self.family == Family::Wave;
        let swing = if wave {
            let lfo = sine(self.lfo);
            self.lfo = (self.lfo + LFO_HZ / rate).fract();
            let depth = position.min(1.0 - position) * motion * 0.26;
            [
                self.depths[0].tick(-depth) * lfo,
                self.depths[1].tick(depth) * lfo,
            ]
        } else {
            [0.0; 2]
        };
        let targets = [(1.0 - position) * self.level, position * self.level];
        let mut mix = 0.0;
        for (pair, levels) in self.pairs.iter_mut().zip(self.levels.iter_mut()) {
            // DualVCO and Wavetable pairs run at one pitch: read both shapes at one phase.
            let (a, b) = if pair.0.ratio == pair.1.ratio {
                pair.0
                    .oscillator
                    .tick_with(hz * pair.0.ratio, pair.1.oscillator.bank())
            } else {
                (
                    pair.0.oscillator.tick(hz * pair.0.ratio),
                    pair.1.oscillator.tick(hz * pair.1.ratio),
                )
            };
            let (a, b) = (f64::from(a), f64::from(b));
            mix += a * (levels[0].tick(targets[0]) + swing[0])
                + b * (levels[1].tick(targets[1]) + swing[1]);
        }
        if let Some((sub, level)) = &mut self.sub {
            mix += f64::from(sub.oscillator.tick(hz * sub.ratio)) * *level;
        }
        mix
    }

    /// Biquad path: 2× waveshaper, then two lowpass stages; the first carries the resonance.
    fn biquad(&mut self, x: f64, hz: f64, resonance: f64) -> f64 {
        let q = [
            self.resonance[0].tick(0.6 + resonance * 0.42),
            self.resonance[1].tick(0.707),
        ];
        let (cached_hz, cached_q) = self.filter_state;
        if hz != cached_hz || q != cached_q {
            if q != cached_q {
                self.filter_q = q.map(Biquad::q);
            }
            self.filter_state = (hz, q);
            let angle = Angle::new(hz, self.rate);
            for (filter, q) in self.filters.iter_mut().zip(self.filter_q) {
                filter.set_angle(false, angle, q);
            }
        }
        let (a, b) = self.up.process(x as f32);
        let shaped = self
            .down
            .process(shape(self.curve, a), shape(self.curve, b));
        let y = self.filters[0].tick(f64::from(shaped));
        self.filters[1].tick(y)
    }

    /// Ladder path: the Ladder β filter at twice the sample rate.
    fn ladder(&mut self, x: f64, hz: f64, resonance: f64) -> f64 {
        let k = self.resonance[0].tick(((resonance - 0.5) * 0.62).clamp(0.0, 3.95)) as f32;
        let hz = hz.clamp(10.0, 0.45 * self.rate);
        if hz != self.ladder_hz {
            self.ladder_hz = hz;
            self.ladder_g = (std::f64::consts::PI * hz / (2.0 * self.rate)).tan() as f32;
        }
        let g = self.ladder_g;
        let (a, b) = self.up.process(x as f32);
        let (a, b) = (
            self.ladder.tick(a, g, k, LADDER_DRIVE),
            self.ladder.tick(b, g, k, LADDER_DRIVE),
        );
        let makeup = (1.0 + 0.5 * k) * LADDER_DRIVE / soft_clip(LADDER_DRIVE);
        f64::from(makeup * self.down.process(a, b))
    }

    pub fn process(&mut self, frames: usize) {
        for i in 0..frames.min(BLOCK) {
            let value = |slot: usize| self.parameters[slot * BLOCK + i];
            if !self.started {
                if !(value(0).is_finite() && value(0) > 0.5) {
                    self.output[i] = 0.0;
                    continue;
                }
                // The sweep and cutoff glide start from the cutoff at the gate.
                self.started = true;
                let cutoff = self.controls[0];
                self.cutoff.value = cutoff;
                let peak = (cutoff * (1.0 + self.envelope * 5.0)).min(self.rate * 0.42);
                self.sweep = Sweep::new(peak / cutoff, self.decay, self.rate);
            }
            let modulation = finite(value(2), -1e6, 1e6, 0.0);
            let (pitch, filter, drive) = match self.modulation {
                1 => (0.0, modulation, 0.0),
                2 => (0.0, 0.0, modulation),
                3 => (modulation, 0.0, 0.0),
                _ => (0.0, 0.0, 0.0),
            };
            let detune =
                (finite(value(1), -9600.0, 9600.0, 0.0) + pitch).clamp(-9600.0, 9600.0) as f32;
            if detune != self.detune {
                self.detune = detune;
                self.ratio = (f64::from(detune) / 1200.0).exp2();
            }
            let filter_detune = filter.clamp(-9600.0, 9600.0) as f32;
            if filter_detune != self.filter_detune {
                self.filter_detune = filter_detune;
                self.filter_ratio = (f64::from(filter_detune) / 1200.0).exp2();
            }
            let [cutoff, resonance, position, motion] = self.controls;
            let x = self.oscillators(position, motion) * (self.drive + drive);
            let hz = self.cutoff.tick(cutoff) * self.sweep.tick() * self.filter_ratio;
            let y = if self.ladder_filter {
                self.ladder(x, hz, resonance)
            } else {
                self.biquad(x, hz, resonance)
            };
            self.output[i] = self.dc.tick(y) as f32;
        }
    }
}

/// The Biquad voice's waveshaper: 1025 points of tanh(1.4x)/tanh(1.4), read linearly.
type Curve = [f32; 1025];
fn curve() -> &'static Curve {
    static CURVE: std::sync::OnceLock<Curve> = std::sync::OnceLock::new();
    CURVE.get_or_init(|| {
        std::array::from_fn(|i| (((i as f64 / 512.0 - 1.0) * 1.4).tanh() / 1.4f64.tanh()) as f32)
    })
}
fn shape(curve: &Curve, x: f32) -> f32 {
    let position = (x.clamp(-1.0, 1.0) + 1.0) * 512.0;
    let index = (position as usize).min(1023);
    let fraction = position - index as f32;
    curve[index] * (1.0 - fraction) + curve[index + 1] * fraction
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(config: [f32; CONFIG_SIZE], controls: [f32; PARAMETERS], seconds: f64) -> Vec<f32> {
        render_with(config, controls, seconds, None)
    }
    /// Optionally changes configuration index `.0` to `.1` after `.2` blocks, through `update`.
    fn render_with(
        config: [f32; CONFIG_SIZE],
        controls: [f32; PARAMETERS],
        seconds: f64,
        change: Option<(usize, f32, usize)>,
    ) -> Vec<f32> {
        let mut v = TimbreVoice::new(48000.0);
        v.config = config;
        v.configure();
        for (slot, value) in controls.iter().enumerate() {
            v.parameters[slot * BLOCK..(slot + 1) * BLOCK].fill(*value);
        }
        let mut out = vec![];
        for block in 0..(seconds * 48000.0) as usize / BLOCK {
            if let Some((index, value, at)) = change {
                if block == at {
                    v.config[index] = value;
                    v.update();
                }
            }
            v.process(BLOCK);
            out.extend_from_slice(&v.output);
        }
        out
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }
    const CONTROLS: [f32; PARAMETERS] = [1.0, 0.0, 0.0];

    #[test]
    fn every_family_and_filter_renders_bounded_deterministic_audio() {
        for family in 0..3 {
            for filter in 0..2 {
                let mut config = DEFAULT_CONFIG;
                config[0] = family as f32;
                config[1] = filter as f32;
                config[5] = 0.5;
                let out = render(config, CONTROLS, 0.5);
                assert!(out.iter().all(|x| x.is_finite() && x.abs() < 2.0));
                assert!(rms(&out[4800..]) > 0.01, "{family}/{filter} is silent");
                assert_eq!(out, render(config, CONTROLS, 0.5));
            }
        }
    }

    #[test]
    fn controls_and_modulation_change_the_sound() {
        // The Wavetable family, where motion matters too.
        let mut wave = DEFAULT_CONFIG;
        wave[0] = 2.0;
        let base = render(wave, CONTROLS, 0.3);
        let differs = |out: Vec<f32>| {
            let delta: Vec<f32> = out.iter().zip(&base).map(|(a, b)| a - b).collect();
            rms(&delta) > 1e-3
        };
        // Position, cutoff, resonance and motion from the first block, and changed mid-note.
        for (index, value) in [(10, 0.0), (8, 300.0), (9, 8.0), (11, 0.0)] {
            let mut config = wave;
            config[index] = value;
            assert!(differs(render(config, CONTROLS, 0.3)), "config {index}");
            assert!(differs(render_with(
                wave,
                CONTROLS,
                0.3,
                Some((index, value, 40))
            )));
        }
        assert!(differs(render(wave, [1.0, 700.0, 0.0], 0.3)), "detune");
        for (target, amount) in [(1.0, -1200.0), (2.0, 1.0), (3.0, 700.0)] {
            let mut config = wave;
            config[7] = target;
            assert!(
                differs(render(config, [1.0, 0.0, amount], 0.3)),
                "target {target}"
            );
        }
    }

    #[test]
    fn silent_until_the_gate_and_safe_with_malformed_input() {
        let mut controls = CONTROLS;
        controls[0] = 0.0;
        assert!(render(DEFAULT_CONFIG, controls, 0.2)
            .iter()
            .all(|x| *x == 0.0));
        let mut v = TimbreVoice::new(f32::NAN);
        for bad in [f32::NAN, f32::INFINITY, -f32::INFINITY, -1e30, 1e30] {
            v.config.fill(bad);
            v.configure();
            v.parameters.fill(bad);
            v.parameters[..BLOCK].fill(1.0);
            for _ in 0..64 {
                v.process(BLOCK);
                assert!(v.output.iter().all(|x| x.is_finite() && x.abs() < 4.0));
            }
        }
    }

    #[test]
    #[ignore = "manual release-mode CPU measurement, no timing threshold"]
    fn measure_32_active_voices() {
        for family in 0..3 {
            for filter in 0..2 {
                let mut voices: Vec<_> = (0..32)
                    .map(|_| {
                        let mut v = TimbreVoice::new(48000.0);
                        v.config[0] = family as f32;
                        v.config[1] = filter as f32;
                        v.configure();
                        for (slot, value) in CONTROLS.iter().enumerate() {
                            v.parameters[slot * BLOCK..(slot + 1) * BLOCK].fill(*value);
                        }
                        v
                    })
                    .collect();
                let start = std::time::Instant::now();
                let mut checksum = 0.0;
                for _ in 0..375 {
                    for v in &mut voices {
                        v.process(BLOCK);
                        checksum += std::hint::black_box(v.output[64]);
                    }
                }
                eprintln!(
                    "family {family} filter {filter}: 32 voices, 1 s at 48 kHz: {:?} ({checksum})",
                    start.elapsed()
                );
            }
        }
    }
}
