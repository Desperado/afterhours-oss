# Playable sampled instruments

Choose **Instrument** as a Groove lane's machine, then choose the recorded instrument.
Notes, velocity, gate, pitch, filter, level and pan work in the sequencer. **Synth → Match
Groove** plays that lane's sound from the keyboard or MIDI input, including pitch bend
and pressure. Drums use chromatic MIDI keys: kick 36, snare 38, low tom 41, closed hat
42, open hat 46, high tom 48, crash 49. A closed hat chokes the open hat.

Pattern, stem and full-song WAV exports use the same instrument recordings.
Private content packs can also supply complete sampled arrangements.

This is a curated Web Audio multisampler, not an embedded sfizz engine or a general
SFZ/SF2 importer. SFZ mappings are compiled during installation. Key zones, velocity
zones and amplitude curves, available alternate takes, gain and attack/release are
preserved. Random alternatives cycle in order for reproducible exports. The drum kit
uses the stereo overhead perspective and seven articulations; close microphones,
bleed, pedal controllers and the full sfizz kit are not implemented. Snare and toms
use the source's densely recorded dynamic layers; only articulations with recorded
alternates cycle takes. No invented loops: held notes end when their recording ends.

Recordings are lossless FLAC at the source rate. Playback decodes at 32 kHz with
stereo retained, and transposes from the original root pitch. Preparation requests
are queued; each request loads missing banks through a shared pool of up to 16
recording jobs. Successfully decoded banks are published together and cached within
a 1536 MiB decoded-audio budget. All selected banks together use
about 1104 MiB. First play loads the necessary banks;
subsequent notes reuse them. Reload clears the cache. Export sample rate is 48 kHz.

## Local installation and native packaging

Recordings are not checked into the app repository. The tracked manifests alone
cannot make sound. A configured [private content pack](../../docs/content-packs.md)
supplies all required recordings automatically for development and private builds;
no manual extraction is needed.

To prepare recordings independently, extract these source distributions under
`.context/sampled-instruments/`:

| Folder | Source / license |
| --- | --- |
| `karoryfer.growlybass-master/` | [Karoryfer Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass), CC0; clean bass patch |
| `guitar/EGuitarFSBS-direct SFZ+FLAC-20220911/` | [FreePats direct electric guitar](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html), CC0; bridge patch, 2022-09-11 |
| `virtuosity_drums-master/` | [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums), CC0 |
| `vsco/` | [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), CC0; selected sustain ensemble, brass, flute and harp SFZs plus their relative sample folders |

Growlybass and Virtuosity source snapshots are pinned by the mapping hashes in the
generated manifests. VSCO was recorded by Sam Gossner and Simon Dalzell, with sample
cutting by Elan Hickler / Soundemote. FreePats guitar is by FlameStudios (Ben Saylor).
Original license notices are in `licenses/`; VSCO's CC0 dedication is described on
its [official distribution page](https://versilian-studios.com/vsco-community/).

With Python `soundfile` installed:

```sh
.context/music-analysis-venv/bin/python scripts/prepare-instruments.py
```

The compiler rejects unknown region opcodes and samples outside the source tree.
It does not execute source files or use sfizz. Private desktop builds explicitly
include the recordings named by the curated manifests. Public desktop builds include manifests and notices only; see
[content packs](../../docs/content-packs.md). Keep source libraries available for
rebuilding these local assets. CI can run fixture-based playback tests without the
large banks; real-library tests run when the recordings are installed.
