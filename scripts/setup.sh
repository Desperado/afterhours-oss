#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
venv_python="$PWD/.context/music-analysis-venv/bin/python"
if [ ! -x "$venv_python" ]; then
    python3.11 -m venv .context/music-analysis-venv
fi
"$venv_python" -m pip install -r .agents/skills/music-analysis/requirements.txt -r desktop/requirements-build.txt -r requirements-dev.txt
npm ci
"$venv_python" scripts/setup-private.py --check
printf '%s\n' 'Ready. Run npm run desktop or npm run desktop:dist.'
