"""Offline regression tests for verified, retryable SDK archive downloads."""

import ast
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import unittest
import urllib.error
import urllib.parse


class ProvisionSDKTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.cache = self.base / "cache"
        self.root = self.base / "sdk"
        self.cache.mkdir()
        self.root.mkdir()
        body = io.BytesIO()
        with tarfile.open(fileobj=body, mode="w:gz") as archive:
            member = tarfile.TarInfo("fixture/1.0/data.txt")
            member.size = 2
            archive.addfile(member, io.BytesIO(b"ok"))
        self.body = body.getvalue()
        self.downloads = 0
        self.response = lambda: io.BytesIO(self.body)
        self.formula = {
            "name": "fixture",
            "bottle": {
                "stable": {
                    "files": {
                        "all": {
                            "url": "https://example.invalid/fixture",
                            "sha256": hashlib.sha256(self.body).hexdigest(),
                        }
                    }
                }
            },
        }
        # Load the actual installer without the CLI's platform/network bootstrap.
        source = Path(__file__).resolve().parents[1] / "scripts/ardour/provision-sdk.py"
        function = next(
            node
            for node in ast.parse(source.read_text()).body
            if isinstance(node, ast.FunctionDef) and node.name == "install"
        )
        namespace = dict(
            cache=self.cache,
            root=self.root,
            request=self.request,
            hashlib=hashlib,
            shutil=shutil,
            re=re,
            json=json,
            tarfile=tarfile,
            Path=Path,
            urllib=urllib,
        )
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        self.install = namespace["install"]

    def request(self, url, headers=None):
        self.downloads += 1
        return self.response()

    def assert_installed(self):
        self.install(self.formula)
        self.assertEqual((self.root / "Cellar/fixture/1.0/data.txt").read_text(), "ok")
        self.assertTrue((self.cache / "fixture.installed").exists())
        self.assertEqual((self.cache / "fixture.tar.gz").read_bytes(), self.body)

    def test_corrupt_existing_archive_is_downloaded_again(self):
        (self.cache / "fixture.tar.gz").write_bytes(b"truncated")
        self.assert_installed()
        self.assertEqual(self.downloads, 1)

    def test_interrupted_download_leaves_no_archive_and_can_retry(self):
        class Interrupted(io.BytesIO):
            def read(self, size=-1):
                if self.tell():
                    raise OSError("interrupted download")
                return super().read(8)

        self.response = lambda: Interrupted(self.body)
        with self.assertRaises(OSError):
            self.install(self.formula)
        self.assertEqual(list(self.cache.iterdir()), [])
        self.response = lambda: io.BytesIO(self.body)
        self.assert_installed()
        self.assertEqual(self.downloads, 2)

    def test_checksum_failure_leaves_no_archive_and_can_retry(self):
        self.response = lambda: io.BytesIO(b"invalid archive")
        with self.assertRaisesRegex(RuntimeError, "Checksum failed"):
            self.install(self.formula)
        self.assertEqual(list(self.cache.iterdir()), [])
        self.response = lambda: io.BytesIO(self.body)
        self.assert_installed()
        self.assertEqual(self.downloads, 2)


if __name__ == "__main__":
    unittest.main()
