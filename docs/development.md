# Development

This page is for contributors: setting up a checkout, running the browser and desktop apps, building the desktop app, running the checks, and adding a theme or a translation. For using the app, start with [Interface](guide/interface.md).

## Prerequisites and setup

For a fresh checkout, install Python 3.11 and Node.js, then run the automated setup and start the browser app:

```sh
npm run setup
bash start.sh
```

Open **http://127.0.0.1:8765**.

Setup installs the Python and Node dependencies and validates any configured private content. Conductor runs the same setup for new workspaces.

### Start options

| Command | Effect |
| --- | --- |
| `bash start.sh` | Starts the browser app on port 8765. Needs the Python environment installed. |
| `bash start.sh --port 8766` | Uses another port. |
| `bash start.sh --public` | Runs the public app, ignoring configured private content. |
| `npm run desktop` | Runs the desktop app for development. |
| `npm run desktop:public` | Runs the public desktop app. |

### Private content

Private content is an explicit, one-time opt-in; see [private setup](content-packs.md). Once configured, browser and desktop development and ordinary local builds include it automatically across this repository's workspaces. `bash start.sh --public` and `npm run desktop:public` run the public app.

## Project layout

| Path | What it holds |
| --- | --- |
| `app.py` and the other top-level `*.py` files | The Python backend: the local server, analysis jobs, the Ardour bridge and content packs. |
| `web/` | The interface in plain HTML, CSS and JavaScript. |
| `dsp/` | Rust DSP, built to WebAssembly with `npm run dsp`. The result is embedded in `web/ladder-wasm.js`, which is committed, so running the app never needs a Rust toolchain. |
| `desktop/` | The Electron shell and the packaging scripts. |
| `scripts/` | Setup, lint, DSP build, instrument preparation and the [Ardour build](../scripts/ardour/README.md). |
| `tests/` | Python and Node unit tests, browser audio checks and the Playwright suites in `tests/e2e`. |

## Desktop app

What the app is for users, where it keeps data and how its menus work is in [the desktop app](desktop.md). This section covers running, building and testing it.

### Run and build

After `npm run setup`, run `npm run desktop` for development. Build the standalone app and a drag-to-Applications disk image with:

```sh
npm run desktop:dist
```

| Command | Result |
| --- | --- |
| `npm run desktop:dist` | Builds the standalone app and the DMG. |
| `npm run desktop:pack` | Builds only the app. |
| `npm run desktop:dist:public` | Always builds public content, even when private content is configured. |

### Packaging

- Packaging installs the declared Python runtime and build dependencies in a fresh temporary environment.
- Pip reuses cached downloads, but builds need access to the package index.
- Extra packages installed for research or transcription are excluded.

### Output folders

| Checkout | Output folder |
| --- | --- |
| Private content configured | `.context/desktop-dist/private/` |
| Unconfigured (public content) | `.context/desktop-dist/public/` |

The app is under `mac-arm64/AFTERHOURS.app` and the DMG is alongside that folder. Each workspace has its own output.

### What a build contains

- The build does not embed imported user-data recordings, reports or credentials.
- Public builds include only the reviewed list in `desktop/web-assets.json`, without local audio.
- Private builds include the selected pack, its instrument recordings and its app icon, use a separate output folder, and stop if required recordings are missing or checksums differ.

See [private build instructions](content-packs.md) and [release readiness](open-source-readiness.md).

### Signing

These local builds use the same ad-hoc signing as the public binaries. Developer ID signing and notarization remain a future distribution improvement.

### Desktop tests

Run `npm run test:desktop` for the Electron smoke tests. Set `AFTERHOURS_DESKTOP_APP` to the packaged executable to run those checks against the standalone build.

## Checks

Install the Python environment described above, then run the integrated suites with Playwright:

```sh
npm ci
npm run lint
npm test
```

### Browser used by the checks

- The browser checks use installed Google Chrome.
- To use another Chromium build, set `AFTERHOURS_CHROMIUM` to its executable.
- The 9lives runner works with the same config if it is installed (`9l run tests/e2e`) and writes receipts to `.9lives/receipts/`.

### What `tests/e2e` covers

`tests/e2e` runs:

- the Python and Node suites;
- the offline FM and live-effects audio checks in Chrome;
- browser checks for the shell, desktop groovebox, 390 px Perform view, Ardour, Listen and AI.

| Area | Covered |
| --- | --- |
| Phone checks | Pad gestures, hit areas, patterns, pages, transport and edits surviving resize/reload. |
| Listen/AI checks | Seeking, A–B loops, presets, request counts, explicit submission, local excerpt ranges, safe report text and saved experiment checkboxes. |

Good to know:

- It starts its own app on port 8790 and mocks Ardour and analysis requests, so it never touches a live session or sends paid requests.
- One worker avoids two app instances competing for that port.
- The Node wrapper discovers every top-level `tests/*.test.js` file, including the instrument-loader concurrency, retry and memory-budget checks.

### MPK mini Plus II emulator

