# AFTERHOURS DSP

The `analog` Synth family and Groove `Analog` machine render a complete subtractive voice in Rust: two oscillators → sub/noise mixer → resonant filter → amplitude envelope → downsampler. The Groove FM machines (Kick, Snare, Metal, Perc, Tone, Chord) and Saw render in Rust too: four FM operators, noise and highpass filters, or two saws and a triangle sub through 2× saturation, then the lowpass and amplitude envelope. The Ladder, DualVCO and Wavetable/WavePad voices (Groove machines and Synth patches) render their oscillators, drive and Biquad or Ladder β filter in Rust; the host keeps their amplitude envelope. The same code runs in live and offline AudioWorklets. It runs on the CPU through WebAssembly; it is not a separate CoreAudio driver or plugin host.

No third-party DSP crates, samples, factory patches or instrument ROMs are used. The sound is inspired by early analog synths, not an exact Pro-One circuit emulation. Changing language alone does not improve timbre: the oscillator, nonlinear filter, oversampling and modulation determine it.

## Modules and extension points

| Module | Responsibility |
| --- | --- |
| `oscillator.rs` | Phase, PolyBLEP saw/pulse, integrated triangle and sine. Add waveform algorithms here. |
| `envelope.rs` | Retriggerable ADSR, continuous release and finite silence. |
| `modulation.rs` | Seeded noise, slow drift, PWM LFO and control smoothing. |
| `filter.rs` | Nonlinear ladder wrapper, resonance compensation and DC rejection. This is the boundary for future filter models. |
| `voice.rs` | Typed patch, validation, signal routing and 2× processing. No browser dependencies. |
| `wavetable.rs` | Band-limited wavetable oscillator built like Web Audio's PeriodicWave: same table size, three tables per octave and peak normalization. |
| `biquad.rs` | Web Audio–equivalent lowpass/highpass biquad (Q in dB). |
| `timbre.rs` | Ladder, DualVCO and Wavetable voices: wavetable oscillators, drive, 2× waveshaper and two biquads or the Ladder β filter, DC blocker. |
| `fastmath.rs` | Polynomial sines for hot loops: WebAssembly has no trigonometric instructions. |
| `groove.rs` | Groove FM machines and Saw: operators, noise, Web Audio–equivalent biquads, filter sweep and amplitude envelope. |
| `halfband.rs` | Shared 63-tap FIR oversampling/downsampling, SIMD in WebAssembly. |
| `abi.rs` | Versioned host interface and voice ownership. No musical logic. |
| `lib.rs` | Module exports and the legacy ladder ABI (`ladder.rs` owns its filter algorithm). |

`web/dsp-worklet.js` owns one WASM instance per AudioWorklet scope. The old ladder processor and the voice processors share that runtime; `web/voice-worklet.js` registers `afterhours-voice`, `afterhours-groove` and `afterhours-timbre`. `web/voice-worklet.js` transfers sample-timed AudioParams to Rust, detects memory growth, and frees finished voices. `web/voice.js` adapts the voice to the existing Synth/Groove scheduling and tuning contracts. Presets and arrangements stay in JavaScript; Rust does not know about songs, UI or storage.

Before marking a voice runtime ready, `web/voice.js` generates all five wavetable banks in `web/wavetable-worker.js`, caches them per sample rate, and imports them through the silent `afterhours-wavetables` processor. First notes reuse these banks; their constructors do not run FFTs on the audio thread. Every migrated Synth family prepares this runtime on first use, with the existing Web Audio fallback if preparation fails.

A voice allocates only at construction. Processing uses fixed buffers, no locks, messages, I/O or heap allocations. Pending notes skip DSP until their gate rises; released voices flush the FIR before skipping DSP. Live voice limits remain eight held/sixteen total in Synth and thirty-two in Groove. Offline export uses the existing bounded chunks.

To add a waveform, implement it in `oscillator.rs`, add its ID conversion, and test pitch, DC and aliasing. To add a filter, implement its state behind `filter.rs` and select it through a validated patch field. Keep old waveform/filter IDs stable. Change the ABI version if layouts or meanings change; update both adapters and regenerate WASM in the same commit. Add new controls to the Synth UI's bounded persistence list or Groove's validated schema explicitly. Do not reinterpret existing patch IDs or project machine names.

