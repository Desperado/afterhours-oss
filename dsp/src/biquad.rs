//! Web Audio BiquadFilterNode lowpass/highpass, with Q in dB as the specification defines.
use crate::fastmath::sin_quarter;

#[derive(Default)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

/// A cutoff as a fraction of Nyquist with its sine and versine (1 − cos), from the
/// half-angle sine: one polynomial and one square root instead of libm sin and cos.
#[derive(Clone, Copy)]
pub struct Angle {
    normalized: f64,
    sin: f64,
    versine: f64,
}

impl Angle {
    pub fn new(hz: f64, rate: f64) -> Self {
        let normalized = hz / (rate * 0.5);
        let half: f64 = sin_quarter(std::f64::consts::FRAC_PI_2 * normalized.clamp(0.0, 1.0));
        Self {
            normalized,
            sin: 2.0 * half * (1.0 - half * half).sqrt(),
            versine: 2.0 * half * half,
        }
    }
}

impl Biquad {
    /// From Web Audio's Q in dB, the factor 1/(2Q) that `set` takes, so a coefficient update
    /// needs no division by Q.
    pub fn q(db: f64) -> f64 {
        0.5 / 10f64.powf(db / 20.0)
    }
    pub fn set(&mut self, highpass: bool, hz: f64, q: f64, rate: f64) {
        self.set_angle(highpass, Angle::new(hz, rate), q);
    }
    /// Sets coefficients from a precomputed angle, so filters sharing a cutoff share the trig.
    pub fn set_angle(&mut self, highpass: bool, angle: Angle, q: f64) {
        let Angle {
            normalized,
            sin,
            versine,
        } = angle;
        let cos = 1.0 - versine;
        if normalized >= 1.0 {
            // At or above Nyquist the lowpass passes everything and the highpass nothing.
            let pass = if highpass { 0.0 } else { 1.0 };
            (self.b0, self.b1, self.b2, self.a1, self.a2) = (pass, 0.0, 0.0, 0.0, 0.0);
            return;
        }
        if normalized <= 0.0 {
            let pass = if highpass { 1.0 } else { 0.0 };
            (self.b0, self.b1, self.b2, self.a1, self.a2) = (pass, 0.0, 0.0, 0.0, 0.0);
            return;
        }
        let alpha = sin * q;
        let scale = 1.0 / (1.0 + alpha);
        let (b0, b1) = if highpass {
            ((1.0 + cos) * 0.5, -(1.0 + cos))
        } else {
            (versine * 0.5, versine)
        };
        self.b0 = b0 * scale;
        self.b1 = b1 * scale;
        self.b2 = b0 * scale;
        self.a1 = -2.0 * cos * scale;
        self.a2 = (1.0 - alpha) * scale;
    }
    pub fn tick(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        (self.x2, self.x1, self.y2, self.y1) = (self.x1, x, self.y1, y);
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biquad_matches_web_audio_lowpass_dc_and_nyquist_gain() {
        let mut f = Biquad::default();
        f.set(false, 1000.0, Biquad::q(0.65), 48000.0);
        let dc = (f.b0 + f.b1 + f.b2) / (1.0 + f.a1 + f.a2);
        let nyquist = (f.b0 - f.b1 + f.b2) / (1.0 - f.a1 + f.a2);
        assert!((dc - 1.0).abs() < 1e-9 && nyquist.abs() < 1e-9);
    }
}
