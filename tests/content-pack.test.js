'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../web/groove-presets');
const song = require('./fixtures/song.cjs');

test('packs register atomically, cannot replace public presets and return independent projects', () => {
  const before = P.catalog.length;
  const entry = {id: 'private-test', title: 'Private test', project: song()};
  assert.throws(() => P.create(entry.id), /Unknown/);
  assert.throws(() => P.register({version: 1, presets: [entry, {...entry, id: 'neon'}]}), /Duplicate/);
  assert.equal(P.catalog.length, before);
  assert.throws(
    () => P.register({version: 1, presets: [entry], demo: {preset: entry.id, label: 'Test', startSection: 900}}),
    /demo/,
  );
  assert.equal(P.catalog.length, before);
  P.register({version: 1, presets: [entry], prepend: true, demo: {preset: entry.id, label: 'Test', startSection: 0}});
  assert.equal(P.catalog[0].id, entry.id);
  const project = P.create(entry.id);
  assert.deepEqual(project, entry.project);
  project.patterns[0].tracks[4].note = 90;
  assert.notDeepEqual(P.create(entry.id), project);
  entry.project.title = 'Changed after registration';
  assert.equal(P.create(entry.id).title, 'Register test');
  assert.throws(() => P.register({version: 1, presets: [entry]}), /Duplicate/);
});
