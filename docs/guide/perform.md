# Performance studio

Open **Perform** in the rail to save and replay a live session. This page covers each section of the panel in the order of its jump links: Session, Takes, Macros, Scenes, Jam, USB MIDI, Mixer and Modulation. The **MPK mini** section has its own page: [Akai MPK mini Plus II](mpk-mini-plus-ii.md).

The panel works alongside [Groove](groove.md), [Synth](synth-and-control.md) and [Listen](listen-and-ai.md). Live audio uses one shared Web Audio clock, with capture on an AudioWorklet rather than the screen-update thread. It runs locally without an API key.

## Session

### Undo and redo

**Undo** / **Redo** cover the performance controls: setups, A/B snapshots, macros, scenes, mixer, modulation and MIDI mappings.

| Key | Action |
| --- | --- |
| `Cmd/Ctrl+Z` | Undo (outside text fields) |
| `Shift+Cmd/Ctrl+Z` | Redo (outside text fields) |

Undo does not undo sequencer or Synth patch edits.

### Hold to experiment

Hold **Hold to experiment** with a pointer or `Space`/`Enter` to try changes, then release to return. The held experiment cannot overwrite the saved base setup.

### Controller target

**Controller target** selects what the controller processes:

- **All engines**
- **Groove only**
- **Synth only**
- **Listen only**

### Setups

