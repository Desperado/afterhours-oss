# AFTERHOURS

[Website](https://desperado.github.io/afterhours-oss/) · [Download for macOS](https://github.com/Desperado/afterhours-oss/releases/latest) · [Public CI](https://github.com/Desperado/afterhours-oss/actions/workflows/ci.yml)

A local music studio for sequencing songs, playing synths, recording performances and studying recordings. Build sixteen-lane Groove arrangements, play a keyboard or USB MIDI controller, shape the mix, and export projects, MIDI and WAV audio. Listen and AI add waveform playback, loops, local measurements and optional paid musical feedback.

The backend is Python; the interface is plain HTML, CSS and JavaScript. It reuses the existing music-analysis skill and its librosa, NumPy, SoundFile and OpenAI audio pipeline. The modular Rust DSP core compiles to WebAssembly for the audio rendering thread. It supplies the complete Analog voice, the Groove FM machines and Saw, the Ladder, DualVCO and Wavetable voices, and the ladder filter; see [DSP architecture and extension guide](dsp/README.md).

## Run

With the Python environment installed, start the browser app:

```sh
bash start.sh
```

Open **http://127.0.0.1:8765**. To use another port:

```sh
bash start.sh --port 8766
```

For a fresh checkout, install Python 3.11 and Node.js, then run the automated setup:

```sh
npm run setup
bash start.sh
```

Setup installs the Python and Node dependencies and validates any configured private content. Conductor runs the same setup for new workspaces. Private content is an explicit, one-time opt-in; see [private setup](docs/content-packs.md). Once configured, browser and desktop development and ordinary local builds include it automatically across this repository’s workspaces. `bash start.sh --public` and `npm run desktop:public` run the public app.

### First session

- Open **Groove → Song library**, choose **Neon Afterimage**, press **Load track**, then Play. This synth arrangement works without downloaded instrument recordings or an API key.
- Open **Synth** to play the on-screen or computer keyboard. **Perform** opens recording, USB MIDI, scenes and the lane mixer; **Control** opens the shared sound controls.
- Open **Listen** to import and loop a recording. **AI → Local signal scan** measures an excerpt locally; paid listening is optional.

Sampled instruments need separately installed recordings; a checkout contains their manifests and source notices. See [instrument installation](web/instruments/README.md#local-installation-and-native-packaging). The public demo library uses synthesis and works without these downloads. Optional private songs and the sound tour come from a [separate content pack](docs/content-packs.md).

## macOS desktop app

AFTERHOURS also runs as a standalone Electron app. The Apple Silicon build includes the Python runtime and audio libraries: launching the `.app` does not need a terminal, Python, Node or the development checkout. Groove, live effects and beat sync run locally. Ardour remains a separately installed application.

Download the DMG or app ZIP from [GitHub Releases](https://github.com/Desperado/afterhours-oss/releases/latest). The current binaries support Apple Silicon Macs and are ad-hoc signed, without Apple Developer ID notarization; macOS may block the first launch. The release includes checksums and corresponding third-party sources.

After `npm run setup`, run `npm run desktop` for development. Build the standalone app and a drag-to-Applications disk image with:

```sh
npm run desktop:dist
```

Configured private builds go to `.context/desktop-dist/private/`; unconfigured checkouts build public content in `.context/desktop-dist/public/`. The app is under `mac-arm64/AFTERHOURS.app` and the DMG is alongside that folder. `npm run desktop:pack` builds only the app. `npm run desktop:dist:public` always builds public content, even when private content is configured. Each workspace has its own output. These local builds use the same ad-hoc signing as the public binaries. Developer ID signing and notarization remain a future distribution improvement.

Desktop recordings, reports, caches and browser projects are kept in `~/Library/Application Support/AFTERHOURS/`, independently of the browser version and app bundle. **File → Open Data Folder** opens it. Import recordings through Listen; the build does not embed imported user-data recordings, reports or credentials. Public builds include only the reviewed list in `desktop/web-assets.json`, without local audio. Private builds include the selected pack, its instrument recordings and its app icon, use a separate output folder, and stop if required recordings are missing or checksums differ. See [private build instructions](docs/content-packs.md) and [release readiness](docs/open-source-readiness.md). Export a Groove project in the browser and open that JSON in the desktop app to transfer it. To use a separate profile, launch the executable with `--data-dir=/absolute/path`.

Paid listening is optional and still requires an OpenAI API key. The desktop backend reads only `OPENAI_API_KEY` from a `.env` file in the data folder, or from the launching process. It does not copy the development checkout's `.env`. Local features work without a key.

The desktop shell uses a stable `afterhours://app` origin so autosaved projects survive changes to the private server port. The renderer is sandboxed, has no Node access, and can reach only the app. A private capability protects the loopback server; closing the app also closes that server. Run `npm run test:desktop` for the Electron smoke tests. Set `AFTERHOURS_DESKTOP_APP` to the packaged executable to run those checks against the standalone build.

## Layout

The top strip always shows the three engines — **Groove** (the sequencer and its synthesized or sampled instruments), **Recording** (the listening-room player) and **Ardour** — with each one's state. Click an engine to make it active; the strip's Start, Play and Stop buttons, position and tempo then belong to it. Pressing Play inside a workspace also makes that engine active. **Space** plays or stops the active engine, and **?** opens the help sheet. Engines run independently unless Groove is linked to the recording with **Auto sync track**. A **Separate clock** chip appears when independent engines play together; Ardour always keeps its own clock.

The rail switches between the **Groove**, **Synth**, **Ardour**, **Listen** and **AI** workspaces. **Perform** and **Control** open panels alongside the current workspace. Switching workspace never changes the active engine. The last workspace and engine are remembered in this browser. One status line at the bottom reports what just happened.

Colors have one job each, and each is paired with a symbol: magenta means sound is playing, amber (◆) marks a locked or overridden value, cyan means connected or safe, and lime ($) appears only where money is spent. Fonts (Chakra Petch, IBM Plex Sans Condensed, JetBrains Mono, all SIL OFL) are served from `web/fonts`, so the app makes no external font requests.

## Use

- Import a WAV, MP3, FLAC, OGG or AIFF recording, up to 100 MB and 20 minutes, mono or stereo, up to 192 kHz. Browser playback support varies; WAV and MP3 are the safest choices.
- Open **Listen**. Click the waveform to seek. Press **A** at the playhead, move forward, press **B** to arm the loop; the loop chip toggles it on and off, and double-clicking it clears both points. The played part of the waveform is tinted, and the loop band is marked on the wave. With Recording active, Space toggles playback outside form controls.
- Listening modes are cards in **AI**: **Local signal scan** measures the selected excerpt on this Mac. No API key or audio upload is needed. Tempo estimates can have half-time or double-time ambiguity.
- **Selected excerpt** sends up to 120 seconds to the OpenAI Audio API for musical feedback. **Use A–B loop** copies the armed loop into the excerpt fields.
- **Whole track** covers the entire recording in independent excerpts of up to 120 seconds with 5 seconds of overlap. This is not one continuous model context. Completed excerpts are saved even if a later request fails.
- Existing sessions are free to browse in the **Saved** list; each shows how many paid requests it used. New audio-model listening starts only when you press **Send**; the **Before you send** card shows the destination and request count. API billing is separate from a Codex subscription. No automatic retries are made.
- Reports show what the model heard per excerpt with a timestamp button that jumps the player there, plus experiment checkboxes. **New listen** returns to the mode cards. Export saves the selected session as JSON. Experiment checkboxes are remembered in this browser.

## Live effects

Press Play and move the controls in **Live effects**. A streaming Web Audio graph applies low-pass filtering and resonance, bass/treble EQ, parallel distortion, and feedback echo immediately during playback. The XY pad controls filter cutoff (horizontal) and echo mix (vertical); arrow keys work too. Dark room, Dub echo, and Dirty tape presets are starting points.

**Original** compares the processed mix with an unprocessed path. **Reset** clears settings and echo tails. Parameters transition over about 45 ms to avoid abrupt jumps; changing echo time deliberately bends the repeats. A compressor on the processed path controls large peaks. Pause silences the echo; switching recordings clears the graph's delay memory and resets controls.

Effects run in the browser on this Mac, with no API calls. They affect the entire mix, rather than isolated instruments. The original audio, signal measurements and AI reports remain unchanged. Export session includes the current effect settings in JSON, but does **not** render processed audio or record knob movements. Settings reset when the page reloads or you select a recording.

## Groove sequencer

An optional content pack can enable **Sound demo** in the Song library. It demonstrates sampled instruments, phrasing, dynamics, synthesis and mixer sends without changing the saved score or ordinary WAV exports. The public library hides this control when no tour is installed.

**Follow playback** changes step pages for the selected lane and keeps the active song section visible. The compact overview shows the whole arrangement; the named row below stays readable and scrolls to the playing section. Browsing pages or scrolling the grid pauses following; **Resume follow** returns to the audible position. Demo chapters also reveal their featured player. Track labels and step numbers stay visible in the scrolling grid.

Level controls use the same slider style in Groove, Synth, Listen and the performance mixer. The strip's **Output** slider controls listening volume across browser instruments and recordings and remembers its setting. It leaves capture and WAV export levels unchanged. External Ardour audio uses its own mixer.

**Stereo output** in the Groove song panel offers six meter faces: Analog VU, Tape LED, Digital peak / RMS, Studio PPM, Broadcast bars and Stereo scope. They measure the left and right channels separately after the Output slider, with independent peak holds and overload indicators. Analog VU and Stereo scope show per-channel HOLD values. A lightweight AudioWorklet scans every output sample for peaks and reports at most 20 times per second, independently of drawing, so short overloads between screen updates are retained. Analog VU uses a 300 ms response with 0 VU calibrated to −18 dBFS. The selected face is remembered. Hidden meters skip waveform reads, and settled silence stops canvas redraws; reduced motion slows the display while peak accumulation continues. If the meter worklet cannot load, analyser snapshots remain available but can miss short transients. These are visual sample meters, not certified true-peak or broadcast compliance meters.

Sampled instruments load through one bounded pool of 16 recording jobs across missing banks. They keep their existing 32 kHz decode rate, velocity layers and alternate takes. Banks become available together after successful decoding; a failed load drains its workers before a retry. Already decoded instruments stay immediately available. See [performance measurements and reproduction](docs/performance.md).

Twelve original synthesized instruments — Kick, Snare, Metal, Perc, Tone, Chord, Saw, Ladder, DualVCO, Wavetable, WavePad and Analog — run locally without an API key or external plugins, on sixteen sequencer lanes. The workflow takes inspiration from Model:Cycles; no Elektron code or samples are included. The first six are our own FM voices. Saw adds detuned sawtooth oscillators, a triangle sub and oversampled saturation: Color changes detuning, Shape drives the saturation, Sweep opens a falling filter envelope and Contour sets its duration. These seven render in Rust (`dsp/src/groove.rs`) in playback and WAV exports, one AudioWorklet voice per note; if the worklet cannot load they fall back to the equivalent Web Audio graph.

**Ladder** adds a warm saw/square/sub blend; **DualVCO** mixes triangle and saw oscillators over a square sub. Both use saturation before a resonant lowpass. **Wavetable** crossfades two original harmonic frames across three detuned oscillators; **WavePad** plays the selected chord with that engine. For these four machines, Color changes the wave blend, Shape changes resonance, Sweep opens the filter envelope (and adds wave motion on Wavetable/WavePad), and Contour sets the envelope decay. Their four-pole filters use two biquads: these are inspired digital voices, not circuit emulations or factory samples. Their oscillators and filters render in Rust (`dsp/src/timbre.rs`), with the Web Audio graph as a fallback.

**Filter: Biquad / Ladder β.** Ladder, DualVCO, Wavetable and WavePad tracks choose their filter in the track editor. **Biquad** is the original waveshaper and biquad pair. **Ladder β** is a four-pole transistor-ladder model written in Rust (`dsp/`) and compiled to WebAssembly. It runs in an AudioWorklet at twice the sample rate, solves its feedback loop without a unit delay and saturates inside that loop, so resonance thins the bass and loud notes compress the way an analog ladder does. Shape 100 stays just below self-oscillation. The switch affects new notes, is saved with the project, and is used for WAV exports too; older projects open with Biquad. If the browser cannot load the worklet, voices fall back to Biquad and the status line says so. It is an original model of the general topology, not a measurement of a specific instrument.

The generated `web/ladder-wasm.js` is committed, so running the app needs no Rust. After changing `dsp/`, install Rust with the `wasm32-unknown-unknown` target and run `npm run dsp`; `cargo test` in `dsp/` runs the filter's own tests.

With Groove active, set **40–240 BPM** with the strip’s slider or numeric field, then press Play (or Space). Click a track name to select it, then drag the **Color, Shape, Sweep and Contour** knobs vertically. Hold Shift for finer movement; focused knobs also take arrow keys, Page Up/Down for bigger jumps and Home/End. Each track header has an audition square, mute, solo and a hit-activity meter. Pitch, decay, filter, level and pan complete each sound. Changes affect upcoming hits; they do not rewrite notes already sounding. The starter Tone bass uses a low E1 and a gentle filter.

- **Auto sync track** detects the loaded Listen recording’s beat grid on this Mac. It needs 4 seconds to 20 minutes of mono or stereo audio, up to 192 kHz. No API key, upload or paid model request is involved. Once linked, Play starts both engines; Groove follows Recording pause, seeks, A–B loops and playback speed. Manual BPM changes, opening a project or choosing another recording unlink them. Sync is temporary and must be enabled again after reloading. Beat detection estimates tempo and phase, can choose half/double time, and does not identify the musical downbeat. Use manual BPM when the estimate does not fit.
- Use **Loop steps 16 / 32 / 48 / 64** to set the pattern and all sixteen track lengths together. **View steps 1–16 / 17–32 / 33–48 / 49–64** changes only the visible page. Shortening a loop preserves notes outside it, so extending it restores them. Individual track lengths and speeds remain available in the track editor. Click a step to toggle it; right-click to select without toggling. The grid is one tab stop: arrows move, Enter toggles, Shift+Enter selects.
- Enable **TRIG LOCK** to swap the knob panels for the selected step: its velocity, chance, microtiming, retrig, gate and condition, plus a **Locks** panel. Turning a lock knob stores an override for that hit, shown in amber with the base value underneath; Delete on a focused lock knob removes that lock. Turn TRIG LOCK off to edit the track's base sound. Clear locks removes the selected step's overrides.
- Set velocity, chance, microtiming, retrigs, gate and conditional triggers per step. Gates extend up to eight lane steps for sustained melodies. Microtiming is a fraction of the lane's own step, so it scales with track speed. Use Fill, mute and solo while playing. Each track has a tempo-synced LFO for FM shape, filter, pitch or pan.
- Starter patterns A–D hold independent sequences and sounds; projects support up to 32 patterns. Pattern changes queue for the next 4/4 bar, even with a longer pattern. Clicking the currently playing pattern cancels the queued change; choosing another replaces it. Existing notes and effect tails continue across the change. Keep the tab visible: hiding it stops the browser transport.

On screens up to 620 px wide, **Perform** replaces the desktop editor with sixteen machine pads, pattern buttons, 16 step pads per page and four sound macros. Tap a machine to select it, double-tap to audition, or hold to mute. Dedicated Audition and Mute buttons provide the same actions. The phone and desktop views share the saved project and transport; resize without losing edits. Use the desktop editor for detailed step locks, track timing and modulation.

Project files and audio exports live in the **Export** menu. The project autosaves in this browser. **Save project** exports a JSON backup; **Open project** validates and restores one. Export before clearing browser data or moving to another browser.

**Mix WAV** renders four cycles as stereo 48 kHz 24-bit PCM audio with TPDF dither, including sound locks and LFO modulation. **Track WAV** renders the selected lane even when muted. Both include a quarter-beat lead-in and a decay tail. Very dense renders have a voice limit; export individual tracks if the mix exceeds it. Exports use the current pattern with Fill off and a fixed project BPM; they do not render the recording or its live beat grid.

**MIDI** exports sixteen note channels, tempo, timing, retrigs, velocity and locked pitches. Repeated notes of the same pitch end their preceding gate before retriggering. FM timbres, sound modulation and other sound locks remain in WAV or project JSON. Import WAV or MIDI through **Session → Import** in Ardour. The browser groovebox and Ardour have separate transports; there is no automatic clock sync or plugin installation.

## Original tracks and live Synth

The Groove track picker contains eighteen original arrangements: **Neon Afterimage** (darkwave), **Rain on Concrete** (trip-hop), **Velvet Circuit** (deep house), **Low Pressure** (dub techno), **Ghost Signal** (electro), **Before the City Wakes** (ambient breaks), **Chrome Cathedral** (synth pop), **Body Electric** (industrial EBM), **Mirrorball After Dark** (Italo disco), **Shadow Circuit** (post-punk), **Midnight Overpass** (cinematic synthwave), **Acid Rain Relay** (acid breaks), **Iron Orchid** (industrial techno), **Redline Ritual** (darksynth), **Neon Letters** (synth pop), **Glass Platforms** (new wave), and **Satellite Hearts** (Italo pop). The first six each have four patterns and eight sections over 64 bars. Old six- and twelve-lane projects gain empty lanes on import. Redline Ritual uses all sixteen lanes: kick, snare, hats, lead, distorted bass, fifths, subbass, octave lead, arpeggio, drone, industrial percussion, crash, toms, bell, shaker and a second synth answer. It runs at 130 BPM, with nine sections over 96 bars (about three minutes), including a stripped breakdown and a final drop. **Redline Ritual — Overdrive** is a separate 160 BPM version: six patterns across 112 bars (2:48 plus a 6-second export tail), with detuned saw/pulse analog bass, longer pedal-note phrasing, a warm ladder filter, double-kick passages, half-time breakdowns and stop-start drops. The original Redline remains available. Loading a track saves one backup of the previous session; **Restore session** brings it back, including after a reload. Export a project JSON to keep additional versions.

**Shadow Circuit** (118 BPM), **Midnight Overpass** (106 BPM), **Acid Rain Relay** (134 BPM) and **Iron Orchid** (138 BPM) each have 72 bars across eight named sections. All sixteen lanes play in their main and final sections, with separate bass, sub, chords, hook, arpeggio, pad, reply and percussion parts. Sparse intros and breakdowns leave space between those sections. Pattern D develops the hook and drum fills for the final section. The four songs combine Ladder bass and leads, DualVCO plucks and replies, and moving WavePad/Wavetable layers. These four presets use every lane; choose Chrome Cathedral, Body Electric or Mirrorball After Dark or clear a lane before adding an overlay.

**Overlay MIDI…** reads standard MIDI format 0/1 files (up to 2 MiB). Choose a melodic part, its starting bar in 4/4 and optional transposition. It adds four bars to empty lanes in the current pattern and preserves existing notes and BPM. Notes snap to sixteenths; long gates shorten to half a beat. Drum mapping, sustain/CC and tempo changes are not imported. Chrome Cathedral, Body Electric and Mirrorball After Dark leave four lanes free for overlays.

**Song** plays the arrangement once, with section-specific instruments and a changing timeline. Enable **Continuous Play** to repeat the whole arrangement until stopped. Click a named section to start there, or queue a jump on the next bar while playing; existing sound tails continue. Return to Start resets the arrangement to its beginning. Section jumps are disabled while synced to a recording. Turn Song off while stopped to play and edit individual patterns. **Space** adds a tempo-synced echo, and **Pump** ducks the music behind the kick. The selected **Stereo output** meter face follows Groove's actual audio output. **Full song WAV** exports the arrangement as stereo 48 kHz PCM with a decay tail; Mix WAV and Track WAV still export the current pattern.

Open **Synth** for a separate polyphonic instrument that can play alongside Groove. Sixteen patches cover chorus-heavy post-punk, disco strings and clav, a house organ, 90s rave, an atmospheric pad, and six hardware-inspired sounds: **Grand dusk bass / lead**, **1002 wire pluck / twin current**, and **Third horizon / prism**. Filter, resonance, attack, release, drive, chorus, delay, reverb and level can be changed live. The new patches add **Wave blend** and **Filter env**; the wavetable patches also expose **Motion**. Blend and motion update held voices, while filter-envelope amount takes effect on the next note. Delay follows the Groove tempo when playing a note. Patch and control settings are remembered locally.

Four additional patches, **Circuit bass**, **Neon pluck**, **Signal lead** and **Clockwork pulse**, use the complete Rust voice. Their saw/pulse oscillators, sub/noise mixer, drift, PWM, independent filter/amplitude envelopes and nonlinear filter run together at 2× sample rate. **Pulse width** and **Motion** change held notes; **Glide**, attack and release configure new notes. Glide starts from the previous played pitch, while the keyboard remains polyphonic. Filter-envelope amount updates live on these four patches. These are original early-80s-inspired sounds, not sampled recordings or an exact Sequential Pro-One emulation.

In **Keyboard Synths**, **Match Groove part** copies the selected melodic Groove lane’s instrument, sound settings, mixer effects, song key and playing range. It uses the same audio renderer as Groove; the selected active step’s sound locks are included. **Follow selected part** keeps that match when you load a song or select a different lane. Drum selections fall back to a melodic lane. Songs without stored key information use an editable estimate. **Stay in key** snaps live notes to the chosen scale; **Shift MIDI to this octave** moves USB MIDI relative to C4 (the status line shows the resulting C). G-minor songs that use F♯ can use **Minor + leading tone**. Manual key/scale/octave changes stop following. Groove keeps playing, and recorded performances retain the matched sound and actual notes you played. Edit a matched instrument in Groove and match again. Selecting a keyboard preset stops following while retaining the key and octave. Turn off snapping and MIDI shifting for an ordinary chromatic keyboard.

Groove's **Analog** machine uses the same Rust voice in playback and WAV exports. Shape controls resonance, Color blends saw/pulse, Sweep controls filter-envelope amount and PWM, and Contour sets envelope decay. Three original 64-bar songs demonstrate it: **Neon Letters** (116 BPM synth pop), **Glass Platforms** (104 BPM new wave), and **Satellite Hearts** (124 BPM Italo pop). Each has seven sections, a developed final hook, and four empty lanes for overlays. Existing projects retain their previous machines and sound paths. If the Rust voice cannot load, playback/export reports an error rather than substituting another sound.

The new palette draws on the [Moog Grandmother](https://api.moogmusic.com/sites/default/files/2022-01/Grandmother_Manual_Version_2.pdf), the analog [PPG 1002 Mk2](https://www.ppgsynth.com/1002/specs), and [Groove Synthesis 3rd Wave](https://groovesynthesis.com/products/3rd-wave/24k-keyboard/). It uses original oscillator shapes and digital filter/effect approximations; it does not reproduce their circuits, spring tank, factory patches or wavetable library.

Open **Control** in the rail for a live sound layer above Groove, Synth and recording playback. Shape tone, resonance, heat, stereo movement and space with knobs or the XY pad. Six starting points, **Explore a variation**, and **Capture / Recall A/B** let you try changes while playing; **Bypass** compares with the original and **Reset controller** restores neutral settings.

Melodic Groove voices and held Synth notes also follow the controller's root, scale, transpose, fine tuning and momentary bend. Choose natural minor, Dorian, whole tone or Hirajoshi, with equal, 5-limit just, Pythagorean or notes mapped onto 19-tone equal tuning. Drums keep their pitch. Recording playback receives effects only; external Ardour audio is separate. Controller settings, named setups and A/B snapshots now save inside Groove projects and restore on reload. Groove WAV exports freeze the current settings, rather than record live knob movements; full-song renders process chunks separately. Saved instruments, patterns and MIDI remain unchanged.

Play the on-screen keys with a mouse or touch, or use **A W S E D F T G Y H U J K O L P** on the computer keyboard. **Z / X** shift the octave. **Panic** releases voices and clears effect tails; leaving Synth or switching away from the app also releases held notes. The instrument supports eight held notes. USB MIDI plays this instrument through the Performance studio; Groove's MIDI file export is a separate feature.

## Performance studio

Open **Perform** in the rail to save and replay a live session. This panel works alongside Groove, Synth and Listen. Live audio uses one shared Web Audio clock, with capture on an AudioWorklet rather than the screen-update thread. It runs locally without an API key.

- **Save setup** gives the current controller sound a name. Setups, A/B snapshots, macros, scenes, mixer, modulation and MIDI mappings travel inside **Groove → Export → Save project**. Old projects open with neutral performance settings. **Undo / Redo** covers these performance controls (Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z outside text fields); it does not undo sequencer or Synth patch edits. Hold **Hold to experiment** with a pointer or Space/Enter to try changes, then release to return. The held experiment cannot overwrite the saved base setup.
- **Record take** captures stereo audio plus keys, controller moves, tuning, macros, lane mix, modulation routes, Synth patches, tempo, pattern changes and section jumps. Stop adds a new recording to **Saved performances** in local IndexedDB. Give it an optional **Next take name** before recording, or rename it with **Take name → Save name** afterward. Select any saved take to return to it; recording another never replaces it. Use **Export take WAV** and **Export gestures & parts** to keep a portable backup: JSON contains the starting project, gestures and named parts; audio is a separate WAV. Importing gestures adds a separate entry without audio; render it to make it playable. Takes stop after five minutes, 20,000 gestures or the gesture storage limit. The previous single saved take migrates into the library automatically. Deleting a take asks for confirmation and leaves other entries intact.
- **Named parts:** choose **Name or edit parts**, enter an Intro/Chorus/etc. name and start/end times in seconds, then **Save part**. You can also seek in the audio player and use **Mark start here / Mark end here**. Choose a saved part in **Playback part**, then **Play selected part** or **Loop selected part**. **New part** starts another range; **Whole take** plays the complete recording. Part edits leave the recorded audio intact. Auditioning a take pauses Listen and stops live Groove/Synth so the recording plays on its own. Parts select recorded audio; gesture replay always recreates the full take.
- **Replay gestures** temporarily loads the take and restores your previous project and controller when it stops. Move or delete events under **Gesture replay & editing**, then use **Render replay as new take** to render the result in real time. Rendering adds a new library entry with the same named parts and preserves the original recording. A canceled render creates no new entry. Keep note-on/off events paired. The original recording captures Groove, Synth and Listen together; gesture replay recreates Groove + Synth and pauses Listen. Listen transport and sequencer edits are preserved in the recorded audio, not the gesture timeline. Replay uses a short browser scheduling interval, so the original WAV is the reference for exact timing and sound. Ardour audio is outside this graph.
- **Arm rolling capture** keeps up to 60 seconds of recent audio in memory; **Save last 60 seconds** downloads it. The buffer starts when armed and clears on reload. The master meter shows sample peak and RMS in dBFS with a clip indicator; it is not a LUFS meter.
- **Connect USB MIDI**, then play Synth with velocity, sustain, ±2-semitone pitch bend, channel pressure or poly aftertouch. Right-click a Controller, Synth, macro or mixer knob to Learn its next CC. Pickup waits until the physical control crosses the software value, including after an on-screen edit. The **Generic 8 knobs** preset maps channel 1 CC 20–27 to macros. Device mappings save with the project; reconnect MIDI after restarting. Web MIDI needs Electron or a compatible browser, and the app requests access with SysEx disabled.
- Eight macros shape selected Groove lanes: **Weight, Bite, Drift, Width, Air, Tension, Space, Pulse**. Target all lanes, drums, music, or individual lanes. Eight named scenes capture controller, macro and target values. **Recall** queues scale/root/tuning for the next bar while Groove plays, then morphs continuous values over 1–8 bars. Changing transport cancels an in-progress transition.
- The lane mixer adds three-band EQ, level, pan, mute/solo, peak meters and post-fader sends to a shared dotted-eighth delay and reverb. Drum/music group faders control their buses; shared effects return through the music group. Controller target selection can process only Groove, Synth or Listen. Groove mix, song and selected-lane WAV exports include saved macros and mixer routing. Use **Groove → Export → Track WAV** for one stem at a time.
- Four modulation routes add tempo-synced sine/triangle LFOs, repeating envelopes, stepped random motion or lane amplitude to controller cutoff, motion, space, drive or fine tuning. Set depth to zero to disable a route. These overlays leave the saved base knobs unchanged. Capture a live take to preserve the resulting movement; offline Groove exports freeze the base controller and do not run the live modulation routes.

The take library is local to this browser or desktop data directory; Groove project exports do not contain its audio or recordings. Download backups before clearing app data. Recording and replay stop when the app is hidden; unfinished takes should be stopped before quitting.

## Ardour integration (experimental)

The **Ardour** workspace provides session readback, transport, saving, route gain controls and a Surge XT sound editor through Ardour's experimental MCP HTTP interface. It uses a fixed loopback destination, validates commands and checks the session name before writes. Native readback, playback/stop, gain changes and saving were verified with our Apple Silicon build and a copy of Night Session. The MCP server advertises 95 upstream tools, including MIDI, regions and plugin parameters.

Connect to Ardour to load the sound editor. It opens the **Night Bass** track when present, otherwise the first track with Surge XT; choose another Surge XT track from its menu or by clicking its channel head in the mixer. Its FM routing control and seven knobs drive that track's Surge XT Scene A directly: oscillator FM depth, filter cutoff (Brightness), resonance, feedback, filter input gain, amplitude attack and release. Choose **2→1**, **3→2→1**, or **2+3→1** to enable FM, then turn **FM depth**. **Off** bypasses oscillator FM. FM Depth displays Surge XT 1.3.4's −48 to +24 dB range; routing values use Surge's discrete parameter encoding. These mappings follow the [Surge source](https://github.com/surge-synthesizer/surge/blob/release_xt_1.3.4/src/common/Parameter.h) and [FM documentation](https://surge-synthesizer.github.io/manual-xt/index.html#oscillator-fm-routing). Drag knobs vertically (Shift for fine) or use arrow keys while Ardour plays; other knobs show normalized position, rather than Hz or seconds; feedback is neutral at the midpoint. A knob that differs from its loaded value grows a **↶ Reset** button, and Delete on a focused knob restores the loaded value. The strip count under the title shows how many controls differ; **Save session** persists your sound. Refresh controls after editing the patch in Ardour. Knob moves are coalesced into one request at a time and are not recorded as automation. The plugin description is read once when the controls load. Each write still checks the session and the plugin occupying that slot, so replacing the instrument requires a refresh. Gain faders cover −60 to +6 dB with a dB scale beside each channel; the bottom notch is −∞. A failed fader write restores the last confirmed gain without disconnecting the session. When Ardour is not connected, the workspace shows an offline card with setup steps, and a failed connect shows the error inline.

Play confirms that Ardour's transport actually moves before reporting success. The panel polls transport state while visible, so Play/Stop changes made inside Ardour also appear here. If playback stays frozen, use **Window → Audio/MIDI Setup → Stop → Start** in Ardour to restart CoreAudio without closing the session. Also check the Master and track gains if transport moves but the output is silent.

Our native Apple Silicon build is based on [Desperado/ardour](https://github.com/Desperado/ardour), forked from [Ardour/ardour](https://github.com/Ardour/ardour). It includes a loopback-only MCP HTTP server, a separate app identity and preferences, and the General MIDI Synth. See [native build instructions](scripts/ardour/README.md). The upstream demo does not have our loopback restriction; use the custom build for MCP.

Surge XT 1.3.4 and Surge XT Effects were installed from the official signed macOS package into `~/Library/Audio/Plug-Ins/VST3/`, with factory resources in `~/Library/Application Support/Surge XT/`. Ardour has scanned both VST3 plugins. On this Mac, the saved starter project is `~/Music/AFTERHOURS Night Session/AFTERHOURS Night Session.ardour`. Open it with **Session → Open**, then press Space:

- **Night Bass** — Surge XT, Rubber bass preset.
- **Shadow Pad** — Surge XT, Ghost pad preset.
- **Broken Beat** — General MIDI Synth, channel 10 drums.

The original MIDI example has eight bars at 93 BPM, with Am–F–Dm–Em harmony and a swung trip-hop rhythm. Both synths and the drums were verified producing audio in Ardour; the project was saved from the editor. Notes, synth patches, track gains and automation can be edited in Ardour during playback. The project lives outside this Git repository and is not included in a fresh checkout. Surge XT Effects is installed and available, but is not inserted as a separate effect in this starter project.

The custom source build has no demo timeout. Surge XT remains a separately installed VST3 instrument.

## API key and local files

The server reads `OPENAI_API_KEY` from the workspace `.env` file, or from its process environment. It reads only that key from `.env` as data; it does not execute the file. Keep the file private and excluded from Git. The browser receives only a configured/not-configured status, never the key.

The existing CLI can prompt for and save the key through hidden terminal input; see [the music-analysis skill](.agents/skills/music-analysis/SKILL.md). Never paste credentials into chat or frontend code.

Everything local is gitignored:

- `.context/tracks/`: recordings and the original download manifest.
- `.context/analysis/`: original and newly generated session reports.
- `.context/analysis/summaries/<track id>.json`: optional full-track measurements made outside the app.
- `.context/app/`: imported-library metadata and job status.
- `.env`: the optional local API key.

The server binds to `127.0.0.1` and checks the Host and Origin headers. It is intended for one person on this Mac. Keep it running while listening or analyzing. Restarting interrupts active work; completed whole-track excerpts remain available. A running job may finish after the browser closes.

A track with a summary file shows its full-track FFmpeg loudness (LUFS, true peak) and refined beat timing; the summary is used only when its `source` is that recording's path. Other tracks show sample RMS and sample peak instead. These are different measurements; they are labeled separately.

## Play Anything reference

Reviewed [Desperado/play-anything](https://github.com/Desperado/play-anything), including its Python preparation pipeline and Swift player. This web player follows its approach of reading playback position from the audio engine rather than estimating it from a wall clock. Speed controls and section looping fit the same practice workflow. No Swift source or heavy stem-separation dependencies were copied. Automated stem separation, chord analysis and audio-to-MIDI transcription remain possible future integrations; Groove already exports its sequenced notes as MIDI.

## Checks

Install the Python environment described above, then run the integrated suites with Playwright:

```sh
npm ci
npm run lint
npm test
```

The browser checks use installed Google Chrome. To use another Chromium build, set `AFTERHOURS_CHROMIUM` to its executable. The 9lives runner works with the same config if it is installed (`9l run tests/e2e`) and writes receipts to `.9lives/receipts/`.

`tests/e2e` runs the Python and Node suites, the offline FM and live-effects audio checks in Chrome, and browser checks for the shell, desktop groovebox, 390 px Perform view, Ardour, Listen and AI. The phone checks cover pad gestures, hit areas, patterns, pages, transport and edits surviving resize/reload. Listen/AI checks cover seeking, A–B loops, presets, request counts, explicit submission, local excerpt ranges, safe report text and saved experiment checkboxes. It starts its own app on port 8790 and mocks Ardour and analysis requests, so it never touches a live session or sends paid requests. One worker avoids two app instances competing for that port.

The Node wrapper discovers every top-level `tests/*.test.js` file, including the instrument-loader concurrency, retry and memory-budget checks.

The public suite uses synthetic fixtures for song matching and sampling. Real-library checks skip when the [instrument recordings](web/instruments/README.md#local-installation-and-native-packaging) are absent. Song-specific checks are preserved with the private content archive.

GitHub Actions runs JavaScript syntax checks, Prettier, Ruff, Rust formatting and Clippy, then all public unit, DSP, browser and offline audio tests. The macOS job tests the development app, builds the public Apple Silicon app and DMG, then tests the packaged app. Successful runs provide an `AFTERHOURS-public-macos-arm64` artifact containing the app ZIP, DMG, source ZIP, WebAssembly files and SHA-256 checksums, retained for 14 days. These macOS builds are ad-hoc signed and are not notarized. CI checks out only this public repository and explicitly selects `desktop:dist:public`.

The individual commands below still work on their own:

```sh
.context/music-analysis-venv/bin/python -m unittest discover -s tests -v
.context/music-analysis-venv/bin/python -m unittest discover -s .agents/skills/music-analysis/tests -v
node --check web/app.js
node --check web/effects.js
node --check web/daw.js
node --check web/groove-core.js
node --check web/groove-audio.js
node --check web/groove.js
node --test tests/*.test.js
```

Format JavaScript and CSS with Prettier and Python with Ruff (`pip install -r requirements-dev.txt` in the same environment):

```sh
npm run format
npm run format:check
```

Tests cover local access rules, byte-range playback, bounded imports, key redaction, explicit analysis submission, job concurrency, local report persistence and partial whole-track recovery. Audio API requests are mocked in tests.


The live-effects checks render the production audio graph with the browser's native `OfflineAudioContext`. They verify sample-exact bypass, filter attenuation, distortion, decaying echo, pause/reset behavior, removal of old delay memory, and parameter bounds. They do not make API calls or play sound. Run them in Chrome:

```sh
mkdir -p .context/effects-qa
cp tests/effects.html .context/effects-qa/index.html
cp tests/effects-browser.js web/effects.js web/controller-audio.js .context/effects-qa/
python3 -m http.server 8766 --bind 127.0.0.1 --directory .context/effects-qa
```

Open `http://127.0.0.1:8766` and check for **7 checks passed**.

The FM sequencer's Node tests cover locks, lane timing, retrigs, chance, conditions, project validation and MIDI note ordering. Its browser checks render the production FM graph offline and verify the six FM voices, macro response, modulation, bass pitch, stop behavior, stereo pan and PCM WAV encoding. The additional browser tests render the Analog and wavetable machines, check wave motion, filter and macro response, release cleanup and the Synth patches. They do not play sound or use an API:

```sh
mkdir -p .context/groove-qa/tests .context/groove-qa/web
cp tests/groove.html tests/groove-browser.js .context/groove-qa/tests/
cp web/groove-core.js web/groove-audio.js web/instrument-catalog.js web/timbres.js web/controller-audio.js web/performance-core.js web/performance-mixer.js web/ladder*.js web/voice*.js web/dsp-worklet.js .context/groove-qa/web/
cp web/ladder-wasm.js web/ladder-worklet.js web/voice-worklet.js web/dsp-worklet.js web/wavetable-worker.js .context/groove-qa/
python3 -m http.server 8766 --bind 127.0.0.1 --directory .context/groove-qa
```

Open `http://127.0.0.1:8766/tests/groove.html`, click **Run audio checks**, and check for **7 checks passed**.

## License

Original AFTERHOURS software and documentation are licensed under [Apache-2.0](LICENSE).
See [NOTICE](NOTICE), [third-party licenses and media exclusions](THIRD_PARTY.md),
and [contributing](CONTRIBUTING.md). Fonts, instrument recordings and the Ardour
patch retain their own terms. Reference songs, reconstructions and uncleared
artwork are outside the Apache grant.

The public repository excludes private reference content. Configured local builds
can include a separately installed private pack; see [content packs](docs/content-packs.md)
and [release readiness](docs/open-source-readiness.md).
