"""Load a separately stored preset pack and its explicitly listed audio assets."""

import hashlib
import json
from pathlib import Path
import re
import subprocess


def load_pack(directory):
    root = Path(directory).resolve(strict=True)
    source = (root / "pack.json").resolve(strict=True)
    if not source.is_relative_to(root):
        raise ValueError("Content manifest must remain inside the pack")
    if source.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Content pack is too large")
    pack = json.loads(source.read_text())
    if (
        not isinstance(pack, dict)
        or pack.get("version") != 1
        or not isinstance(pack.get("presets"), list)
        or not 1 <= len(pack["presets"]) <= 64
    ):
        raise ValueError("Invalid content pack")
    if not isinstance(pack.get("assets", []), list):
        raise ValueError("Invalid content asset list")
    assets = {}
    for name in pack.get("assets", []):
        if (
            not isinstance(name, str)
            or not re.fullmatch(
                r"(?:samples/[a-z0-9-]{1,64}\.wav|instruments/[a-z0-9-]{1,64}/[a-f0-9]{24}\.flac)", name
            )
            or name in assets
        ):
            raise ValueError("Invalid content asset")
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Content assets must remain inside the pack")
        assets[name] = path
    checksums = pack.get("checksums", {})
    if not isinstance(checksums, dict):
        raise ValueError("Invalid content checksums")
    for name, expected in checksums.items():
        if name not in assets or not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise ValueError("Invalid content checksum")
        with assets[name].open("rb") as recording:
            actual = hashlib.file_digest(recording, "sha256").hexdigest()
        if actual != expected:
            raise ValueError(f"Content checksum mismatch: {name}")
    # The renderer receives editable presets, never private storage metadata.
    presets = {key: pack[key] for key in ("version", "presets", "demo", "prepend") if key in pack}
    payload = json.dumps(presets, allow_nan=False)
    # Use the renderer's own registration contract before setup, serving or staging.
    # Bundled apps serve the already validated script and do not need Node.js.
    try:
        validation = subprocess.run(
            [
                "node",
                "-e",
                "require('./web/groove-presets').register(JSON.parse(require('node:fs').readFileSync(0, 'utf8')))",
            ],
            cwd=Path(__file__).resolve().parent,
            input=payload,
            text=True,
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError("Node.js is required to validate a separately supplied content pack.") from None
    if validation.returncode:
        raise ValueError("Invalid content preset metadata, projects or demo configuration.")
    script = ("AfterhoursPresets.register(" + payload + ");\n").encode()
    return script, assets
