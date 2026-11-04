from pathlib import Path
import os

root = Path(SPECPATH).parent
audio = root / '.agents/skills/music-analysis/scripts/audio.py'
web = Path(os.environ['AFTERHOURS_WEB_STAGE']).resolve(strict=True)
a = Analysis([str(root / 'desktop/server.py')], pathex=[str(root), str(audio.parent)],
             binaries=[], datas=[(str(web), 'web'), (str(audio), '.agents/skills/music-analysis/scripts')],
             hiddenimports=['audio', 'librosa', 'openai'], hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=['tkinter', 'matplotlib', 'IPython', 'pytest', 'notebook'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='afterhours-server', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True, target_arch=None,
          codesign_identity=None, entitlements_file=None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='afterhours-server')
