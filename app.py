#!/usr/bin/env python3
"""AFTERHOURS: a loopback-only music listening room."""

import argparse
from ardour import Ardour, ArdourError
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import threading
from urllib.parse import unquote, urlsplit
import uuid
import beatsync

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("music_audio", ROOT / ".agents/skills/music-analysis/scripts/audio.py")
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)
MAX_UPLOAD = 100 * 1024 * 1024
MAX_DURATION = 20 * 60
AUDIO_MODEL = "gpt-audio-1.5"
EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".aiff", ".aif"}
FEATURE_KEYS = {
    "analysis_method",
    "start_seconds",
    "duration_seconds",
    "file_duration_seconds",
    "sample_rate",
    "channels",
    "peak_dbfs",
    "rms_dbfs",
    "crest_factor_db",
    "estimated_bpm",
    "tempo_half_double_candidates",
    "frequency_band_power_fractions",
    "energy_windows",
    "limitations",
}


def read_json(path, fallback=None):
    try:
        if path.stat().st_size > 3 * 1024 * 1024:
            return fallback
        return json.loads(path.read_text())
    except (OSError, ValueError, UnicodeError):
        return fallback


def write_json(path, data):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False))
    temporary.replace(path)


def public_features(data):
    return {k: v for k, v in data.items() if k in FEATURE_KEYS} if isinstance(data, dict) else {}


