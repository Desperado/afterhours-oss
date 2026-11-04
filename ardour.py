"""Small, loopback-only bridge to Ardour's experimental MCP HTTP surface."""

import http.client
import json
import math
import re
import time
import uuid


class ArdourError(Exception):
    pass


class Ardour:
    def __init__(self, port=4820):
        self.port = port
        # Plugin descriptions are large (Surge XT exposes hundreds of parameters).
        # Keep the last inspected ones so each knob move needs only small requests.
        self.descriptions = {}

    def call(self, name, arguments=None):
        request_id = uuid.uuid4().hex
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments or {}},
            },
            allow_nan=False,
        )
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request("POST", "/mcp", body, {"Content-Type": "application/json", "Accept": "application/json"})
            response = connection.getresponse()
            raw = response.read(2 * 1024 * 1024 + 1)
            if response.status != 200 or len(raw) > 2 * 1024 * 1024:
                raise ArdourError("Ardour returned an unexpected response. Check MCPHttp settings.")
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("id") != request_id:
                raise ValueError("Invalid RPC response")
            if "error" in data or data.get("result", {}).get("isError"):
                raise ArdourError("Ardour could not complete this command. Open a session and reconnect.")
            result = data["result"]["structuredContent"]
            if not isinstance(result, dict):
                raise ValueError("Expected structured content")
            return result
        except (OSError, http.client.HTTPException):
            raise ArdourError(
                "Ardour is unavailable. A build with local MCP HTTP access on port 4820 is required."
            ) from None
        except (ValueError, KeyError, TypeError, AttributeError):
            raise ArdourError("Unsupported Ardour response. Use a build with MCPHttp enabled.") from None
        finally:
            connection.close()

    def snapshot(self):
        session = self.call("session_get_info")
        tracks = self.call("tracks_list").get("tracks", [])
        if not isinstance(tracks, list):
            raise ArdourError("Ardour returned an unsupported track list.")
        # Keep refresh work bounded even for a large session.
        visible = []
        for track in tracks[:32]:
            if not isinstance(track, dict) or any(
                not isinstance(track.get(key), str) for key in ("id", "name", "type")
            ):
                raise ArdourError("Ardour returned an unsupported track list.")
            fader = self.call("track_get_fader", {"id": track["id"]})
            info = self.call("track_get_info", {"id": track["id"]})
            if type(fader.get("db")) not in (int, float) or not math.isfinite(fader["db"]):
                raise ArdourError("Ardour returned an unsupported gain value.")
            visible.append(
                {
                    "id": track["id"],
                    "name": track["name"],
                    "type": track["type"],
                    "db": fader["db"],
                    "plugins": info.get("plugins", []),
                }
            )
        return {"connected": True, "session": session, "tracks": visible, "omitted_tracks": max(0, len(tracks) - 32)}

    def command(self, data):
        if not isinstance(data, dict):
            raise ValueError("Expected an object")
        action = data.get("action")
        allowed = {"action", "session"}
        if action == "fader":
            allowed |= {"id", "db"}
        elif action in ("inspect_plugin", "parameter"):
            allowed |= {"id", "pluginIndex"}
            if action == "parameter":
                allowed |= {"pluginId", "parameterIndex", "label", "interface"}
        if (
            action not in ("play", "stop", "rewind", "save", "fader", "inspect_plugin", "parameter")
            or set(data) - allowed
        ):
            raise ValueError("Unsupported DAW command")
        if not isinstance(data.get("session"), str) or not data["session"]:
            raise ValueError("Expected a session")
        if action in ("fader", "inspect_plugin", "parameter"):
            track_id = data.get("id")
            if not isinstance(track_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", track_id):
                raise ValueError("Invalid route ID")
        if action == "fader":
            db = data.get("db")
            if type(db) not in (float, int) or not math.isfinite(db) or not -193 <= db <= 6:
                raise ValueError("Invalid gain")
        if action in ("inspect_plugin", "parameter"):
            if type(data.get("pluginIndex")) is not int or not 0 <= data["pluginIndex"] < 128:
                raise ValueError("Invalid plugin index")
        if action == "parameter":
            if (
                type(data.get("parameterIndex")) is not int
                or data["parameterIndex"] < 0
                or not isinstance(data.get("pluginId"), str)
                or not data["pluginId"]
                or not isinstance(data.get("label"), str)
                or not data["label"]
            ):
                raise ValueError("Invalid parameter identity")
            value = data.get("interface")
            if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError("Invalid parameter value")
        if self.call("session_get_info").get("sessionName") != data["session"]:
            raise ArdourError("The Ardour session changed. Refresh before making changes.")
        if action == "fader":
            return self.call("track_set_fader_db", {"id": track_id, "db": db})
        if action in ("inspect_plugin", "parameter"):
            target = {"id": track_id, "pluginIndex": data["pluginIndex"]}
            key = (data["session"], track_id, data["pluginIndex"])
            description = None if action == "inspect_plugin" else self.descriptions.get(key)
            if description is None:
                description = self.call("plugin_get_description", target)
                if len(self.descriptions) >= 16:
                    self.descriptions.clear()
                self.descriptions[key] = description
                if action == "inspect_plugin":
                    return description
            else:
                # A cached description is only valid while the same plugin occupies this slot.
                plugins = self.call("track_get_info", {"id": track_id}).get("plugins", [])
                current = next(
                    (p for p in plugins if isinstance(p, dict) and p.get("index") == data["pluginIndex"]), None
                )
                if not current or current.get("name") != description.get("plugin", {}).get("name"):
                    self.descriptions.pop(key, None)
                    raise ArdourError("The instrument changed. Refresh its controls before editing.")
            if description.get("plugin", {}).get("uniqueId") != data["pluginId"]:
                raise ArdourError("The instrument changed. Refresh its controls before editing.")
            parameter = next(
                (p for p in description.get("parameters", []) if p.get("index") == data["parameterIndex"]), None
            )
            if (
                not parameter
                or parameter.get("label") != data["label"]
                or not parameter.get("isInput")
                or not parameter.get("isControl")
                or parameter.get("isHidden")
            ):
                raise ArdourError("This parameter changed or is unavailable. Refresh its controls.")
            return self.call(
                "plugin_set_parameter_by_index_interface",
                {**target, "parameterIndex": data["parameterIndex"], "interface": value},
            )
        if action in ("play", "stop"):
            # Native MCP acknowledges requests before the audio thread handles them.
            # A running flag alone can also be stale when CoreAudio stops processing.
            self.call("transport_" + action)
            deadline = time.monotonic() + 1.25
            previous_sample = None
            while True:
                state = self.call("transport_get_state")
                if action == "stop" and state.get("rolling") is False:
                    return state
                sample = state.get("sample")
                if action == "play" and state.get("rolling") is True and type(sample) is int:
                    if previous_sample is not None and sample != previous_sample:
                        return state
                    previous_sample = sample
                else:
                    previous_sample = None
                if time.monotonic() >= deadline:
                    raise ArdourError(
                        "Ardour did not confirm playback movement. Open Window → Audio/MIDI Setup and restart the audio engine."
                        if action == "play"
                        else "Ardour did not confirm stopping. Check its audio engine."
                    )
                time.sleep(0.05)
        return self.call({"save": "session_save", "rewind": "transport_goto_start"}.get(action, "transport_" + action))