`tests/e2e/helpers/mpk-emulator.js` emulates the controller, so a test plays the device as a person would and checks what that person would see:

```js
const {MPK} = require('./helpers/mpk-emulator');
const mpk = await MPK.install(page); // before page.goto
await mpk.holdEncoder(() => mpk.pad(5)); // select track 5
await mpk.press('record', {shift: true}); // record keys
await mpk.playKey(36, {ms: 250});
await mpk.expectScreen([undefined, undefined, /^KEYS /]);
expect((await mpk.light('record')).color).toBe(127);
```

What it emulates:

- **Ports:** MIDI, DAW and Plugin ports, identity reply, SysEx permission, unplugging and plugging back in.
- **Modes:** DAW, Plugin (PLUGIN/DAW) and User Presets (`SHIFT` + PLUGIN/DAW). Controls go to the port of the current mode, and the mode change is announced as the hardware does.
- **Controls:** keys with octave shift, pads on banks A/B with velocity, relative knobs and encoder, encoder push, `SHIFT` and every transport and bank button.
- **Firmware:** `SHIFT` + pads 5–8 open and close the Prog/Chord menus, which take over the screen and the encoder; closing one asks the host to redraw.
- **Feedback:** the three display lines Afterhours writes, screen ownership and the pad and button lights with their animation.

The protocol follows Bitwig's MPK driver and Akai's user guide. Behaviour that neither source states is marked `ASSUMPTION` in the file. When the real controller behaves differently, change the emulator first, then the app. `tests/e2e/mpk-scenarios.spec.js` holds the end-to-end scenarios.

### What the unit tests cover

Tests cover local access rules, byte-range playback, bounded imports, key redaction, explicit analysis submission, job concurrency, local report persistence and partial whole-track recovery. Audio API requests are mocked in tests.

The FM sequencer's Node tests cover locks, lane timing, retrigs, chance, conditions, project validation and MIDI note ordering.

### Fixtures and content

