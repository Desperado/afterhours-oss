"""Shared check for the short SDK path that relocated Homebrew bottles require."""

import os
from pathlib import Path

LINK = Path("/tmp/afterhours-sdk")
REAL = Path(__file__).resolve().parents[2] / ".context/sdk"


def sdk(create=False):
    # /tmp is shared and cleared on reboot; only trust a link this user made to this workspace.
    if create and not LINK.is_symlink() and not LINK.exists():
        REAL.mkdir(parents=True, exist_ok=True)
        LINK.symlink_to(REAL, target_is_directory=True)
    if not LINK.is_symlink() or os.lstat(LINK).st_uid != os.getuid() or LINK.resolve() != REAL.resolve():
        raise SystemExit(
            f"{LINK} is missing or belongs to another workspace or user. "
            "Preserve that build, remove the link, then run scripts/ardour/provision-sdk.py."
        )
    return LINK
