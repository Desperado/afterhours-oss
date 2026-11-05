import json
from importlib.metadata import PackagePath
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from types import SimpleNamespace

from desktop.licenses import stage_licenses


class DesktopLicensesTests(unittest.TestCase):
    def test_preserves_notices_and_exact_versions(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "COPYING.LGPL").write_text("upstream license")
            (root / "python.txt").write_text("Python license")
            package = SimpleNamespace(
                metadata={"Name": "example"},
                version="1.2.3",
                files=[PackagePath("COPYING.LGPL")],
                locate_file=lambda item: root / item,
            )
            target = root / "notices"
            stage_licenses(target, [package], root / "python.txt")
            self.assertEqual((target / "example/COPYING.LGPL").read_text(), "upstream license")
            self.assertEqual((target / "PYTHON-LICENSE.txt").read_text(), "Python license")
            inventory = json.loads((target / "inventory.json").read_text())
            self.assertEqual(
                inventory["build_environment"],
                [{"name": "example", "version": "1.2.3", "notices": ["example/COPYING.LGPL"]}],
            )

    def test_rejects_missing_notices_and_paths_outside_package(self):
        for files in [[], [PackagePath("../LICENSE")]]:
            with self.subTest(files=files), TemporaryDirectory() as directory:
                package = SimpleNamespace(metadata={"Name": "example"}, version="1", files=files)
                with self.assertRaises(ValueError):
                    stage_licenses(Path(directory) / "notices", [package])
