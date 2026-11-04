#!/bin/bash
# Run in your own Terminal. A missing key is entered privately and saved in .env.
set -eu

workspace_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
venv_python="$workspace_dir/.context/music-analysis-venv/bin/python"

if [ ! -x "$venv_python" ]; then
    printf '%s\n' 'Music-analysis environment missing. Follow setup in .agents/skills/music-analysis/SKILL.md.' >&2
    exit 1
fi

if [ "$#" -eq 1 ] && [ "$1" = "--whole-track" ]; then
    report_path="$workspace_dir/.context/analysis/drumntrick-whole-listening-$(date +%Y%m%d-%H%M%S)-$$.json"
    printf '%s\n' 'Analyze the full Drum’n’trick track in two overlapping excerpts. Uses paid OpenAI API credits.'
    printf 'Report: %s\n' "$report_path"
    set -- "$workspace_dir/.context/tracks/1036517479.mp3" --whole-track --output "$report_path"
elif [ "$#" -eq 0 ]; then
    report_path="$workspace_dir/.context/analysis/drumntrick-listening-$(date +%Y%m%d-%H%M%S)-$$.json"
    printf '%s\n' 'Analyze Drum’n’trick, 1:00–1:45. This uploads the excerpt to OpenAI and uses paid API credits.'
    printf 'Report: %s\n' "$report_path"
    set -- "$workspace_dir/.context/tracks/1036517479.mp3" --start 60 --duration 45 --output "$report_path"
fi

if [ -f "$workspace_dir/.env" ] && [ ! -L "$workspace_dir/.env" ]; then
    chmod 600 "$workspace_dir/.env"
fi

exec "$venv_python" "$workspace_dir/.agents/skills/music-analysis/scripts/audio.py" listen --env-file "$workspace_dir/.env" --save-key "$@"
