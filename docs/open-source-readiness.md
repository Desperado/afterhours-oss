# Apache-2.0 release preparation

Status: project licensing is prepared; public source and binary release clearance
is still pending. Track the work in [#14](https://github.com/Desperado/afterhours/issues/14).
The repository remains private. Private song material has been preserved in a separate content repository and removed from the public source tree. Old history remains private.

## Completed preparation

- Standard, unmodified Apache License 2.0 text in `LICENSE`, with project `NOTICE`.
- Matching Apache-2.0 metadata in npm's manifest/lockfile and the Rust crate.
- Contributor submission terms in `CONTRIBUTING.md`.
- Scope, third-party credits and initial dependency/asset audit in `THIRD_PARTY.md`.
- Upstream Ardour GPL text and VSCO source readme preserved separately.
- Project license/scope documents included as desktop application resources.

## Before making source or history public

- [ ] Verify ownership/permission for original source contributions and branding.
- [x] Separate reference songs, scores, research, artwork and song-specific tests
  from the application; load them only through an explicitly selected content pack.
- [x] Define a fresh-snapshot public boundary. The original repository and its old
  history stay private. The snapshot is a candidate for review, not a published release.
- [ ] Review tracked files and Git history for credentials, personal paths/data,
  private recordings and material without redistribution permission. Do not dump
  secrets during the review; record affected credential names only.
- [x] Verify clean-checkout setup and clearly identify optional local instruments.

## Before distributing a public app or DMG

- [x] Stage explicit public desktop builds from a web asset allowlist, excluding
  ignored local audio. Private builds have separate staging, backend and app outputs,
  include their selected pack and instrument recordings, and reject missing assets.
- [ ] Inventory exact packaged Python, native and Electron dependencies. Include
  their full license texts/notices and satisfy source, replacement/relinking and
  other applicable conditions. The current root license resources alone do not
  complete that work; `THIRD_PARTY.md` lists observed LGPL/MPL/runtime items.
- [ ] Verify any bundled samples against their source versions and preserved
  notices. Do not bundle model weights or new instrument libraries by assumption.
- [ ] Test the cleared package without private assets; avoid presets pointing at
  missing restricted recordings. Verify playback, export and demo behavior.
- [ ] Prepare Developer ID signing/notarization for the intended macOS release.

No repository visibility changes, public releases, destructive history rewriting
or deletion of the private music work are part of this preparation.
