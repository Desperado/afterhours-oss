# Ardour integration (experimental)

The **Ardour** workspace connects AFTERHOURS to a running Ardour session: it reads the session back, drives the transport, saves, sets route gains and edits a Surge XT sound. This page covers what you need, how to connect, each part of the workspace and what to check when something does not work.

## What it does

The workspace provides session readback, transport, saving, route gain controls and a Surge XT sound editor through Ardour's experimental MCP HTTP interface.

- It uses a fixed loopback destination, validates commands and checks the session name before writes.
- The MCP server advertises 95 upstream tools, including MIDI, regions and plugin parameters.
- Native readback, playback/stop, gain changes and saving were verified with our Apple Silicon build and a copy of Night Session.

Ardour is one of the three engines in the strip and always keeps its own clock; see [Interface](interface.md#the-strip-and-its-engines).

## Requirements

| You need | Details |
| --- | --- |
| The custom Ardour build | A native Apple Silicon build based on [Desperado/ardour](https://github.com/Desperado/ardour), forked from [Ardour/ardour](https://github.com/Ardour/ardour). It includes a loopback-only MCP HTTP server, a separate app identity and preferences, and the General MIDI Synth. See [native build instructions](../../scripts/ardour/README.md). |
| MCP HTTP enabled | In Ardour, **Preferences → Control Surfaces**, enable **MCP HTTP Server (Experimental)** on port 4820. It only listens on `127.0.0.1`. |
| Surge XT | A separately installed VST3 instrument, needed for the sound editor. |

Good to know:

- The upstream demo does not have our loopback restriction; use the custom build for MCP.
- The custom source build has no demo timeout.
- The starter project lives outside this Git repository and is not included in a fresh checkout.
- In the desktop app, Ardour remains a separately installed application; see [the desktop app](../desktop.md).

## Connecting

1. Open the AFTERHOURS Ardour build.
2. Enable MCP in Preferences.
3. Open a session, then press **Connect** in the **Ardour** workspace.

When Ardour is not connected, the workspace shows an offline card with these setup steps, and a failed connect shows the error inline.

Connecting loads the mixer and the sound editor.

## Mixer

Each route has a gain fader with a dB scale beside the channel.

| Property | Value |
| --- | --- |
| Fader range | −60 to +6 dB |
| Bottom notch | −∞ |

A failed fader write restores the last confirmed gain without disconnecting the session.

## Surge XT sound editor

Connect to Ardour to load the sound editor. It opens the **Night Bass** track when present, otherwise the first track with Surge XT. To edit another Surge XT track, choose it from the editor's menu or click its channel head in the mixer.

The FM routing control and seven knobs drive that track's Surge XT Scene A directly.

| Control | Surge XT Scene A parameter | Notes |
| --- | --- | --- |
| FM routing | Oscillator FM routing | **Off** bypasses oscillator FM. **2→1**, **3→2→1** and **2+3→1** enable it. Values use Surge's discrete parameter encoding. |
| **FM depth** | Oscillator FM depth | Displays Surge XT 1.3.4's −48 to +24 dB range. |
| **Brightness** | Filter cutoff | Shows normalized position. |
| **Resonance** | Resonance | Shows normalized position. |
| **Feedback** | Feedback | Neutral at the midpoint. |
| **Drive** | Filter input gain | Shows normalized position. |
| **Attack** | Amplitude attack | Shows normalized position. |
| **Release** | Amplitude release | Shows normalized position. |

Apart from **FM depth**, the knobs show normalized position, rather than Hz or seconds. The mappings follow the [Surge source](https://github.com/surge-synthesizer/surge/blob/release_xt_1.3.4/src/common/Parameter.h) and [FM documentation](https://surge-synthesizer.github.io/manual-xt/index.html#oscillator-fm-routing).

### Using FM

1. Choose **2→1**, **3→2→1**, or **2+3→1** to enable FM.
2. Turn **FM depth**.

### Turning knobs

- Drag knobs vertically (`Shift` for fine) or use arrow keys while Ardour plays.
- A knob that differs from its loaded value grows a **↶ Reset** button.
- `Delete` on a focused knob restores the loaded value.
- The strip count under the title shows how many controls differ.
- **Save session** persists your sound.

### Good to know

- Knob moves are coalesced into one request at a time and are not recorded as automation.
- Refresh controls after editing the patch in Ardour.
- The plugin description is read once when the controls load. Each write still checks the session and the plugin occupying that slot, so replacing the instrument requires a refresh.

## Transport

- Play confirms that Ardour's transport actually moves before reporting success.
- The panel polls transport state while visible, so Play/Stop changes made inside Ardour also appear here.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Playback stays frozen | In Ardour, use **Window → Audio/MIDI Setup → Stop → Start** to restart CoreAudio without closing the session. |
| Transport moves but the output is silent | Check the Master and track gains. |
| The workspace shows the offline card | Follow the setup steps on the card; see [Connecting](#connecting). A failed connect shows the error inline. |
| Knobs no longer match the instrument | Refresh the controls after editing the patch in Ardour or replacing the instrument. |
