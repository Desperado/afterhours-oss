from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch

from ardour import Ardour, ArdourError


class ArdourTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.gain = -12
        self.session = "Test session"
        self.bad = None
        self.rolling = False
        self.sample = 0
        self.transport_states = []
        self.tracks = [{"id": "42", "name": "Bass", "type": "audio"}]
        self.plugin = {"uniqueId": "surge-test", "name": "Surge XT"}
        self.slot_name = "Surge XT"
        self.parameters = [
            {
                "index": 319,
                "label": "A Filter 1 Cutoff",
                "isInput": True,
                "isControl": True,
                "isHidden": False,
                "currentInterface": 0.65,
            }
        ]
        owner = self

        class FakeMCP(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.calls.append((self.path, request["params"]))
                name = request["params"]["name"]
                arguments = request["params"]["arguments"]
                if name == "session_get_info":
                    content = {"sessionName": owner.session, "tempoBpm": 93, "transport": {"rolling": False}}
                elif name == "tracks_list":
                    content = {"tracks": owner.tracks}
                elif name == "track_get_fader":
                    content = {"db": owner.gain}
                elif name == "track_get_info":
                    content = {"plugins": [{"index": 0, "name": owner.slot_name}]}
                elif name == "plugin_get_description":
                    content = {"plugin": owner.plugin, "parameters": owner.parameters}
                elif name == "plugin_set_parameter_by_index_interface":
                    parameter = next(p for p in owner.parameters if p["index"] == arguments["parameterIndex"])
                    parameter["currentInterface"] = arguments["interface"]
                    content = {"interface": arguments["interface"]}
                elif name == "track_set_fader_db":
                    owner.gain = arguments["db"]
                    content = {"db": owner.gain}
                elif name == "session_save":
                    content = {"saved": True}
                elif name == "transport_get_state":
                    owner.sample += 1024
                    content = (
                        owner.transport_states.pop(0)
                        if owner.transport_states
                        else {"rolling": owner.rolling, "sample": owner.sample}
                    )
                else:
                    owner.rolling = name == "transport_play"
                    content = {"rolling": name == "transport_play"}
                result = {"jsonrpc": "2.0", "id": request["id"], "result": {"structuredContent": content}}
                if owner.bad == "error":
                    result = {"id": request["id"], "error": {"message": "private internal detail"}}
                elif owner.bad == "id":
                    result["id"] = "wrong"
                elif owner.bad == "shape":
                    result["result"] = None
                body = json.dumps(result).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeMCP)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.daw = Ardour(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_session_tracks_and_actual_gain_round_trip(self):
        snapshot = self.daw.snapshot()
        self.assertEqual(snapshot["session"]["sessionName"], "Test session")
        self.assertEqual(snapshot["tracks"][0]["db"], -12)
        self.daw.command({"action": "fader", "session": self.session, "id": "42", "db": -22.5})
        self.assertEqual(self.daw.snapshot()["tracks"][0]["db"], -22.5)
        self.assertTrue(all(path == "/mcp" for path, _ in self.calls))
        self.assertTrue(self.daw.command({"action": "play", "session": self.session})["rolling"])
        self.assertFalse(self.daw.command({"action": "stop", "session": self.session})["rolling"])

    def test_play_waits_for_audio_thread_and_moving_position(self):
        self.transport_states = [
            {"rolling": False, "sample": 0},
            {"rolling": True, "sample": 0},
            {"rolling": True, "sample": 1024},
        ]
        with patch("ardour.time.sleep"):
            result = self.daw.command({"action": "play", "session": self.session})
        self.assertEqual(result, {"rolling": True, "sample": 1024})
        self.assertEqual(len([call for _, call in self.calls if call["name"] == "transport_get_state"]), 3)

    def test_play_does_not_trust_acknowledgement_or_frozen_position(self):
        for states in (
            [{"rolling": False, "sample": 0}],
            [{"rolling": True, "sample": 100}, {"rolling": True, "sample": 100}],
        ):
            self.transport_states = list(states)
            with (
                self.subTest(states=states),
                patch("ardour.time.monotonic", side_effect=[0, 0, 2]),
                patch("ardour.time.sleep"),
            ):
                with self.assertRaisesRegex(ArdourError, "Audio/MIDI Setup"):
                    self.daw.command({"action": "play", "session": self.session})

    def test_save_and_rewind_use_current_session(self):
        self.assertEqual(self.daw.command({"action": "save", "session": self.session}), {"saved": True})
        self.assertEqual(self.calls[-1][1], {"name": "session_save", "arguments": {}})
        self.daw.command({"action": "rewind", "session": self.session})
        self.assertEqual(self.calls[-1][1]["name"], "transport_goto_start")
        with self.assertRaises(ArdourError):
            self.daw.command({"action": "save", "session": "Different session"})
        self.assertEqual(self.calls[-1][1]["name"], "session_get_info")

    def test_rejects_bad_commands_before_contacting_daw(self):
        invalid = [
            None,
            {},
            {"action": "session_remove"},
            {"action": "play", "session": self.session, "url": "http://example.com"},
        ]
        for db in (True, float("nan"), float("inf"), -194, 7, "0"):
            invalid.append({"action": "fader", "session": self.session, "id": "42", "db": db})
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.daw.command(data)
        self.assertEqual(self.calls, [])

    def test_session_switch_prevents_stale_change(self):
        with self.assertRaises(ArdourError):
            self.daw.command({"action": "fader", "session": "Previous session", "id": "42", "db": 0})
        self.assertEqual(self.gain, -12)
        self.assertEqual(len(self.calls), 1)

    def test_live_instrument_parameter_round_trip_and_identity_guards(self):
        self.assertEqual(self.daw.snapshot()["tracks"][0]["plugins"][0]["name"], "Surge XT")
        target = {"session": self.session, "id": "42", "pluginIndex": 0}
        inspected = self.daw.command({"action": "inspect_plugin", **target})
        self.assertEqual(inspected["parameters"][0]["currentInterface"], 0.65)
        change = {
            "action": "parameter",
            **target,
            "pluginId": "surge-test",
            "parameterIndex": 319,
            "label": "A Filter 1 Cutoff",
            "interface": 0.42,
        }
        self.assertEqual(self.daw.command(change)["interface"], 0.42)
        self.assertEqual(self.parameters[0]["currentInterface"], 0.42)
        self.assertEqual(
            self.calls[-1][1],
            {
                "name": "plugin_set_parameter_by_index_interface",
                "arguments": {"id": "42", "pluginIndex": 0, "parameterIndex": 319, "interface": 0.42},
            },
        )
        for changed in (
            {"pluginId": "different-plugin"},
            {"parameterIndex": 320},
            {"label": "Other knob"},
            {"session": "old-session"},
        ):
            with self.subTest(changed=changed), self.assertRaises(ArdourError):
                self.daw.command({**change, **changed})
            self.assertNotEqual(self.calls[-1][1]["name"], "plugin_set_parameter_by_index_interface")
        self.parameters[0]["isInput"] = False
        self.daw.command({"action": "inspect_plugin", **target})
        with self.assertRaises(ArdourError):
            self.daw.command(change)
        self.assertNotEqual(self.calls[-1][1]["name"], "plugin_set_parameter_by_index_interface")

    def test_knob_moves_reuse_description_until_the_plugin_slot_changes(self):
        target = {"session": self.session, "id": "42", "pluginIndex": 0}
        self.daw.command({"action": "inspect_plugin", **target})
        change = {
            "action": "parameter",
            **target,
            "pluginId": "surge-test",
            "parameterIndex": 319,
            "label": "A Filter 1 Cutoff",
        }
        self.calls.clear()
        for value in (0.1, 0.2, 0.3):
            self.daw.command({**change, "interface": value})
        names = [call["name"] for _, call in self.calls]
        self.assertNotIn("plugin_get_description", names)
        self.assertEqual(names.count("plugin_set_parameter_by_index_interface"), 3)
        self.slot_name = "ACE Reasonable Synth"
        with self.assertRaisesRegex(ArdourError, "instrument changed"):
            self.daw.command({**change, "interface": 0.4})
        self.assertEqual(self.parameters[0]["currentInterface"], 0.3)

    def test_rejects_invalid_instrument_edits_before_contacting_ardour(self):
        change = {
            "action": "parameter",
            "session": self.session,
            "id": "42",
            "pluginIndex": 0,
            "pluginId": "surge-test",
            "parameterIndex": 319,
            "label": "A Filter 1 Cutoff",
            "interface": 0.42,
        }
        invalid = [{"interface": v} for v in (True, float("nan"), float("inf"), -0.01, 1.01, "0.5")]
        invalid += [{"pluginIndex": v} for v in (True, -1, 128, "0")]
        invalid += [{"parameterIndex": -1}, {"parameterIndex": True}, {"id": "../42"}, {"label": ""}, {"pluginId": ""}]
        for changed in invalid:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                self.daw.command({**change, **changed})
        self.assertEqual(self.calls, [])

    def test_fm_routing_and_depth_target_separate_parameters(self):
        self.parameters += [
            {
                "index": 232,
                "label": "A FM Routing",
                "isInput": True,
                "isControl": True,
                "isHidden": False,
                "currentInterface": 0.005,
            },
            {
                "index": 233,
                "label": "A FM Depth",
                "isInput": True,
                "isControl": True,
                "isHidden": False,
                "currentInterface": 1 / 3,
            },
        ]
        target = {
            "action": "parameter",
            "session": self.session,
            "id": "42",
            "pluginIndex": 0,
            "pluginId": "surge-test",
        }
        self.daw.command({**target, "parameterIndex": 232, "label": "A FM Routing", "interface": 0.335})
        self.daw.command({**target, "parameterIndex": 233, "label": "A FM Depth", "interface": 0.5})
        values = {p["index"]: p["currentInterface"] for p in self.parameters}
        self.assertEqual(values, {319: 0.65, 232: 0.335, 233: 0.5})

    def test_rpc_errors_and_invalid_shapes_are_sanitized(self):
        for bad in ("error", "id", "shape"):
            self.bad = bad
            with self.subTest(bad=bad), self.assertRaises(ArdourError) as raised:
                self.daw.snapshot()
            self.assertNotIn("private internal detail", str(raised.exception))

    def test_malformed_track_or_gain_reports_connection_error(self):
        for tracks in ([None], [{}], [{"id": 42, "name": "Bass", "type": "audio"}]):
            self.tracks = tracks
            with self.subTest(tracks=tracks), self.assertRaises(ArdourError):
                self.daw.snapshot()
        self.tracks = [{"id": "42", "name": "Bass", "type": "audio"}]
        self.gain = None
        with self.assertRaises(ArdourError):
            self.daw.snapshot()
