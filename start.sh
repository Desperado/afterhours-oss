#!/bin/bash
set -eu
workspace_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
venv_python="$workspace_dir/.context/music-analysis-venv/bin/python"
if [ ! -x "$venv_python" ]; then
    printf '%s\n' 'Set up the music-analysis environment first. See README.md.' >&2
    exit 1
fi
exec "$venv_python" "$workspace_dir/app.py" "$@"
