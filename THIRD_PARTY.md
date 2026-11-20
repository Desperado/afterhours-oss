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

The public catalog includes **Червона рута · Orchestra**, an instrumental
adaptation of the user-supplied voice/piano score of **Червона рута**, music and
lyrics by **Volodymyr Ivasiuk**. Its musical material in `web/chervona-ruta.js`
is excluded from the Apache-2.0 grant on the application code. Inclusion is not
a claim that the composition is public domain or a grant of rights in the
underlying work. The scans and recordings are not bundled. See the
[arrangement notes](docs/chervona-ruta.md) for the source form and instrumentation.

Other reference songs, reconstructions, transcriptions, exported recordings and track
artwork are kept in a separate private content repository. They are absent from
the public source snapshot and default build. Selecting a private content pack
explicitly adds its presets and listed recordings to a private build; it does
not grant redistribution rights to that material.

The original repository's old Git history still contains this work. Keep that
repository private and publish only a newly reviewed snapshot with fresh history.
A deletion commit does not remove earlier media or musical data. The public
repository uses a fresh source snapshot rather than that original history.

## Packaged software dependencies

The local Electron app bundles a PyInstaller Python runtime. The direct analysis
requirements are in `.agents/skills/music-analysis/requirements.txt`; desktop
build tooling is in `desktop/requirements-build.txt`, and npm versions are pinned
in `package-lock.json`. The Rust DSP currently has no crate dependencies.

The standalone backend includes `third-party-licenses/`, with the installed
Python distribution notices, Python's license, an exact build-environment
version inventory, and native codec notices. The inventory is a superset of
runtime dependencies: it also identifies installed build tools. Electron's
`LICENSE.electron.txt` and `LICENSES.chromium.html` remain in the app resources.

The following components retain their separate terms:

| Component | Installed version / observed terms | Distribution treatment |
| --- | --- | --- |
| Electron / Chromium | Electron 45.1.0; MIT plus Chromium third-party terms | Original Electron and Chromium notices are included in the app resources. |
| SoundFile / libsndfile | SoundFile 0.13.1 wrapper BSD; libsndfile 1.2.2 LGPL | Notices include the statically linked codec libraries; corresponding sources and the upstream macOS build recipe accompany the release. The dylib remains a separate replaceable file. |
| python-soxr / libsoxr | soxr 1.1.0, LGPL-2.1-or-later, with libsoxr/PFFFT notices | Full notices are included; the source distribution includes the patched libsoxr and build files. |
| certifi | MPL-2.0 | Full notice and the exact source distribution accompany the release. |
| tqdm | MPL-2.0 AND MIT | Full notice and the exact source distribution accompany the release. |
| llvmlite / LLVM | BSD-2-Clause and Apache-2.0 WITH LLVM-exception | `LICENSE` and `LICENSE.thirdparty` are preserved. |
| NumPy / SciPy and native runtimes | Multiple BSD/MIT-style terms, compiler runtimes and exceptions | Installed wheel notices, including their bundled native runtime terms, are preserved. |
| PyInstaller bootloader / Python runtime | GPL with PyInstaller bootloader exception; Python's separate license | Both full license texts are preserved. |

Download `AFTERHOURS-third-party-sources.zip` alongside the DMG from the
[v0.3.0 release](https://github.com/Desperado/afterhours-oss/releases/tag/v0.3.0).
It contains unmodified upstream source archives, their SHA-256 hashes and origin
URLs, and the SoundFile wheel's native macOS build recipe. In particular, that
recipe identifies libsndfile 1.2.2, Ogg 1.3.5, Vorbis 1.3.7, FLAC 1.4.3, Opus 1.4,
mpg123 1.32.3 and LAME 3.100. Native notices record the source archives used.

The application imposes no restriction on modifying, reverse engineering or
replacing these libraries. The backend keeps native libraries as separate files
under `Contents/Resources/backend/_internal/`. To rebuild with modified versions,
install them into the build environment and run `npm run desktop:dist:public`;
the application source and build scripts are included with the release. A locally
modified macOS bundle must be signed again; these builds use an ad-hoc signature,
without a vendor signing key or hardened runtime requirement.

The inventory describes the build environment, not every possible future build.
New dependency versions need corresponding notices and covered sources before a
new binary release. Model weights and research-only transcription/separation
tools are not approved for bundling by this inventory.

See [release checks](docs/open-source-readiness.md). This is a technical inventory,
not a legal opinion.
