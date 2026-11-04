'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const K = require('../web/synth-key'),
  G = require('../web/groove-core'),
  song = require('./fixtures/song.cjs');

test('song matching distinguishes bass and guide registers and preserves the leading tone', () => {
  const p = song();
  assert.deepEqual(p.tonality, {root: 7, scale: 'minor'});
  assert.equal(K.suggest(p, 4).octave, 1);
  assert.equal(K.suggest(p, 9).octave, 4);
  assert.equal(K.suggest(p, 9).scale, 'minorLeading');
  assert.equal(K.snap(66, 7, 'minorLeading'), 66);
  assert.equal(K.snap(68, 7, 'minorLeading'), 67);
  assert.equal(K.suggest(p, 0).lane, 4, 'a drum selection falls back to the first pitched part');
  for (let note = 0; note <= 127; note++) {
    const snapped = K.snap(note, 7, 'minor');
    assert.ok(snapped >= 0 && snapped <= 127);
    assert.ok(K.scales.minor.includes((snapped - 7 + 12) % 12));
  }
});

test('unknown song key is estimated, empty projects are not assigned a false key', () => {
  const p = song();
  delete p.tonality;
  assert.equal(K.suggest(p, 4).estimated, true);
  p.patterns.forEach(p =>
    p.tracks.forEach(t =>
      t.steps.forEach(s => {
        s.on = false;
      }),
    ),
  );
  assert.equal(K.suggest(p, 4), null);
  p.tonality = {root: 200, scale: 'made-up'};
  assert.equal(G.validate(p).tonality, undefined);
});
