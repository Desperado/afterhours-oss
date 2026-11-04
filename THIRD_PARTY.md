# License scope and third-party materials

Original AFTERHOURS application code, Rust DSP, tooling, tests and documentation
are licensed under [Apache-2.0](LICENSE), except for the materials listed below
and files carrying their own license notices. This grant covers only rights held
by the contributors. Package metadata describes the project's own code; it does
not relicense dependencies or media. [NOTICE](NOTICE) accompanies that grant.

## Code and fonts with separate terms

| Material | Terms / source | Treatment |
| --- | --- | --- |
| `web/fonts/*` | SIL Open Font License 1.1 | Preserve `OFL-ChakraPetch.txt`, `OFL-IBMPlexSansCondensed.txt`, `OFL-JetBrainsMono.txt` alongside the font files. |
| `scripts/ardour/afterhours.patch` | GPL-2.0-or-later; changes to [Ardour revision fd4ef052](https://github.com/Ardour/ardour/tree/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8) | Excluded from Apache. Upstream license and plugin clarification are preserved in `scripts/ardour/COPYING`. A distributed patched Ardour build needs its corresponding source and dependency notices. |
| Separately installed Ardour, x42 GM Synth, Surge XT | Their upstream licenses | These are not embedded in the AFTERHOURS Electron application. Optional build scripts and HTTP control do not change their licenses. |

## Instrument recordings

Local FLAC recordings under `web/instruments/` are installed separately and are
not tracked in Git. Their manifests refer to third-party source samples. The
selected source libraries use CC0, independently of the Apache license on our
sampler implementation:

| Library | Credit and source | Preserved notice |
| --- | --- | --- |
| Growlybass | [Karoryfer Samples](https://github.com/sfzinstruments/karoryfer.growlybass) | `web/instruments/licenses/growlybass.txt` |
| FreePats direct electric guitar, 2022-09-11 | [FlameStudios / Ben Saylor](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html) | `web/instruments/licenses/freepats-guitar.txt` |
| Virtuosity Drums | [Versilian Studios and contributors](https://github.com/sfzinstruments/virtuosity_drums) | `web/instruments/licenses/virtuosity-drums.txt` |
| VSCO 2 Community Edition | Sam Gossner, Simon Dalzell; sample cutting by Elan Hickler / Soundemote. [Publisher's CC0 statement](https://versilian-studios.com/vsco-community/), [source version 1.1.0](https://github.com/sgossner/VSCO-2-CE/tree/1.1.0) | `web/instruments/licenses/vsco-readme.txt` (unmodified upstream readme) |

Installation, source mapping hashes and processing are described in
[web/instruments/README.md](web/instruments/README.md). Do not extend these terms
to other instruments or downloads without checking their own licenses.

## Musical works and artwork outside the Apache grant

Reference songs, reconstructions, transcriptions, exported recordings and track
artwork are kept in a separate private content repository. They are absent from
the public source snapshot and default build. Selecting a private content pack
explicitly adds its presets and listed recordings to a private build; it does
not grant redistribution rights to that material.

The original repository's old Git history still contains this work. Keep that
repository private and publish only a newly reviewed snapshot with fresh history.
A deletion commit does not remove earlier media or musical data. Branding and
source-contribution ownership still need review before a public release.

## Packaged software dependencies

The local Electron app bundles a PyInstaller Python runtime. The direct analysis
requirements are in `.agents/skills/music-analysis/requirements.txt`; desktop
build tooling is in `desktop/requirements-build.txt`, and npm versions are pinned
in `package-lock.json`. The Rust DSP currently has no crate dependencies.

The initial installed-runtime inventory found permissive licenses for much of
that stack, plus these separate obligations requiring a binary-release review:

| Component | Installed version / observed terms | Remaining work |
| --- | --- | --- |
| Electron / Chromium | Electron 45.1.0; MIT plus Chromium third-party terms | Retain the actual Electron/Chromium license files and notices in the packaged distribution. |
| SoundFile / libsndfile | SoundFile 0.13.1 wrapper BSD; bundled libsndfile LGPL | Preserve both notices and satisfy the native library's source/replacement requirements for the exact binary shipped. |
| python-soxr / libsoxr | soxr 1.1.0 wheel declares LGPL-2.1-or-later and includes libsoxr/PFFFT notices | Include full terms, identify exact native sources/build, and verify replacement/relinking rights in the signed app. |
| certifi | 2026.10.23, MPL-2.0 | Retain notices and provide the covered source as required. |
| tqdm | 4.70.1, MPL-2.0 AND MIT | Preserve its code and documentation license notices. |
| llvmlite / LLVM | 0.50.0, BSD-2-Clause and Apache-2.0 WITH LLVM-exception | Preserve the bundled `LICENSE` and `LICENSE.thirdparty`. |
| NumPy / SciPy and native runtimes | NumPy 2.4.6, SciPy 1.17.1; multiple BSD/MIT-style terms, compiler runtimes and exceptions | Inventory the actual linked native libraries (including GCC/Fortran/quadmath where bundled) and preserve every applicable notice/source obligation. |
| PyInstaller bootloader / Python runtime | PyInstaller 6.22.3, GPL with bootloader exception; Python has its own license | Preserve their exact notices and check the exception's application to the built bundle. |

These observations describe the installed environment, not a complete license
bill of materials for every possible build. Links alone are not a replacement
for full notices or source obligations. Model weights and research-only
transcription/separation tools are not approved for bundling by this inventory.

See [open-source release readiness](docs/open-source-readiness.md) for unresolved
items. This is a technical preparation report, not a legal opinion.