**Save setup** gives the current controller sound a name. Saved setups travel inside the Groove project; see [What is saved and exported](#what-is-saved-and-exported).

## Takes

### Record a take

1. Optionally enter a **Next take name**.
2. Click **Record take**.
3. Play.
4. Stop. A new recording is added to **Saved performances** in local IndexedDB.

A take captures stereo audio plus keys, controller moves, tuning, macros, lane mix, modulation routes, Synth patches, tempo, pattern changes and section jumps.

To rename a take afterward, use **Take name** → **Save name**.

Limits:

- A take stops after five minutes, 20,000 gestures or the gesture storage limit.
- Recording and replay stop when the app is hidden. Stop unfinished takes before quitting.

### Take library

- Select any saved take in **Saved performances** to return to it. Recording another take never replaces it.
- Deleting a take asks for confirmation and leaves other entries intact.
- The previous single saved take migrates into the library automatically.
- Auditioning a take pauses Listen and stops live Groove/Synth so the recording plays on its own.

The take library is local to this browser or desktop data directory. Download backups before clearing app data.

### Named parts

A part is a named range of the recorded audio.

1. Choose **Name or edit parts**.
2. Enter an Intro/Chorus/etc. name and start/end times in seconds. You can also seek in the audio player and use **Mark start here** / **Mark end here**.
3. Click **Save part**.

To play a part, choose it in **Playback part**, then **Play selected part** or **Loop selected part**.

- **New part** starts another range.
- **Whole take** plays the complete recording.

Good to know:

- Part edits leave the recorded audio intact.
- Parts select recorded audio; gesture replay always recreates the full take.

### Gesture replay and editing

**Replay gestures** temporarily loads the take and restores your previous project and controller when it stops.

To edit and render a replay:

1. Open **Gesture replay & editing**.
2. Move or delete events. Keep note-on/off events paired.
3. Use **Render replay as new take** to render the result in real time.

Rendering adds a new library entry with the same named parts and preserves the original recording. A canceled render creates no new entry.

Limits:

- The original recording captures Groove, Synth and Listen together; gesture replay recreates Groove + Synth and pauses Listen.
- Listen transport and sequencer edits are preserved in the recorded audio, not the gesture timeline.
- Replay uses a short browser scheduling interval, so the original WAV is the reference for exact timing and sound.
- Ardour audio is outside this graph.

### Rolling capture and the master meter

- **Arm rolling capture** keeps up to 60 seconds of recent audio in memory.
- **Save last 60 seconds** downloads it.

The buffer starts when armed and clears on reload.

The master meter shows sample peak and RMS in dBFS with a clip indicator; it is not a LUFS meter.

### Take exports

Use the two exports together to keep a portable backup:

| Button | Output |
| --- | --- |
| **Export take WAV** | The audio, as a separate WAV |
| **Export gestures & parts** | JSON containing the starting project, gestures and named parts |

Importing gestures adds a separate entry without audio; render it to make it playable.

## Macros

Eight macros shape selected Groove lanes: **Weight**, **Bite**, **Drift**, **Width**, **Air**, **Tension**, **Space**, **Pulse**.

Target all lanes, drums, music, or individual lanes.

## Scenes

Eight named scenes capture controller, macro and target values.

**Recall** queues scale/root/tuning for the next bar while Groove plays, then morphs continuous values over 1–8 bars. Changing transport cancels an in-progress transition.

## Jam (experimental phrase accompaniment)

**Perform → Jam** (“Play → add the band”) builds a backing band around a phrase you play. No network request or paid model is used.

1. Choose a tempo and style.
2. Click **1 · Listen to my phrase**.
3. Play on MIDI or the Synth keyboard.
4. Click **2 · Done — add the band**.

A learned encoder push can perform both steps; see [Akai MPK mini Plus II](mpk-mini-plus-ii.md#learn-the-remaining-buttons).

### What it creates

The local harmonizer estimates major/minor tonality and chooses chords using the phrase's notes and durations. It creates editable bass, drums, three harmony voices and up to eight melody voices, with four backing variations arranged as a looping song.

The styles **Groove**, **Gentle** and **Pulse** change the backing while retaining the played melody pitches.

### Your previous project

A new mix is created while preserving learned MIDI mappings and profile. The first original session is saved before replacement; **Restore previous project** restores it, including after reload. Regeneration does not replace that backup.

### Limits

| Limit | Value |
| --- | --- |
| Phrase length | Up to four bars |
| Notes | Up to 256 |
| Density | Eight notes per sixteenth |
| Pitch range | MIDI pitches 24–96 |

- The first note defines the start.
- Onsets snap to sixteenths, and notes longer than two beats are shortened and reported.
- The melody uses Tone rather than reproducing the current Synth patch or pitch-wheel expression.
- Very short or chromatic phrases can produce an ambiguous key.
- Recording/replay/export must finish before changing the project.

## USB MIDI

Click **Connect USB MIDI**, then play Synth with velocity, sustain, ±2-semitone pitch bend, channel pressure or poly aftertouch.

For the Akai profile, its knob banks, pads and guided learning, see [Akai MPK mini Plus II](mpk-mini-plus-ii.md).

### MIDI Learn

Right-click a Controller, Synth, macro or mixer knob to Learn its next CC.

### Pickup

Pickup waits until the physical control crosses the software value, including after an on-screen edit.

### Generic 8 knobs preset

The **Generic 8 knobs** preset maps channel 1 CC 20–27 to macros.

### Good to know

- Device mappings save with the project; reconnect MIDI after restarting.
- Web MIDI needs Electron or a compatible browser.
- The app requests MIDI access with SysEx first; SysEx is only needed for the MPK's display and lights. Without that permission it connects with SysEx disabled: keys and Learn work, and the MPK display and lights are unavailable.

## Mixer

The lane mixer adds, per lane:

- three-band EQ
- level and pan
- mute/solo
- peak meters
- post-fader sends to a shared dotted-eighth delay and reverb

Drum/music group faders control their buses; shared effects return through the music group.

Groove mix, song and selected-lane WAV exports include saved macros and mixer routing. Use **Groove → Export → Track WAV** for one stem at a time.

## Modulation

Four modulation routes add motion to the controller.

| | Options |
| --- | --- |
| Sources | Tempo-synced sine/triangle LFOs, repeating envelopes, stepped random motion, lane amplitude |
| Destinations | Controller cutoff, motion, space, drive, fine tuning |

Set depth to zero to disable a route.

These overlays leave the saved base knobs unchanged. Capture a live take to preserve the resulting movement; offline Groove exports freeze the base controller and do not run the live modulation routes.

## What is saved and exported

| Item | Where it lives |
| --- | --- |
| Setups, A/B snapshots, macros, scenes, mixer, modulation and MIDI mappings | Inside **Groove → Export → Save project** |
| Saved macros and mixer routing | Included in Groove mix, song and selected-lane WAV exports |
| Take library (audio and recordings) | Local IndexedDB in this browser or desktop data directory |
| Take audio backup | **Export take WAV** |
| Take gestures, starting project and named parts | **Export gestures & parts** (JSON) |
| Rolling capture | In memory until **Save last 60 seconds** downloads it; clears on reload |
| Jam backup of the first original session | Kept for **Restore previous project**, including after reload |

What is not saved or exported:

- Groove project exports do not contain the take library's audio or recordings. Download backups before clearing app data.
- Imported gestures have no audio until rendered.
- Live modulation movement is not in offline Groove exports; they freeze the base controller.
- Listen transport and sequencer edits are in a take's recorded audio, not its gesture timeline.
- Ardour audio is outside the recording graph.
- The MIDI connection itself: reconnect MIDI after restarting.

Old projects open with neutral performance settings.
