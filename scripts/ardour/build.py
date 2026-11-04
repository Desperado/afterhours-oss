"""Configure or compile the pinned native fork against the isolated ARM64 SDK."""

import os
from pathlib import Path
import subprocess
import sys

from sdk_link import sdk as sdk_link

context = Path(__file__).resolve().parents[2] / ".context"
sdk = sdk_link()
env = os.environ.copy()
env.update(
    CC="/usr/bin/clang",
    CXX="/usr/bin/clang++",
    PKG_CONFIG="/usr/local/bin/pkg-config",
    PKG_CONFIG_PATH="",
    PKG_CONFIG_LIBDIR=":".join(
        str(p) for pattern in ("opt/*/lib/pkgconfig", "opt/*/share/pkgconfig") for p in sorted(sdk.glob(pattern))
    ),
    MACOSX_DEPLOYMENT_TARGET="15.0",
)
args = sys.argv[1:] or [
    "configure",
    "--arm64",
    "--strict",
    "--ptformat",
    "--libjack=weak",
    "--optimize",
    "--no-phone-home",
    "--with-backends=coreaudio,dummy",
    "--boost-include=" + str(sdk / "opt/boost/include"),
    "--also-include=" + ",".join(str(p) for p in sorted(sdk.glob("opt/*/include")) if p.is_dir()),
    "--also-libdir=" + ",".join(str(p) for p in sorted(sdk.glob("opt/*/lib")) if p.is_dir()),
    "--noconfirm",
]
sys.exit(subprocess.call([sys.executable, "./waf", *args], cwd=context / "ardour-fork", env=env))
