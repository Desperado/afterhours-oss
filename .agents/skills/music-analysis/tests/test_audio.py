import base64
from contextlib import redirect_stderr, redirect_stdout
import getpass
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings

import httpx
import numpy as np
from openai import OpenAI
import soundfile as sf


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audio.py"
spec = importlib.util.spec_from_file_location("music_audio", SCRIPT)
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "track.wav"
        self.rate = 22050

    def write(self, samples):
        sf.write(self.path, samples, self.rate, subtype="FLOAT")

    def test_antiphase_stereo_retains_power_and_bass(self):
        tone = 0.5 * np.sin(2 * np.pi * 100 * np.arange(self.rate * 5) / self.rate)
        self.write(np.column_stack([tone, -tone]))
        samples, rate, meta = audio.load_excerpt(self.path, 1, 2)
        report = audio.measure(samples, rate, meta)
        self.assertAlmostEqual(report["rms_dbfs"], -9.031, places=2)
        self.assertGreater(report["frequency_band_power_fractions"]["bass_60_250"], 0.99)
        self.assertEqual(report["duration_seconds"], 2)
        self.assertEqual(report["channels"], 2)

    def test_silence_has_no_tempo_and_serializes_without_nan(self):
        self.write(np.zeros(self.rate * 5))
        samples, rate, meta = audio.load_excerpt(self.path, 0, 60)
        report = audio.measure(samples, rate, meta)
        self.assertIsNone(report["rms_dbfs"])
        self.assertIsNone(report["estimated_bpm"])
        self.assertEqual(report["duration_seconds"], 5)
        json.dumps(report, allow_nan=False)

    def test_120_bpm_pulse_train(self):
        samples = np.zeros(self.rate * 20, dtype=np.float32)
        pulse = 0.8 * np.hanning(300)
        for start in range(0, len(samples) - len(pulse), self.rate // 2):
            samples[start : start + len(pulse)] += pulse
        self.write(samples)
        data, rate, meta = audio.load_excerpt(self.path, 0, 20)
        bpm = audio.measure(data, rate, meta)["estimated_bpm"]
        self.assertIsNotNone(bpm)
        self.assertLess(abs(bpm - 120), 3)

    def test_selection_validation_and_bad_audio(self):
        self.write(np.zeros(self.rate))
        for start, duration in (
            (-1, 1),
            (float("nan"), 1),
            (0, float("inf")),
            (0, 121),
            (0, 0),
            (2, 1),
            (1e308, 1),
            (0, 0.01),
        ):
            with self.subTest(start=start, duration=duration), self.assertRaises(audio.AudioError):
                audio.load_excerpt(self.path, start, duration)
        self.path.write_bytes(b"not audio")
        with self.assertRaises(audio.AudioError):
            audio.load_excerpt(self.path, 0, 1)

    def test_output_cannot_replace_recording(self):
        self.write(np.zeros(self.rate))
        before = self.path.read_bytes()
        with redirect_stderr(io.StringIO()):
            result = audio.main(["analyze", str(self.path), "--output", str(self.path)])
        self.assertEqual(result, 1)
        self.assertEqual(self.path.read_bytes(), before)

    def test_missing_key_fails_before_audio_loading(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(audio, "load_excerpt") as load:
            with redirect_stderr(io.StringIO()) as error:
                result = audio.main(["listen", str(self.path)])
        self.assertEqual(result, 1)
        self.assertIn("OPENAI_API_KEY is missing", error.getvalue())
        load.assert_not_called()

    def test_prompted_key_is_used_without_environment_or_report_storage(self):
        self.write(np.zeros(self.rate))
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("getpass.getpass", return_value="test-placeholder"),
            patch.object(audio, "listen", return_value={"listening_notes": "Mock feedback"}) as listen,
        ):
            with redirect_stdout(io.StringIO()) as output:
                result = audio.main(["listen", str(self.path), "--prompt-key"])
            self.assertNotIn("OPENAI_API_KEY", os.environ)
        self.assertEqual(result, 0)
        self.assertEqual(listen.call_args.kwargs["api_key"], "test-placeholder")
        self.assertEqual(json.loads(output.getvalue())["listening_notes"], "Mock feedback")
        self.assertNotIn("test-placeholder", output.getvalue())

    def test_prompt_fails_closed_when_hidden_input_is_unavailable(self):
        def unsafe_prompt(*args, **kwargs):
            warnings.warn("Hidden input unavailable", getpass.GetPassWarning)
            self.fail("Must stop before the password-echo fallback")

        with patch("getpass.getpass", side_effect=unsafe_prompt), patch.object(audio, "load_excerpt") as load:
            with redirect_stderr(io.StringIO()) as error:
                result = audio.main(["listen", str(self.path), "--prompt-key"])
        self.assertEqual(result, 1)
        self.assertIn("hidden input unavailable", error.getvalue())
        load.assert_not_called()

    def test_empty_or_cancelled_key_never_loads_audio(self):
        for entry in ("  ", EOFError(), KeyboardInterrupt()):
            mock = {"return_value": entry} if isinstance(entry, str) else {"side_effect": entry}
            with (
                self.subTest(entry=type(entry).__name__),
                patch("getpass.getpass", **mock),
                patch.object(audio, "load_excerpt") as load,
                redirect_stderr(io.StringIO()),
            ):
                result = audio.main(["listen", str(self.path), "--prompt-key"])
            self.assertEqual(result, 1)
            load.assert_not_called()

    def test_whole_track_covers_every_sample_in_two_overlapping_requests(self):
        sf.write(self.path, np.zeros(234685), 1000)
        output = Path(self.temp.name) / "whole.json"

        def feedback(samples, rate, features, model, *, api_key):
            self.assertEqual(api_key, "test-placeholder")
            return {"local_measurements": features, "listening_notes": "Mock feedback"}

        with (
            patch.object(audio, "measure", side_effect=lambda samples, rate, meta: meta),
            patch.object(audio, "listen", side_effect=feedback) as listen,
            redirect_stderr(io.StringIO()),
        ):
            report = audio.listen_whole(self.path, "gpt-audio-1.5", "test-placeholder", output)
        self.assertEqual(listen.call_count, 2)
        self.assertEqual(report["status"], "complete")
        first, last = [s["local_measurements"] for s in report["segments"]]
        self.assertEqual(first["start_seconds"], 0)
        self.assertEqual(first["duration_seconds"], 120)
        self.assertEqual(last["start_seconds"], 115)
        self.assertAlmostEqual(last["start_seconds"] + last["duration_seconds"], 234.685, delta=0.001)
        self.assertEqual(json.loads(output.read_text()), report)
        self.assertNotIn("test-placeholder", output.read_text())

    def test_second_request_failure_preserves_first_listening_result(self):
        sf.write(self.path, np.zeros(234685), 1000)
        output = Path(self.temp.name) / "partial.json"
        first = {"listening_notes": "Keep this paid result"}
        with (
            patch.object(audio, "measure", return_value={}),
            patch.object(audio, "listen", side_effect=[first, audio.AudioError("API unavailable")]) as listen,
            redirect_stderr(io.StringIO()),
            self.assertRaises(audio.AudioError),
        ):
            audio.listen_whole(self.path, "gpt-audio-1.5", "test-placeholder", output)
        self.assertEqual(listen.call_count, 2)
        partial = json.loads(output.read_text())
        self.assertEqual(partial["status"], "in_progress")
        self.assertEqual(partial["segments"], [first])

    def test_whole_track_does_not_overwrite_an_existing_report(self):
        self.write(np.zeros(self.rate))
        output = Path(self.temp.name) / "existing.json"
        output.write_text("previous report")
        with patch.object(audio, "listen") as listen, self.assertRaises(FileExistsError):
            audio.listen_whole(self.path, "gpt-audio-1.5", "test-placeholder", output)
        self.assertEqual(output.read_text(), "previous report")
        listen.assert_not_called()

    def test_saved_key_is_private_and_reused_without_another_prompt(self):
        self.write(np.zeros(self.rate))
        env_file = Path(self.temp.name) / ".env"
        env_file.write_text("FEATURE=enabled")
        args = ["listen", str(self.path), "--env-file", str(env_file), "--save-key"]
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("getpass.getpass", return_value="test-placeholder") as prompt,
            patch.object(audio, "listen", return_value={"listening_notes": "Mock feedback"}) as listen,
            redirect_stdout(io.StringIO()) as output,
            redirect_stderr(io.StringIO()) as error,
        ):
            self.assertEqual(audio.main(args), 0)
            self.assertEqual(audio.main(args), 0)
            self.assertNotIn("OPENAI_API_KEY", os.environ)
        self.assertEqual(prompt.call_count, 1)
        self.assertEqual(listen.call_count, 2)
        self.assertEqual(listen.call_args.kwargs["api_key"], "test-placeholder")
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
        self.assertTrue(env_file.read_text().startswith("FEATURE=enabled\n"))
        self.assertNotIn("test-placeholder", output.getvalue() + error.getvalue())

    def test_dotenv_only_reads_the_allowlisted_key_as_data(self):
        env_file = Path(self.temp.name) / ".env"
        env_file.write_text("OTHER_SETTING=ignored\nexport OPENAI_API_KEY='test-placeholder'\n")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(audio.load_api_key(env_file), "test-placeholder")
            self.assertNotIn("OTHER_SETTING", os.environ)
            self.assertNotIn("OPENAI_API_KEY", os.environ)

    def test_saving_cannot_replace_an_existing_key(self):
        env_file = Path(self.temp.name) / ".env"
        env_file.write_text('OPENAI_API_KEY="existing-test-placeholder"\n')
        before = env_file.read_bytes()
        with self.assertRaises(audio.AudioError), redirect_stderr(io.StringIO()):
            audio.save_api_key(env_file, "replacement-test-placeholder")
        self.assertEqual(env_file.read_bytes(), before)

    def test_model_request_sends_selected_audio_and_text_only(self):
        self.write(np.column_stack([np.zeros(self.rate), np.full(self.rate, 0.25)]))
        samples, rate, features = audio.load_excerpt(self.path, 0.25, 0.5)
        features = audio.measure(samples, rate, features)
        captured = []

        def handler(request):
            captured.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "id": "mock",
                    "created": 0,
                    "object": "chat.completion",
                    "model": "gpt-audio-1.5",
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "stop",
                            "message": {"role": "assistant", "content": "Тестові нотатки"},
                        }
                    ],
                },
            )

        def factory(**kwargs):
            self.assertEqual(kwargs["base_url"], "https://api.openai.com/v1")
            self.assertEqual(kwargs["max_retries"], 0)
            return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-placeholder"}),
            patch("openai.OpenAI", side_effect=factory),
        ):
            result = audio.listen(samples, rate, features, "gpt-audio-1.5")
        self.assertEqual(len(captured), 1)
        body = captured[0]
        self.assertFalse(body["store"])
        self.assertEqual(body["modalities"], ["text"])
        self.assertNotIn(str(self.path), json.dumps(body))
        encoded = body["messages"][1]["content"][1]["input_audio"]
        decoded, sr = sf.read(io.BytesIO(base64.b64decode(encoded["data"])), always_2d=True)
        self.assertEqual(sr, 24000)
        self.assertEqual(decoded.shape[1], 2)
        self.assertAlmostEqual(len(decoded) / sr, 0.5, delta=1 / sr + 1e-9)
        self.assertGreater(float(decoded[:, 1].mean()), 0.24)
        self.assertEqual(result["listening_notes"], "Тестові нотатки")
        self.assertEqual(result["analysis_method"], "audio_model")
        self.assertFalse(result["response_truncated"])

    def test_api_error_body_is_not_exposed(self):
        samples = np.zeros((self.rate, 1), dtype=np.float32)

        def handler(request):
            return httpx.Response(401, json={"error": {"message": "PRIVATE_PROVIDER_BODY"}})

        def factory(**kwargs):
            return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-placeholder"}),
            patch("openai.OpenAI", side_effect=factory),
        ):
            with self.assertRaises(audio.AudioError) as error:
                audio.listen(samples, self.rate, {}, "gpt-audio-1.5")
        self.assertIn("HTTP 401", str(error.exception))
        self.assertNotIn("PRIVATE_PROVIDER_BODY", str(error.exception))

    def test_doctor_reports_presence_without_values(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-placeholder"}):
            with redirect_stdout(io.StringIO()) as output:
                self.assertEqual(audio.main(["doctor"]), 0)
        self.assertTrue(json.loads(output.getvalue())["openai_api_key_present"])
        self.assertNotIn("test-placeholder", output.getvalue())


if __name__ == "__main__":
    unittest.main()
