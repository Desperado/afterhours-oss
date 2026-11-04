"""Bundle and ad-hoc sign the local source build. No developer credentials needed."""

from pathlib import Path
import os
import shutil
import subprocess

from sdk_link import sdk as sdk_link

root = Path(__file__).resolve().parents[2]
context = root / ".context"
sdk = sdk_link()
source = context / "ardour-fork"
gm = context / "gmsynth"
gm_revision = "13acf5ef99e725334a4f72a604f296d1a68eccd4"
env = {
    key: os.environ[key] for key in ["HOME", "PATH", "LANG", "TMPDIR", "USER", "LOGNAME", "SHELL"] if key in os.environ
}
env.update(
    CC="/usr/bin/clang",
    CXX="/usr/bin/clang++",
    PKG_CONFIG="/usr/local/bin/pkg-config",
    PKG_CONFIG_PATH="",
    PKG_CONFIG_LIBDIR=":".join(str(p) for p in sorted(sdk.glob("opt/*/lib/pkgconfig")))
    + ":"
    + ":".join(str(p) for p in sorted(sdk.glob("opt/*/share/pkgconfig"))),
)
if not gm.exists():
    subprocess.run(
        ["git", "clone", "--no-checkout", "--depth=100", "https://github.com/x42/gmsynth.lv2.git", str(gm)], check=True
    )
    subprocess.run(["git", "fetch", "--depth=100", "origin", gm_revision, "--tags"], cwd=gm, check=True)
    subprocess.run(["git", "checkout", "--detach", gm_revision], cwd=gm, check=True)
if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=gm, text=True).strip() != gm_revision:
    raise SystemExit("Unexpected GM synth revision. Preserve local edits before using the pinned version.")
subprocess.run(["git", "fetch", "--depth=100", "origin", gm_revision, "--tags"], cwd=gm, check=True)
subprocess.run(["make", "-j4", "CC=/usr/bin/clang"], cwd=gm, env=env, check=True)
(sdk / "lib").mkdir(exist_ok=True)
lv2 = sdk / "lib/lv2"
if not lv2.exists():
    lv2.symlink_to(sdk / "opt/lv2/lib/lv2")
packaging = source / "tools/osx_packaging"
subprocess.run(
    ["bash", "./osx_build", "--afterhours", "--app-only", "--no-nls", "--nostrip", "--stack", str(sdk)],
    cwd=packaging,
    env=env,
    check=True,
)
app = packaging / "Ardour/AfterhoursArdour9.app"
plugins = app / "Contents/lib/LV2/gmsynth.lv2"
shutil.copytree(gm / "build", plugins, dirs_exist_ok=True)
shutil.copy2(gm / "COPYING", plugins / "COPYING")
# Recent bottles also use @rpath dependencies, which upstream's packager misses.
# Copy their transitive libraries and give every dependency a bundle-relative path.
index = {}
for candidate in (sdk / "opt").glob("*/lib/*.dylib"):
    index.setdefault(candidate.name, candidate)
while True:
    added = False
    for binary in list(app.rglob("*")):
        if not binary.is_file() or binary.is_symlink():
            continue
        with binary.open("rb") as stream:
            if stream.read(4) not in [b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"]:
                continue
        for line in subprocess.check_output(["otool", "-L", str(binary)], text=True).splitlines()[1:]:
            dep = line.strip().split(" (")[0]
            if not (dep.startswith(str(sdk)) or dep.startswith("@rpath/")):
                continue
            name = Path(dep).name
            target = app / "Contents/lib" / name
            if not target.exists():
                original = index.get(name)
                if original is None:
                    raise SystemExit("Missing bundled dependency: " + name)
                shutil.copy2(original, target)
                added = True
            subprocess.run(
                ["install_name_tool", "-change", dep, "@executable_path/../lib/" + name, str(binary)], check=True
            )
    if not added:
        break
# install_name_tool invalidates signatures. Re-sign every native file, then the bundle.
main = app / "Contents/MacOS/AfterhoursArdour9"
for path in sorted(app.rglob("*"), key=lambda p: p == main):
    if path.is_file() and not path.is_symlink():
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic in [b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"] or path.parent == app / "Contents/MacOS":
            subprocess.run(["codesign", "--force", "--sign", "-", str(path)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
print("Local app ready:", app)
