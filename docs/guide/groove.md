# Groove sequencer

Groove is the sixteen-lane step sequencer with twelve built-in synthesized machines, a song library of eighteen original arrangements, and WAV, MIDI and project exports. This page covers the machines, patterns and steps, Song mode, MIDI overlays, recording sync, the meters and the phone view. The separate playable instrument and the live sound layer are described in [Synth and Control](synth-and-control.md).

## Quick start

1. Open **Groove** in the rail.
2. Set the tempo, **40–240 BPM**, with the strip's slider or numeric field.
3. Press Play (or the `Space` key).
4. Click a track name to select it, then drag the **Color**, **Shape**, **Sweep** and **Contour** knobs vertically.
5. Click a step in the grid to toggle it.

To start from a finished arrangement instead, choose one in **Song library** and press **Load track** (see [Song library](#song-library)).

## Machines

Twelve original synthesized instruments run locally without an API key or external plugins, on sixteen sequencer lanes. The workflow takes inspiration from Model:Cycles; no Elektron code or samples are included.

| Machine | What it is | Renders in |
| --- | --- | --- |
| Kick, Snare, Metal, Perc, Tone, Chord | Our own FM voices | Rust (`dsp/src/groove.rs`) |
| Saw | Detuned sawtooth oscillators, a triangle sub and oversampled saturation | Rust (`dsp/src/groove.rs`) |
| Ladder | A warm saw/square/sub blend, with saturation before a resonant lowpass | Rust (`dsp/src/timbre.rs`) |
| DualVCO | Triangle and saw oscillators over a square sub, with saturation before a resonant lowpass | Rust (`dsp/src/timbre.rs`) |
| Wavetable | Crossfades two original harmonic frames across three detuned oscillators | Rust (`dsp/src/timbre.rs`) |
| WavePad | Plays the selected chord with the Wavetable engine | Rust (`dsp/src/timbre.rs`) |
| Analog | The same Rust voice as the four Rust-voice patches in [Synth](synth-and-control.md#the-four-rust-voice-patches) | Rust voice |

The first seven machines (the six FM voices and Saw) render in Rust in playback and WAV exports, one AudioWorklet voice per note. The oscillators and filters of Ladder, DualVCO, Wavetable and WavePad also render in Rust. Analog uses the Rust voice in playback and WAV exports.

### What the four knobs do

| Machine | Color | Shape | Sweep | Contour |
| --- | --- | --- | --- | --- |
| Saw | Changes detuning | Drives the saturation | Opens a falling filter envelope | Sets the envelope's duration |
| Ladder, DualVCO | Changes the wave blend | Changes resonance | Opens the filter envelope | Sets the envelope decay |
| Wavetable, WavePad | Changes the wave blend | Changes resonance | Opens the filter envelope and adds wave motion | Sets the envelope decay |
| Analog | Blends saw/pulse | Controls resonance | Controls filter-envelope amount and PWM | Sets envelope decay |

### Filter: Biquad / Ladder β

Ladder, DualVCO, Wavetable and WavePad tracks choose their filter in the track editor.

- **Biquad** is the original waveshaper and biquad pair.
- **Ladder β** is a four-pole transistor-ladder model written in Rust (`dsp/`) and compiled to WebAssembly. It runs in an AudioWorklet at twice the sample rate, solves its feedback loop without a unit delay and saturates inside that loop, so resonance thins the bass and loud notes compress the way an analog ladder does. Shape 100 stays just below self-oscillation.

The switch affects new notes, is saved with the project, and is used for WAV exports too. Older projects open with Biquad.

### Good to know

- If the worklet cannot load, the first seven machines fall back to the equivalent Web Audio graph. Ladder, DualVCO, Wavetable and WavePad also have the Web Audio graph as a fallback.
- If the browser cannot load the Ladder β worklet, voices fall back to Biquad and the status line says so.
- If the Rust voice behind Analog cannot load, playback/export reports an error rather than substituting another sound.
- The four-pole filters of Ladder, DualVCO, Wavetable and WavePad use two biquads: these are inspired digital voices, not circuit emulations or factory samples.
- Ladder β is an original model of the general topology, not a measurement of a specific instrument.
- Existing projects retain their previous machines and sound paths.

## Tracks and sound knobs

- Click a track name to select it.
- Each track header has an audition square, mute, solo and a hit-activity meter.
- **Color**, **Shape**, **Sweep** and **Contour** are the four machine knobs. Pitch, decay, filter, level and pan complete each sound.
- Each track has a tempo-synced LFO for FM shape, filter, pitch or pan.
- Individual track lengths and speeds are available in the track editor.
- Use **FILL**, mute and solo while playing.
- The starter Tone bass uses a low E1 and a gentle filter.

Changes affect upcoming hits; they do not rewrite notes already sounding.

| Knob input | Effect |
| --- | --- |
| Drag vertically | Change the value |
| `Shift` + drag | Finer movement |
| Arrow keys (focused knob) | Step the value |
| `Page Up` / `Page Down` | Bigger jumps |
| `Home` / `End` | Jump to the ends of the range |

Level controls use the same slider style in Groove, Synth, Listen and the performance mixer. The strip's **Output** slider controls listening volume across browser instruments and recordings and remembers its setting. It leaves capture and WAV export levels unchanged. External Ardour audio uses its own mixer.

## Patterns and steps

### Loop length and pages

- **Loop length 16 / 32 / 48 / 64** sets the pattern and all sixteen track lengths together.
- **View steps 1–16 / 17–32 / 33–48 / 49–64** changes only the visible page.
- Shortening a loop preserves notes outside it, so extending it restores them.

### Editing steps

| Input | Effect |
| --- | --- |
| Click a step | Toggle it |
| Right-click a step | Select without toggling |
| Arrow keys | Move within the grid (the grid is one tab stop) |
| `Enter` | Toggle the step |
| `Shift` + `Enter` | Select the step |

Each step has its own velocity, chance, microtiming, retrigs, gate and conditional trigger.

- Gates extend up to eight lane steps for sustained melodies.
- Microtiming is a fraction of the lane's own step, so it scales with track speed.

### TRIG LOCK

1. Enable **TRIG LOCK**. The knob panels swap to the selected step: its velocity, chance, microtiming, retrig, gate and condition, plus a **Locks** panel.
2. Turn a lock knob. This stores an override for that hit, shown in amber with the base value underneath.
3. Press `Delete` on a focused lock knob to remove that lock, or use **Clear locks** to remove the selected step's overrides.
4. Turn **TRIG LOCK** off to edit the track's base sound.

### Patterns

- Starter patterns A–D hold independent sequences and sounds.
- Projects support up to 64 patterns.
- Pattern changes queue for the next 4/4 bar, even with a longer pattern.
- Clicking the currently playing pattern cancels the queued change; choosing another replaces it.
- Existing notes and effect tails continue across the change.

### Follow playback

**Follow playback** changes step pages for the selected lane and keeps the active song section visible. The compact overview shows the whole arrangement; the named row below stays readable and scrolls to the playing section. Browsing pages or scrolling the grid pauses following; **Resume follow** returns to the audible position. Demo chapters also reveal their featured player. Track labels and step numbers stay visible in the scrolling grid.

## Song library

The **Song library** picker contains eighteen original arrangements. Choose one and press **Load track**.

| Track | Genre | BPM | Bars / sections | Notes |
| --- | --- | --- | --- | --- |
| Neon Afterimage | Darkwave | 112 | 64 bars, 8 sections | Four patterns |
| Rain on Concrete | Trip hop | 84 | 64 bars, 8 sections | Four patterns |
| Velvet Circuit | Deep house | 122 | 64 bars, 8 sections | Four patterns |
| Low Pressure | Dub techno | 126 | 64 bars, 8 sections | Four patterns |
| Ghost Signal | Electro | 132 | 64 bars, 8 sections | Four patterns |
| Before the City Wakes | Ambient breaks | 76 | 64 bars, 8 sections | Four patterns |
| Chrome Cathedral | Synth pop | 110 | 64 bars, 8 sections | Leaves four lanes free for overlays |
| Body Electric | Industrial EBM | 124 | 64 bars, 8 sections | Leaves four lanes free for overlays |
| Mirrorball After Dark | Italo disco | 118 | 64 bars, 8 sections | Leaves four lanes free for overlays |
| Shadow Circuit | Post-punk | 118 | 72 bars, 8 named sections | Uses every lane |
| Midnight Overpass | Cinematic synthwave | 106 | 72 bars, 8 named sections | Uses every lane |
| Acid Rain Relay | Acid breaks | 134 | 72 bars, 8 named sections | Uses every lane |
| Iron Orchid | Industrial techno | 138 | 72 bars, 8 named sections | Uses every lane |
| Redline Ritual | Darksynth | 130 | 96 bars, 9 sections (about three minutes) | Uses all sixteen lanes; includes a stripped breakdown and a final drop |
| Redline Ritual — Overdrive | Aggressive darksynth | 160 | 112 bars, 11 sections (2:48 plus a 6-second export tail) | Separate version with six patterns; the original Redline remains available |
| Neon Letters | 80s synth pop | 116 | 64 bars, 7 sections | Analog machine demo; four empty lanes for overlays |
| Glass Platforms | 80s new wave | 104 | 64 bars, 7 sections | Analog machine demo; four empty lanes for overlays |
| Satellite Hearts | 80s Italo pop | 124 | 64 bars, 7 sections | Analog machine demo; four empty lanes for overlays |

### Track details

- **Shadow Circuit, Midnight Overpass, Acid Rain Relay and Iron Orchid.** All sixteen lanes play in their main and final sections, with separate bass, sub, chords, hook, arpeggio, pad, reply and percussion parts. Sparse intros and breakdowns leave space between those sections. Pattern D develops the hook and drum fills for the final section. The four songs combine Ladder bass and leads, DualVCO plucks and replies, and moving WavePad/Wavetable layers.
- **Redline Ritual.** The sixteen lanes are kick, snare, hats, lead, distorted bass, fifths, subbass, octave lead, arpeggio, drone, industrial percussion, crash, toms, bell, shaker and a second synth answer.
- **Redline Ritual — Overdrive.** Detuned saw/pulse analog bass, longer pedal-note phrasing, a warm ladder filter, double-kick passages, half-time breakdowns and stop-start drops.
- **Neon Letters, Glass Platforms and Satellite Hearts.** Three original songs that demonstrate the Analog machine. Each has a developed final hook.

### Loading and restoring

- Loading a track saves one backup of the previous session. **Restore session** brings it back, including after a reload.
- Export a project JSON to keep additional versions.
- Old six- and twelve-lane projects gain empty lanes on import.

### Song mode

**Song mode** plays the arrangement once, with section-specific instruments and a changing timeline.

- Enable **Continuous Play** to repeat the whole arrangement until stopped.
- Click a named section to start there, or queue a jump on the next bar while playing; existing sound tails continue.
- Return to start resets the arrangement to its beginning.
- Turn **Song mode** off while stopped to play and edit individual patterns.

Limits:

- Section jumps are disabled while synced to a recording.

### Space and Pump

- **Space** adds a tempo-synced echo.
- **Pump** ducks the music behind the kick.

## Overlay MIDI

**Overlay MIDI…** adds a four-bar part from a MIDI file to empty lanes in the current pattern.

1. Press **Overlay MIDI…** and choose a standard MIDI format 0/1 file (up to 2 MiB).
2. Choose a melodic part, its starting bar in 4/4 and optional transposition.
3. Confirm. Four bars are added to empty lanes in the current pattern; existing notes and BPM are preserved.

Limits:

- Notes snap to sixteenths; long gates shorten to half a beat.
- Drum mapping, sustain/CC and tempo changes are not imported.
- Shadow Circuit, Midnight Overpass, Acid Rain Relay and Iron Orchid use every lane. Choose Chrome Cathedral, Body Electric or Mirrorball After Dark, or clear a lane, before adding an overlay.
- Chrome Cathedral, Body Electric and Mirrorball After Dark leave four lanes free for overlays, as do Neon Letters, Glass Platforms and Satellite Hearts.

## Auto sync with a recording

**Auto sync track** detects the beat grid of the recording loaded in [Listen](listen-and-ai.md). Detection runs on this computer: no API key, upload or paid model request is involved.

Once linked:

- Play starts both engines.
- Groove follows Recording pause, seeks, A–B loops and playback speed.

Limits:

- It needs 4 seconds to 20 minutes of mono or stereo audio, up to 192 kHz.
- Manual BPM changes, opening a project or choosing another recording unlink them.
- Sync is temporary and must be enabled again after reloading.
- Beat detection estimates tempo and phase, can choose half/double time, and does not identify the musical downbeat. Use manual BPM when the estimate does not fit.

## Playalong guide

**Playalong guide** opens an optional, remembered guitar and bass panel. It follows scheduled Groove note gates, note locks and section lane masks.

- Auto groups harmony lanes for suggested standard-tuning guitar shapes and chooses a bass lane.
- Use the source selectors to choose an individual lane.
- Bass positions include the written octave.
- Unrecognized note groups show note names instead of a chord diagram.

Limits:

- Tuning-controller pitches are rounded to the nearest semitone; effects, glide and modulation can differ.
- Imported-recording chord analysis is not included.

## Sound demo

An optional content pack can enable **Sound demo** in the Song library. It demonstrates sampled instruments, phrasing, dynamics, synthesis and mixer sends without changing the saved score or ordinary WAV exports. The public library hides this control when no tour is installed. See [content packs](../content-packs.md).

## Stereo output meters

**Stereo output** in the Groove song panel offers six meter faces:

- Analog VU
- Tape LED
- Digital peak / RMS
- Studio PPM
- Broadcast bars
- Stereo scope

They measure the left and right channels separately after the **Output** slider, with independent peak holds and overload indicators. The selected face is remembered, and it follows Groove's actual audio output.

- Analog VU and Stereo scope show per-channel HOLD values.
- Analog VU uses a 300 ms response with 0 VU calibrated to −18 dBFS.
- A lightweight AudioWorklet scans every output sample for peaks and reports at most 20 times per second, independently of drawing, so short overloads between screen updates are retained.
- Hidden meters skip waveform reads, and settled silence stops canvas redraws; reduced motion slows the display while peak accumulation continues.

Limits:

- If the meter worklet cannot load, analyser snapshots remain available but can miss short transients.
- These are visual sample meters, not certified true-peak or broadcast compliance meters.

## Background playback

Groove keeps playing when you switch tabs, apps or minimize the desktop window. Song endings and playback queues use the audio clock independently of screen updates. The [desktop shell](../desktop.md) disables background timer throttling.

Limits:

- Browsers and operating systems may still suspend audio or discard tabs; this does not keep playback running through computer sleep or app closure.
- Keep the tab visible: hiding it stops the browser transport.

## Phone view

On screens up to 620 px wide, a performance view replaces the desktop editor with sixteen machine pads, pattern buttons, 16 step pads per page and four sound macros.

| Gesture | Effect |
| --- | --- |
| Tap a machine | Select it |
| Double-tap | Audition |
| Hold | Mute |

Dedicated **Audition** and **Mute** buttons provide the same actions. The phone and desktop views share the saved project and transport; resize without losing edits. Use the desktop editor for detailed step locks, track timing and modulation.

## Sampled instruments

Sampled instruments load through one bounded pool of 16 recording jobs across missing banks. They keep their existing 32 kHz decode rate, velocity layers and alternate takes.

- Banks become available together after successful decoding.
- A failed load drains its workers before a retry.
- Already decoded instruments stay immediately available.

See [performance measurements and reproduction](../performance.md) and the [instrument sources](../../web/instruments/README.md).

## Saving and exports

Project files and audio exports live in the **Export** menu. The project autosaves in this browser.

| Menu item | What it does |
| --- | --- |
| **Mix WAV** | Renders four cycles of the current pattern as stereo 48 kHz 24-bit PCM audio with TPDF dither, including sound locks and LFO modulation |
| **Track WAV** | Renders the selected lane, even when muted |
| **Full song WAV** | Exports the arrangement as stereo 48 kHz PCM with a decay tail |
| **MIDI** | Exports sixteen note channels, tempo, timing, retrigs, velocity and locked pitches |
| **Save project** | Exports a JSON backup |
| **Open project…** | Validates and restores a JSON backup |

Export before clearing browser data or moving to another browser.

### WAV limits

- **Mix WAV** and **Track WAV** both include a quarter-beat lead-in and a decay tail.
- **Mix WAV** and **Track WAV** use the current pattern with Fill off and a fixed project BPM, also when a song is loaded; they do not render the recording or its live beat grid.
- Very dense renders have a voice limit; export individual tracks if the mix exceeds it.
- The [Control](synth-and-control.md#control-layer) layer's current settings are frozen into Groove WAV exports.

### MIDI limits

- Repeated notes of the same pitch end their preceding gate before retriggering.
- FM timbres, sound modulation and other sound locks remain in WAV or project JSON.
- This MIDI file export is separate from USB MIDI input, which is handled in the [Performance studio](perform.md).

### Using exports in Ardour

Import WAV or MIDI through **Session → Import** in Ardour. The browser groovebox and Ardour have separate transports; there is no automatic clock sync or plugin installation. See [Ardour](ardour.md).

## Rebuilding the DSP

The generated `web/ladder-wasm.js` is committed, so running the app needs no Rust. After changing `dsp/`:

1. Install Rust with the `wasm32-unknown-unknown` target.
2. Run `npm run dsp`.
3. Run `cargo test` in `dsp/` for the filter's own tests.

See [development](../development.md) for the other checks.
