# Synth and Control

**Synth** is a separate polyphonic instrument that can play alongside [Groove](groove.md). **Control** is a live sound layer above Groove, Synth and recording playback. This page covers the Synth patches and controls, matching a Groove part, playing from the keyboard, and what the Control layer changes and saves.

## Synth workspace

Open **Synth** in the rail. Sixteen patches cover chorus-heavy post-punk, disco strings and clav, a house organ, 90s rave, an atmospheric pad, six hardware-inspired sounds and four patches that use the complete Rust voice.

### Controls

Filter, resonance, attack, release, drive, chorus, delay, reverb and level can be changed live.

| Control | Available on | When it takes effect |
| --- | --- | --- |
| **Wave blend** | The six hardware-inspired patches | Updates held voices |
| **Motion** | The wavetable patches | Updates held voices |
| **Filter env** | The six hardware-inspired patches | On the next note |

- Delay follows the Groove tempo when playing a note.
- Patch and control settings are remembered locally.

### Hardware-inspired patches

- **Grand dusk bass** / **Grand dusk lead**
- **1002 wire pluck** / **1002 twin current**
- **Third horizon** / **Third prism**

This palette draws on the [Moog Grandmother](https://api.moogmusic.com/sites/default/files/2022-01/Grandmother_Manual_Version_2.pdf), the analog [PPG 1002 Mk2](https://www.ppgsynth.com/1002/specs), and [Groove Synthesis 3rd Wave](https://groovesynthesis.com/products/3rd-wave/24k-keyboard/). It uses original oscillator shapes and digital filter/effect approximations; it does not reproduce their circuits, spring tank, factory patches or wavetable library.

### The four Rust-voice patches

**Circuit bass**, **Neon pluck**, **Signal lead** and **Clockwork pulse** use the complete Rust voice. Their saw/pulse oscillators, sub/noise mixer, drift, PWM, independent filter/amplitude envelopes and nonlinear filter run together at 2× sample rate.

| Control | When it takes effect |
| --- | --- |
| **Pulse width**, **Motion** | Change held notes |
| **Glide**, attack, release | Configure new notes |
| Filter-envelope amount | Updates live on these four patches |

Glide starts from the previous played pitch, while the keyboard remains polyphonic.

These are original early-80s-inspired sounds, not sampled recordings or an exact Sequential Pro-One emulation.

Groove's Analog machine uses the same Rust voice; see [Groove machines](groove.md#machines).

## Playing along with a Groove part

The **Play along** panel in Synth can take its sound and key from Groove.

1. In Groove, select a melodic lane.
2. In Synth, press **Match Groove part**. It copies the selected lane's instrument, sound settings, mixer effects, song key and playing range.
3. Optionally tick **Follow selected part** to keep that match when you load a song or select a different lane.

The matched sound uses the same audio renderer as Groove; the selected active step's sound locks are included. Groove keeps playing, and recorded performances retain the matched sound and actual notes you played.

### Key, scale and octave

- **Stay in key** snaps live notes to the chosen scale.
- **Shift MIDI to this octave** moves USB MIDI relative to C4; the status line shows the resulting C.
- G-minor songs that use F♯ can use **Minor + leading tone**.
- Turn off snapping and MIDI shifting for an ordinary chromatic keyboard.

### Good to know

- Drum selections fall back to a melodic lane.
- Songs without stored key information use an editable estimate.
- Manual key/scale/octave changes stop following.
- Selecting a keyboard preset stops following while retaining the key and octave.
- To change a matched instrument, edit it in Groove and match again.

## Playing the keyboard

| Input | Effect |
| --- | --- |
| Mouse or touch on the on-screen keys | Play notes |
| `A` `W` `S` `E` `D` `F` `T` `G` `Y` `H` `U` `J` `K` `O` `L` `P` | Play notes from the computer keyboard |
| `Z` / `X` | Shift the octave |
| **Panic · silence synth** | Releases voices and clears effect tails |

USB MIDI plays this instrument through the [Performance studio](perform.md); with an Akai controller see [MPK mini Plus II](mpk-mini-plus-ii.md). Groove's MIDI file export is a separate feature, described in [Groove exports](groove.md#saving-and-exports).

### Limits

- The instrument supports eight held notes.
- Leaving Synth or switching away from the app also releases held notes.

## Control layer

Open **Control** in the rail for a live sound layer above Groove, Synth and recording playback. The panel is titled **Sound controller**.

### Shaping the sound

Shape tone, resonance, heat, stereo movement and space with knobs or the XY pad.

| Control | Use |
| --- | --- |
| **Starting point** | Six starting points to begin from |
| **Explore a variation** | Try a change while playing |
| **Capture A** / **Capture B**, **Recall A** / **Recall B** | Store and compare two snapshots while playing |
| **Bypass** | Compare with the original |
| **Reset controller** | Restore neutral settings |

### Root, scale and tuning

Melodic Groove voices and held Synth notes also follow the controller's root, scale, transpose, fine tuning and momentary bend.

- Scales: natural minor, Dorian, whole tone or Hirajoshi.
- Tunings: equal, 5-limit just, Pythagorean or notes mapped onto 19-tone equal tuning.

### What it affects

| Source | Effect of the controller |
| --- | --- |
| Melodic Groove voices | Effects, plus root, scale, transpose, fine tuning and momentary bend |
| Held Synth notes | Effects, plus root, scale, transpose, fine tuning and momentary bend |
| Groove drums | Keep their pitch |
| Recording playback | Effects only |
| External Ardour audio | Separate; not affected |

### Saving and export

- Controller settings, named setups and A/B snapshots save inside Groove projects and restore on reload.
- Groove WAV exports freeze the current settings, rather than record live knob movements; full-song renders process chunks separately.
- Saved instruments, patterns and MIDI remain unchanged.

Named setups, scenes and modulation above the controller values are managed in the [Performance studio](perform.md).
