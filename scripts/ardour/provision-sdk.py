import concurrent.futures as futures
import hashlib
import json
import platform
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import tarfile
import urllib.error
import urllib.parse
import urllib.request

from sdk_link import sdk as sdk_link

if platform.system() != "Darwin" or platform.machine() != "arm64":
    raise SystemExit("This dependency SDK requires an Apple Silicon Mac.")
base = Path(__file__).resolve().parents[2] / ".context"
cache = base / "sdk-cache"
cache.mkdir(parents=True, exist_ok=True)
root = sdk_link(create=True)
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")


def request(url, headers=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), context=ctx, timeout=120)


lock = json.loads(Path(__file__).with_name("dependencies.lock.json").read_text())


def formula(name):
    return lock[name]


todo = set(
    [
        "expat",
        "bzip2",
        "jpeg-turbo",
        "libusb",
        "zlib",
        "libffi",
        "boost",
        "glibmm@2.66",
        "cairomm@1.14",
        "pangomm@2.46",
        "libsigc++@2",
        "libsndfile",
        "curl",
        "libarchive",
        "liblo",
        "taglib",
        "vamp-plugin-sdk",
        "rubberband",
        "aubio",
        "libxml2",
        "lrdf",
        "lv2",
        "lilv",
        "fftw",
        "libwebsockets",
        "cppunit",
    ]
)
all_formulas = {}
while todo:
    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        for d in pool.map(formula, sorted(todo)):
            all_formulas[d["name"]] = d
    todo = {n for d in all_formulas.values() for n in d["dependencies"]} - all_formulas.keys()


def install(d):
    name = d["name"]
    done = cache / (name + ".installed")
    if done.exists():
        return name + " cached"
    files = d["bottle"]["stable"]["files"]
    target = next((k for k in ["arm64_sequoia", "arm64_tahoe", "arm64_sonoma", "all"] if k in files), None)
    if not target:
        raise RuntimeError("No ARM bottle: " + name)
    bottle = files[target]
    archive = cache / (name + ".tar.gz")
    if archive.exists():
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != bottle["sha256"]:
            archive.unlink()
    if not archive.exists():
        partial = archive.with_suffix(".part")
        try:
            headers = {}
            try:
                response = request(bottle["url"])
            except urllib.error.HTTPError as e:
                if e.code != 401:
                    raise
                auth = dict(re.findall(r'(\w+)="([^"]+)"', e.headers["WWW-Authenticate"]))
                token_url = (
                    auth["realm"] + "?" + urllib.parse.urlencode({"service": auth["service"], "scope": auth["scope"]})
                )
                token = json.loads(request(token_url).read())["token"]
                headers["Authorization"] = "Bearer " + token
                response = request(bottle["url"], headers)
            with response, partial.open("wb") as out:
                shutil.copyfileobj(response, out)
            with partial.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if digest != bottle["sha256"]:
                raise RuntimeError("Checksum failed: " + name)
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    with tarfile.open(archive) as tf:
        members = []
        for member in tf.getmembers():
            member.name = "Cellar/" + member.name
            if member.islnk():
                member.linkname = "Cellar/" + member.linkname
            members.append(member)
        tf.extractall(root, members=members, filter="data")
    versions = [p for p in (root / "Cellar" / name).iterdir() if p.is_dir()]
    version = versions[0]
    (root / "opt").mkdir(exist_ok=True)
    link = root / "opt" / name
    if not link.exists():
        link.symlink_to(Path("../Cellar") / name / version.name)
    # Relocate only files owned by this bottle. Mach-O changes require ad-hoc signatures.
    for path in version.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic in [b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"]:
            scan = subprocess.run(["/usr/bin/otool", "-L", str(path)], capture_output=True, text=True)
            if scan.returncode:
                continue
            deps = scan.stdout
            args = []
            for line in deps.splitlines()[1:]:
                dep = line.strip().split(" (")[0]
                newdep = (
                    dep.replace("@@HOMEBREW_CELLAR@@", str(root / "Cellar"))
                    .replace("@@HOMEBREW_PREFIX@@", str(root))
                    .replace("/opt/homebrew", str(root))
                )
                if dep != newdep:
                    args.extend(["-change", dep, newdep])
            ids = subprocess.check_output(["/usr/bin/otool", "-D", str(path)], text=True).splitlines()[1:]
            if ids:
                new_id = (
                    ids[0]
                    .replace("@@HOMEBREW_CELLAR@@", str(root / "Cellar"))
                    .replace("@@HOMEBREW_PREFIX@@", str(root))
                    .replace("/opt/homebrew", str(root))
                )
                if new_id != ids[0]:
                    args.extend(["-id", new_id])
            if args:
                subprocess.run(
                    ["/usr/bin/install_name_tool", *args, str(path)],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                subprocess.run(
                    ["/usr/bin/codesign", "--force", "--sign", "-", str(path)],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        elif path.suffix in [".pc", ".la", ".cmake", ".h", ".py"] or path.name.endswith("-config"):
            try:
                old = path.read_text()
                new = (
                    old.replace("@@HOMEBREW_CELLAR@@", str(root / "Cellar"))
                    .replace("@@HOMEBREW_PREFIX@@", str(root))
                    .replace("/opt/homebrew", str(root))
                )
                new = re.sub(re.escape(str(root / "Cellar")) + r"/([^/\s]+)/[^/\s]+", str(root / "opt") + r"/\1", new)
                if old != new:
                    path.write_text(new)
            except UnicodeDecodeError:
                pass
    done.write_text(target + "\n")
    return name + " installed"


print("Preparing", len(all_formulas), "ARM64 dependency bottles", flush=True)
with futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(install, all_formulas.values()):
        print(result, flush=True)
# Homebrew uses the macOS bzip2 package without pkg-config metadata.
pc = root / "opt/bzip2/lib/pkgconfig"
pc.mkdir(exist_ok=True)
(pc / "bzip2.pc").write_text(
    f"prefix={root}/opt/bzip2\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include\n\nName: bzip2\nDescription: bzip2 compression library\nVersion: 1.0.8\nLibs: -L${{libdir}} -lbz2\nCflags: -I${{includedir}}\n"
)
print("SDK ready:", root, flush=True)
