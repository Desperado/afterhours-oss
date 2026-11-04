import http.client
import json
import re
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

import app


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        tracks = self.root / ".context/tracks"
        tracks.mkdir(parents=True)
        self.recording = tracks / "reference.wav"
        sf.write(self.recording, 0.2 * np.sin(np.arange(16000) * 2 * np.pi * 220 / 16000), 16000)
        app.write_json(tracks / "manifest.json", [{"id": "reference", "title": "Reference", "duration": 1}])
        self.key_patch = patch.object(app.Studio, "key", return_value=None)
        self.key_patch.start()
        self.server = app.make_server(0, self.root)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.studio = self.server.studio
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def test_local_sample_route_supports_ranges_and_rejects_paths(self):
        samples = self.root / "web/samples"
        samples.mkdir(parents=True)
        (samples / "test-stem.wav").write_bytes(self.recording.read_bytes())
        with patch.object(app, "ROOT", self.root):
            status, headers, body = self.request("GET", "/samples/test-stem.wav", headers={"Range": "bytes=0-43"})
            self.assertEqual(status, 206)
            self.assertEqual(len(body), 44)
            self.assertEqual(body[:4], b"RIFF")
            for path in ["/samples/missing.wav", "/samples/../reference.wav", "/samples/%2e%2e/reference.wav"]:
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_instrument_route_serves_only_maps_and_recordings(self):
        folder = self.root / "web/instruments/growlybass"
        folder.mkdir(parents=True)
        (folder / "manifest.json").write_text('{"version":1}')
        filename = "a" * 24 + ".flac"
        (folder / filename).write_bytes(b"fLaC" + b"x" * 100)
        with patch.object(app, "ROOT", self.root):
            self.assertEqual(self.request("GET", "/instruments/growlybass/manifest.json")[0], 200)
            status, _, data = self.request("GET", f"/instruments/growlybass/{filename}", headers={"Range": "bytes=0-3"})
            self.assertEqual((status, data), (206, b"fLaC"))
            for path in [
                "/instruments/growlybass/missing.flac",
                "/instruments/../app.py",
                "/instruments/growlybass/%2e%2e/manifest.json",
            ]:
                self.assertEqual(self.request("GET", path)[0], 404)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.key_patch.stop()
        self.temporary.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(self, path, data):
        return self.request("POST", path, json.dumps(data), {"Origin": self.origin, "Content-Type": "application/json"})

    def wait_job(self, job):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = next(item for item in self.studio.public_jobs() if item["id"] == job["id"])
            if current["status"] not in ("running", "queued"):
                return current
            time.sleep(0.01)
        self.fail("Analysis did not finish")

    def test_library_reports_key_presence_without_value_or_paths(self):
        with patch.object(self.studio, "key", return_value="test-placeholder"):
            status, _, body = self.request("GET", "/api/library")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data["key_ready"])
        self.assertEqual(data["tracks"][0]["id"], "reference")
        self.assertNotIn(b"test-placeholder", body)
        self.assertNotIn(str(self.root).encode(), body)
        for path in ("/.env", "/.context/tracks/manifest.json", "/../app.py"):
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_self_hosted_fonts_are_served_without_exposing_other_files(self):
        status, headers, body = self.request("GET", "/fonts/jetbrains-mono.woff2")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "font/woff2")
        self.assertEqual(body[:4], b"wOF2")
        for path in (
            "/fonts/OFL-JetBrainsMono.txt",
            "/fonts/missing.woff2",
            "/fonts/../app.py",
            "/fonts/%2e%2e/app.py",
        ):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_every_page_asset_is_served_and_nothing_else_from_the_checkout(self):
        page = (app.ROOT / "web/index.html").read_text()
        assets = re.findall(r'(?:src|href)="(/[^"/]+\.(?:js|css|svg))"', page)
        self.assertGreater(len(assets), 20)
        for asset in assets:
            status, _, body = self.request("GET", asset)
            self.assertEqual(status, 200, asset)
            self.assertEqual(body, (app.ROOT / "web" / asset[1:]).read_bytes(), asset)
        for path in ("/index.html", "/app.py", "/README.md", "/web/app.js", "/.prettierrc.json", "/%2e%2e/app.py"):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_midi_overlay_script_is_served(self):
        status, headers, body = self.request("GET", "/groove-midi.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertEqual(body, (app.ROOT / "web/groove-midi.js").read_bytes())

    def test_cross_site_and_rebound_host_are_rejected(self):
        for origin in (None, "https://example.com"):
            headers = {"Origin": origin} if origin else {}
            self.assertEqual(self.request("POST", "/api/jobs", "{}", headers)[0], 403)
        self.assertEqual(self.request("GET", "/api/library", headers={"Host": "example.com"})[0], 421)
        self.assertEqual(
            self.request("POST", "/api/jobs", "{}", {"Origin": self.origin, "Host": "example.com"})[0], 403
        )

    def test_track_summary_is_read_per_track_and_only_for_its_source(self):
        self.assertIsNone(json.loads(self.request("GET", "/api/tracks/reference")[2])["summary"])
        summaries = self.root / ".context/analysis/summaries"
        summaries.mkdir()
        measured = {
            "source": str(self.recording.resolve()),
            "beat_time_fits": [{"bpm_from_beat_fit": 120.2}, {"bpm_from_beat_fit": 119.8}],
            "loudness_ffmpeg_loudnorm": {"input_i": "-9.1", "input_tp": "-0.4"},
            "source_quality": "WAV master",
        }
        app.write_json(summaries / "reference.json", measured)
        summary = json.loads(self.request("GET", "/api/tracks/reference")[2])["summary"]
        self.assertEqual(summary["estimated_bpm"], 120)
        self.assertEqual(summary["loudness"]["input_i"], "-9.1")
        self.assertEqual(summary["quality"], "WAV master")
        # A summary measured from another file must not describe this recording.
        app.write_json(summaries / "reference.json", {**measured, "source": "/elsewhere/reference.wav"})
        self.assertIsNone(json.loads(self.request("GET", "/api/tracks/reference")[2])["summary"])

    def test_audio_ranges_match_file_bytes(self):
        recording = self.recording.read_bytes()
        status, headers, body = self.request("GET", "/api/tracks/reference/audio", headers={"Range": "bytes=12-42"})
        self.assertEqual(status, 206)
        self.assertEqual(body, recording[12:43])
        self.assertEqual(headers["Content-Range"], f"bytes 12-42/{len(recording)}")
        self.assertEqual(
            self.request("GET", "/api/tracks/reference/audio", headers={"Range": "bytes=-20"})[2], recording[-20:]
        )
        for value in ("bytes=999999-", "bytes=20-10", "bytes=-0", "bytes=0-1,5-6"):
            self.assertEqual(self.request("GET", "/api/tracks/reference/audio", headers={"Range": value})[0], 416)

    def test_beat_sync_is_explicit_local_and_cached_until_file_changes(self):
        grid = {"bpm": 120, "beats": [i / 2 for i in range(20)], "method": "local_beat_tracking"}
        with patch.object(app.beatsync, "detect", return_value=grid) as detect:
            self.assertEqual(self.request("GET", "/api/tracks/reference/sync")[0], 404)
            self.assertEqual(self.request("POST", "/api/tracks/reference/sync", "{}")[0], 403)
            self.assertEqual(self.post("/api/tracks/missing/sync", {})[0], 404)
            detect.assert_not_called()
            for _ in range(2):
                status, _, body = self.post("/api/tracks/reference/sync", {})
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), grid)
            detect.assert_called_once_with(self.recording)
            self.recording.touch()
            self.assertEqual(self.post("/api/tracks/reference/sync", {})[0], 200)
            self.assertEqual(detect.call_count, 2)
        self.assertEqual(self.studio.public_jobs(), [])

    def test_beat_sync_reports_unusable_audio_without_caching_failure(self):
        with patch.object(app.beatsync, "detect", side_effect=ValueError("No clear beat found.")) as detect:
            for _ in range(2):
                status, _, body = self.post("/api/tracks/reference/sync", {})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body)["error"], "No clear beat found.")
            self.assertEqual(detect.call_count, 2)

    def test_import_uses_generated_path_and_persists_metadata(self):
        status, _, body = self.request(
            "POST",
            "/api/tracks",
            self.recording.read_bytes(),
            {"Origin": self.origin, "X-Filename": "..%2Fnew%20song.wav"},
        )
        self.assertEqual(status, 201)
        track_id = json.loads(body)["id"]
        track = self.studio.track(track_id)
        self.assertEqual(track["title"], "new song")
        self.assertEqual(track["_path"].parent, self.recording.parent)
        self.assertEqual(track["_path"].stem, track_id)
        self.assertEqual(len(app.Studio(self.root).library()), 2)

    def test_invalid_import_is_removed_and_has_useful_error(self):
        status, _, body = self.request(
            "POST", "/api/tracks", b"not an audio recording", {"Origin": self.origin, "X-Filename": "broken.wav"}
        )
        self.assertEqual(status, 400)
        self.assertIn("could not be decoded", json.loads(body)["error"])
        self.assertEqual(list(self.recording.parent.glob("*.wav")), [self.recording])
        self.assertEqual(
            self.request("POST", "/api/tracks", b"anything", {"Origin": self.origin, "X-Filename": "script.js"})[0], 400
        )

    def test_upload_size_is_rejected_before_reading_body(self):
        self.assertEqual(
            self.request(
                "POST", "/api/tracks", b"x", {"Origin": self.origin, "Content-Length": str(app.MAX_UPLOAD + 1)}
            )[0],
            413,
        )

    def test_bad_job_requests_do_not_start_work(self):
        for data in (
            [],
            {"track_id": "reference", "mode": "unknown"},
            {"track_id": "reference", "mode": "local", "start": -1},
            {"track_id": "reference", "mode": "local", "duration": "NaN"},
        ):
            self.assertEqual(self.post("/api/jobs", data)[0], 400)
        self.assertEqual(self.studio.public_jobs(), [])

    def test_audio_model_requires_key_and_is_never_called_on_get(self):
        with patch.object(app.audio, "listen") as listen, patch.object(app.audio, "listen_whole") as whole:
            self.assertEqual(self.request("GET", "/api/tracks/reference")[0], 200)
            self.assertEqual(self.post("/api/jobs", {"track_id": "reference", "mode": "whole"})[0], 400)
            listen.assert_not_called()
            whole.assert_not_called()

    def test_local_job_saves_a_session_without_audio_api(self):
        def measure(samples, rate, metadata):
            return {**metadata, "analysis_method": "local_signal_features", "estimated_bpm": 82}

        with patch.object(app.audio, "measure", side_effect=measure), patch.object(app.audio, "listen") as listen:
            status, _, body = self.post("/api/jobs", {"track_id": "reference", "mode": "local", "duration": 0.5})
            self.assertEqual(status, 202)
            result = self.wait_job(json.loads(body))
            self.assertEqual(result["status"], "complete")
            listen.assert_not_called()
        sessions = self.studio.sessions(self.studio.track("reference"))
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["segments"][0]["features"]["estimated_bpm"], 82)
        self.assertNotIn("source", sessions[0]["segments"][0]["features"])

    def test_partial_whole_track_report_survives_failure(self):
        def interrupted(path, model, key, output):
            app.write_json(
                output,
                {
                    "analysis_method": "audio_model_sections",
                    "source": str(path.resolve()),
                    "status": "in_progress",
                    "segments": [
                        {
                            "listening_notes": "Completed excerpt",
                            "local_measurements": {"start_seconds": 0, "duration_seconds": 0.5},
                        }
                    ],
                },
            )
            raise app.audio.AudioError("Provider request could not finish.")

        with (
            patch.object(self.studio, "key", return_value="test-placeholder"),
            patch.object(app.audio, "listen_whole", side_effect=interrupted),
        ):
            result = self.wait_job(self.studio.start_job(self.studio.track("reference"), "whole"))
        self.assertEqual(result["status"], "failed")
        sessions = self.studio.sessions(self.studio.track("reference"))
        self.assertEqual(sessions[0]["segments"][0]["notes"], "Completed excerpt")
        self.assertEqual(sessions[0]["status"], "in_progress")

    def test_only_one_analysis_runs_at_a_time(self):
        release = threading.Event()

        def measure(samples, rate, metadata):
            release.wait(timeout=3)
            return {**metadata, "analysis_method": "local_signal_features"}

        with patch.object(app.audio, "measure", side_effect=measure):
            job = self.studio.start_job(self.studio.track("reference"), "local", duration=0.5)
            try:
                with self.assertRaisesRegex(app.audio.AudioError, "already running"):
                    self.studio.start_job(self.studio.track("reference"), "local", duration=0.5)
            finally:
                release.set()
                self.assertEqual(self.wait_job(job)["status"], "complete")

    def test_restart_marks_unfinished_job_as_interrupted(self):
        app.write_json(self.studio.state_dir / "jobs.json", [{"id": "interrupted", "status": "running"}])
        self.assertEqual(app.Studio(self.root).public_jobs()[0]["status"], "interrupted")


if __name__ == "__main__":
    unittest.main()