## Host ABI v1

`voice_abi_version()` returns `1`. `voice_new(sample_rate)` returns a live opaque pointer. Call `voice_buffer(pointer, kind)` to get the float-buffer address:

- Kind `0`: eleven control planes, each with a stride of 128 floats.
- Kind `1`: 128 output samples, mono.
- Kind `2`: twenty configuration floats, initialized to defaults.

Write configuration, then call `voice_configure(pointer)` once before processing. Fill every control plane for the requested frames, call `voice_process(pointer, frames)` (0–128), then read that many output samples. A host with larger blocks must split them. Recreate JavaScript views after WASM memory growth. Pointers must belong to this instance and remain live; free each exactly once with `voice_free(pointer)`. The ABI is an internal trusted-host interface, not a parser for arbitrary pointers.

Control planes, in order:

| Index | Control | Units/range |
| --- | --- | --- |
| 0 | Frequency | 8–20,000 Hz, before detune |
| 1 | Pitch detune | −9,600…9,600 cents |
| 2 | Gate | >0.5 on; falling edge starts release |
| 3 | Filter cutoff | 20–24,000 Hz, before modulation |
| 4 | Filter detune | −9,600…9,600 cents |
| 5 | Oscillator blend | 0 = A, 1 = B |
| 6 | PWM depth | 0–1 |
| 7 | Filter input drive | 0.1–8 |
| 8 | Resonance | 0–3.95 |
| 9 | Pulse width | 0.05–0.95 |
| 10 | Filter envelope amount | −6…6 octaves |

Configuration indices: `0–1` oscillator wave IDs (saw 0, pulse 1, triangle 2, sine 3); `2` oscillator B frequency ratio; `3` detune spread in cents; `4` sub level; `5` noise level; `6` drift amount; `7` PWM rate in Hz; `8–11` amplitude ADSR; `12–15` filter ADSR; `16` glide time constant in seconds; `17` initial pitch in Hz; `18` noise seed (integer 1–16,777,215); `19` reserved, write zero. ADSR times are seconds, sustain is 0–1. Rust validates finite values and clamps ranges. Configuration changes apply to the next voice; continuous controls are smoothed inside the voice.

The worklet additionally exposes `alive`, a host lifetime parameter independent of gate. A gate of zero does **not** retire a pending voice. Schedule `alive=0` at the final stop; the adapter's silent ConstantSource supplies the corresponding `onended` cleanup event. This separation preserves notes scheduled more than twelve seconds into offline exports, and allows cancellation before onset without a stuck voice. Port messages are only an idempotent cleanup backstop, never note timing.

## Groove ABI v1

`groove_abi_version()` returns `1`. `groove_new`, `groove_buffer`, `groove_configure`, `groove_process` and `groove_free` follow the voice ABI's ownership and buffer rules. Each voice plays one note: the first rising gate starts it, and it finishes on its own.

- Kind `0`: three control planes of 128 floats: gate (>0.5 on; a falling gate releases a held note), pitch detune in cents (tuning and bend), and one modulation input.
- Kind `1`: 128 mono output samples.
- Kind `2`: sixteen configuration floats: `0` machine (Kick 0, Snare 1, Metal 2, Perc 3, Tone 4, Chord 5, Saw 6); `1` note frequency in Hz; `2` loudness (level, velocity and pulse); `3–6` color, shape, sweep and contour (0–100); `7` cutoff in Hz; `8` serial FM algorithm (0/1); `9` gate in seconds; `10` decay in seconds; `11` held (1 for a live key: sustain until the gate falls, then release over decay); `12` modulation target (0 none, 1 filter detune in cents, 2 shape as LFO × depth, which Rust scales to FM deviation or Saw drive, 3 pitch in cents); `13–15` reserved, write zero.

Rust derives every envelope from these settings, matching the Web Audio graph it replaced: percussion decays from the attack, sustained notes hold to the gate then drop to 72 %, and ramps end at 0.00001 when the note's scheduled length (plus 40 ms) is reached. The previous Web Audio graph remains in `web/groove-audio.js` as the fallback when the worklet cannot load.

