# Listen and AI

**Listen** is the listening room: import a recording, play it, loop a passage and shape it with live effects. **AI** measures or describes what is in the recording, either locally for free or through a paid audio model that you start explicitly. This page covers both workspaces and where the API key comes from.

## Import a recording

In **Listen**, press **Import** in the **Library** panel and choose a file.

| Limit | Value |
| --- | --- |
| Formats | WAV, MP3, FLAC, OGG or AIFF |
| File size | Up to 100 MB |
| Length | Up to 20 minutes |
| Channels | Mono or stereo |
| Sample rate | Up to 192 kHz |

Browser playback support varies; WAV and MP3 are the safest choices.

## The player

- Click the waveform to seek.
- The played part of the waveform is tinted.
- The **Speed** slider changes the playback speed, and **Vol** sets the player volume.
- With Recording as the active engine, `Space` toggles playback outside form controls. See [Interface](interface.md#the-strip-and-its-engines) for engines and the strip.

### A–B loop

1. Press **A** at the playhead to set the loop start.
2. Move forward.
3. Press **B** to arm the loop.

The loop band is marked on the wave. The loop chip toggles the loop on and off, and double-clicking it clears both points.

## Live effects

Press Play and move the controls in **Live effects**. A streaming Web Audio graph applies the effects immediately during playback:

- low-pass filtering and resonance;
- bass/treble EQ;
- parallel distortion;
- feedback echo.

| Control | What it does |
| --- | --- |
| XY pad | Filter cutoff (horizontal) and echo mix (vertical). Arrow keys work too. |
| **Dark room**, **Dub echo**, **Dirty tape** | Presets, meant as starting points. |
| **Original** | Compares the processed mix with an unprocessed path. |
| **Reset** | Clears settings and echo tails. |

How it behaves:

- Parameters transition over about 45 ms to avoid abrupt jumps.
- Changing echo time deliberately bends the repeats.
- A compressor on the processed path controls large peaks.
- Pause silences the echo.
- Switching recordings clears the graph's delay memory and resets controls.

### Limits

- Effects run in the browser on this Mac, with no API calls.
- They affect the entire mix, rather than isolated instruments.
- The original audio, signal measurements and AI reports remain unchanged.
- **Export session** includes the current effect settings in JSON, but does **not** render processed audio or record knob movements.
- Settings reset when the page reloads or you select a recording.

## AI listening modes

Listening modes are cards in **AI**.

| Mode | What it covers | Where it runs | Cost |
| --- | --- | --- | --- |
| **Local scan** | Measures the selected excerpt. | On this Mac. No API key or audio upload is needed. | Free |
| **Selected excerpt** | Sends up to 120 seconds for musical feedback. | OpenAI Audio API | Paid |
| **Whole track** | Covers the entire recording in independent excerpts of up to 120 seconds with 5 seconds of overlap. | OpenAI Audio API | Paid |

For **Selected excerpt**, **Use A–B loop** copies the armed loop into the excerpt fields.

### Limits

- Local scan: tempo estimates can have half-time or double-time ambiguity.
- Whole track: this is not one continuous model context.
- Whole track: completed excerpts are saved even if a later request fails.

## Cost and consent

- New audio-model listening starts only when you press **Send**.
- The **Before you send** card shows the destination and request count.
- No automatic retries are made.
- API billing is separate from a Codex subscription.
- Existing sessions are free to browse in the **Saved** list; each shows how many paid requests it used.
- Audio API requests need an API key; see [API key](#api-key). Paid listening is optional, and local features work without a key.

## Reports and saved sessions

- A report shows what the model heard per excerpt, with a timestamp button that jumps the player there, plus experiment checkboxes.
- Experiment checkboxes are remembered in this browser.
- **New listen** returns to the mode cards.
- The **Saved** list holds existing sessions, which are free to browse.
- Export saves the selected session as JSON. It includes the current [live effect](#live-effects) settings.

### Loudness and beat measurements

A track with a summary file shows its full-track FFmpeg loudness (LUFS, true peak) and refined beat timing. Other tracks show sample RMS and sample peak instead. These are different measurements; they are labeled separately.

A summary file is an optional full-track measurement made outside the app, stored as `.context/analysis/summaries/<track id>.json`. The summary is used only when its `source` is that recording's path. See [local files](../development.md#local-files) for the other local folders.

## API key

Paid listening needs an OpenAI API key.

- The server reads `OPENAI_API_KEY` from the workspace `.env` file, or from its process environment.
- It reads only that key from `.env` as data; it does not execute the file.
- Keep the file private and excluded from Git.
- The browser receives only a configured/not-configured status, never the key.
- Never paste credentials into chat or frontend code.

The existing CLI can prompt for and save the key through hidden terminal input; see [the music-analysis skill](../../.agents/skills/music-analysis/SKILL.md).

The desktop app reads the key from a different place; see [the desktop app](../desktop.md#api-key).

## The local server

The server is local-only and is intended for one person on this Mac; binding details are in [Development](../development.md#server-binding).

- Keep it running while listening or analyzing.
- Restarting interrupts active work; completed whole-track excerpts remain available.
- A running job may finish after the browser closes.
