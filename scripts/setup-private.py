#!/usr/bin/env python3
"""Opt in to a private GitHub content repository; never publish content."""

import argparse
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from desktop.stage_web import web_sources
from local_content import configure, configured_pack


def run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{command[0]} failed. Check GitHub authentication and repository access.")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="Private GitHub OWNER/REPO (required for first setup)")
    parser.add_argument("--directory", type=Path, help="An existing private checkout outside the app repository")
    parser.add_argument("--update", action="store_true", help="Pull a clean configured checkout with --ff-only")
    parser.add_argument("--check", action="store_true", help="Validate existing content without network access")
    args = parser.parse_args()
    directory = args.directory or configured_pack(must_exist=False)
    if args.check:
        if not directory:
            return
    else:
        if not args.repo and not directory:
            parser.error("First setup needs --repo OWNER/REPO")
        if not directory:
            directory = Path.home() / "work/afterhours-private"
        directory = directory.expanduser().resolve()
        if directory.is_relative_to(ROOT):
            raise ValueError("Keep the private checkout outside the app repository.")
        if args.repo or args.update or not directory.exists():
            repo = args.repo
            if not repo:
                remote = run(["git", "-C", str(directory), "remote", "get-url", "origin"])
                match = re.fullmatch(r"(?:https://github.com/|git@github.com:)([\w.-]+/[\w.-]+?)(?:\.git)?", remote)
                if not match:
                    raise ValueError("Pass --repo OWNER/REPO for this private checkout.")
                repo = match[1]
            if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
                raise ValueError("Use a GitHub OWNER/REPO name, without credentials or a URL.")
            if run(["gh", "repo", "view", repo, "--json", "isPrivate", "--jq", ".isPrivate"]) != "true":
                raise ValueError("Content repository must be PRIVATE.")
            if directory.exists():
                remote = run(["git", "-C", str(directory), "remote", "get-url", "origin"])
                if remote not in (
                    f"https://github.com/{repo}.git",
                    f"https://github.com/{repo}",
                    f"git@github.com:{repo}.git",
                ):
                    raise ValueError("Existing checkout belongs to a different repository.")
                if args.update:
                    if run(["git", "-C", str(directory), "status", "--porcelain"]):
                        raise ValueError("Save private content changes before updating.")
                    run(["git", "-C", str(directory), "pull", "--ff-only"])
            else:
                directory.parent.mkdir(parents=True, exist_ok=True)
                run(["gh", "repo", "clone", repo, str(directory)])
                directory.chmod(0o700)
    # Validate everything before changing the shared local selection.
    sources, _ = web_sources(content_pack=directory, instruments=True)
    if not (directory / "desktop/icon.png").is_file():
        raise ValueError("Private content needs desktop/icon.png.")
    if not args.check:
        configure(directory)
    print(f"Private content ready: {sum(name.endswith(('.wav', '.flac')) for name in sources)} recordings verified.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from None
