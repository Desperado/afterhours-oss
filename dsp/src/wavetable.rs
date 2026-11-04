//! Band-limited wavetable oscillator built like Web Audio's PeriodicWave, so voices that
//! replaced OscillatorNodes keep their level and spectrum: the same table size, three
//! band-limited tables per octave crossfaded by pitch, and the same peak normalization.
use std::f64::consts::TAU;
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Shape {
    Saw,
    Square,
    Triangle,
    /// Hollow, odd-heavy frame of the Wavetable machine.
    Dark,
    /// Glassy upper-spectrum frame of the Wavetable machine.
    Bright,
}

impl Shape {
    pub fn from_index(index: u32) -> Option<Self> {
        [
            Self::Saw,
            Self::Square,
            Self::Triangle,
            Self::Dark,
            Self::Bright,
        ]
        .get(index as usize)
        .copied()
    }

    /// Sine-series coefficient of harmonic `k` (k ≥ 1), before normalization.
    fn coefficient(self, k: usize) -> f64 {
        let n = k as f64;
        match self {
            Self::Saw => 2.0 / (std::f64::consts::PI * n) * if k % 2 == 1 { 1.0 } else { -1.0 },
            Self::Square => {
                if k % 2 == 1 {
                    4.0 / (std::f64::consts::PI * n)
                } else {
                    0.0
                }
            }
            Self::Triangle => {
                if k % 2 == 1 {
                    8.0 / (std::f64::consts::PI * std::f64::consts::PI * n * n)
                        * if ((k - 1) / 2) % 2 == 1 { -1.0 } else { 1.0 }
                } else {
                    0.0
                }
            }
            // Single-precision like the Float32Arrays the Web Audio frames were built from.
            Self::Dark => f64::from(if k % 2 == 1 {
                (1.0 / n.powf(1.8)) as f32
            } else {
                (0.08 / n) as f32
            }),
            Self::Bright => f64::from(if k == 1 {
                0.7f32
            } else {
                ((n * 1.73).sin().powi(2) / n.powf(0.8)) as f32
            }),
        }
    }
    /// Number of harmonics defined; the built-in shapes fill every available bin.
    fn harmonics(self, half: usize) -> usize {
        match self {
            Self::Dark | Self::Bright => 64,
            _ => half,
        }
    }
}

/// Band-limited tables for one shape at one table size.
pub struct Bank {
    size: usize,
    lowest: f64,
    ranges: usize,
    /// Every range's table back to back, each followed by a copy of its first sample so
    /// interpolation never wraps.
    tables: Vec<f32>,
}

