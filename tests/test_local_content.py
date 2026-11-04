import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import local_content


class LocalContentTests(unittest.TestCase):
    def test_public_source_archive_works_without_git(self):
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(local_content.subprocess, "run", side_effect=FileNotFoundError),
        ):
            self.assertIsNone(local_content.configured_pack(Path(temporary)))

    def test_selection_is_shared_between_worktrees_but_absent_in_a_fresh_repository(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app"
            root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-qm",
                    "fixture",
                    "--allow-empty",
                ],
                check=True,
            )
            sibling = Path(temporary) / "sibling"
            subprocess.run(["git", "-C", str(root), "worktree", "add", "-q", "-b", "sibling", str(sibling)], check=True)
            pack = Path(temporary) / "private"
            pack.mkdir()
            (pack / "pack.json").write_text("{}")
            self.assertIsNone(local_content.configured_pack(root))
            local_content.configure(pack, root)
            self.assertEqual(local_content.configured_pack(sibling), pack.resolve())
            self.assertEqual(local_content.settings_path(root).stat().st_mode & 0o777, 0o600)
            (pack / "pack.json").unlink()
            with self.assertRaisesRegex(ValueError, "configured but unavailable"):
                local_content.configured_pack(sibling)
            self.assertEqual(local_content.configured_pack(sibling, must_exist=False), pack.resolve())
            fresh = Path(temporary) / "fresh"
            fresh.mkdir()
            subprocess.run(["git", "init", "-q", str(fresh)], check=True)
            self.assertIsNone(local_content.configured_pack(fresh))

    def test_setup_rejects_public_repository_before_cloning_or_configuring(self):
        spec = importlib.util.spec_from_file_location(
            "setup_private", Path(__file__).resolve().parents[1] / "scripts/setup-private.py"
        )
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(setup, "configured_pack", return_value=None),
            patch.object(setup, "run", return_value="false") as run,
            patch.object(setup, "configure") as configure,
            patch(
                "sys.argv",
                ["setup-private.py", "--repo", "fixture/content", "--directory", str(Path(directory) / "private")],
            ),
        ):
            with self.assertRaisesRegex(ValueError, "must be PRIVATE"):
                setup.main()
            self.assertEqual(run.call_count, 1)
            configure.assert_not_called()
