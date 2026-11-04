import http.client
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest

import app
from content_pack import load_pack
from desktop.stage_web import stage_web


class ContentPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pack = self.root / "pack"
        self.pack.mkdir()
        self.data = {
            "version": 1,
            "presets": [{"id": "fixture", "project": {"patterns": []}}],
            "assets": ["samples/fixture.wav"],
        }
        (self.pack / "samples").mkdir()
        (self.pack / "samples/fixture.wav").write_bytes(b"RIFFtest")
        (self.pack / "archive.txt").write_text("private archive")
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        (self.pack / "pack.json").write_text(json.dumps(self.data))

    def test_rejects_undeclared_paths_and_symlink_escape(self):
        for name in ["../archive.txt", "samples/../archive.txt", "samples/fixture.wav?x", "/samples/fixture.wav"]:
            self.data["assets"] = [name]
            self.save()
            with self.assertRaises(ValueError):
                load_pack(self.pack)
        self.data["assets"] = ["samples/escape.wav"]
        (self.pack / "samples/escape.wav").symlink_to(self.pack.parent / "outside.wav")
        (self.pack.parent / "outside.wav").write_bytes(b"outside")
        self.save()
        with self.assertRaises(ValueError):
            load_pack(self.pack)

    def test_checksums_detect_changed_audio_without_disclosing_storage_metadata(self):
        self.data["checksums"] = {"samples/fixture.wav": hashlib.sha256(b"RIFFtest").hexdigest()}
        self.save()
        script, _ = load_pack(self.pack)
        self.assertNotIn(b"checksums", script)
        self.assertNotIn(b"assets", script)
        (self.pack / "samples/fixture.wav").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            load_pack(self.pack)

    def test_server_serves_only_selected_pack_assets_and_supports_ranges(self):
        server = app.make_server(0, self.root / "data", content_pack=self.pack)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        try:

            def request(path, headers=None):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    connection.request("GET", path, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, response.read()
                finally:
                    connection.close()

            self.assertIn(b"AfterhoursPresets.register", request("/content-packs.js")[1])
            self.assertEqual(request("/samples/fixture.wav", {"Range": "bytes=0-3"}), (206, b"RIFF"))
            for path in ["/archive.txt", "/pack.json", "/samples/%2e%2e/archive.txt"]:
                self.assertEqual(request(path)[0], 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_public_stage_ignores_local_audio_and_private_stage_includes_only_declared_assets(self):
        source = self.root / "source"
        (source / "web/samples").mkdir(parents=True)
        (source / "desktop").mkdir()
        (source / "web/index.html").write_text("public")
        (source / "web/content-packs.js").write_text("// public")
        (source / "web/samples/unlisted.wav").write_bytes(b"private")
        (source / "desktop/web-assets.json").write_text(json.dumps(["index.html", "content-packs.js"]))
        public = self.root / "public"
        stage_web(public, root=source)
        self.assertEqual(sorted(p.name for p in public.iterdir()), ["content-packs.js", "index.html"])
        private = self.root / "private"
        stage_web(private, root=source, content_pack=self.pack)
        self.assertEqual((private / "samples/fixture.wav").read_bytes(), b"RIFFtest")
        self.assertFalse((private / "archive.txt").exists())
        self.assertFalse((private / "samples/unlisted.wav").exists())
        with self.assertRaises(FileExistsError):
            stage_web(private, root=source)

    def test_private_stage_bundles_manifest_recordings_and_rejects_missing_files(self):
        source = self.root / "source"
        bank = source / "web/instruments/fixture"
        bank.mkdir(parents=True)
        (source / "desktop").mkdir()
        sample = "a" * 24 + ".flac"
        (bank / "manifest.json").write_text(json.dumps({"regions": [{"sample": sample}]}))
        (source / "desktop/web-assets.json").write_text(json.dumps(["instruments/fixture/manifest.json"]))
        with self.assertRaises(FileNotFoundError):
            stage_web(self.root / "missing-bank", root=source, content_pack=self.pack, instruments=True)
        (bank / sample).write_bytes(b"fLaCfixture")
        public = self.root / "public-bank"
        stage_web(public, root=source)
        self.assertFalse((public / "instruments/fixture" / sample).exists())
        private = self.root / "private-bank"
        stage_web(private, root=source, content_pack=self.pack, instruments=True)
        self.assertEqual((private / "instruments/fixture" / sample).read_bytes(), b"fLaCfixture")
        self.assertIn(b"AfterhoursPresets.register", (private / "content-packs.js").read_bytes())

    def test_private_build_refuses_missing_sample_lanes(self):
        self.data["presets"][0]["project"]["patterns"] = [
            {"tracks": [{"machine": "Sample", "sample": {"id": "missing"}}]}
        ]
        self.save()
        with self.assertRaisesRegex(ValueError, "samples/missing.wav"):
            stage_web(self.root / "build", content_pack=self.pack)

    def test_private_instrument_assets_are_served_and_staged_without_installing_into_public_web(self):
        relative = "instruments/fixture/" + "a" * 24 + ".flac"
        audio = self.pack / relative
        audio.parent.mkdir(parents=True)
        audio.write_bytes(b"fLaCfixture")
        self.data["assets"].append(relative)
        self.save()
        script, assets = load_pack(self.pack)
        self.assertEqual(assets[relative], audio.resolve())
        server = app.make_server(0, self.root / "data", content_pack=self.pack)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request("GET", "/" + relative, headers={"Range": "bytes=0-3"})
            response = connection.getresponse()
            self.assertEqual((response.status, response.read()), (206, b"fLaC"))
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        stage_web(self.root / "build", content_pack=self.pack)
        self.assertEqual((self.root / "build" / relative).read_bytes(), b"fLaCfixture")
