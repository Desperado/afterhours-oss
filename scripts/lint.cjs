'use strict';
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
  .split('\0')
  .filter(file => /\.(?:js|cjs)$/.test(file));
for (const file of files) execFileSync(process.execPath, ['--check', file], {cwd: root, stdio: 'inherit'});
console.log(`JavaScript syntax checked: ${files.length} files.`);
