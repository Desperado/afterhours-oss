//! ABI v1: all pointers belong to the same live SynthVoice. Buffers are fixed-size;
//! only construction/destruction allocates. See dsp/README.md for layout and lifetime.
use crate::voice::SynthVoice;
#[no_mangle]
pub extern "C" fn voice_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn voice_new(rate: f32) -> *mut SynthVoice {
    Box::into_raw(Box::new(SynthVoice::new(rate)))
}
/// # Safety
/// Must be a live pointer from voice_new, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn voice_free(v: *mut SynthVoice) {
    drop(Box::from_raw(v));
}
/// # Safety
/// Must be a live pointer from voice_new. Kind 0 = controls, 1 = output, 2 = config.
#[no_mangle]
pub unsafe extern "C" fn voice_buffer(v: *mut SynthVoice, kind: u32) -> *mut f32 {
    match kind {
        0 => (*v).parameters.as_mut_ptr(),
        1 => (*v).output.as_mut_ptr(),
        2 => (*v).config.as_mut_ptr(),
        _ => std::ptr::null_mut(),
    }
}
/// # Safety
/// Must be a live pointer from voice_new; call before rendering, after writing config.
#[no_mangle]
pub unsafe extern "C" fn voice_configure(v: *mut SynthVoice) {
    (*v).configure();
}
/// # Safety
/// Must be a live pointer from voice_new with control buffers filled for frames samples.
#[no_mangle]
pub unsafe extern "C" fn voice_process(v: *mut SynthVoice, frames: usize) {
    (*v).process(frames);
}

// Groove ABI v1: same ownership rules, for crate::groove::GrooveVoice.
use crate::groove::GrooveVoice;
#[no_mangle]
pub extern "C" fn groove_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn groove_new(rate: f32) -> *mut GrooveVoice {
    Box::into_raw(Box::new(GrooveVoice::new(rate)))
}
/// # Safety
/// Must be a live pointer from groove_new, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn groove_free(v: *mut GrooveVoice) {
    drop(Box::from_raw(v));
}
/// # Safety
/// Must be a live pointer from groove_new. Kind 0 = controls, 1 = output, 2 = config.
#[no_mangle]
pub unsafe extern "C" fn groove_buffer(v: *mut GrooveVoice, kind: u32) -> *mut f32 {
    match kind {
        0 => (*v).parameters.as_mut_ptr(),
        1 => (*v).output.as_mut_ptr(),
        2 => (*v).config.as_mut_ptr(),
        _ => std::ptr::null_mut(),
    }
}
/// # Safety
/// Must be a live pointer from groove_new; call before the gate opens, after writing config.
#[no_mangle]
pub unsafe extern "C" fn groove_configure(v: *mut GrooveVoice) {
    (*v).configure();
}
/// # Safety
/// Must be a live pointer from groove_new with control buffers filled for frames samples.
#[no_mangle]
pub unsafe extern "C" fn groove_process(v: *mut GrooveVoice, frames: usize) {
    (*v).process(frames);
}

// Timbre ABI v1: same ownership rules, for crate::timbre::TimbreVoice.
use crate::timbre::TimbreVoice;
use crate::wavetable::{Bank, Shape};

// Wavetable transfer: generate in a Worker, then copy into an owned staging buffer
// and install it in the audio runtime before creating voices. No FFT runs there.
#[no_mangle]
pub extern "C" fn wavetable_len(rate: f64) -> usize {
    Bank::len(rate)
}

#[no_mangle]
pub extern "C" fn wavetable_data(rate: f64, shape: u32) -> *const f32 {
    Bank::get(Shape::from_index(shape).expect("wavetable shape"), rate).data()
}

#[no_mangle]
pub extern "C" fn wavetable_alloc(rate: f64) -> *mut f32 {
    Box::into_raw(vec![0.0; Bank::len(rate)].into_boxed_slice()) as *mut f32
}

/// # Safety
/// `data` must come from wavetable_alloc at the same rate, filled with one bank.
/// Consumes the buffer exactly once. Install all five shapes before creating voices.
#[no_mangle]
pub unsafe extern "C" fn wavetable_install(rate: f64, shape: u32, data: *mut f32) {
    let tables = Box::from_raw(std::ptr::slice_from_raw_parts_mut(data, Bank::len(rate)));
    Bank::install(
        Shape::from_index(shape).expect("wavetable shape"),
        rate,
        tables.into_vec(),
    );
}

#[no_mangle]
pub extern "C" fn timbre_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn timbre_new(rate: f32) -> *mut TimbreVoice {
    Box::into_raw(Box::new(TimbreVoice::new(rate)))
}
/// # Safety
/// Must be a live pointer from timbre_new, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn timbre_free(v: *mut TimbreVoice) {
    drop(Box::from_raw(v));
}
/// # Safety
/// Must be a live pointer from timbre_new. Kind 0 = controls, 1 = output, 2 = config.
#[no_mangle]
pub unsafe extern "C" fn timbre_buffer(v: *mut TimbreVoice, kind: u32) -> *mut f32 {
    match kind {
        0 => (*v).parameters.as_mut_ptr(),
        1 => (*v).output.as_mut_ptr(),
        2 => (*v).config.as_mut_ptr(),
        _ => std::ptr::null_mut(),
    }
}
/// # Safety
/// Must be a live pointer from timbre_new; call before the gate opens, after writing config.
#[no_mangle]
pub unsafe extern "C" fn timbre_configure(v: *mut TimbreVoice) {
    (*v).configure();
}
/// # Safety
/// Must be a live pointer from timbre_new with control buffers filled for frames samples.
#[no_mangle]
pub unsafe extern "C" fn timbre_process(v: *mut TimbreVoice, frames: usize) {
    (*v).process(frames);
}
/// # Safety
/// Must be a live pointer from timbre_new; applies configuration indices 8–11.
#[no_mangle]
pub unsafe extern "C" fn timbre_update(v: *mut TimbreVoice) {
    (*v).update();
}
