"""Compile only the curated SFZ banks into AH region maps and lossless FLAC assets.

Not a general SFZ importer. Source libraries must be extracted under --source-root.
No per-note normalization, resampling, or baked effects; velocity layers/takes retained.
Requires soundfile. See web/instruments/README.md for sources and supported behavior.
"""

import argparse
import hashlib
import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import soundfile as sf

REPO = Path(__file__).resolve().parents[1]


def parse(path):
    text = re.sub(r"//[^\n]*", "", path.read_text())
    if re.search(r"(?m)^\s*#", text):
        raise ValueError(f"Unsupported SFZ directive in {path.name}")
    headers = re.split(r"<(\w+)>", text)
    control, glob, group, regions = {}, {}, {}, []
    for kind, body in zip(headers[1::2], headers[2::2]):
        ops = {m[0]: m[1].strip() for m in re.findall(r"(\w+)\s*=\s*(.*?)(?=\s+\w+\s*=|$)", body, re.DOTALL)}
        if kind == "control":
            control.update(ops)
        elif kind == "global":
            glob = ops
            group = {}
        elif kind == "group":
            group = ops
        elif kind == "region":
            regions.append({**control, **glob, **group, **ops})
        else:
            raise ValueError(f"Unsupported header: {kind} in {path.name}")
    return regions


def compile_bank(bank, source, destination):
    instrument, path, defaults = bank
    mapping = source / path
    regions = [] if instrument == "virtuosity-drums" else parse(mapping)
    if instrument == "virtuosity-drums":
        regions = []
        # Stereo overhead perspective. Keep every dynamic layer and available alternate.
        for key, name, veltrack in [
            (36, "kick_snon", 100),
            (38, "snare_center", 0),
            (42, "hh_closed", 100),
            (46, "hh_open", 100),
            (41, "ltom_center", 0),
            (48, "htom_center", 0),
            (49, "crash_crash", 100),
        ]:
            for r in parse(mapping / f"mappings/oh/{name}_map.sfz"):
                regions.append(
                    {"key": key, "amp_veltrack": veltrack, **({"amp_velcurve_1": 0.4} if veltrack else {}), **r}
                )
        mapping = mapping / "01-basic-kit.sfz"
    out = destination / instrument
    out.mkdir(parents=True, exist_ok=True)
    tasks, compiled = {}, []
    for r in regions:
        allowed = {
            "sample",
            "default_path",
            "key",
            "lokey",
            "hikey",
            "pitch_keycenter",
            "lovel",
            "hivel",
            "lorand",
            "hirand",
            "seq_length",
            "seq_position",
            "ampeg_attack",
            "ampeg_release",
            "ampeg_dynamic",
            "volume",
            "amp_veltrack",
            "group_label",
        }
        unknown = set(r) - allowed - {k for k in r if k.startswith("amp_velcurve_")}
        if unknown:
            raise ValueError(f"Unsupported opcodes {unknown} in {instrument}")
        sample = (
            mapping.parent / str(r.get("default_path", "")).replace("\\", "/") / str(r["sample"]).replace("\\", "/")
        ).resolve()
        if not sample.is_relative_to(source.resolve()) or not sample.is_file():
            raise ValueError(f"Sample missing or outside source root: {sample.name}")
        digest = hashlib.sha256(sample.read_bytes()).hexdigest()
        filename = digest[:24] + ".flac"
        tasks[filename] = sample

        def n(key, default, region=r):
            return float(region.get(key, default))

        lo = int(n("lokey", r.get("key", 0)))
        hi = int(n("hikey", r.get("key", 127)))
        root = int(n("pitch_keycenter", r.get("key", 60)))
        item = dict(
            sample=filename,
            lo=lo,
            hi=hi,
            root=root,
            lovel=int(n("lovel", 0)),
            hivel=int(n("hivel", 127)),
            attack=n("ampeg_attack", 0.001),
            release=n("ampeg_release", 0.3),
            volume=n("volume", 0),
            veltrack=n("amp_veltrack", 100),
            take=int(n("seq_position", 1)) - 1,
            takes=int(n("seq_length", 1)),
            **defaults,
        )
        if "lorand" in r or "hirand" in r:
            width = n("hirand", 1) - n("lorand", 0)
            item.update(take=round(n("lorand", 0) / width), takes=round(1 / width))
        points = [
            [int(k.removeprefix("amp_velcurve_")), float(v)] for k, v in r.items() if k.startswith("amp_velcurve_")
        ]
        if points:
            item["curve"] = sorted({0: 0, 127: 1, **dict(points)}.items())
        compiled.append(item)

    def convert(entry):
        name, original = entry
        target = out / name
        if target.exists():
            return
        temporary = target.with_suffix(".tmp.flac")
        if original.suffix.lower() == ".flac":
            shutil.copyfile(original, temporary)
        else:
            audio, rate = sf.read(original, dtype="int32", always_2d=True)
            sf.write(temporary, audio, rate, subtype="PCM_24")
        temporary.replace(target)

    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(convert, tasks.items()))
    # Track the small manifest, ignore the local recordings. Atomic final write.
    manifest = {
        "version": 1,
        "id": instrument,
        "regions": compiled,
        "source_sha256": hashlib.sha256(mapping.read_bytes()).hexdigest(),
    }
    temporary = out / "manifest.tmp.json"
    temporary.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    temporary.replace(out / "manifest.json")
    print(f"{instrument}: {len(compiled)} regions, {len(tasks)} recordings", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=REPO / ".context/sampled-instruments")
    args = parser.parse_args()
    banks = [
        ("growlybass", "karoryfer.growlybass-master/growlybass_clean.sfz", {}),
        ("freepats-guitar", "guitar/EGuitarFSBS-direct SFZ+FLAC-20220911/EGuitarFSBS-direct bridge 20220911.sfz", {}),
        ("virtuosity-drums", "virtuosity_drums-master/Programs", {"oneShot": True}),
    ]
    for instrument, file in [
        ("flute", "FluteSusNV"),
        ("trumpet", "TrumpetSus"),
        ("horn", "FHornSus"),
        ("tuba", "TubaSus"),
        ("trombone", "TromboneSus"),
        ("harp", "Harp"),
        ("violins", "ViolinEnsSusVib"),
        ("violas", "ViolaEnsSusVib"),
        ("cellos", "CelloEnsSusVib"),
    ]:
        banks.append(("vsco-" + instrument, "vsco/" + file + ".sfz", {}))
    for bank in banks:
        compile_bank(bank, args.source_root, REPO / "web/instruments")


if __name__ == "__main__":
    main()
