//! AFTERHOURS DSP: per-sample synthesis that Web Audio's built-in nodes cannot express.
//!
//! The AudioWorklet in web/ladder-worklet.js owns one `Voice` per note through the C ABI
//! below. Buffers live inside the voice; JavaScript writes and reads them through views
//! on the WebAssembly memory.

pub mod abi;
pub mod biquad;
pub mod envelope;
pub mod fastmath;
pub mod filter;
pub mod groove;
pub mod halfband;
pub mod ladder;
pub mod modulation;
pub mod oscillator;
pub mod timbre;
pub mod voice;
pub mod wavetable;

use halfband::{Downsampler, Upsampler};
use ladder::Ladder;

/// The Web Audio render quantum.
pub const BLOCK: usize = 128;

pub struct Voice {
    rate: f32,
    up: Upsampler,
    down: Downsampler,
    ladder: Ladder,
    pub input: [f32; BLOCK],
    pub output: [f32; BLOCK],
    pub cutoff: [f32; BLOCK],
    pub detune: [f32; BLOCK],
}

impl Voice {
    pub fn new(rate: f32) -> Self {
        Self {
            rate,
            up: Upsampler::new(),
            down: Downsampler::new(),
            ladder: Ladder::new(),
            input: [0.0; BLOCK],
            output: [0.0; BLOCK],
            cutoff: [1000.0; BLOCK],
            detune: [0.0; BLOCK],
        }
    }

    /// Filters `frames` input samples. Cutoff (Hz) and detune (cents) hold one value per
    /// frame, or a single value for the whole block when their length is 1.
    pub fn process(
        &mut self,
        frames: usize,
        cutoff_len: usize,
        detune_len: usize,
        resonance: f32,
        drive: f32,
    ) {
        let frames = frames.min(BLOCK);
        let k = resonance.clamp(0.0, 3.98);
        let drive = drive.clamp(0.1, 8.0);
        // Keep some of the ladder's bass loss at high resonance, but not all of it. The drive
        // term matches the small-signal level of the Biquad voice's normalised waveshaper.
        let makeup = (1.0 + 0.5 * k) * drive / ladder::soft_clip(drive);
        for i in 0..frames {
            let cutoff = self.cutoff[if cutoff_len > 1 { i } else { 0 }];
            let detune = self.detune[if detune_len > 1 { i } else { 0 }];
            let hz = (cutoff * (detune / 1200.0).exp2()).clamp(10.0, 0.45 * self.rate);
            let g = (std::f32::consts::PI * hz / (2.0 * self.rate)).tan();
            let (a, b) = self.up.process(self.input[i]);
            let (a, b) = (
                self.ladder.tick(a, g, k, drive),
                self.ladder.tick(b, g, k, drive),
            );
            self.output[i] = makeup * self.down.process(a, b);
        }
    }
}

#[no_mangle]
pub extern "C" fn ladder_new(rate: f32) -> *mut Voice {
    Box::into_raw(Box::new(Voice::new(rate)))
}

/// # Safety
/// `voice` must come from `ladder_new` and not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn ladder_free(voice: *mut Voice) {
    drop(Box::from_raw(voice));
}

/// # Safety
/// `voice` must be a live pointer from `ladder_new`.
#[no_mangle]
pub unsafe extern "C" fn ladder_input(voice: *mut Voice) -> *mut f32 {
    (*voice).input.as_mut_ptr()
}

/// # Safety
/// `voice` must be a live pointer from `ladder_new`.
#[no_mangle]
pub unsafe extern "C" fn ladder_output(voice: *mut Voice) -> *mut f32 {
    (*voice).output.as_mut_ptr()
}

/// # Safety
/// `voice` must be a live pointer from `ladder_new`.
#[no_mangle]
pub unsafe extern "C" fn ladder_cutoff(voice: *mut Voice) -> *mut f32 {
    (*voice).cutoff.as_mut_ptr()
}

/// # Safety
/// `voice` must be a live pointer from `ladder_new`.
#[no_mangle]
pub unsafe extern "C" fn ladder_detune(voice: *mut Voice) -> *mut f32 {
    (*voice).detune.as_mut_ptr()
}

/// # Safety
/// `voice` must be a live pointer from `ladder_new`.
#[no_mangle]
pub unsafe extern "C" fn ladder_process(
    voice: *mut Voice,
    frames: usize,
    cutoff_len: usize,
    detune_len: usize,
    resonance: f32,
    drive: f32,
) {
    (*voice).process(frames, cutoff_len, detune_len, resonance, drive);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_filters_blocks_and_follows_per_frame_cutoff() {
        let mut voice = Voice::new(48000.0);
        let mut energy = [0.0f32; 2];
        for (half, cutoff) in [(0, 8000.0), (1, 200.0)] {
            voice.cutoff = [cutoff; BLOCK];
            for block in 0..200 {
                for i in 0..BLOCK {
                    let n = block * BLOCK + i;
                    voice.input[i] = if n % 48 < 24 { 0.3 } else { -0.3 };
                }
                voice.process(BLOCK, BLOCK, 1, 0.0, 1.4);
                assert!(voice.output.iter().all(|y| y.is_finite()));
                if block >= 100 {
                    energy[half] += voice.output.iter().map(|y| y * y).sum::<f32>();
                }
            }
        }
        // A 1 kHz square wave keeps its harmonics at 8 kHz and loses them at 200 Hz.
        assert!(energy[1] < 0.2 * energy[0], "{energy:?}");
    }

    #[test]
    fn detune_moves_the_cutoff_in_cents() {
        let run = |detune: f32| {
            let mut voice = Voice::new(48000.0);
            voice.cutoff = [500.0; BLOCK];
            voice.detune = [detune; BLOCK];
            let mut energy = 0.0;
            for block in 0..100 {
                for i in 0..BLOCK {
                    voice.input[i] = ((block * BLOCK + i) as f32 * 0.13).sin() * 0.2;
                }
                voice.process(BLOCK, 1, 1, 0.0, 1.4);
                energy += voice.output.iter().map(|y| y * y).sum::<f32>();
            }
            energy
        };
        assert!(run(2400.0) > 4.0 * run(0.0));
    }
}
