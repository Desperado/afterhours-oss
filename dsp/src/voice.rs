//! Complete subtractive voice. The browser supplies sample-timed controls, never audio samples.
use crate::{
    envelope::{Adsr, Envelope},
    filter::Filter,
    halfband::Downsampler,
    modulation::{smooth, Modulation},
    oscillator::{Oscillator, Wave},
    BLOCK,
};

pub const PARAMETERS: usize = 11;
pub const CONFIG_SIZE: usize = 20;
pub const DEFAULT_CONFIG: [f32; CONFIG_SIZE] = [
    0.0, 1.0, 1.0, 4.0, 0.12, 0.0, 2.0, 0.3, 0.005, 0.2, 0.6, 0.3, 0.01, 0.2, 0.0, 0.15, 0.0,
    220.0, 1979.0, 0.0,
];
fn finite(value: f32, min: f32, max: f32, default: f32) -> f32 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        default
    }
}

struct Patch {
    waves: [Wave; 2],
    ratio: f32,
    detune: f32,
    sub: f32,
    noise: f32,
    drift: f32,
    speed: f32,
    amp: Adsr,
    envelope: Adsr,
    glide: f32,
}
impl Patch {
    fn from(c: &[f32; CONFIG_SIZE]) -> Self {
        let adsr = |i| Adsr {
            attack: finite(c[i], 0.001, 10.0, 0.005),
            decay: finite(c[i + 1], 0.005, 10.0, 0.2),
            sustain: finite(c[i + 2], 0.0, 1.0, 0.6),
            release: finite(c[i + 3], 0.005, 10.0, 0.3),
        };
        Self {
            waves: [Wave::from_id(c[0]), Wave::from_id(c[1])],
            ratio: finite(c[2], 0.25, 4.0, 1.0),
            detune: finite(c[3], 0.0, 50.0, 4.0),
            sub: finite(c[4], 0.0, 1.0, 0.12),
            noise: finite(c[5], 0.0, 0.5, 0.0),
            drift: finite(c[6], 0.0, 20.0, 2.0),
            speed: finite(c[7], 0.01, 20.0, 0.3),
            amp: adsr(8),
            envelope: adsr(12),
            glide: finite(c[16], 0.0, 2.0, 0.0),
        }
    }
}

