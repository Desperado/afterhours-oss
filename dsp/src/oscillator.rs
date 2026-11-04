//! Band-limited oscillator primitives. No allocation or platform audio dependencies.
use std::f32::consts::TAU;

#[derive(Clone, Copy)]
pub enum Wave {
    Saw,
    Pulse,
    Triangle,
    Sine,
}

impl Wave {
    pub fn from_id(id: f32) -> Self {
        match id as u32 {
            1 => Self::Pulse,
            2 => Self::Triangle,
            3 => Self::Sine,
            _ => Self::Saw,
        }
    }
}

pub struct Oscillator {
    phase: f64,
    triangle: f32,
}

fn blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

impl Oscillator {
    pub fn new(phase: f64) -> Self {
        Self {
            phase,
            triangle: 0.0,
        }
    }
    pub fn tick(&mut self, hz: f32, rate: f32, wave: Wave, width: f32) -> f32 {
        let dt = (hz / rate).clamp(0.000001, 0.45);
        let t = self.phase as f32;
        let width = width.clamp(0.05, 0.95);
        let pulse = |width| {
            (if t < width { 1.0 } else { -1.0 }) + blep(t, dt)
                - blep((t - width).rem_euclid(1.0), dt)
        };
        let sample = match wave {
            Wave::Saw => 2.0 * t - 1.0 - blep(t, dt),
            Wave::Pulse => pulse(width) - (2.0 * width - 1.0),
            Wave::Triangle => {
                // Leaky integration prevents DC accumulation while preserving the fundamental.
                self.triangle = (self.triangle + 4.0 * dt * pulse(0.5)) * (1.0 - dt * 0.05);
                self.triangle
            }
            Wave::Sine => (TAU * t).sin(),
        };
        self.phase = (self.phase + f64::from(dt)).fract();
        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pulse_has_no_dc_and_oscillators_stay_bounded() {
        for wave in [Wave::Saw, Wave::Pulse, Wave::Triangle, Wave::Sine] {
            let mut o = Oscillator::new(0.0);
            let mut sum = 0.0;
            for n in 0..96000 {
                let y = o.tick(1000.0, 96000.0, wave, 0.2);
                assert!(y.is_finite() && y.abs() < 2.1);
                if n >= 48000 {
                    sum += y;
                }
            }
            assert!((sum / 48000.0_f32).abs() < 0.01);
        }
    }
    #[test]
    fn blep_reduces_the_folded_saw_harmonic() {
        let mut o = Oscillator::new(0.0);
        let (mut clean, mut naive) = (0.0_f64, 0.0_f64);
        // At 48 kHz the third harmonic of 10 kHz folds to 18 kHz.
        for n in 0..48000 {
            let basis = (std::f64::consts::TAU * 18000.0 * n as f64 / 48000.0).sin();
            clean += o.tick(10000.0, 48000.0, Wave::Saw, 0.5) as f64 * basis;
            naive += (2.0 * (10000.0 * n as f64 / 48000.0).fract() - 1.0) * basis;
        }
        assert!(clean.abs() < naive.abs() * 0.3, "{clean} / {naive}");
    }
}
