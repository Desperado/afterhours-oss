"""Machine-local private content selection, shared by this repository's worktrees."""

import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def settings_path(root=ROOT):
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=root,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        pass
    else:
        if result.returncode == 0:
            return Path(result.stdout.strip()) / "afterhours-private.json"
    return Path(root) / ".context/private-content.json"


def configured_pack(root=ROOT, *, must_exist=True):
    settings = settings_path(root)
    if not settings.exists():
        return None
    try:
        data = json.loads(settings.read_text())
        directory = Path(data["directory"])
        if (
            data["version"] != 1
            or not directory.is_absolute()
            or (must_exist and not (directory / "pack.json").is_file())
        ):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError(
            "Private content is configured but unavailable. Run npm run setup:private to repair it."
        ) from None
    return directory


def configure(directory, root=ROOT):
    settings = settings_path(root)
    settings.parent.mkdir(parents=True, exist_ok=True)
    temporary = settings.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": 1, "directory": str(Path(directory).resolve(strict=True))}) + "\n")
    temporary.chmod(0o600)
    temporary.replace(settings)


if __name__ == "__main__":
    try:
        directory = configured_pack()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print(directory or "")
