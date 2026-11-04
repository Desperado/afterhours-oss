'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {selection} = require('./content.cjs');
const root = path.resolve(__dirname, '..');
try {
  const {pack, directory, flavor} = selection(process.argv.slice(2));
  console.log(`Building ${flavor} content.`);
  const backend = spawnSync(
    process.execPath,
    ['desktop/build-backend.cjs', ...(pack ? ['--content-pack', pack] : ['--public'])],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (backend.status !== 0) process.exit(backend.status ?? 1);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('electron-builder/cli.js'),
      '--config',
      pack ? 'desktop/private-builder.cjs' : 'electron-builder.cjs',
      '--mac',
      '--arm64',
      '--publish',
      'never',
      ...(directory ? ['--dir'] : []),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {...process.env, AFTERHOURS_CONTENT_PACK: pack || ''},
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
