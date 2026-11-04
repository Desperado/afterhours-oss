//! Groove machine voices: the six FM machines (Kick, Snare, Metal, Perc, Tone, Chord) and Saw.
//!
//! One voice renders one note: operators or oscillators, noise, filters and the amplitude
//! envelope. The browser supplies the gate and continuous modulation (tuning, LFO); all
//! envelope shapes are derived here from the track settings in the configuration.
use crate::{
    biquad::Biquad,
    fastmath::sine_cycle,
    halfband::Downsampler,
    oscillator::{Oscillator, Wave},
    BLOCK,
};

/// Control planes: gate (−1 stops), pitch detune in cents, and one modulation input whose
/// target is chosen per note (configuration index 12).
pub const PARAMETERS: usize = 3;
pub const CONFIG_SIZE: usize = 16;
pub const DEFAULT_CONFIG: [f32; CONFIG_SIZE] = [
    0.0, 55.0, 0.5, 10.0, 15.0, 60.0, 60.0, 2600.0, 0.0, 0.1, 0.38, 0.0, 0.0, 0.0, 0.0, 0.0,
];
/// Web Audio's exponential ramps end at this level before the voice stops.
const FLOOR: f64 = 0.00001;
/// Web Audio normalizes its sawtooth to the Gibbs peak of the full series, 2/π·Si(π).
const SAW_LEVEL: f64 = 1.0 / 1.178_979_744;

fn finite(value: f32, min: f32, max: f32, default: f32) -> f64 {
    f64::from(if value.is_finite() {
        value.clamp(min, max)
    } else {
        default
    })
}

/// Saw saturation: the 2049-point tanh(2x) curve the Web Audio WaveShaper used, shared by
/// every voice and read with the same linear interpolation.
fn saturate(x: f64) -> f64 {
    static CURVE: std::sync::OnceLock<[f32; 2049]> = std::sync::OnceLock::new();
    let curve = CURVE
        .get_or_init(|| std::array::from_fn(|i| ((i as f64 / 1024.0 - 1.0) * 2.0).tanh() as f32));
    let position = (x.clamp(-1.0, 1.0) + 1.0) * 1024.0;
    let index = (position as usize).min(2047);
    let fraction = position - index as f64;
    f64::from(curve[index]) * (1.0 - fraction) + f64::from(curve[index + 1]) * fraction
}