class Studio:
    def __init__(self, root=ROOT):
        self.daw = Ardour()
        self.root = Path(root)
        self.tracks_dir = self.root / ".context/tracks"
        self.analysis_dir = self.root / ".context/analysis"
        self.state_dir = self.root / ".context/app"
        for directory in (self.tracks_dir, self.analysis_dir, self.state_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.cache = {}
        self.sync_cache = {}
        self.sync_lock = threading.Lock()
        self.jobs = read_json(self.state_dir / "jobs.json", [])
        for job in self.jobs:
            if job.get("status") in ("queued", "running"):
                job.update(
                    status="interrupted", error="The server stopped. Completed excerpts remain in the session report."
                )

    def key(self):
        return os.environ.get("OPENAI_API_KEY") or audio.load_api_key(self.root / ".env")

    def key_ready(self):
        try:
            return bool(self.key())
        except (audio.AudioError, OSError, UnicodeError):
            return False

    def library(self):
        entries = read_json(self.tracks_dir / "manifest.json", []) + read_json(self.state_dir / "library.json", [])
        result = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or not re.fullmatch(r"[A-Za-z0-9_-]+", str(entry.get("id", ""))):
                continue
            track_id = str(entry["id"])
            # Never accept an arbitrary filesystem path from a manifest or request.
            candidates = [
                p
                for p in self.tracks_dir.glob(track_id + ".*")
                if p.suffix.lower() in EXTENSIONS and not p.is_symlink()
            ]
            if not candidates or track_id in seen:
                continue
            seen.add(track_id)
            result.append(
                {
                    "id": track_id,
                    "title": str(entry.get("title") or candidates[0].stem)[:180],
                    "artist": str(entry.get("uploader") or "Your collection")[:100],
                    "duration": entry.get("duration"),
                    "format": candidates[0].suffix[1:].upper(),
                    "_path": candidates[0],
                }
            )
        return result

    def track(self, track_id):
        return next((t for t in self.library() if t["id"] == track_id), None)

    def public_library(self):
        return [{k: v for k, v in track.items() if k != "_path"} for track in self.library()]

    def waveform(self, track):
        import numpy as np
        import soundfile as sf

        path = track["_path"]
        stamp = (path.stat().st_mtime_ns, path.stat().st_size)
        cached = self.cache.get(track["id"])
        if cached and cached[0] == stamp:
            return cached[1]
        with sf.SoundFile(path) as source:
            if source.channels > 2 or source.samplerate > 192000 or source.frames / source.samplerate > MAX_DURATION:
                raise audio.AudioError("Supported limit: 20 minutes, stereo, and 192 kHz.")
            edges = np.linspace(0, source.frames, 361, dtype=int)
            peaks, energies = [], []
            total_power, sample_count, peak = 0.0, 0, 0.0
            for size in np.diff(edges):
                chunk = source.read(int(size), dtype="float32", always_2d=True)
                if not chunk.size:
                    peaks.append(0)
                    energies.append(None)
                    continue
                if not np.isfinite(chunk).all():
                    raise audio.AudioError("The recording contains invalid samples.")
                power = float(np.square(chunk.astype(np.float64)).sum())
                level = float(np.abs(chunk).max())
                total_power += power
                sample_count += chunk.size
                peak = max(peak, level)
                peaks.append(level)
                energies.append(audio.dbfs(math.sqrt(power / chunk.size)))
            result = {
                "waveform": [round(p / max(peak, 1e-9), 4) for p in peaks],
                "energy": energies,
                "duration": source.frames / source.samplerate,
                "sample_rate": source.samplerate,
                "channels": source.channels,
                "peak_dbfs": audio.dbfs(peak),
                "rms_dbfs": audio.dbfs(math.sqrt(total_power / sample_count)) if sample_count else None,
            }
        self.cache[track["id"]] = (stamp, result)
        return result

    def sessions(self, track):
        result = []
        source = str(track["_path"].resolve())
        for path in sorted(self.analysis_dir.glob("*.json"), reverse=True):
            data = read_json(path)
            if not isinstance(data, dict):
                continue
            method = data.get("analysis_method")
            if method not in ("audio_model", "audio_model_sections", "local_signal_features"):
                continue
            features = data.get("local_measurements", data)
            if not isinstance(features, dict):
                continue
            if data.get("source", features.get("source")) != source:
                continue
            segments = data.get("segments", [data])
            if not isinstance(segments, list):
                continue
            result.append(
                {
                    "id": path.stem,
                    "method": method,
                    "status": data.get("status", "complete"),
                    "created": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                    "segments": [
                        {
                            "model": s.get("model"),
                            "notes": s.get("listening_notes", ""),
                            "truncated": bool(s.get("response_truncated")),
                            "features": public_features(s.get("local_measurements", s)),
                        }
                        for s in segments
                        if isinstance(s, dict)
                    ],
                }
            )
        return result[:80]

    def summary(self, track):
        # Optional full-track measurements made outside the app (FFmpeg loudness, refined beat fits).
        existing = read_json(self.analysis_dir / "summaries" / (track["id"] + ".json"), {})
        if not isinstance(existing, dict) or existing.get("source") != str(track["_path"].resolve()):
            return None
        fits = existing.get("beat_time_fits", [])
        return {
            "estimated_bpm": round(sum(f["bpm_from_beat_fit"] for f in fits) / len(fits)) if fits else None,
            "loudness": existing.get("loudness_ffmpeg_loudnorm", {}),
            "bands": existing.get("band_power_fractions_welch_16384", {}),
            "quality": existing.get("source_quality"),
        }

    def detail(self, track):
        signal = self.waveform(track)
        return {
            **{k: v for k, v in track.items() if k != "_path"},
            **signal,
            "summary": self.summary(track),
            "sessions": self.sessions(track),
        }

    def add_upload(self, stream, length, filename):
        import soundfile as sf

        extension = Path(filename).suffix.lower()
        if extension not in EXTENSIONS:
            raise audio.AudioError("Choose a WAV, MP3, FLAC, OGG or AIFF recording.")
        track_id = uuid.uuid4().hex
        path = self.tracks_dir / (track_id + extension)
        try:
            with path.open("xb") as output:
                remaining = length
                while remaining:
                    block = stream.read(min(65536, remaining))
                    if not block:
                        raise audio.AudioError("Upload interrupted. Please try again.")
                    output.write(block)
                    remaining -= len(block)
            try:
                with sf.SoundFile(path) as source:
                    duration = source.frames / source.samplerate
                    if not 0.25 <= duration <= MAX_DURATION or source.channels > 2 or source.samplerate > 192000:
                        raise audio.AudioError(
                            "Choose a recording from 0.25 seconds to 20 minutes, mono or stereo, up to 192 kHz."
                        )
            except sf.LibsndfileError:
                raise audio.AudioError("This file could not be decoded. Choose a valid audio recording.") from None
            audio.load_excerpt(path, 0, 0.25)
            entry = {
                "id": track_id,
                "title": Path(filename).stem[:180],
                "uploader": "Your collection",
                "duration": duration,
            }
            with self.lock:
                library = read_json(self.state_dir / "library.json", [])
                write_json(self.state_dir / "library.json", library + [entry])
            return track_id
        except Exception:
            path.unlink(missing_ok=True)
            raise

    def beat_grid(self, track):
        path = track["_path"]
        stamp = (path.stat().st_mtime_ns, path.stat().st_size)
        # One analysis at a time; repeated clicks/tabs reuse the result.
        with self.sync_lock:
            cached = self.sync_cache.get(track["id"])
            if cached and cached[0] == stamp:
                return cached[1]
            try:
                grid = beatsync.detect(path)
            except ValueError as error:
                raise audio.AudioError(str(error)) from None
            self.sync_cache[track["id"]] = (stamp, grid)
            return grid

    def start_job(self, track, mode, start=0.0, duration=60.0):
        if mode not in ("whole", "excerpt", "local"):
            raise audio.AudioError("Choose a supported analysis mode.")
        if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or not 0.25 <= duration <= 120:
            raise audio.AudioError("Use a valid start and a duration between 0.25 and 120 seconds.")
        audio.load_excerpt(track["_path"], 0 if mode == "whole" else start, 0.25)
        if mode != "local" and not self.key_ready():
            raise audio.AudioError("Set OPENAI_API_KEY in the workspace .env file, then try again.")
        with self.lock:
            if any(j["status"] in ("queued", "running") for j in self.jobs):
                raise audio.AudioError("An analysis is already running. Wait for it to finish.")
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id,
                "track_id": track["id"],
                "mode": mode,
                "status": "queued",
                "created": datetime.now(timezone.utc).isoformat(),
                "report_id": "studio-" + job_id,
                "start": start,
                "duration": duration,
            }
            self.jobs.insert(0, job)
            self.jobs = self.jobs[:100]
            write_json(self.state_dir / "jobs.json", self.jobs)
        threading.Thread(target=self.run_job, args=(job, track), daemon=True).start()
        return dict(job)

    def run_job(self, job, track):
        try:
            with self.lock:
                job["status"] = "running"
                write_json(self.state_dir / "jobs.json", self.jobs)
            path = self.analysis_dir / (job["report_id"] + ".json")
            if job["mode"] == "whole":
                audio.listen_whole(track["_path"], AUDIO_MODEL, self.key(), path)
            else:
                samples, rate, metadata = audio.load_excerpt(track["_path"], job["start"], job["duration"])
                result = audio.measure(samples, rate, metadata)
                if job["mode"] == "excerpt":
                    result = audio.listen(samples, rate, result, AUDIO_MODEL, api_key=self.key())
                with path.open("x", encoding="utf-8") as output:
                    json.dump(result, output, ensure_ascii=False, allow_nan=False)
            with self.lock:
                job["status"] = "complete"
        except audio.AudioError as error:
            with self.lock:
                job.update(status="failed", error=str(error))
        except Exception:
            # Provider exceptions and credentials must never reach HTTP responses or logs.
            with self.lock:
                job.update(
                    status="failed",
                    error="Analysis could not finish. Check the recording, API access and quota. Saved excerpts are preserved.",
                )
        finally:
            with self.lock:
                write_json(self.state_dir / "jobs.json", self.jobs)

    def public_jobs(self):
        with self.lock:
            return [dict(j) for j in self.jobs]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    @property
    def studio(self):
        return self.server.studio

    def allowed_host(self):
        port = self.server.server_address[1]
        token = self.server.desktop_token
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}") and (
            not token or hmac.compare_digest(self.headers.get("X-Afterhours-Token", ""), token)
        )

    def headers_for(self, status, content_type, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.headers_for(status, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def serve_file(self, path, media=False):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        extra = {"Accept-Ranges": "bytes"} if media else {}
        if media and self.headers.get("Range"):
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers["Range"])
            if not match or not any(match.groups()):
                self.headers_for(416, "text/plain", 0, {"Content-Range": f"bytes */{size}"})
                return
            left, right = match.groups()
            start = int(left) if left else max(0, size - int(right))
            end = min(int(right), size - 1) if left and right else size - 1
            if start >= size or end < start:
                self.headers_for(416, "text/plain", 0, {"Content-Range": f"bytes */{size}"})
                return
            status = 206
            extra["Content-Range"] = f"bytes {start}-{end}/{size}"
        self.headers_for(
            status, mimetypes.guess_type(path.name)[0] or "application/octet-stream", end - start + 1, extra
        )
        with path.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                block = source.read(min(65536, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)

    def do_GET(self):
        try:
            if not self.allowed_host():
                return self.json({"error": "Local access only."}, 421)
            path = urlsplit(self.path).path
            if path == "/":
                return self.serve_file(ROOT / "web/index.html")
            if path == "/content-packs.js" and self.server.content_script is not None:
                body = self.server.content_script
                self.headers_for(200, "text/javascript; charset=utf-8", len(body))
                self.wfile.write(body)
                return
            if path[1:] in self.server.content_assets:
                return self.serve_file(self.server.content_assets[path[1:]], True)
            # Top-level web assets by name only: no directories, dot-files or other file types.
            asset = re.fullmatch(r"/([a-z0-9-]+\.(?:js|css|svg))", path)
            if asset and (ROOT / "web" / asset[1]).is_file():
                return self.serve_file(ROOT / "web" / asset[1])
            font = re.fullmatch(r"/fonts/([a-z0-9-]+\.woff2)", path)
            if font and (ROOT / "web/fonts" / font[1]).is_file():
                return self.serve_file(ROOT / "web/fonts" / font[1])
            sample = re.fullmatch(r"/samples/([a-z0-9-]{1,64}\.wav)", path)
            if sample and (ROOT / "web/samples" / sample[1]).is_file():
                return self.serve_file(ROOT / "web/samples" / sample[1], True)
            instrument = re.fullmatch(r"/instruments/([a-z0-9-]{1,40})/(manifest\.json|[a-f0-9]{24}\.flac)", path)
            if instrument:
                asset_path = ROOT / "web/instruments" / instrument[1] / instrument[2]
                if asset_path.is_file():
                    return self.serve_file(asset_path, instrument[2].endswith(".flac"))
            if path in ("/api/daw", "/api/daw/state"):
                try:
                    if path.endswith("/state"):
                        return self.json(self.studio.daw.call("session_get_info"))
                    return self.json(self.studio.daw.snapshot())
                except ArdourError as error:
                    return self.json({"connected": False, "message": str(error)})
            if path == "/api/library":
                return self.json(
                    {
                        "tracks": self.studio.public_library(),
                        "key_ready": self.studio.key_ready(),
                        "jobs": self.studio.public_jobs(),
                    }
                )
            if path == "/api/jobs":
                return self.json({"jobs": self.studio.public_jobs()})
            match = re.fullmatch(r"/api/tracks/([A-Za-z0-9_-]+)(/audio)?", path)
            if match:
                track = self.studio.track(match[1])
                if track:
                    return self.serve_file(track["_path"], True) if match[2] else self.json(self.studio.detail(track))
            return self.json({"error": "Not found."}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except audio.AudioError as error:
            self.json({"error": str(error)}, 400)
        except Exception:
            self.json({"error": "Could not load this resource."}, 500)

    def do_POST(self):
        try:
            port = self.server.server_address[1]
            origins = (f"http://127.0.0.1:{port}", f"http://localhost:{port}")
            if not self.allowed_host() or self.headers.get("Origin") not in origins:
                self.close_connection = True
                return self.json({"error": "Requests must originate from this local app."}, 403)
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            path = urlsplit(self.path).path
            limit = MAX_UPLOAD if path == "/api/tracks" else 4096
            if not 0 < length <= limit:
                self.close_connection = True
                return self.json(
                    {"error": "File too large. Maximum upload is 100 MB." if length > limit else "Empty request."}, 413
                )
            self.connection.settimeout(60)
            if path == "/api/tracks":
                filename = unquote(self.headers.get("X-Filename", "recording.wav"))
                track_id = self.studio.add_upload(self.rfile, length, filename)
                return self.json({"id": track_id}, 201)
            if path == "/api/daw":
                data = json.loads(self.rfile.read(length))
                return self.json(self.studio.daw.command(data))
            match = re.fullmatch(r"/api/tracks/([A-Za-z0-9_-]+)/sync", path)
            if match:
                self.rfile.read(length)
                track = self.studio.track(match[1])
                if not track:
                    return self.json({"error": "Track not found."}, 404)
                return self.json(self.studio.beat_grid(track))
            if path == "/api/jobs":
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Expected an object")
                track = self.studio.track(str(data.get("track_id", "")))
                if not track:
                    return self.json({"error": "Track not found."}, 404)
                job = self.studio.start_job(
                    track, data.get("mode"), float(data.get("start", 0)), float(data.get("duration", 60))
                )
                return self.json(job, 202)
            self.close_connection = True
            return self.json({"error": "Not found."}, 404)
        except ArdourError as error:
            self.json({"error": str(error)}, 503)
        except (audio.AudioError, ValueError, TypeError) as error:
            self.close_connection = True
            message = str(error) if isinstance(error, audio.AudioError) else "Invalid request."
            self.json({"error": message}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.close_connection = True
            self.json({"error": "The request could not be completed."}, 500)


def make_server(port=8765, root=ROOT, *, desktop_token=None, content_pack=None):
    from content_pack import load_pack

    script, assets = load_pack(content_pack) if content_pack else (None, {})
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.desktop_token = desktop_token
    server.content_script = script
    server.content_assets = assets
    server.studio = Studio(root)
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--content-pack", type=Path, help="Explicitly load a separate private content repository")
    parser.add_argument("--public", action="store_true", help="Ignore local private content configuration")
    args = parser.parse_args()
    if args.public and args.content_pack:
        parser.error("--public and --content-pack cannot be combined")
    try:
        if not args.public and not args.content_pack:
            from local_content import configured_pack

            args.content_pack = configured_pack()
        server = make_server(args.port, content_pack=args.content_pack)
    except (FileNotFoundError, ValueError) as error:
        raise SystemExit(f"Content unavailable: {error}") from None
    except OSError:
        raise SystemExit("Port unavailable. Try: bash start.sh --port 8766") from None
    print(f"AFTERHOURS is ready at http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
