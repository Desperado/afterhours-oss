# Public app and private content

The app's original synth demos work on their own. A separate private repository
holds reference songs, editable arrangements, source recordings, exported audio,
research, artwork and their original tests. Keep the original app repository
private too: its old Git history still contains that material. A public repository
must start from a reviewed snapshot with fresh history.

## One-time private setup

Install Python 3.11, Node.js and the authenticated GitHub CLI, then run:

```sh
npm run setup
npm run setup:private -- --repo OWNER/PRIVATE-CONTENT-REPO
```

Setup checks that the GitHub repository is private, clones it outside the app
checkout, and verifies the declared recordings and their SHA-256 checksums.
The default location is `~/work/afterhours-private/`, beside the app checkout
at `~/work/afterhours/`.
Use `--directory /absolute/path` for an existing private checkout outside the app.
Attaching an existing checkout also checks its GitHub origin and repository privacy.
No credentials are copied or written into either repository.

The selection is stored in the app repository's local Git metadata, shared across
its worktrees. New Conductor workspaces automatically install dependencies and
validate that selection. A fresh public repository has no private selection or
private-repository dependency. Setup never publishes, changes repository visibility
or pushes content. Update the private checkout explicitly with
`npm run setup:private -- --update` (requires a clean working tree).

After setup, ordinary commands include the original private songs, recordings,
catalog order, sound tour and icon automatically:

```sh
bash start.sh
npm run desktop
npm run desktop:dist
```

`desktop:pack` produces just the app. The standalone app and DMG go to
`.context/desktop-dist/private/`; the backend is in
`.context/desktop-backend/private/`. The app does not need the private checkout
after building. Missing configured content fails instead of silently producing a
public build. `npm run desktop:dist:private` requires a private selection, and
`-- --content-pack /absolute/path` selects a pack for a single build.

Run `npm run test:private` to check the configured pack in the development app.
Set `AFTERHOURS_DESKTOP_APP` to the packaged executable to check the standalone
app instead. The check compares every private project and its catalog order,
checks the tour and every declared recording, and renders a sampled instrument.

## Explicit public commands

```sh
bash start.sh --public
npm run desktop:public
npm run desktop:dist:public
npm run desktop:pack:public
```

Public builds always ignore local private settings and stage only
`desktop/web-assets.json`. Private WAVs, instrument FLACs, presets, archive and icon
are excluded, even on a configured machine. Output is isolated in
`.context/desktop-dist/public/` and `.context/desktop-backend/public/`.
Never merge public and private output folders.

## Pack format and boundaries

`pack.json` contains `version: 1`, `presets` entries with
`{id, title, genre, description, project}`, and an `assets` array.
Allowed asset paths are `samples/NAME.wav` and
`instruments/BANK/24-HEX-DIGITS.flac`. Optional `checksums` maps those paths to
SHA-256 digests. Preset IDs cannot replace built-in presets; `prepend: true`
places pack presets first while preserving their order.
Setup, staging and the development server validate presets with the renderer's
registration code through Node.js, rejecting invalid projects, conflicting IDs or
invalid demo settings before launch. The bundled app uses the validated script
and needs no Node.js installation.

Optional `demo: {preset, label, startSection}` enables the sampled-instrument tour.
A complete private pack includes all recordings referenced by the app's curated
instrument manifests and all sample lanes. It needs `desktop/icon.png` for private
packaging. The server exposes only generated preset JavaScript and listed audio;
it never exposes the manifest, archive or research. Instrument files can be served
directly from the private checkout without copying them into the app source tree.
While a pack is selected, undeclared audio in the app checkout is not served.

Research, archived artwork, old tests and exported full-song audio stay in the
private repository. The app bundles editable projects, required source recordings
and its icon. Private content keeps its own rights restrictions. Public binary
dependency notices, branding clearance and signing still need the
[release review](open-source-readiness.md).
