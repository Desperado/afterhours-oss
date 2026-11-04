"""Private desktop backend. Its parent owns the lifetime of the stdin pipe."""

import json
from pathlib import Path
import sys
import threading

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app


def main():
    settings = json.loads(sys.stdin.readline(8192))
    token = settings["token"]
    if not isinstance(token, str) or len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("Invalid desktop handshake")
    content_pack = None
    if not getattr(sys, "frozen", False) and not settings.get("publicContent", False):
        from local_content import configured_pack

        content_pack = configured_pack()
    server = app.make_server(0, Path(settings["dataDir"]), desktop_token=token, content_pack=content_pack)

    def watch_parent():
        # EOF also arrives if Electron crashes or is force-quit.
        sys.stdin.read()
        server.shutdown()

    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"port": server.server_port}), flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
