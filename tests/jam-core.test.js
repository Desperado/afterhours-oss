'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const J = require('../web/jam-core'),
  G = require('../web/groove-core');
const phrase = [60, 64, 67, 72].map((note, i) => ({note, start: 12 + i * 0.5, duration: 0.35, velocity: 0.75}));
const leadEvents = p =>
  Array.from({length: p.length * 2}, (_, tick) => G.events(p, tick))
    .flat()
    .filter(e => e.lane >= 8);

test('phrase pitches, velocity, duration and grid positions survive project validation, storage and MIDI export', () => {
  const before = JSON.stringify(phrase),
    result = J.compose(phrase, {bpm: 120});
  const restored = G.validate(JSON.parse(G.serialize(result.project)));
  const events = leadEvents(restored.patterns[0]);
  assert.deepEqual(
    events.map(e => e.settings.note),
    [60, 64, 67, 72],
  );
  assert.deepEqual(
    events.map(e => e.beat),
    [0, 1, 2, 3],
  );
  for (const e of events) {
    assert.equal(e.velocity, 95 / 127);
    assert.ok(Math.abs(e.gate - 0.7) < 1e-9);
  }
  assert.equal(restored.patterns[0].length, 16);
  assert.equal(result.bars, 1);
  assert.ok(G.midi(restored.patterns[0], restored.bpm, restored.swing, 1).length > 100);
  assert.equal(JSON.stringify(phrase), before);
  assert.deepEqual(J.compose(phrase, {bpm: 120}), result);
});
test('harmony and bass transpose with the played phrase while all original pitches stay intact', () => {
  const a = J.compose(phrase, {bpm: 120}),
    b = J.compose(
      phrase.map(n => ({...n, note: n.note + 2})),
      {bpm: 120},
    );
  assert.equal((b.key.root - a.key.root + 12) % 12, 2);
  for (let lane = 4; lane < 8; lane++) {
    const first = p => p.patterns[0].tracks[lane].steps.find(s => s.on).locks.note;
    assert.equal((first(b.project) - first(a.project) + 12) % 12, 2);
  }
  assert.deepEqual(
    leadEvents(b.project.patterns[0]).map(e => e.settings.note),
    [62, 66, 69, 74],
  );
});
test('eight-note chords use separate editable lanes and styles alter backing without altering the phrase', () => {
  const chord = Array.from({length: 8}, (_, i) => ({note: 60 + i, start: 0, duration: 0.2, velocity: 1}));
  const a = J.compose(chord, {bpm: 120, style: 'gentle'}),
    b = J.compose(chord, {bpm: 120, style: 'pulse'});
  assert.deepEqual(
    leadEvents(a.project.patterns[0]).map(e => e.settings.note),
    chord.map(n => n.note),
  );
  assert.deepEqual(a.project.patterns[0].tracks.slice(8), b.project.patterns[0].tracks.slice(8));
  assert.notDeepEqual(a.project.patterns[0].tracks.slice(0, 8), b.project.patterns[0].tracks.slice(0, 8));
  assert.throws(() => J.compose([...chord, {...chord[0], note: 80}]), /8 notes/);
});
test('invalid or overlong phrases are rejected before any project is produced; long gates are counted explicitly', () => {
  for (const raw of [[], [{...phrase[0], note: 127}], [{...phrase[0], velocity: NaN}], [{...phrase[0], duration: -1}]])
    assert.throws(() => J.compose(raw));
  assert.throws(
    () =>
      J.compose(
        [
          {...phrase[0], start: 0},
          {...phrase[1], start: 10},
        ],
        {bpm: 120},
      ),
    /4 bars/,
  );
  assert.throws(() => J.compose(phrase, {bpm: NaN}));
  assert.throws(() => J.compose(phrase, {style: 'unknown'}));
  const result = J.compose([{note: 60, start: 0, duration: 2, velocity: 1}], {bpm: 120});
  assert.equal(result.shortened, 1);
  assert.equal(leadEvents(result.project.patterns[0])[0].gate, 2);
});
