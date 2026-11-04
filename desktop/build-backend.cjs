'use strict';
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {selection} = require('./content.cjs');
const root = path.resolve(__dirname, '..');
const python = path.join(root, '.context/music-analysis-venv/bin/python');
const args = process.argv.slice(2);
let selected;
try {
  selected = selection(args);
  if (selected.directory) throw new Error('--dir belongs to the desktop pack command');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const {pack, flavor} = selected;
fs.mkdirSync(path.join(root, '.context'), {recursive: true});
const temporary = fs.mkdtempSync(path.join(root, '.context/web-stage-'));
const stage = path.join(temporary, 'web');
function run(argv, options = {}) {
  const result = spawnSync(python, argv, {cwd: root, stdio: 'inherit', ...options});
  if (result.error) console.error('Install the Python environment and desktop/requirements-build.txt first.');
  if (result.error || result.status !== 0) throw new Error('Backend build failed');
}
try {
  run(['desktop/stage_web.py', stage, ...(pack ? ['--content-pack', pack, '--instruments'] : [])]);
  run(
    [
      '-m',
      'PyInstaller',
      '--noconfirm',
      '--distpath',
      `.context/desktop-backend/${flavor}`,
      '--workpath',
      `.context/desktop-build/${flavor}`,
      'desktop/backend.spec',
    ],
    {env: {...process.env, AFTERHOURS_WEB_STAGE: stage}},
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
