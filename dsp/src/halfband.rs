//! 2x oversampling around nonlinear stages with a windowed-sinc halfband FIR.
//!
//! Every other tap of a halfband filter is zero, so the polyphase form below only
//! multiplies the non-zero branch: 32 taps per base-rate sample in each direction.

/// Centre tap index. Odd, so the even-indexed taps are the non-zero ones.
const CENTER: usize = 31;
/// Number of even-indexed (non-zero, non-centre) taps.
const BRANCH: usize = CENTER + 1;

fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term) = (1.0, 1.0);
    for k in 1..32 {
        term *= (x / 2.0) * (x / 2.0) / (k * k) as f64;
        sum += term;
    }
    sum
}

/// Even-indexed taps h[2i] of a 63-tap Kaiser-windowed halfband lowpass, summing to 0.5.
fn branch() -> [f32; BRANCH] {
    let beta = 8.0;
    let mut taps = [0.0f64; BRANCH];
    for (i, tap) in taps.iter_mut().enumerate() {
        let d = (2 * i) as f64 - CENTER as f64;
        let sinc = (std::f64::consts::PI * d / 2.0).sin() / (std::f64::consts::PI * d / 2.0);
        let r = d / CENTER as f64;
        *tap = 0.5 * sinc * bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta);
    }
    let scale = 0.5 / taps.iter().sum::<f64>();
    taps.map(|t| (t * scale) as f32)
}

/// Even taps in reverse order, built once: `reversed[j]` multiplies the sample `31 - j` back.
fn reversed() -> &'static [f32; BRANCH] {
    static TAPS: std::sync::OnceLock<[f32; BRANCH]> = std::sync::OnceLock::new();
    TAPS.get_or_init(|| {
        let mut taps = branch();
        taps.reverse();
        taps
    })
}

/// A ring buffer written twice, so the last `BRANCH` samples are always one contiguous
/// slice, oldest first: the FIR is a plain dot product with no index wrapping.
struct History {
    data: [f32; 2 * BRANCH],
    newest: usize,
}

impl History {
    fn new() -> Self {
        Self {
            data: [0.0; 2 * BRANCH],
            newest: 0,
        }
    }
    fn push(&mut self, x: f32) {
        self.newest = (self.newest + 1) % BRANCH;
        self.data[self.newest] = x;
        self.data[self.newest + BRANCH] = x;
    }
    /// The last `BRANCH` samples, oldest first: `window()[BRANCH - 1 - i]` is `i` samples ago.
    fn window(&self) -> &[f32] {
        &self.data[self.newest + 1..=self.newest + BRANCH]
    }
}

/// The FIR as eight 4-lane SIMD multiply-adds.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
fn dot(taps: &[f32; BRANCH], window: &[f32]) -> f32 {
    use core::arch::wasm32::*;
    let window = &window[..BRANCH];
    let mut sum = f32x4_splat(0.0);
    for chunk in 0..BRANCH / 4 {
        // SAFETY: both slices hold BRANCH floats; each load reads four from chunk * 4.
        let (w, t) = unsafe {
            (
                v128_load(window.as_ptr().add(chunk * 4) as *const v128),
                v128_load(taps.as_ptr().add(chunk * 4) as *const v128),
            )
        };
        sum = f32x4_add(sum, f32x4_mul(w, t));
    }
    (f32x4_extract_lane::<0>(sum) + f32x4_extract_lane::<1>(sum))
        + (f32x4_extract_lane::<2>(sum) + f32x4_extract_lane::<3>(sum))
}

/// The taps are symmetric, so samples equally far from the centre share one multiply:
/// sixteen products instead of 32, in four independent partial sums.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn dot(taps: &[f32; BRANCH], window: &[f32]) -> f32 {
    let (early, late) = window.split_at(BRANCH / 2);
    let mut sums = [0.0f32; 4];
    for (j, (tap, x)) in taps.iter().zip(early).enumerate() {
        sums[j % 4] += tap * (x + late[BRANCH / 2 - 1 - j]);
    }
    (sums[0] + sums[1]) + (sums[2] + sums[3])
}

/// Doubles the sample rate: each input sample becomes two output samples.
pub struct Upsampler {
    taps: &'static [f32; BRANCH],
    history: History,
}

impl Upsampler {
    pub fn new() -> Self {
        Self {
            taps: reversed(),
            history: History::new(),
        }
    }

    pub fn process(&mut self, x: f32) -> (f32, f32) {
        self.history.push(x);
        let window = self.history.window();
        // The odd phase meets only the centre tap (0.5, doubled for zero stuffing).
        (
            2.0 * dot(self.taps, window),
            window[BRANCH - 1 - (CENTER - 1) / 2],
        )
    }
}

/// Halves the sample rate, filtering out everything above the base-rate Nyquist first.
pub struct Downsampler {
    taps: &'static [f32; BRANCH],
    even: History,
    odd: History,
}

impl Downsampler {
    pub fn new() -> Self {
        Self {
            taps: reversed(),
            even: History::new(),
            odd: History::new(),
        }
    }

    pub fn process(&mut self, first: f32, second: f32) -> f32 {
        self.even.push(first);
        self.odd.push(second);
        dot(self.taps, self.even.window()) + 0.5 * self.odd.window()[BRANCH - 1 - (CENTER + 1) / 2]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn amplitude(signal: &[f32], hz: f32, rate: f32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (n, &x) in signal.iter().enumerate() {
            let phase = 2.0 * std::f64::consts::PI * (hz * n as f32 / rate) as f64;
            re += x as f64 * phase.cos();
            im += x as f64 * phase.sin();
        }
        (2.0 * (re * re + im * im).sqrt() / signal.len() as f64) as f32
    }

    #[test]
    fn taps_are_symmetric() {
        let taps = branch();
        for i in 0..BRANCH {
            assert_eq!(taps[i], taps[BRANCH - 1 - i]);
        }
    }

    #[test]
    fn round_trip_keeps_the_audio_band() {
        for hz in [100.0, 1000.0, 10000.0, 18000.0] {
            let (mut up, mut down) = (Upsampler::new(), Downsampler::new());
            let out: Vec<f32> = (0..48000)
                .map(|n| {
                    let phase =
                        2.0 * std::f64::consts::PI * (hz as f64 * n as f64 / 48000.0).fract();
                    let (a, b) = up.process(phase.sin() as f32);
                    down.process(a, b)
                })
                .collect();
            let gain = amplitude(&out[1000..], hz, 48000.0);
            assert!((gain - 1.0).abs() < 0.01, "{hz} Hz gain {gain}");
        }
    }

    #[test]
    fn downsampling_rejects_content_that_would_alias() {
        // 30 kHz at the 96 kHz rate would fold to 18 kHz without the filter.
        let mut down = Downsampler::new();
        let tone = |n: usize| {
            (2.0 * std::f64::consts::PI * (30000.0 * n as f64 / 96000.0).fract()).sin() as f32
        };
        let out: Vec<f32> = (0..48000)
            .map(|n| down.process(tone(2 * n), tone(2 * n + 1)))
            .collect();
        let folded = amplitude(&out[1000..], 18000.0, 48000.0);
        assert!(folded < 0.001, "alias at {folded}");
    }
}
