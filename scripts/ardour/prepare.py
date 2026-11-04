"""Fetch the pinned Ardour source and apply the AFTERHOURS patch."""

from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
source = root / ".context/ardour-fork"
revision = "fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8"
if not source.exists():
    subprocess.run(["git", "clone", "--depth=300", "https://github.com/Desperado/ardour.git", str(source)], check=True)
    subprocess.run(["git", "fetch", "--depth=300", "origin", revision], cwd=source, check=True)
    subprocess.run(
        ["git", "fetch", "--depth=300", "https://github.com/Ardour/ardour.git", "9.8:refs/tags/9.8"],
        cwd=source,
        check=True,
    )
    subprocess.run(["git", "checkout", "--detach", revision], cwd=source, check=True)
actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
if actual != revision:
    raise SystemExit("Source revision differs. Preserve your edits and use a fresh .context/ardour-fork checkout.")
patch = Path(__file__).with_name("afterhours.patch")
already = (
    subprocess.run(["git", "apply", "--reverse", "--check", str(patch)], cwd=source, capture_output=True).returncode
    == 0
)
if not already:
    subprocess.run(["git", "apply", "--check", str(patch)], cwd=source, check=True)
    subprocess.run(["git", "apply", str(patch)], cwd=source, check=True)
print("AFTERHOURS source ready:", source)
