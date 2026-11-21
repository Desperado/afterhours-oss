# Akai MPK mini Plus II

Afterhours has a ready-to-use profile for the MPK's **DAW** mode, plus guided learning for a custom **User Preset**. This page covers setup, the display and pads, track selection, the knob banks, buttons, pad modes, MIDI clock output and limits. Generic USB MIDI, MIDI Learn and pickup are described in [Performance studio](perform.md#usb-midi).

## Quick start: the ready DAW profile

1. Connect the MPK over USB.
2. Select **DAW** on the MPK.
3. Open **Perform → MPK mini** and click **Enable ready DAW profile**.

The native profile verifies the MPK identity and DAW port before sending display or RGB feedback. Display ownership and native pad notes are restored when the profile is disabled or the app is hidden.

Device settings and learned mappings are saved on this Mac across song changes and restarts. Custom User Preset learning remains available; see [Guided learning for a custom User Preset](#guided-learning-for-a-custom-user-preset).

## Display and pads

Three large 24-point rows show:

1. the song
2. the live instrument or selected track
3. transport/tempo/knob bank

The bottom row always includes the selected track number. The row format follows [Bitwig's MPK driver](https://github.com/bitwig/bitwig-extensions/blob/main/src/main/java/com/bitwig/extensions/controllers/akai/mpkmk4/display/MpkDisplayFont.java).

- The selected pad is steady yellow.
- While the encoder is held, the display prompts `Pad = select track`; striking a pad shows that track's number and name.
- A song chosen with `SHIFT` + BANK appears as `> Song name` with `Play = load song` until Play/Stop loads it.
- Changing the knob bank shows the bank name on the display; turning a knob shows its parameter and value.

## Selecting tracks

Hold the **central encoder** and strike a pad to select its Groove track.

| Pads | Groove tracks |
| --- | --- |
| A1–A8 | 1–8 |
| B1–B8 | 9–16 |

Use **PAD BANK A/B** to change the physical bank.

- Selection works in every pad mode without auditioning, muting or recalling a scene.
- `SHIFT` + pad stays with the MPK firmware's pad modes, Prog and Chord menus.
- Enable **Synth → Follow selected part** to make your live instrument follow track selection. See [Synth and control](synth-and-control.md).

## Knob banks

**BANK −/+** on the MPK cycles the eight-knob pages below. Hold `SHIFT` for quarter-speed continuous adjustments. Perform also shows all eight assignments and values, and **Selected track sound** jumps straight to that track's sound controls.

| Page | Knobs 1–8 |
| --- | --- |
| Live Synth | Filter, resonance, wave blend, motion, attack, release, delay, reverb |
| Macros | Performance macros 1–8 |
| Levels 1–8 / 9–16 | Eight track levels |
| Track sound | Filter, shape, color, sweep, contour, decay, volume, pan |
| Track mixer | Level, pan, low/mid/high EQ, drive, delay, reverb |
| Track motion | Pitch, algorithm/chord/filter model, LFO depth/target/period/shape, decay or chord, filter |
| Track rhythm | Loop steps, speed, mute, solo, pitch, decay/release, volume, pan |
| Synth extra | Drive, chorus, pulse width, glide, filter envelope, volume, delay, reverb |

Good to know:

- Track pages follow **held encoder + pad** selection.
- Sound and motion controls adapt to the selected machine: sampled instruments expose filter/release and mixer effects; audio tracks expose level, pan, EQ and effects. Unavailable controls are marked explicitly.
- With **Follow selected part**, Live Synth uses the matched track's sound page.
- Tone edits affect upcoming notes without releasing held keys; mixer effects update live.
- Track settings save with the song, and encoder movements are included in recorded take gestures.

## Transport and buttons

The native DAW profile handles `SHIFT` directly.

| Control | Action |
| --- | --- |
| **Play/Stop** | Toggles Groove playback. Play starts from the beginning and first loads a song chosen with `SHIFT` + BANK. Stop also ends a recording take. |
| `SHIFT` + Play/Stop (Continue) | Resumes the audible position after Stop in the same Groove session |
| **Record** | Starts or finishes a live take |
| `SHIFT` + Record | Records keys into the selected track |
| Central encoder (turn) | Changes your live Synth instrument |
| `SHIFT` + encoder | Changes patterns (previous / next) |
| Held central encoder + pad | Selects a Groove track |
| Encoder push (released without a pad) | Starts or confirms an experimental jam |
| `SHIFT` + encoder push | Cancels the jam phrase |
| **BANK −/+** | Changes the software knob bank |
| `SHIFT` + BANK −/+ | Chooses a song; Play loads and starts it |
| `SHIFT` + knob | Quarter-speed (fine) adjustment |
| Undo / `SHIFT` + Undo | Undo / Redo |
| Loop | Repeats the song |
| `SHIFT` + Loop (Stop All) | Stops all sound |
| Tap Tempo | Taps the tempo |
| `SHIFT` + Tap Tempo | Metronome |
| + (Quantize) | Quantizes the selected Groove lane |
| **PAD BANK A/B** | Switches the physical pad bank; it is not a pad |
| `SHIFT` + PAD BANK | Changes the pad mode |
| `SHIFT` + pad | Belongs to the MPK itself (pad modes, Prog, Chord Type) |

Details:

- Quantize removes microtiming from the selected Groove lane; immediate Undo/Redo restores/reapplies it.
- Metronome clicks during phrase capture or Groove playback and is excluded from offline exports.
- The jam started by the encoder push is described in [Performance studio → Jam](perform.md#jam-experimental-phrase-accompaniment).
- OCT, ARP, LATCH, CHORDS, SCALES, NOTE REPEAT and hardware configuration remain local controller functions.

If something unexpected opens on the MPK:

- If `SHIFT` + pad opens a firmware menu, press `SHIFT` + the same pad again.
- If the MPK switched to Plugin or User Presets, press PLUGIN/DAW without `SHIFT`.

## Guided learning for a custom User Preset

Use this when you play from a **User Preset** on the hardware instead of DAW mode. Select a User Preset with keys and pads on separate MIDI channels.

### Learn my own User Preset

1. Open **Perform** and click **Learn my own User Preset**. It connects MIDI and selects the profile automatically.
2. Turn knobs 1–8 as prompted.
3. When learning pauses before pad bank A, select A using the hardware **PAD BANK A/B** button, then click **I’m in bank A** in Afterhours. Press pads A1–8.
4. When learning pauses before pad bank B, select B the same way, click **I’m in bank B**, then press pads B1–8.
5. Turn the central encoder clockwise.
6. Press Play/Stop, then Record.

How the prompts behave:

- Each incoming control advances the prompt; repeated messages from an already learned control do not advance it again.
- MIDI received during a bank pause is consumed without assigning controls, so the bank switch cannot become pad B1.
- **Skip this bank** skips eight pads.
- Skip unavailable controls or finish early; learned mappings stay saved in this project.
- Re-run guided setup to replace an earlier incorrect B1 assignment.

After learning:

- The central encoder steps through Synth instruments in both directions, using the same selection behavior as the Synth preset buttons. Its click is separate.
- MIDI clock output remains off until explicitly selected.

Encoder formats: relative central-encoder learning recognizes clockwise 1 or 65 messages; other absolute CC values use direction changes. Custom formats can be selected in the advanced MIDI controls before learning.

### Learn the remaining buttons

Click **Learn the remaining buttons** for the encoder push, BANK −/+, Undo/Redo, Loop/Stop All, Continue, Tap Tempo, Metronome and Quantize.

- In custom User Preset learning, `SHIFT` combinations must send distinct MIDI messages.
- The guide protects existing assignments when a combination repeats an ordinary button's message.
- Skip controls that do not transmit.

### Manual learning in USB MIDI

1. Open **Perform → USB MIDI + MIDI Learn** and connect MIDI.
2. Choose **Akai MPK mini Plus II** as the profile.
3. Leave **All MIDI inputs** selected.

This profile listens to the controller's MIDI and DAW ports together and ignores Plugin/DIN ports. Akai describes these separate ports in its [official FAQ](https://support.akaipro.com/en/support/solutions/articles/69000884506-mpk-mini-plus-ii-frequently-asked-questions).

Then learn each group of controls:

- **Knobs:** choose the hardware's **Knob format**, then **Learn 8 knobs in order**. Turn each knob once in sequence. The same eight controls use all the knob pages above. Absolute pickup prevents jumps; relative formats respond to each turn.
- **Pads:** **Learn pads A1–8 then B1–8** captures both pad banks.
- **Transport buttons and the push encoder:** choose **Play**, **Stop**, **Record / Finish take**, **Rewind**, **Tap tempo**, pattern changes, bank changes, Undo/Redo or Panic under **Learn target**, click **Learn**, then press the hardware control. This learns the actual User Preset instead of assuming factory note/CC numbers.

**Cancel Learn** retains controls already learned. Individual mappings can be removed.

### Keys, wheels and hardware performance features

- Keys, pitch wheel, sustain, modulation wheel and MIDI pressure feed Synth.
- Selecting this profile adds channel 1 CC 1 → Synth Motion for the modulation wheel; learn it again if the hardware uses a different channel.
- Hardware scales, chords and arpeggios work as incoming notes; disable Synth key snapping/octave shifting when you want their original pitches.

## Pad modes

Choose the mode in the **Pads** list under **Perform → USB MIDI + MIDI Learn**, or with `SHIFT` + PAD BANK on the ready DAW profile.

| **Pads** option | What the pads do |
| --- | --- |
| **Play assigned tracks with velocity** | Play Groove lanes with velocity |
| **Beat · play and record tracks into steps** | A pad plays its assigned track. During playback each hit is written to the nearest 1/16 step of the pattern you hear. UNDO on the MPK removes the last pass. |
| **Bank A · scenes / Bank B · mute lanes 1–8** | Recall eight scenes plus eight mutes |
| **Mute lanes 1–16** | Mute all sixteen lanes |
| **Play Synth notes / chord progressions** | Play Synth notes/chords |

Pad strikes are included in take gestures and replay. Program Change and CC pads can trigger actions too; Program Change has no velocity.

Track selection with the held encoder works in every pad mode; see [Selecting tracks](#selecting-tracks).

## MIDI clock out

To sync hardware Arp/Note Repeat:

1. Explicitly select the controller's output in **Send Groove MIDI clock to**.
2. Set the MPK clock to **External**.
3. Play Groove.

Afterhours sends 24 pulses per quarter note and Start/Stop/Continue with song position.

Limits:

- Output starts **Off** each session and stops when the app is hidden.
- This is outgoing Groove clock, not incoming clock sync.

## Limits

- CV/gate and DIN routing remain hardware settings.
- OCT, ARP, LATCH, CHORDS, SCALES, NOTE REPEAT and hardware configuration remain local controller functions.
- Plugin/DIN ports are ignored by the profile.

### What the automated tests cover

Automated tests simulate MIDI messages and verify audio, transport, track selection, display packets and saved mappings.

They do not certify the physical controller's current preset or visible display layout.
