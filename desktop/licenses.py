"""Preserve installed dependency notices in the standalone Python bundle."""

import argparse
from importlib.metadata import distributions
import json
from pathlib import Path
import shutil
import sys
import sysconfig


def stage_licenses(destination, packages=None, python_license=None):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    inventory = []
    for package in sorted(
        packages if packages is not None else distributions(), key=lambda p: p.metadata["Name"].lower()
    ):
        name = package.metadata["Name"]
        if not name or any(
            char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in name
        ):
            raise ValueError("Invalid dependency name")
        notices = []
        for item in package.files or []:
            if not item.name.lower().startswith(("license", "licence", "copying", "notice", "authors")):
                continue
            if item.is_absolute() or ".." in item.parts:
                raise ValueError(f"Invalid notice path for {name}")
            source = Path(package.locate_file(item))
            if not source.is_file():
                raise ValueError(f"Missing notice for {name}")
            target = destination / name / item
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            notices.append(str(target.relative_to(destination)))
        if not notices:
            raise ValueError(f"No license notice installed for {name}")
        inventory.append({"name": name, "version": package.version, "notices": notices})
    source = Path(python_license) if python_license else Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
    shutil.copyfile(source, destination / "PYTHON-LICENSE.txt")
    (destination / "inventory.json").write_text(
        json.dumps({"python": sys.version.split()[0], "build_environment": inventory}, indent=2) + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    stage_licenses(parser.parse_args().destination)
