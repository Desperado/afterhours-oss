const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/playalong-core');

test('every suggested guitar shape contains exactly the named chord pitches', () => {
  for (const [quality, intervals] of [
    ['', [0, 4, 7]],
    ['m', [0, 3, 7]],
    ['7', [0, 4, 7, 10]],
    ['m7', [0, 3, 7, 10]],
    ['maj7', [0, 4, 7, 11]],
    ['sus2', [0, 2, 7]],
    ['sus4', [0, 5, 7]],
    ['5', [0, 7]],
  ])
    for (let root = 0; root < 12; root++) {
      const notes = intervals.map(n => 48 + root + n),
        c = C.chord(notes);
      assert.equal(c.root, root);
      assert.equal(c.quality, quality);
      const frets = C.fingering(c),
        sounding = frets.flatMap((f, i) => (f < 0 ? [] : [(C.guitarTuning[i] + f) % 12]));
      assert.deepEqual(
        [...new Set(sounding)].sort((a, b) => a - b),
        notes.map(n => n % 12).sort((a, b) => a - b),
      );
      assert.ok(Math.max(...frets) - Math.min(...frets.filter(f => f > 0)) <= 4);
    }
});
test('single notes and unrecognized clusters do not invent a chord', () => {
  assert.equal(C.chord([]), null);
  assert.equal(C.chord([60, 72]), null);
  assert.equal(C.chord([60, 61, 62]), null);
  assert.equal(C.chord([64, 67, 72]).name, 'C');
});
test('bass positions preserve octave and stay within standard tuning', () => {
  assert.equal(C.noteName(28), 'E1');
  assert.deepEqual(C.bassPositions(28), [{string: 'E', fret: 0}]);
  assert.deepEqual(C.bassPositions(27), []);
  for (let note = 28; note <= 67; note++) {
    const positions = C.bassPositions(note);
    assert.ok(positions.length);
    for (const p of positions) assert.equal({E: 28, A: 33, D: 38, G: 43}[p.string] + p.fret, note);
  }
});
