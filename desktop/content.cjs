'use strict';
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function selection(args) {
  let pack,
    mode,
    directory = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir' && !directory) directory = true;
    else if (['--public', '--private', '--content-pack'].includes(arg) && !mode) {
      mode = arg;
      if (arg === '--content-pack') {
        pack = args[++i];
        if (!pack || pack.startsWith('--')) throw new Error('--content-pack needs a directory');
        pack = path.resolve(pack);
      }
    } else throw new Error(`Unexpected or conflicting build option: ${arg}`);
  }
  if (mode !== '--public' && !pack) {
    const venv = path.join(root, '.context/music-analysis-venv/bin/python');
    const result = spawnSync(fs.existsSync(venv) ? venv : 'python3', ['local_content.py'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0)
      throw new Error(result.stderr?.trim() || 'Cannot read local content settings. Run npm run setup first.');
    pack = result.stdout.trim() || undefined;
  }
  if (mode === '--private' && !pack) throw new Error('Run npm run setup:private -- --repo OWNER/REPO first.');
  return {pack, directory, flavor: pack ? 'private' : 'public'};
}

module.exports = {selection};
