"""Stage only reviewed web assets, plus explicitly selected private content."""

import argparse
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from content_pack import load_pack


def inside(root, name):
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f"Asset outside source directory: {name}")
    return path


def web_sources(*, root=ROOT, content_pack=None, instruments=False):
    web = root / "web"
    names = json.loads((root / "desktop/web-assets.json").read_text())
    sources = {name: inside(web, name) for name in names}
    script = None
    if content_pack:
        script, assets = load_pack(content_pack)
        pack = json.loads((Path(content_pack) / "pack.json").read_text())
        required = {
            f"samples/{track['sample']['id']}.wav"
            for entry in pack["presets"]
            for pattern in entry["project"]["patterns"]
            for track in pattern["tracks"]
            if track.get("machine") == "Sample"
        }
        missing = required - assets.keys()
        if missing:
            raise ValueError("Private build needs declared recordings in pack.json: " + ", ".join(sorted(missing)))
        sources.update(assets)
    if instruments:
        for name in names:
            if not re.fullmatch(r"instruments/[a-z0-9-]+/manifest.json", name):
                continue
            manifest = json.loads(sources[name].read_text())
            for region in manifest["regions"]:
                sample = region["sample"]
                if not re.fullmatch(r"[a-f0-9]{24}\.flac", sample):
                    raise ValueError("Invalid instrument recording")
                asset = str(Path(name).parent / sample)
                if asset not in sources:
                    sources[asset] = inside(web, asset)
    return sources, script


def stage_web(destination, *, root=ROOT, content_pack=None, instruments=False):
    destination = Path(destination)
    # Never merge with an earlier build, which might contain private assets.
    destination.mkdir(parents=True, exist_ok=False)
    sources, script = web_sources(root=root, content_pack=content_pack, instruments=instruments)
    for name, source in sources.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    if script is not None:
        (destination / "content-packs.js").write_bytes(script)
        (destination / "PRIVATE-CONTENT-NOTICE.txt").write_text(
            "PRIVATE BUILD: separately supplied content is not covered by the app's license.\n"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--content-pack", type=Path)
    parser.add_argument("--instruments", action="store_true")
    args = parser.parse_args()
    stage_web(args.destination, content_pack=args.content_pack, instruments=args.instruments)
