import http.client
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import unittest


class DesktopServerTests(unittest.TestCase):
    def test_private_backend_guards_requests_and_exits_when_parent_pipe_closes(self):
        with tempfile.TemporaryDirectory(prefix="afterhours desktop ") as directory:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve().parents[1] / "desktop/server.py")],
                cwd=directory,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            token = secrets.token_hex(32)
            try:
                process.stdin.write(json.dumps({"token": token, "dataDir": directory}) + "\n")
                process.stdin.flush()
                port = json.loads(process.stdout.readline())["port"]

                def request(method, target, headers=None):
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    try:
                        connection.request(method, target, "{}" if method == "POST" else None, headers or {})
                        response = connection.getresponse()
                        response.read()
                        return response.status
                    finally:
                        connection.close()

                self.assertEqual(request("GET", "/api/library"), 421)
                self.assertEqual(request("GET", "/", {"X-Afterhours-Token": "invalid"}), 421)
                headers = {"X-Afterhours-Token": token}
                self.assertEqual(request("GET", "/api/library", headers), 200)
                self.assertEqual(request("POST", "/api/jobs", headers), 403)
                headers["Origin"] = f"http://127.0.0.1:{port}"
                self.assertEqual(request("POST", "/api/tracks/missing/sync", headers), 404)
                self.assertTrue((Path(directory) / ".context/tracks").is_dir())
                process.stdin.close()
                self.assertEqual(process.wait(timeout=5), 0)
                with self.assertRaises(OSError):
                    http.client.HTTPConnection("127.0.0.1", port, timeout=1).connect()
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
                if not process.stdin.closed:
                    process.stdin.close()
