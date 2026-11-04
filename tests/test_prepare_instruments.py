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
