# macOS desktop app

AFTERHOURS also runs as a standalone Electron app. This page is for people using that app: where to get it, where it keeps your data, how the API key and projects are handled, and what its menus add. Building and packaging the app is covered in [Development](development.md#desktop-app).

## What is included

The Apple Silicon build includes the Python runtime and audio libraries: launching the `.app` does not need a terminal, Python, Node or the development checkout.

- Groove, live effects and beat sync run locally.
- Ardour remains a separately installed application; see [Ardour integration](guide/ardour.md).

## Download and first launch

Download the DMG or app ZIP from [GitHub Releases](https://github.com/Desperado/afterhours-oss/releases/latest). The release includes checksums and corresponding third-party sources.

Good to know:

- The current binaries support Apple Silicon Macs.
- They are ad-hoc signed, without Apple Developer ID notarization; macOS may block the first launch.

## Where your data lives

Desktop recordings, reports, caches and browser projects are kept in `~/Library/Application Support/AFTERHOURS/`, independently of the browser version and app bundle.

- **File → Open Data Folder** opens it.
- Import recordings through [Listen](guide/listen-and-ai.md#import-a-recording); the build does not embed imported user-data recordings, reports or credentials.
- To use a separate profile, launch the executable with `--data-dir=/absolute/path`.

## API key

Paid listening is optional and still requires an OpenAI API key. Local features work without a key.

- The desktop backend reads only `OPENAI_API_KEY` from a `.env` file in the data folder, or from the launching process.
- It does not copy the development checkout's `.env`.

See [Listen and AI](guide/listen-and-ai.md#cost-and-consent) for what paid listening sends and when.

## Moving a project between browser and desktop

1. Export a Groove project in the browser.
2. Open that JSON in the desktop app.

## View menu

The **View** menu lists the same entries as the rail, plus the theme and language pickers. See [Interface](guide/interface.md) for what each one is.

| Menu item | Shortcut |
| --- | --- |
| **Groove** | `⌘1` |
| **Synth** | `⌘2` |
| **Perform** | `⌘3` |
| **Control** | `⌘4` |
| **Listen** | `⌘5` |
| **AI** | `⌘6` |
| **Ardour** | `⌘7` |

- **View → Theme** lists the eight themes: Night, Sampler 60, Red Keys, Red Edition, Clip Launch, Black Box, Pad Grid and Deep Blue. See [Themes](guide/interface.md#themes).
- **View → Language** switches between English and Українська. See [Language](guide/interface.md#language).

## Security model

- The desktop shell uses a stable `afterhours://app` origin so autosaved projects survive changes to the private server port.
- The renderer is sandboxed, has no Node access, and can reach only the app.
- A private capability protects the loopback server.
- Closing the app also closes that server.
