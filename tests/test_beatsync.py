from pathlib import Path
import tempfile
import unittest

import numpy as np
import soundfile as sf

import beatsync


class BeatSyncTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "beat.wav"

    def clicks(self, duration=65, stereo=False):
        rate = 22050
        samples = np.zeros(int(duration * rate))
        pulse = np.random.default_rng(5).normal(size=800) * np.exp(-np.arange(800) / 90)
        for seconds in np.arange(0.37, duration - 0.1, 0.5):
            start = int(seconds * rate)
            samples[start : start + len(pulse)] += pulse[: len(samples) - start]
        if stereo:
            samples = np.column_stack((samples, -samples))
        sf.write(self.path, samples, rate, subtype="FLOAT")

    def test_detects_offset_and_beats_across_chunk_boundaries(self):
        self.clicks()
        grid = beatsync.detect(self.path)
        self.assertAlmostEqual(grid["bpm"], 120, delta=2)
        beats = np.array(grid["beats"])
        self.assertTrue(np.all(np.diff(beats) > 0))
        self.assertGreater(beats[-1], 63)
        for start in (0, 29, 59):
            section = beats[(beats >= start) & (beats < start + 3)]
            self.assertGreater(len(section), 2)
            error = (section - 0.37 + 0.25) % 0.5 - 0.25
            self.assertLess(np.max(np.abs(error)), 0.05)

    def test_opposite_stereo_channels_do_not_cancel(self):
        self.clicks(12, stereo=True)
        self.assertAlmostEqual(beatsync.detect(self.path)["bpm"], 120, delta=2)

    def test_silence_short_and_invalid_recordings_are_rejected(self):
        for samples, message in (
            (np.zeros(22050 * 12), "No clear beat"),
            (np.zeros(22050), "4 seconds"),
            (np.full(22050 * 5, np.nan), "invalid samples"),
        ):
            with self.subTest(message=message):
                sf.write(self.path, samples, 22050, subtype="FLOAT")
                with self.assertRaisesRegex(ValueError, message):
                    beatsync.detect(self.path)
