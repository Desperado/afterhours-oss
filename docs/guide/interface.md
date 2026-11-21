# Interface

This page explains how the AFTERHOURS window is laid out: the strip with its three engines and transport, the rail with its workspaces and live layers, the status line, what the colours mean, and how to change the theme and the language.

## The strip and its engines

The top strip always shows the three engines, each with its current state:

| Engine | What it is |
| --- | --- |
| **Groove** | The sequencer and its synthesized or sampled instruments. |
| **Recording** | The listening-room player. |
| **Ardour** | The connected Ardour session. |

Click an engine to make it active. The strip's Start, Play and Stop buttons, position and tempo then belong to that engine. Pressing Play inside a workspace also makes that workspace's engine active.

### Keys

| Key | Action |
| --- | --- |
| `Space` | Plays or stops the active engine. |
| `?` | Opens the help sheet. |

### Separate clock

Engines run independently unless Groove is linked to the recording with **Auto sync track** (see [Groove](groove.md)). A **Separate clock** chip appears in the strip when independent engines play together. Ardour always keeps its own clock.

## The rail

The rail groups the app by job:

| Group | Entries | Kind |
| --- | --- | --- |
| **Create** | **Groove**, **Synth** | Workspaces |
| **Live layers** | **Perform**, **Control** | Panels that open alongside the current workspace |
| **Study** | **Listen**, **AI** | Workspaces |
| **External** | **Ardour** | Workspace |

The rail switches between the **Groove**, **Synth**, **Ardour**, **Listen** and **AI** workspaces. Each has its own page: [Groove](groove.md), [Synth and Control](synth-and-control.md), [Listen and AI](listen-and-ai.md) and [Ardour](ardour.md).

Good to know:

- Switching workspace never changes the active engine.
- The last workspace and engine are remembered in this browser.
- In the desktop app, **View** lists the same seven entries with `⌘1`–`⌘7`; see [the desktop app](../desktop.md#view-menu).

### Live layers

**Perform** and **Control** are live layers. A live layer is not a place: it docks above whichever workspace is open, and its rail entry shows a dot while it is open.

[Perform](perform.md) is one long panel. The links under its title jump to Session, Takes, Macros, Scenes, MPK mini, Jam, USB MIDI, Mixer and Modulation. Control is described in [Synth and Control](synth-and-control.md).

## Status line

One status line at the bottom reports what just happened.

## Colours

Colours have one job each, and each is paired with a symbol. In the default Night theme:

| Colour | Symbol | Meaning |
| --- | --- | --- |
| Magenta | | Sound is playing. |
| Amber | ◆ | A locked or overridden value. |
| Cyan | | Connected or safe. |
| Lime | $ | Appears only where money is spent. |
| Violet | | The live layers. |

Other themes keep one colour per job but use different colours; see [Themes](#themes).

## Fonts

The fonts are Chakra Petch, IBM Plex Sans Condensed and JetBrains Mono, all under the SIL OFL. They are served from `web/fonts`, so the app makes no external font requests.

Cyrillic uses IBM Plex Sans Condensed and JetBrains Mono subsets. Chakra Petch has no Cyrillic, so Ukrainian headings use Plex.

## Themes

The palette menu in the strip changes the colours. In the desktop app, **View → Theme** does the same. The choice is remembered on this device.

**Night** is the default. The others are looks inspired by hardware, with generic names. No vendor artwork, logos or fonts are used.

| Theme | Look | Colour of "playing" |
| --- | --- | --- |
| **Night** | The default. | Magenta |
| **Sampler 60** | Warm grey case, dark rubber pads, green LCD. The only light theme. | Red |
| **Red Keys** | Black with red actions and white pads. | Orange |
| **Red Edition** | Red case, black panels. | Yellow |
| **Clip Launch** | Graphite, one clip colour per track. | Green |
| **Black Box** | Matte black, sharp corners, yellow display digits. | Red |
| **Pad Grid** | Glowing RGB pads per track. | White |
| **Deep Blue** | Navy with sky-blue actions. | Orange |

Good to know:

- Each theme keeps one colour per job, but the colours differ between themes, as the last column shows for "playing".
- The stereo meter is drawn on a canvas with fixed colours and stays dark in every theme.

How themes are built, and how to add one, is in [Development](../development.md#adding-a-theme).

## Language

The globe menu in the strip switches the interface between **English** and **Українська** without reloading. In the desktop app, **View → Language** does the same.

- A first visit follows the browser language.
- The choice is remembered on this device.
- A string that is missing from the dictionary simply stays English.
- Dates in the saved-session list follow the picked language.

### What is not translated

Names are content, not interface, so they keep their wording:

- project, track, section, machine, recording and take names;
- song titles and patch names;
- canvas meter legends;
- text sent to the MPK display;
- AI report text.

How translation works, and how to add or change strings, is in [Development](../development.md#adding-or-changing-translations).
