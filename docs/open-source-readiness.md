# Public release checks

The public source repository is [Desperado/afterhours-oss](https://github.com/Desperado/afterhours-oss).
It starts from a fresh snapshot. The original repository, old history, private
music and optional content pack remain separate and private.

## Public binary boundary

`npm run desktop:dist:public` always builds public content. It stages only
`desktop/web-assets.json`, without ignored recordings, local user data or a
configured private content pack. The original synth demo arrangements work
without separately downloaded recordings or an API key.

Configured ordinary local builds still include the private pack and use a
separate output directory. See [content packs](content-packs.md).

## Before publishing a release

- Run Public CI for the exact release commit. Require lint, Python, Node, Rust,
  browser, offline audio, development Electron and packaged Electron checks.
- Use the tested CI artifact, not a different local or private build. Verify the
  embedded app version, public web allowlist and SHA-256 checksums.
- Preserve the app's Apache license and notices, font/sample source notices,
  Electron/Chromium notices and `backend/_internal/third-party-licenses/`.
  The latter includes full installed dependency notices, exact versions and
  native codec notices. [Third-party scope](../THIRD_PARTY.md) explains the terms.
- Publish the covered dependencies' corresponding source archives alongside the
  binary. Match their versions to the embedded inventory; retain the origin URLs,
  hashes, native build recipe and replacement/rebuild instructions.
- Keep user recordings, credentials, private content and old history out of both
  source and binary release assets. Do not print secrets during verification.
- For new contributions, assets or dependencies, verify redistribution rights
  and preserve their applicable license terms before including them.

## macOS signing

Current Apple Silicon builds are ad-hoc signed and tested on the macOS CI runner.
They do not have Apple Developer ID signing or notarization. State this in release
notes; do not present them as notarized builds. Developer ID signing and
notarization remain a future distribution improvement.
