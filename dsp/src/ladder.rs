//! Four-pole transistor-ladder lowpass in zero-delay-feedback (TPT) form.
//!
//! The feedback loop is solved without a unit delay, so cutoff and resonance stay
//! accurate up to the oversampled Nyquist and modulate smoothly. The input to the
//! loop saturates: louder notes and higher resonance compress and thicken the way an
//! analog ladder does, instead of clipping. This is an original model of the general
//! circuit topology, not a measurement of any manufacturer's instrument.

/// tanh with a rational approximation: accurate to ~2% and smooth into ±1.
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    x * (27.0 + x * x) / (27.0 + 9.0 * x * x)
}

pub struct Ladder {
    state: [f32; 4],
}

impl Default for Ladder {
    fn default() -> Self {
        Self::new()
    }
}

impl Ladder {
    pub fn new() -> Self {
        Self { state: [0.0; 4] }
    }

    /// One sample. `g` is tan(pi * cutoff / rate), `k` the feedback amount (4 self-oscillates),
    /// `drive` sets how early the loop input saturates. Small signals pass at unity gain,
    /// so the loop gain, and with it the resonance, does not depend on drive.
    #[inline]
    pub fn tick(&mut self, x: f32, g: f32, k: f32, drive: f32) -> f32 {
        let gain = g / (1.0 + g);
        let hold = 1.0 / (1.0 + g);
        let [s1, s2, s3, s4] = self.state;
        // Each stage outputs gain * input + state * hold; chain them to find the loop's
        // instantaneous response, then solve the feedback equation for the stage input.
        let sigma =
            gain * gain * gain * s1 * hold + gain * gain * s2 * hold + gain * s3 * hold + s4 * hold;
        let g4 = gain * gain * gain * gain;
        let linear = (x - k * sigma) / (1.0 + k * g4);
        let mut signal = soft_clip(drive * linear) / drive;
        for s in self.state.iter_mut() {
            let v = (signal - *s) * gain;
            signal = v + *s;
            *s = signal + v;
            // Decaying tails would otherwise reach denormals, which are slow on x86.
            if s.abs() < 1e-20 {
                *s = 0.0;
            }
        }
        signal
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    // Phase in f64: an f32 phase over 96000 samples adds its own broadband noise floor.
    fn sine(hz: f32, n: usize, rate: f32) -> f32 {
        (2.0 * std::f64::consts::PI * (hz as f64 * n as f64 / rate as f64).fract()).sin() as f32
    }

    fn response(hz: f32, cutoff: f32, k: f32, amplitude: f32) -> f32 {
        let rate = 96000.0;
        let g = (PI * cutoff / rate).tan();
        let mut ladder = Ladder::new();
        let out: Vec<f32> = (0..96000)
            .map(|n| ladder.tick(amplitude * sine(hz, n, rate), g, k, 0.5))
            .collect();
        out[48000..]
            .iter()
            .fold(0.0f32, |peak, y| peak.max(y.abs()))
            / amplitude
    }

    #[test]
    fn rolls_off_at_24_db_per_octave_above_cutoff() {
        let low = response(4000.0, 1000.0, 0.0, 0.01);
        let high = response(8000.0, 1000.0, 0.0, 0.01);
        let db = 20.0 * (high / low).log10();
        assert!((-26.0..-21.0).contains(&db), "{db} dB per octave");
        assert!((response(50.0, 1000.0, 0.0, 0.01) - 1.0).abs() < 0.02);
    }

    #[test]
    fn resonance_peaks_at_cutoff_and_thins_the_bass() {
        let flat = response(1000.0, 1000.0, 0.0, 0.01);
        let peaked = response(1000.0, 1000.0, 3.5, 0.01);
        assert!(peaked > 4.0 * flat, "{flat} -> {peaked}");
        // A linear ladder's passband falls to 1 / (1 + k).
        assert!((response(30.0, 1000.0, 3.0, 0.01) - 0.25).abs() < 0.02);
    }

    #[test]
    fn saturation_compresses_loud_input() {
        assert!(response(200.0, 5000.0, 0.0, 4.0) < 0.6 * response(200.0, 5000.0, 0.0, 0.01));
    }

    #[test]
    fn full_resonance_stays_bounded_and_rings_down_to_zero() {
        let mut ladder = Ladder::new();
        let g = (PI * 2000.0 / 96000.0).tan();
        let mut peak = 0.0f32;
        for n in 0..96000 {
            let y = ladder.tick(if n < 64 { 1.0 } else { 0.0 }, g, 3.95, 1.4);
            assert!(y.is_finite());
            peak = peak.max(y.abs());
        }
        assert!(peak < 4.0, "peak {peak}");
        for _ in 0..4_800_000 {
            ladder.tick(0.0, g, 3.95, 1.4);
        }
        assert_eq!(ladder.state, [0.0; 4]);
    }
}
