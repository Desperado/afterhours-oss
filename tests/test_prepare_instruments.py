import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location(
    "prepare_instruments", Path(__file__).resolve().parents[1] / "scripts/prepare-instruments.py"
)
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class InstrumentCompilerTests(unittest.TestCase):
    def test_bass_octave_range_retains_recorded_root_and_all_takes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sf.write(root / "voice.wav", np.zeros(100), 16000)
            (root / "bass.sfz").write_text(
                "<group> lokey=33 hikey=38 pitch_keycenter=37 seq_length=2\n"
                "<region> sample=voice.wav seq_position=1\n"
                "<region> sample=voice.wav seq_position=2\n"
            )
            compiler.compile_bank(("growlybass", "bass.sfz", {}), root, root / "out")
            bank = root / "out/growlybass"
            regions = json.loads((bank / "manifest.json").read_text())["regions"]
            self.assertEqual(regions[2:], [{**r, "lo": 25, "hi": 32} for r in regions[:2]])
            self.assertEqual([r["root"] for r in regions[2:]], [37, 37])
            self.assertEqual(len(list(bank.glob("*.flac"))), 1)

    def test_gm_toms_reuse_nearest_recording_with_original_layers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sf.write(root / "voice.wav", np.zeros(100), 16000)
            mappings = root / "Programs/mappings/oh"
            mappings.mkdir(parents=True)
            (root / "Programs/01-basic-kit.sfz").write_text("")
            for name in [
                "kick_snon",
                "snare_center",
                "hh_closed",
                "hh_open",
                "ltom_center",
                "htom_center",
                "crash_crash",
            ]:
                (mappings / f"{name}_map.sfz").write_text(
                    "<region> sample=../voice.wav lovel=0 hivel=63\n<region> sample=../voice.wav lovel=64 hivel=127\n"
                )
            compiler.compile_bank(("virtuosity-drums", "Programs", {"oneShot": True}), root, root / "out")
            bank = root / "out/virtuosity-drums"
            regions = json.loads((bank / "manifest.json").read_text())["regions"]
            for target, recorded in [(43, 41), (45, 48), (47, 48)]:
                original = [r for r in regions if r["lo"] == r["hi"] == recorded]
                derived = [r for r in regions if r["lo"] == r["hi"] == target]
                self.assertEqual(derived, [{**r, "lo": target, "hi": target} for r in original])
                self.assertEqual([r["root"] for r in derived], [recorded, recorded])
            self.assertEqual(len(list(bank.glob("*.flac"))), 1)

    def test_mapping_inheritance_dynamics_alternates_and_lossless_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            signal = np.sin(np.arange(800) * 0.13) * 0.3
            sf.write(root / "voice.wav", signal, 16000, subtype="PCM_24")
            mapping = root / "voice.sfz"
            mapping.write_text("""
<global> ampeg_release=.7 volume=-3
<group> lokey=36 hikey=60 pitch_keycenter=48 lovel=1 hivel=80
<region> sample=voice.wav lorand=0 hirand=.5 amp_velcurve_80=1
<region> sample=voice.wav lorand=.5 hirand=1 amp_velcurve_80=1
<group> key=48 lovel=81 hivel=127
<region> sample=voice.wav seq_length=2 seq_position=1
<region> sample=voice.wav seq_length=2 seq_position=2
""")
            compiler.compile_bank(("fixture", "voice.sfz", {}), root, root / "out")
            regions = json.loads((root / "out/fixture/manifest.json").read_text())["regions"]
            self.assertEqual([(r["take"], r["takes"]) for r in regions], [(0, 2), (1, 2), (0, 2), (1, 2)])
            self.assertEqual([(r["lo"], r["hi"], r["root"]) for r in regions], [(36, 60, 48)] * 2 + [(48, 48, 48)] * 2)
            self.assertTrue(all(r["volume"] == -3 and r["release"] == 0.7 for r in regions))
            self.assertEqual(regions[0]["curve"], [[0, 0], [80, 1], [127, 1]])
            original, rate = sf.read(root / "voice.wav")
            converted, converted_rate = sf.read(root / "out/fixture" / regions[0]["sample"])
            self.assertEqual(rate, converted_rate)
            np.testing.assert_array_equal(original, converted)

    def test_unsupported_directives_opcodes_and_outside_samples_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            sf.write(root / "outside.wav", np.zeros(100), 16000)
            for content in [
                '#include "other.sfz"',
                "<region> sample=../outside.wav",
                "<region> sample=voice.wav loop_mode=loop_continuous",
            ]:
                (source / "voice.sfz").write_text(content)
                with self.assertRaises(ValueError):
                    compiler.compile_bank(("fixture", "voice.sfz", {}), source, root / "out")