## Timbre ABI v1

The trusted host can transfer precomputed banks before constructing voices. `wavetable_len(sample_rate)` returns the float count of one bank. `wavetable_data(sample_rate, shape)` generates or returns a bank in the worker instance; shape IDs are Saw 0, Square 1, Triangle 2, Dark 3 and Bright 4. In the audio instance, allocate with `wavetable_alloc(sample_rate)`, fill exactly that many floats, and pass the pointer once to `wavetable_install(sample_rate, shape, pointer)`, which consumes it. Import all five shapes at the context's sample rate before creating voices. Recreate memory views after allocation because memory may grow.

`timbre_abi_version()` returns `1`; `timbre_new`, `timbre_buffer`, `timbre_configure`, `timbre_update`, `timbre_process` and `timbre_free` follow the same rules. The first rising gate starts the oscillators, the LFO and the filter sweep; the voice has no envelope of its own and sounds until the host stops it.

- Kind `0`: three control planes: gate, pitch detune in cents, and one modulation input.
- Kind `1`: 128 mono output samples.
- Kind `2`: sixteen configuration floats: `0` family (ladder 0, dual 1, wave 2); `1` filter (Biquad 0, Ladder β 1); `2` note frequency in Hz; `3` detune spread in cents; `4` second-oscillator ratio; `5` filter-envelope amount; `6` filter-envelope decay in seconds; `7` modulation target (0 none, 1 filter detune in cents, 2 added drive, 3 pitch in cents); `8` cutoff (40–24,000 Hz); `9` resonance (0.1–12, the Web Audio voice's raw value); `10` position (0–1 wave blend); `11` motion (0–1); `12` drive gain; `13–15` reserved, write zero. `timbre_update` applies new values at `8–11` (Synth panel changes); Rust smooths them with the time constants the Web Audio graph used.

## Worklet hosting and cost

`web/voice-worklet.js` registers `afterhours-voice` (Analog, AudioParam controls) and, for Groove and timbre voices, one processor per parameter set: `afterhours-groove-` and `afterhours-timbre-` followed by `d` (detune), `m` (modulation), both or neither. Every AudioParam costs CPU in every render quantum, idle or not, so a voice declares only what it uses: untuned percussion without an LFO has none.

Groove and timbre voices are note-timed: start and stop are processorOptions, and the processor writes the gate plane itself. Realtime changes are messages: `{start}`, `{stop}`, `{release}` (key-up), `{fade}` (silencing, a 4 ms fall), and `{at, values}` for timbre configuration. Messages reach the audio thread asynchronously, like any realtime input; scheduled notes never depend on them. With a `pan` option a scheduled FM or Saw note renders StereoPanner-equivalent stereo straight into its mixer channel, without per-hit panner and gain nodes. Offline renders create each voice about 0.05–0.1 s before it sounds (`FMGrooveAudio.render`), because an idle worklet voice is still called every quantum.

Offline Pump automation is scheduled for every kick before rendering begins. Later kicks can cancel earlier recovery endpoints, so windowing this automation would change samples already rendered. Voice creation remains windowed.

## Build and verify

```sh
rustup target add wasm32-unknown-unknown
cargo test --manifest-path dsp/Cargo.toml
npm run dsp
npx playwright test tests/e2e/rust-voice.spec.js tests/e2e/rust-groove.spec.js tests/e2e/rust-timbre.spec.js tests/e2e/synth.spec.js tests/e2e/full-songs.spec.js
```

`web/ladder-wasm.js` contains both engines and is committed so users need no Rust toolchain. Rebuild it after any DSP change. Browser tests exercise the generated artifact, future-note lifetime, cancellation, shared-memory growth, pitch tuning, PWM/drive differences, release cleanup and all patches. Rust tests cover envelopes, bandlimiting, oversampling, malformed controls, multiple sample rates and deterministic output.

The original Synth patches (forest, strings, clav, organ, rave, pad) and the WAV effects remain Web Audio graphs. Each Rust voice keeps its Web Audio graph as the fallback when the worklet cannot load. `npm run dsp` builds with WebAssembly SIMD. A future native host can reuse the Rust voice and own its audio-device callback; that host and real hardware latency measurements are outside this implementation.