pub struct SynthVoice {
    rate: f32,
    patch: Patch,
    oscillators: [Oscillator; 3],
    amp: Envelope,
    envelope: Envelope,
    filter: Filter,
    modulation: Modulation,
    down: Downsampler,
    silent: usize,
    hz: f32,
    cutoff: f32,
    blend: f32,
    width: f32,
    drive: f32,
    resonance: f32,
    glide_coefficient: f32,
    control_coefficient: f32,
    pub config: [f32; CONFIG_SIZE],
    pub parameters: [f32; PARAMETERS * BLOCK],
    pub output: [f32; BLOCK],
}
impl SynthVoice {
    pub fn new(rate: f32) -> Self {
        let rate = finite(rate, 8000.0, 192000.0, 48000.0) * 2.0;
        Self {
            rate,
            patch: Patch::from(&DEFAULT_CONFIG),
            oscillators: [
                Oscillator::new(0.0),
                Oscillator::new(0.27),
                Oscillator::new(0.0),
            ],
            amp: Envelope::new(),
            envelope: Envelope::new(),
            filter: Filter::new(),
            modulation: Modulation::new(1979),
            down: Downsampler::new(),
            silent: 32,
            hz: 220.0,
            cutoff: 1000.0,
            blend: 0.5,
            width: 0.5,
            drive: 1.4,
            resonance: 0.0,
            glide_coefficient: 1.0,
            control_coefficient: 1.0 - (-1.0 / (0.003 * rate)).exp(),
            config: DEFAULT_CONFIG,
            parameters: [0.0; PARAMETERS * BLOCK],
            output: [0.0; BLOCK],
        }
    }
    pub fn configure(&mut self) {
        self.patch = Patch::from(&self.config);
        self.hz = finite(self.config[17], 8.0, 20000.0, 220.0);
        self.modulation = Modulation::new(finite(self.config[18], 1.0, 16777215.0, 1979.0) as u32);
        self.glide_coefficient = if self.patch.glide == 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (self.patch.glide * self.rate)).exp()
        };
    }
    pub fn process(&mut self, frames: usize) {
        for i in 0..frames.min(BLOCK) {
            let value = |slot| self.parameters[slot * BLOCK + i];
            let gate = value(2).is_finite() && value(2) > 0.5;
            if !gate && self.amp.is_idle() {
                // Flush the 63-tap FIR, then skip DSP for pending/finished notes.
                self.output[i] = if self.silent < 32 {
                    self.down.process(0.0, 0.0)
                } else {
                    0.0
                };
                self.silent = (self.silent + 1).min(32);
                continue;
            }
            self.silent = 0;
            let hz = finite(value(0), 8.0, 20000.0, 220.0)
                * (finite(value(1), -9600.0, 9600.0, 0.0) / 1200.0).exp2();
            let cutoff = finite(value(3), 20.0, 24000.0, 1000.0)
                * (finite(value(4), -9600.0, 9600.0, 0.0) / 1200.0).exp2();
            let blend = finite(value(5), 0.0, 1.0, 0.5);
            let motion = finite(value(6), 0.0, 1.0, 0.0);
            let drive = finite(value(7), 0.1, 8.0, 1.4);
            let resonance = finite(value(8), 0.0, 3.95, 0.0);
            let width = finite(value(9), 0.05, 0.95, 0.5);
            let amount = finite(value(10), -6.0, 6.0, 0.0);
            let mut samples = [0.0; 2];
            for sample in &mut samples {
                let hz = smooth(&mut self.hz, hz, self.glide_coefficient);
                let cutoff = smooth(&mut self.cutoff, cutoff, self.control_coefficient);
                let blend = smooth(&mut self.blend, blend, self.control_coefficient);
                let width = smooth(&mut self.width, width, self.control_coefficient);
                let drive = smooth(&mut self.drive, drive, self.control_coefficient);
                let resonance = smooth(&mut self.resonance, resonance, self.control_coefficient);
                let (lfo, drift, noise) = self.modulation.tick(self.rate, self.patch.speed);
                let detune = (self.patch.detune + drift * self.patch.drift) / 1200.0;
                let pulse = width + lfo * motion * 0.4;
                let a = self.oscillators[0].tick(
                    hz * (-detune).exp2(),
                    self.rate,
                    self.patch.waves[0],
                    pulse,
                );
                let b = self.oscillators[1].tick(
                    hz * self.patch.ratio * detune.exp2(),
                    self.rate,
                    self.patch.waves[1],
                    pulse,
                );
                let sub = self.oscillators[2].tick(hz * 0.5, self.rate, Wave::Sine, 0.5);
                let mix = (a * (1.0 - blend)
                    + b * blend
                    + sub * self.patch.sub
                    + noise * self.patch.noise)
                    * 0.65;
                let envelope = self.envelope.tick(gate, self.patch.envelope, self.rate);
                let filtered = self.filter.tick(
                    mix,
                    cutoff * (amount * envelope).exp2(),
                    resonance,
                    drive,
                    self.rate,
                );
                *sample = filtered * self.amp.tick(gate, self.patch.amp, self.rate);
            }
            self.output[i] = self.down.process(samples[0], samples[1]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn voice(rate: f32) -> SynthVoice {
        let mut v = SynthVoice::new(rate);
        v.configure();
        for (slot, value) in [220.0, 0.0, 1.0, 1800.0, 0.0, 0.5, 0.5, 1.4, 1.0, 0.5, 3.0]
            .iter()
            .enumerate()
        {
            v.parameters[slot * BLOCK..(slot + 1) * BLOCK].fill(*value);
        }
        v
    }
    #[test]
    fn voice_is_deterministic_at_all_supported_rates_and_releases() {
        for rate in [22050.0, 44100.0, 48000.0, 96000.0] {
            let (mut a, mut b) = (voice(rate), voice(rate));
            let mut energy = 0.0;
            for block in 0..(rate as usize / BLOCK) {
                if block == 20 {
                    a.parameters[2 * BLOCK..3 * BLOCK].fill(0.0);
                    b.parameters[2 * BLOCK..3 * BLOCK].fill(0.0);
                }
                a.process(BLOCK);
                b.process(BLOCK);
                assert_eq!(a.output, b.output);
                assert!(a.output.iter().all(|x| x.is_finite() && x.abs() < 2.0));
                energy += a.output.iter().map(|x| x * x).sum::<f32>();
            }
            assert!(energy > 1.0);
            assert!(a.output.iter().all(|x| x.abs() < 1e-6));
        }
    }
    #[test]
    fn malformed_controls_and_extreme_modulation_never_poison_the_voice() {
        let mut v = voice(48000.0);
        for bad in [f32::NAN, f32::INFINITY, -f32::INFINITY, -1e30, 1e30] {
            v.config.fill(bad);
            v.configure();
            v.parameters.fill(bad);
            v.parameters[2 * BLOCK..3 * BLOCK].fill(1.0);
            for _ in 0..64 {
                v.process(BLOCK);
                assert!(v.output.iter().all(|x| x.is_finite() && x.abs() < 4.0));
            }
        }
    }
    #[test]
    #[ignore = "manual release-mode CPU measurement, no timing threshold"]
    fn measure_32_active_voices() {
        let mut voices: Vec<_> = (0..32).map(|_| voice(48000.0)).collect();
        let start = std::time::Instant::now();
        let mut checksum = 0.0;
        for _ in 0..375 {
            for v in &mut voices {
                v.process(BLOCK);
                checksum += std::hint::black_box(v.output[64]);
            }
        }
        eprintln!(
            "32 voices, 1 second at 48 kHz: {:?}; checksum {}",
            start.elapsed(),
            checksum
        );
        assert!(checksum.is_finite());
    }
    #[test]
    fn gate_is_sample_timed_and_silent_before_a_future_note() {
        let mut v = voice(48000.0);
        v.parameters[2 * BLOCK..3 * BLOCK].fill(0.0);
        for _ in 0..4500 {
            v.process(BLOCK);
            assert_eq!(v.output, [0.0; BLOCK]);
        }
        v.parameters[2 * BLOCK + 64..3 * BLOCK].fill(1.0);
        v.process(BLOCK);
        assert!(v.output[..64].iter().all(|x| *x == 0.0));
        assert!(v.output[64..].iter().any(|x| x.abs() > 1e-6));
    }
}
