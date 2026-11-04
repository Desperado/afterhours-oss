'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/groove-core');

test('unknown instrument IDs cannot enter project files', () => {
  const p = G.project();
  Object.assign(p.patterns[0].tracks[4], {machine: 'Instrument', instrument: '../outside'});
  assert.throws(() => G.validate(p), /installed instrument/);
});

test('Growlybass and guitar keep four alternatives and their distinct velocity layers', () => {
  for (const [id, layers] of [
    ['growlybass', 4],
    ['freepats-guitar', 2],
  ]) {
    const {regions} = require(`../web/instruments/${id}/manifest.json`);
    const at = regions.filter(r => r.lo <= 48 && r.hi >= 48);
    assert.equal(new Set(at.map(r => `${r.lovel}:${r.hivel}`)).size, layers);
    for (let velocity = 1; velocity <= 127; velocity++) {
      const layer = at.filter(r => velocity >= r.lovel && velocity <= r.hivel);
      assert.equal(layer.length, 4);
      assert.equal(new Set(layer.map(r => r.sample)).size, 4);
      assert.deepEqual(layer.map(r => r.take).sort(), [0, 1, 2, 3]);
    }
  }
});