static BANKS: Mutex<Vec<(Shape, usize, &'static Bank)>> = Mutex::new(Vec::new());

const BANDS_PER_OCTAVE: f64 = 3.0;

/// Web Audio's table size for a sample rate.
fn table_size(rate: f64) -> usize {
    if rate <= 24000.0 {
        2048
    } else if rate <= 88200.0 {
        4096
    } else {
        16384
    }
}

/// In-place radix-2 inverse FFT (unscaled) of interleaved complex values.
fn inverse_fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut length = 2;
    while length <= n {
        let angle = TAU / length as f64;
        for start in (0..n).step_by(length) {
            for k in 0..length / 2 {
                let (sin, cos) = (angle * k as f64).sin_cos();
                let (a, b) = (start + k, start + k + length / 2);
                let (tr, ti) = (re[b] * cos - im[b] * sin, re[b] * sin + im[b] * cos);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        length <<= 1;
    }
}

impl Bank {
    pub fn len(rate: f64) -> usize {
        let size = table_size(rate);
        (BANDS_PER_OCTAVE * (size as f64).log2()).round() as usize * (size + 1)
    }

    fn new(shape: Shape, rate: f64) -> Self {
        let size = table_size(rate);
        let half = size / 2;
        let ranges = (BANDS_PER_OCTAVE * (size as f64).log2()).round() as usize;
        let harmonics = shape.harmonics(half).min(half);
        let mut scale = 1.0;
        let tables = (0..ranges)
            .flat_map(|range| {
                let cull = (-(range as f64) / BANDS_PER_OCTAVE).exp2();
                let partials = (cull * half as f64) as usize;
                let (mut re, mut im) = (vec![0.0; size], vec![0.0; size]);
                // x[n] = Σ b_k sin(2πkn/N): bins k and N−k carry ∓i·b_k/2.
                for k in 1..=harmonics.min(partials).min(half - 1) {
                    let b = shape.coefficient(k) / 2.0;
                    im[k] = -b;
                    im[size - k] = b;
                }
                inverse_fft(&mut re, &mut im);
                // The full-band table sets one normalization for every range.
                if range == 0 {
                    let peak = re.iter().fold(0.0f64, |m, x| m.max(x.abs()));
                    if peak > 0.0 {
                        scale = 1.0 / peak;
                    }
                }
                let mut table: Vec<f32> = re.iter().map(|x| (x * scale) as f32).collect();
                table.push(table[0]);
                table
            })
            .collect();
        Self::from_tables(rate, tables)
    }

    fn from_tables(rate: f64, tables: Vec<f32>) -> Self {
        let size = table_size(rate);
        Self {
            size,
            lowest: rate / size as f64,
            ranges: tables.len() / (size + 1),
            tables,
        }
    }

    /// Import a bank computed by the host's worker before any voices are created.
    pub fn install(shape: Shape, rate: f64, tables: Vec<f32>) {
        assert_eq!(tables.len(), Self::len(rate));
        let mut banks = BANKS.lock().unwrap_or_else(|e| e.into_inner());
        let size = table_size(rate);
        if !banks.iter().any(|(s, n, _)| *s == shape && *n == size) {
            let bank = Box::leak(Box::new(Self::from_tables(rate, tables)));
            banks.push((shape, size, bank));
        }
    }

    pub fn data(&self) -> *const f32 {
        self.tables.as_ptr()
    }

    #[cfg(test)]
    fn table(&self, range: usize) -> &[f32] {
        &self.tables[range * (self.size + 1)..(range + 1) * (self.size + 1)]
    }

    /// Shared banks; each shape and size is built once per WebAssembly instance.
    pub fn get(shape: Shape, rate: f64) -> &'static Bank {
        let size = table_size(rate);
        let mut banks = BANKS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, _, bank)) = banks.iter().find(|(s, n, _)| *s == shape && *n == size) {
            return bank;
        }
        let bank: &'static Bank = Box::leak(Box::new(Bank::new(shape, rate)));
        banks.push((shape, size, bank));
        bank
    }
}

/// Fractional bits of the fixed-point table position.
const FRACTION: u32 = 32;

/// One oscillator reading a bank, as Web Audio's OscillatorNode does.
#[derive(Clone, Copy)]
pub struct Wavetable {
    bank: &'static Bank,
    /// Table position in samples, fixed point with `FRACTION` fractional bits.
    position: u64,
    /// Position increment per sample; negative frequencies run backwards.
    increment: i64,
    mask: u64,
    hz: f64,
    rate: f64,
    higher: usize,
    lower: usize,
    blend: f32,
}

impl Wavetable {
    pub fn new(shape: Shape, rate: f64) -> Self {
        let bank = Bank::get(shape, rate);
        Self {
            bank,
            position: 0,
            increment: 0,
            mask: ((bank.size as u64) << FRACTION) - 1,
            hz: f64::NAN,
            rate,
            higher: 0,
            lower: 0,
            blend: 0.0,
        }
    }