- The public suite uses synthetic fixtures for song matching and sampling.
- Real-library checks skip when the [instrument recordings](../web/instruments/README.md#local-installation-and-native-packaging) are absent.
- Checks for separately supplied private songs remain with the private content archive.
- The public library also includes [Червона рута · Orchestra](chervona-ruta.md), a 16-lane instrumental adaptation credited to Volodymyr Ivasiuk. It uses separately installed orchestral recordings.

### Individual commands

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

### Formatting

Format JavaScript and CSS with Prettier and Python with Ruff (`pip install -r requirements-dev.txt` in the same environment):

```sh
npm run format
npm run format:check
```

### Manual audio check: live effects

The live-effects checks render the production audio graph with the browser's native `OfflineAudioContext`. They verify sample-exact bypass, filter attenuation, distortion, decaying echo, pause/reset behavior, removal of old delay memory, and parameter bounds. They do not make API calls or play sound.

1. Prepare and serve the check page:

   ```sh
   mkdir -p .context/effects-qa
   cp tests/effects.html .context/effects-qa/index.html
   cp tests/effects-browser.js web/effects.js web/controller-audio.js .context/effects-qa/
   python3 -m http.server 8766 --bind 127.0.0.1 --directory .context/effects-qa
   ```

2. Open `http://127.0.0.1:8766` in Chrome.
3. Check for **7 checks passed**.

### Manual audio check: Groove machines

The FM sequencer's browser checks render the production FM graph offline and verify the six FM voices, macro response, modulation, bass pitch, stop behavior, stereo pan and PCM WAV encoding. The additional browser tests render the Analog and wavetable machines, check wave motion, filter and macro response, release cleanup and the Synth patches. They do not play sound or use an API.

1. Prepare and serve the check page:

   ```sh
   mkdir -p .context/groove-qa/tests .context/groove-qa/web
   cp tests/groove.html tests/groove-browser.js .context/groove-qa/tests/
   cp web/groove-core.js web/groove-audio.js web/instrument-catalog.js web/timbres.js web/controller-audio.js web/performance-core.js web/performance-mixer.js web/ladder*.js web/voice*.js web/dsp-worklet.js .context/groove-qa/web/
   cp web/ladder-wasm.js web/ladder-worklet.js web/voice-worklet.js web/dsp-worklet.js web/wavetable-worker.js .context/groove-qa/
   python3 -m http.server 8766 --bind 127.0.0.1 --directory .context/groove-qa
   ```

2. Open `http://127.0.0.1:8766/tests/groove.html`.
3. Click **Run audio checks**.
4. Check for **7 checks passed**.

## CI

GitHub Actions runs JavaScript syntax checks, Prettier, Ruff, Rust formatting and Clippy, then all public unit, DSP, browser and offline audio tests.

The macOS job tests the development app, builds the public Apple Silicon app and DMG, then tests the packaged app.

- Successful runs provide an `AFTERHOURS-public-macos-arm64` artifact containing the app ZIP, DMG, source ZIP, WebAssembly files and SHA-256 checksums, retained for 14 days.
- These macOS builds are ad-hoc signed and are not notarized.
- CI checks out only this public repository and explicitly selects `desktop:dist:public`.

## Local files

Everything local is gitignored:

| Path | Contents |
| --- | --- |
| `.context/tracks/` | Recordings and the original download manifest. |
| `.context/analysis/` | Original and newly generated session reports. |
| `.context/analysis/summaries/<track id>.json` | Optional full-track measurements made outside the app. |
| `.context/app/` | Imported-library metadata and job status. |
| `.env` | The optional local API key. |

How the key is read, and how a summary file changes what a track shows, is in [Listen and AI](guide/listen-and-ai.md#api-key). The desktop app keeps its data elsewhere; see [the desktop app](desktop.md#where-your-data-lives).

## Server binding

The server binds to `127.0.0.1` and checks the Host and Origin headers. It is intended for one person on this Mac.

What restarting the server does to running work is in [Listen and AI](guide/listen-and-ai.md#the-local-server).

## Adding a theme

What the themes look like is in [Interface](guide/interface.md#themes). This section covers how they work.

### How themes work

- **Night** is the stylesheet's default: its tokens are the `:root` block in `web/style.css`, and it has no block in `web/themes.css`.
- Every other theme is a block of the same tokens in `web/themes.css`, selected by `<html data-theme>` from `web/theme.js`, plus a few rules for the parts that make the look recognisable (pads and readouts).
- `web/theme.js` holds the theme list as `id → [name, browser chrome colour, colour scheme]`. It fills the palette menu from that list, sets the `theme-color` and `color-scheme` meta tags, and stores the choice in `localStorage` under `afterhours-theme`.
- `web/theme.js` is loaded in `<head>` without `defer`, so the saved theme is applied before the first paint.
- Theme names are proper names and are not translated.
- The stereo meter is drawn on a canvas with fixed colours and stays dark in every theme.

### Steps

1. Add the theme to `THEMES` in `web/theme.js` with its id, name, browser chrome colour and colour scheme (`dark` or `light`).
2. Add a `[data-theme='<id>']` block to `web/themes.css` that redefines the `--ah-*` tokens, plus any rules for pads and readouts. Keep one colour per job; see [Colours](guide/interface.md#colours).
3. Add the theme to **View → Theme** in `desktop/main.cjs`, which has its own list.
4. Add the id to the `THEMES` list in `tests/e2e/themes.spec.js`, which checks the picker, text contrast and that the interface stays inside the viewport for every theme.

## Adding or changing translations

Which languages exist and what stays untranslated for users is in [Interface](guide/interface.md#language). This section covers the mechanism.

### How translation works

- English is the source language of `web/index.html` and the scripts. Modules keep writing English.
- `web/i18n.js` translates text and attributes as they reach the page, using the dictionary in `web/i18n-uk.js`. The attributes are `aria-label`, `title`, `placeholder`, `aria-valuetext` and `alt`.
- A string that is missing from the dictionary simply stays English.
- The choice is stored in `localStorage` under `afterhours-lang`; a first visit follows the browser language.
- `web/i18n.js` is loaded in `<head>` without `defer`, so a translated interface never flashes English first.

### Dictionary entries

A dictionary has two parts. Keys are the English source strings.

| Part | Form | Matches |
| --- | --- | --- |
| `exact` | `{"English text": "translation"}` | A whole, trimmed text node or one of the attributes above. |
| `patterns` | `[["Loaded {0} · {1} BPM", "… {0} · {1} BPM"]]` | Interpolated messages. |

Rules for patterns:

- `{0}` inserts the captured text unchanged, because it is usually a name or a number.
- `{0:t}` marks a capture that is interface wording, so it is translated too. This goes one level deep, for example `"WAV failed · {0:t}"` wrapping another message.
- Pattern order is match priority: keep specific patterns before general ones.

### Strings that bypass the page

Strings that never reach the DOM (confirm dialogs, names stored in a project) call `AfterhoursI18n.t()`, for example `AfterhoursI18n.t('Track {0} cleared', 3)`.

### Names stay as written

Names are content, not interface: project, track, section, machine, recording and take names keep their wording, so a recording called "Stop" stays "Stop".

| Attribute | Effect |
| --- | --- |
| `data-i18n-skip` | Leaves the element and its subtree alone. Put it on the nodes that show a name. |
| `data-i18n-skip="text"` | Keeps the node's text but still translates its attributes, such as a tooltip or `aria-label`. |

Text inside `script`, `style`, `textarea`, `code` and `title` elements is never translated.

### Steps to add or change a string

1. Write the English string in the markup or script as usual.
2. Add the translation to `exact` in `web/i18n-uk.js`, or to `patterns` if the string is interpolated.
3. If the string shows a name, mark its node with `data-i18n-skip` instead of translating it.
4. If the string never reaches the page, wrap it in `AfterhoursI18n.t()`.
5. Run `npm test`; `tests/e2e/i18n.spec.js` checks live switching, that names stay as written, and that every static string is translated in Ukrainian.
