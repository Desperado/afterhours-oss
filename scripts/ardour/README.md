# AFTERHOURS Ardour for Apple Silicon

This builds Ardour 9.8.241 from revision
`fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`, with the adjacent
`afterhours.patch`. Ardour and the bundled x42 General MIDI Synth retain
their GPL licenses; the app includes their license files. The adjacent
`afterhours.patch` is GPL-2.0-or-later, outside the root Apache grant; see
[COPYING](COPYING) for the upstream license and plugin clarification. Surge XT is
installed separately from its official distribution.

## Build

Requires an Apple Silicon Mac running macOS 15 or later, Xcode command line
tools, Python 3, Git, Make, and pkg-config at `/usr/local/bin/pkg-config`.
Run from the repository root:

```sh
python3 scripts/ardour/prepare.py
python3 scripts/ardour/provision-sdk.py
python3 scripts/ardour/build.py
python3 scripts/ardour/build.py build -j6
python3 scripts/ardour/package.py
```

The SDK downloads pinned Homebrew bottles, verifies SHA-256 digests and
relocates them into `.context/sdk`. `/tmp/afterhours-sdk` points to that SDK;
only one workspace can own this link at a time. Dependencies are not
installed into the system Homebrew prefix. Packaging builds the pinned GM
synth, bundles transitive libraries and verifies the ad-hoc signature.
This local build does not use an Apple developer account or notarization.

Output:
`.context/ardour-fork/tools/osx_packaging/Ardour/AfterhoursArdour9.app`

The app uses bundle ID `dev.afterhours.AfterhoursArdour9`, preferences in
`~/Library/Preferences/AfterhoursArdour9` and a separate plugin cache in
`~/Library/Caches/AfterhoursArdour9`. It can coexist with official Ardour.
The full build, packaging and strict signature verification have completed
successfully on this Mac. A clean build on another Mac has not been tested.

## Local MCP connection

Complete the first-run setup, start the audio engine and open a session.
In Preferences → Control Surfaces, enable **MCP HTTP Server (Experimental)**.
Use port **4820**, then click **Connect to Ardour** in AFTERHOURS at
`http://127.0.0.1:8765/`.

The fork binds MCP to `127.0.0.1` and exposes the upstream tool set at
`http://127.0.0.1:4820/mcp`. It accepts JSON POST requests with a matching
local Host header, rejects browser Origin headers, and limits bodies to
2 MiB. Agents can use MCP directly. AFTERHOURS uses a smaller set of tools
for session readback, playback, stopping, rewind, faders and saving.
The Night Bass editor also exposes Surge XT FM routing/depth, filter,
feedback, drive and amplitude envelope controls, with plugin identity checks.

Control-surface activation can be stored in the session as well as global
preferences. When setting XML offline, quit Ardour first and preserve a
backup. Its Protocol element requires `name`, `config` (an empty string is
valid), `active="1"` and `port="4820"`; a missing `config` attribute causes
the setting to be ignored. Prefer the preferences UI.

The first launch uses a fresh plugin index. Scan VST3 plugins in Plugin
Manager and reload the session after scanning. A Missing Plugins warning
does not mean Surge XT needs reinstalling. Avoid saving over your only
session copy while instruments are missing.