    /// Chooses the two tables around this pitch: one band up, so partials are culled before
    /// they alias, crossfading towards the one with fewer partials.
    fn select(&mut self, hz: f64) {
        self.hz = hz;
        let bank = self.bank;
        self.increment = (hz * bank.size as f64 / self.rate * (1u64 << FRACTION) as f64) as i64;
        let hz = hz.abs();
        let ratio = if hz > 0.0 { hz / bank.lowest } else { 0.5 };
        let ranges = bank.ranges;
        let pitch = (1.0 + ratio.log2() * BANDS_PER_OCTAVE).clamp(0.0, (ranges - 1) as f64) as f32;
        let higher = pitch as usize;
        // Offsets of the two tables in the bank, so a read is one index.
        self.higher = higher * (bank.size + 1);
        self.lower = (higher + 1).min(ranges - 1) * (bank.size + 1);
        self.blend = pitch - higher as f32;
    }

    pub fn bank(&self) -> &'static Bank {
        self.bank
    }

    fn advance(&mut self, hz: f64) -> (usize, f32) {
        if hz != self.hz {
            self.select(hz.clamp(-self.rate * 0.5, self.rate * 0.5));
            self.hz = hz;
        }
        let i = (self.position >> FRACTION) as usize;
        let fraction = self.position as u32 as f32 * (1.0 / (1u64 << FRACTION) as f32);
        self.position = self.position.wrapping_add_signed(self.increment) & self.mask;
        (i, fraction)
    }

    fn read(&self, bank: &Bank, i: usize, fraction: f32) -> f32 {
        let t = &bank.tables;
        let (h, l) = (self.higher + i, self.lower + i);
        let higher = t[h] + (t[h + 1] - t[h]) * fraction;
        let lower = t[l] + (t[l + 1] - t[l]) * fraction;
        higher + (lower - higher) * self.blend
    }

    /// One sample at `hz` (the oscillator's own sample rate is fixed at construction).
    pub fn tick(&mut self, hz: f64) -> f32 {
        let (i, fraction) = self.advance(hz);
        self.read(self.bank, i, fraction)
    }

    /// One sample of this oscillator and of `other`, a second shape at the same phase and
    /// pitch: two Web Audio oscillators started together, read with one phase.
    pub fn tick_with(&mut self, hz: f64, other: &Bank) -> (f32, f32) {
        let (i, fraction) = self.advance(hz);
        (
            self.read(self.bank, i, fraction),
            self.read(other, i, fraction),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_shapes_peak_at_one_and_keep_their_shape() {
        for shape in [
            Shape::Saw,
            Shape::Square,
            Shape::Triangle,
            Shape::Dark,
            Shape::Bright,
        ] {
            let bank = Bank::get(shape, 48000.0);
            assert_eq!(bank.size, 4096);
            assert_eq!(bank.ranges, 36);
            let peak = bank.table(0).iter().fold(0.0f32, |m, x| m.max(x.abs()));
            assert!((peak - 1.0).abs() < 1e-5, "{shape:?} {peak}");
        }
        // A quarter of the way through, a saw is near half its normalized ideal height.
        let saw = Bank::get(Shape::Saw, 48000.0).table(0);
        assert!((saw[1024] - 0.5 / 1.17898).abs() < 0.01, "{}", saw[1024]);
        let triangle = Bank::get(Shape::Triangle, 48000.0).table(0);
        assert!((triangle[1024] - 1.0).abs() < 1e-3);
    }

    #[test]
    fn high_notes_lose_partials_instead_of_aliasing() {
        let rate = 48000.0;
        let mut o = Wavetable::new(Shape::Saw, rate);
        let (mut folded, mut fundamental) = (0.0f64, 0.0f64);
        // At 10 kHz every harmonic above the fundamental is above Nyquist.
        for n in 0..48000 {
            let y = f64::from(o.tick(10000.0));
            let t = n as f64 / rate;
            folded += y * (TAU * 18000.0 * t).sin();
            fundamental += y * (TAU * 10000.0 * t).sin();
        }
        assert!(folded.abs() < fundamental.abs() * 0.01);
    }
}