/// Starts at zero and rises, like Web Audio's triangle.
fn triangle(phase: f64) -> f64 {
    let x = phase - phase.floor();
    if x < 0.25 {
        4.0 * x
    } else if x < 0.75 {
        2.0 - 4.0 * x
    } else {
        4.0 * x - 4.0
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Machine {
    Kick,
    Snare,
    Metal,
    Perc,
    Tone,
    Chord,
    Saw,
}

impl Machine {
    fn from_id(id: f32) -> Self {
        match id as u32 {
            1 => Self::Snare,
            2 => Self::Metal,
            3 => Self::Perc,
            4 => Self::Tone,
            5 => Self::Chord,
            6 => Self::Saw,
            _ => Self::Kick,
        }
    }
    fn percussion(self) -> bool {
        matches!(self, Self::Kick | Self::Snare | Self::Metal | Self::Perc)
    }
}

/// The lowpass Q of every Groove voice, 0.65 dB, as 1/(2·10^(Q/20)), the form `Biquad::set` takes.
const LOWPASS_Q: f64 = 0.46394874506366557;

/// Web Audio exponentialRampToValueAtTime, sampled from the start of the ramp.
#[derive(Clone, Copy)]
struct Ramp {
    value: f64,
    factor: f64,
    left: u32,
    target: f64,
}

impl Ramp {
    fn new(from: f64, to: f64, seconds: f64, rate: f64) -> Self {
        let samples = (seconds * rate).round().max(1.0);
        // Like Web Audio, a ramp from zero (or across zero) holds its start value.
        let factor = if from > 0.0 && to > 0.0 {
            (to / from).powf(1.0 / samples)
        } else {
            1.0
        };
        Self {
            value: from,
            factor,
            left: samples as u32,
            target: to,
        }
    }
    fn hold(value: f64) -> Self {
        Self::new(value, value, 0.0, 1.0)
    }
    fn tick(&mut self) -> f64 {
        let value = self.value;
        if self.left > 0 {
            self.left -= 1;
            self.value = if self.left == 0 {
                self.target
            } else {
                self.value * self.factor
            };
        }
        value
    }
    fn done(&self) -> bool {
        self.left == 0
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Pending,
    Attack,
    Hold,
    Decay,
    Sustain,
    Release,
    Done,
}

struct Settings {
    machine: Machine,
    hz: f64,
    loudness: f64,
    color: f64,
    shape: f64,
    sweep: f64,
    contour: f64,
    cutoff: f64,
    serial: bool,
    gate: f64,
    decay: f64,
    held: bool,
    /// What the modulation plane drives: 0 nothing, 1 filter cents, 2 shape, 3 pitch cents.
    modulation: u8,
}

impl Settings {
    fn from(c: &[f32; CONFIG_SIZE]) -> Self {
        Self {
            machine: Machine::from_id(finite(c[0], 0.0, 6.0, 0.0) as f32),
            hz: finite(c[1], 8.0, 7000.0, 55.0),
            loudness: finite(c[2], 0.0, 2.0, 0.5),
            color: finite(c[3], 0.0, 100.0, 10.0),
            shape: finite(c[4], 0.0, 100.0, 15.0),
            sweep: finite(c[5], 0.0, 100.0, 60.0),
            contour: finite(c[6], 0.0, 100.0, 60.0),
            cutoff: finite(c[7], 20.0, 24000.0, 2600.0),
            serial: finite(c[8], 0.0, 1.0, 0.0) > 0.5,
            gate: finite(c[9], 0.0, 60.0, 0.1),
            decay: finite(c[10], 0.01, 10.0, 0.38),
            held: finite(c[11], 0.0, 1.0, 0.0) > 0.5,
            modulation: finite(c[12], 0.0, 3.0, 0.0) as u8,
        }
    }
}

pub struct GrooveVoice {
    rate: f64,
    machine: Machine,
    stage: Stage,
    /// Samples since the gate opened.
    n: u32,
    loudness: f64,
    attack: u32,
    hold: u32,
    end: u32,
    step: f64,
    held: bool,
    release: f64,
    amp: Ramp,
    // FM operators: carrier, modulator, second carrier, second modulator.
    phases: [f64; 4],
    pitch: Ramp,
    depth: Ramp,
    depth2: f64,
    shape_depth: f64,
    modulator: f64,
    second: f64,
    modulator2: f64,
    second_level: f64,
    serial: bool,
    noise_level: f64,
    noise_seed: u32,
    noise_index: u32,
    noise_length: u32,
    noise_filter: Biquad,
    metal: Option<Biquad>,
    // Saw: two band-limited saws and a triangle sub at twice the rate, then saturation.
    saws: [Oscillator; 2],
    spread: f64,
    sub_phase: f64,
    drive: f64,
    down: Downsampler,
    dc: Biquad,
    // Shared lowpass, with an optional exponential cutoff sweep.
    cutoff: Ramp,
    filter: Biquad,
    filter_hz: f64,
    hz: f64,
    detune: f32,
    ratio: f64,
    filter_detune: f32,
    filter_ratio: f64,
    modulation: u8,
    pub config: [f32; CONFIG_SIZE],
    pub parameters: [f32; PARAMETERS * BLOCK],
    pub output: [f32; BLOCK],
}

impl GrooveVoice {
    pub fn new(rate: f32) -> Self {
        let mut voice = Self {
            rate: finite(rate, 8000.0, 192000.0, 48000.0),
            machine: Machine::Kick,
            stage: Stage::Pending,
            n: 0,
            loudness: 0.0,
            attack: 1,
            hold: 1,
            end: 1,
            step: 1.0,
            held: false,
            release: 0.1,
            amp: Ramp::hold(0.0),
            phases: [0.0; 4],
            pitch: Ramp::hold(55.0),
            depth: Ramp::hold(0.0),
            depth2: 0.0,
            shape_depth: 0.0,
            modulator: 0.0,
            second: 0.0,
            modulator2: 0.0,
            second_level: 0.0,
            serial: false,
            noise_level: 0.0,
            noise_seed: 1979,
            noise_index: 0,
            noise_length: 48000,
            noise_filter: Biquad::default(),
            metal: None,
            saws: [Oscillator::new(0.5), Oscillator::new(0.5)],
            spread: 1.0,
            sub_phase: 0.0,
            drive: 1.0,
            down: Downsampler::new(),
            dc: Biquad::default(),
            cutoff: Ramp::hold(1000.0),
            filter: Biquad::default(),
            filter_hz: -1.0,
            hz: 55.0,
            detune: 0.0,
            ratio: 1.0,
            filter_detune: 0.0,
            filter_ratio: 1.0,
            modulation: 0,
            config: DEFAULT_CONFIG,
            parameters: [0.0; PARAMETERS * BLOCK],
            output: [0.0; BLOCK],
        };
        voice.configure();
        voice
    }

    pub fn configure(&mut self) {
        let s = Settings::from(&self.config);
        let rate = self.rate;
        let percussion = s.machine.percussion();
        let length = if percussion {
            s.decay
        } else {
            (s.gate + s.decay).min(8.0)
        };
        let attack = if s.machine == Machine::Chord {
            0.012 + (100.0 - s.contour) * 0.0005
        } else {
            0.003
        };
        let samples = |seconds: f64| (seconds * rate).round().max(1.0) as u32;
        self.machine = s.machine;
        self.stage = Stage::Pending;
        self.n = 0;
        self.loudness = s.loudness;
        self.attack = samples(attack.min(length / 3.0));
        self.end = samples(length + 0.04);
        // Percussion decays straight from the attack; sustained notes hold, then drop to 72%.
        let hold = if percussion { 0.0 } else { attack.max(s.gate) };
        self.hold = samples(hold).max(self.attack);
        self.step = if percussion { 1.0 } else { 0.72 };
        // A live key holds until its gate falls; percussion always runs its own decay.
        self.held = s.held && !percussion;
        if !self.held && self.hold >= self.end {
            self.hold = self.attack;
            self.step = 1.0;
        }
        self.release = s.decay + 0.04;
        self.hz = s.hz;
        self.detune = 0.0;
        self.ratio = 1.0;
        self.filter_detune = 0.0;
        self.filter_ratio = 1.0;
        self.modulation = s.modulation;
        let nyquist = rate * 0.5;
        let limit = |hz: f64, max: f64| hz.min(max).min(nyquist);
        self.cutoff = Ramp::hold(s.cutoff.min(rate * 0.42));
        if s.machine == Machine::Saw {
            self.spread = ((2.0 + s.color * 0.2) / 1200.0).exp2();
            self.sub_phase = 0.0;
            self.drive = 1.0 + s.shape / 14.0;
            self.shape_depth = s.shape / 14.0 * 0.7;
            self.saws = [Oscillator::new(0.5), Oscillator::new(0.5)];
            self.down = Downsampler::new();
            self.dc.set(true, 25.0, Biquad::q(0.5), rate);
            self.cutoff = Ramp::new(
                (s.cutoff * (1.0 + s.sweep / 18.0)).min(rate * 0.42),
                s.cutoff.min(rate * 0.42),
                (length * (0.12 + s.contour / 160.0)).max(0.02),
                rate,
            );
        } else {
            let ratio = if s.machine == Machine::Metal {
                1.414 + s.color / 18.0
            } else {
                [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 7.0, 9.0][((s.color * 0.0799) as usize).min(7)]
            };
            let index = 0.04
                + (s.shape / 100.0).powi(2)
                    * if s.machine == Machine::Kick {
                        3.0
                    } else {
                        12.0
                    };
            let deviation = s.hz * index;
            let snare = s.machine == Machine::Snare;
            // The snare tunes its pair inharmonically for a wire-like transient.
            self.modulator = if snare {
                s.hz * 7.13
            } else {
                limit(s.hz * ratio, 11000.0)
            };
            self.second = if snare {
                s.hz * 1.871
            } else {
                limit(
                    s.hz * if s.machine == Machine::Metal {
                        2.756
                    } else {
                        1.003
                    },
                    11000.0,
                )
            };
            self.modulator2 = limit(s.hz * if snare { 6.73 } else { ratio * 2.01 }, 14000.0);
            self.depth = Ramp::new(
                deviation,
                (deviation * 0.08).max(0.01),
                (length * (0.1 + s.contour / 120.0)).max(0.02),
                rate,
            );
            self.depth2 = deviation * 0.4;
            self.shape_depth = deviation * 0.8;
            self.second_level = if s.machine == Machine::Kick {
                0.12
            } else {
                0.35
            };
            self.serial = s.serial;
            self.pitch = if s.sweep > 0.0 {
                let scale = if percussion { 14.0 } else { 150.0 };
                Ramp::new(
                    s.hz * (1.0 + s.sweep / scale),
                    s.hz,
                    (length * 0.45).min(0.12),
                    rate,
                )
            } else {
                Ramp::hold(s.hz)
            };
            self.phases = [0.0; 4];
            self.noise_level = match s.machine {
                Machine::Snare => 0.9,
                Machine::Metal => 0.65,
                _ => 0.0,
            };
            self.noise_seed = 1979;
            self.noise_index = 0;
            self.noise_length = rate.round() as u32;
            self.noise_filter = Biquad::default();
            self.noise_filter.set(
                true,
                if snare { 1100.0 } else { 6000.0 },
                Biquad::q(1.0),
                rate,
            );
            self.metal = (s.machine == Machine::Metal).then(|| {
                let mut hp = Biquad::default();
                hp.set(true, 1500.0 + s.color * 35.0, LOWPASS_Q, rate);
                hp
            });
        }
        self.filter = Biquad::default();
        self.filter_hz = -1.0;
    }

    /// Amplitude for the current sample; advances the envelope.
    fn envelope(&mut self, gate: bool) -> f64 {
        if self.held && !gate && matches!(self.stage, Stage::Attack | Stage::Hold | Stage::Sustain)
        {
            let from = self.amp.value;
            self.amp = Ramp::new(from, FLOOR, self.release, self.rate);
            self.stage = Stage::Release;
        }
        let n = self.n;
        let value = match self.stage {
            Stage::Attack => {
                let value = self.loudness * f64::from(n) / f64::from(self.attack);
                self.amp = Ramp::hold(value);
                value
            }
            Stage::Hold | Stage::Sustain => self.amp.value,
            Stage::Decay | Stage::Release => self.amp.tick(),
            Stage::Pending | Stage::Done => 0.0,
        };
        let next = n + 1;
        match self.stage {
            Stage::Attack if next >= self.attack => {
                self.amp = Ramp::hold(self.loudness);
                self.stage = Stage::Hold;
                if next >= self.hold {
                    self.after_hold();
                }
            }
            Stage::Hold if next >= self.hold => self.after_hold(),
            Stage::Decay | Stage::Release if self.amp.done() => self.stage = Stage::Done,
            _ => {}
        }
        value
    }

    fn after_hold(&mut self) {
        let level = self.loudness * self.step;
        if self.held {
            self.amp = Ramp::hold(level);
            self.stage = Stage::Sustain;
        } else {
            let seconds = f64::from(self.end.saturating_sub(self.n + 1)) / self.rate;
            self.amp = Ramp::new(level, FLOOR, seconds, self.rate);
            self.stage = Stage::Decay;
        }
    }

    fn lowpass(&mut self, detune: f64) -> f64 {
        let hz = self.cutoff.tick() * detune;
        if hz != self.filter_hz {
            self.filter_hz = hz;
            self.filter.set(false, hz, LOWPASS_Q, self.rate);
        }
        hz
    }

    fn noise(&mut self) -> f64 {
        if self.noise_index == self.noise_length {
            self.noise_index = 0;
            self.noise_seed = 1979;
        }
        self.noise_index += 1;
        self.noise_seed = self
            .noise_seed
            .wrapping_mul(1664525)
            .wrapping_add(1013904223);
        f64::from((self.noise_seed as f64 / 2147483648.0 - 1.0) as f32)
    }

    fn fm(&mut self, ratio: f64, shape: f64) -> f64 {
        let nyquist = self.rate * 0.5;
        let inverse = 1.0 / self.rate;
        let advance = |phase: &mut f64, hz: f64| {
            *phase += (hz * ratio).clamp(-nyquist, nyquist) * inverse;
            *phase -= phase.floor();
        };
        let modulator2 = sine_cycle(self.phases[3]);
        advance(&mut self.phases[3], self.modulator2);
        let (serial, parallel) = if self.serial {
            (modulator2 * self.depth2, 0.0)
        } else {
            (0.0, modulator2 * self.depth2)
        };
        let modulator = sine_cycle(self.phases[1]);
        advance(&mut self.phases[1], self.modulator + serial);
        let second = sine_cycle(self.phases[2]);
        advance(&mut self.phases[2], self.second + parallel);
        let depth = self.depth.tick() + shape * self.shape_depth;
        let carrier = sine_cycle(self.phases[0]);
        advance(&mut self.phases[0], self.pitch.tick() + modulator * depth);
        let mut input = carrier * 0.65 + second * self.second_level;
        if self.noise_level > 0.0 {
            let noise = self.noise();
            input += self.noise_filter.tick(noise) * self.noise_level;
        }
        match &mut self.metal {
            Some(highpass) => highpass.tick(input),
            None => input,
        }
    }

    fn saw(&mut self, ratio: f64, shape: f64) -> f64 {
        let rate = self.rate * 2.0;
        let hz = self.hz * ratio;
        let drive = self.drive + shape * self.shape_depth;
        let mut samples = [0.0; 2];
        for sample in &mut samples {
            let low = self.saws[0].tick((hz / self.spread) as f32, rate as f32, Wave::Saw, 0.5);
            let high = self.saws[1].tick((hz * self.spread) as f32, rate as f32, Wave::Saw, 0.5);
            let sub = triangle(self.sub_phase);
            self.sub_phase = (self.sub_phase + hz * 0.5 / rate).fract();
            let x = (f64::from(low + high) * SAW_LEVEL * 0.36 + sub * 0.2) * drive;
            *sample = saturate(x) as f32;
        }
        self.dc
            .tick(f64::from(self.down.process(samples[0], samples[1])))
    }

    pub fn process(&mut self, frames: usize) {
        for i in 0..frames.min(BLOCK) {
            let value = |slot: usize| self.parameters[slot * BLOCK + i];
            let gate = value(0).is_finite() && value(0) > 0.5;
            if self.stage == Stage::Pending && gate {
                self.stage = Stage::Attack;
                self.n = 0;
            }
            if matches!(self.stage, Stage::Pending | Stage::Done) {
                self.output[i] = 0.0;
                continue;
            }
            let modulation = finite(value(2), -1e6, 1e6, 0.0);
            let (pitch, filter, shape) = match self.modulation {
                1 => (0.0, modulation, 0.0),
                2 => (0.0, 0.0, modulation.clamp(-16.0, 16.0)),
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
            let input = if self.machine == Machine::Saw {
                self.saw(self.ratio, shape)
            } else {
                self.fm(self.ratio, shape)
            };
            self.lowpass(self.filter_ratio);
            let filtered = self.filter.tick(input);
            let amp = self.envelope(gate);
            self.n = self.n.saturating_add(1);
            if self.stage == Stage::Done || (!self.held && self.n >= self.end) {
                self.stage = Stage::Done;
            }
            self.output[i] = (filtered * amp) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KICK: [f32; CONFIG_SIZE] = [
        0.0, 65.4, 0.5, 10.0, 15.0, 60.0, 60.0, 2600.0, 0.0, 0.1, 0.38, 0.0, 0.0, 0.0, 0.0, 0.0,
    ];

    fn render(config: [f32; CONFIG_SIZE], seconds: f32, gate_off: Option<usize>) -> Vec<f32> {
        let mut v = GrooveVoice::new(48000.0);
        v.config = config;
        v.configure();
        v.parameters.fill(0.0);
        let mut out = vec![];
        for block in 0..(seconds * 48000.0) as usize / BLOCK {
            let open = gate_off.is_none_or(|b| block < b);
            v.parameters[..BLOCK].fill(if open { 1.0 } else { 0.0 });
            v.process(BLOCK);
            out.extend_from_slice(&v.output);
        }
        out
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn lowpass_q_is_0_65_db() {
        assert!((Biquad::q(0.65) - LOWPASS_Q).abs() < 1e-12);
    }

    #[test]
    fn every_machine_renders_finite_audio_that_ends() {
        for machine in 0..7 {
            let mut config = KICK;
            config[0] = machine as f32;
            config[1] = if machine == 0 { 65.4 } else { 220.0 };
            config[5] = 40.0;
            let out = render(config, 2.0, None);
            assert!(out.iter().all(|x| x.is_finite() && x.abs() < 2.0));
            assert!(rms(&out[..9600]) > 0.005, "machine {machine} is silent");
            assert!(out[out.len() - 4800..].iter().all(|x| *x == 0.0));
        }
    }

    #[test]
    fn rendering_is_deterministic_and_waits_for_the_gate() {
        let a = render(KICK, 0.5, None);
        assert_eq!(a, render(KICK, 0.5, None));
        let mut v = GrooveVoice::new(48000.0);
        v.config = KICK;
        v.configure();
        v.parameters.fill(0.0);
        v.process(BLOCK);
        assert_eq!(v.output, [0.0; BLOCK]);
        v.parameters[64..BLOCK].fill(1.0);
        v.process(BLOCK);
        // The first sample is sin(0); the operators begin exactly at the gate.
        assert!(v.output[..65].iter().all(|x| *x == 0.0));
        assert!(v.output[66..].iter().any(|x| x.abs() > 1e-6));
    }

    #[test]
    fn held_notes_sustain_until_the_gate_falls_then_release() {
        let mut tone = KICK;
        tone[0] = 4.0;
        tone[1] = 110.0;
        tone[9] = 0.05;
        tone[10] = 0.2;
        tone[11] = 1.0;
        // 1.5 s in, a scheduled note would be silent; a held note keeps sounding.
        let out = render(tone, 2.0, Some(600));
        assert!(rms(&out[68000..72000]) > 0.01);
        assert!(out[600 * BLOCK + 14000..].iter().all(|x| *x == 0.0));
        tone[11] = 0.0;
        let scheduled = render(tone, 2.0, None);
        assert!(scheduled[68000..].iter().all(|x| *x == 0.0));
    }

    #[test]
    fn controls_change_the_signal() {
        let base = render(KICK, 0.3, None);
        let mut v = GrooveVoice::new(48000.0);
        let mut moved = vec![];
        // Detune, then the modulation plane driving filter, shape and pitch.
        for (slot, target, amount) in [
            (1, 0.0, -1200.0),
            (2, 1.0, -1200.0),
            (2, 2.0, 1.0),
            (2, 3.0, -1200.0),
        ] {
            v.config = KICK;
            v.config[12] = target;
            v.configure();
            v.parameters.fill(0.0);
            v.parameters[..BLOCK].fill(1.0);
            v.parameters[slot * BLOCK..(slot + 1) * BLOCK].fill(amount);
            let mut out = vec![];
            for _ in 0..(0.3 * 48000.0) as usize / BLOCK {
                v.process(BLOCK);
                out.extend_from_slice(&v.output);
            }
            let delta: Vec<f32> = out.iter().zip(&base).map(|(a, b)| a - b).collect();
            moved.push(rms(&delta));
        }
        assert!(moved.iter().all(|d| *d > 1e-4), "{moved:?}");
    }

    #[test]
    fn malformed_configuration_and_controls_stay_bounded() {
        let mut v = GrooveVoice::new(f32::NAN);
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
        for machine in [1.0, 5.0, 6.0] {
            let mut voices: Vec<_> = (0..32)
                .map(|_| {
                    let mut v = GrooveVoice::new(48000.0);
                    v.config = KICK;
                    v.config[0] = machine;
                    v.config[1] = 220.0;
                    v.config[9] = 4.0;
                    v.config[10] = 2.0;
                    v.configure();
                    v.parameters[..BLOCK].fill(1.0);
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
                "machine {machine}: 32 voices, 1 second at 48 kHz: {:?}; checksum {checksum}",
                start.elapsed()
            );
        }
    }
}
