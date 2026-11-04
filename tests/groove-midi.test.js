'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const G = require('../web/groove-core'),
  M = require('../web/groove-midi'),
  P = require('../web/groove-presets');
function file(events, format = 0, ppq = 480) {
  return Uint8Array.from([
    ...Buffer.from('MThd'),
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    1,
    ppq >> 8,
    ppq & 255,
    ...Buffer.from('MTrk'),
    0,
    0,
    events.length >> 8,
    events.length & 255,
    ...events,
  ]);
}
test('MIDI reads running status, velocity-zero note-offs, names, tempo and channel separation', () => {
  const m = M.read(
    file([
      0, 255, 3, 4, 84, 101, 115, 116, 0, 255, 81, 3, 7, 161, 32, 0, 144, 60, 100, 0, 64, 80, 120, 60, 0, 0, 128, 64, 0,
      0, 145, 67, 90, 120, 129, 67, 0, 0, 255, 47, 0,
    ]),
  );
  assert.equal(m.bpm, 120);
  assert.equal(m.parts.length, 2);
  assert.equal(m.parts[0].name, 'Test · ch 1');
  assert.deepEqual(
    m.parts[0].notes.map(n => [n.note, n.duration]),
    [
      [60, 0.25],
      [64, 0.25],
    ],
  );
  assert.equal(m.parts[1].notes[0].beat, 0.25);
});
test('MIDI reader rejects malformed input, excessive tracks, unsupported timing and empty files', () => {
  for (const bytes of [
    new Uint8Array(),
    file([0, 144, 60]),
    file([0, 60, 100]),
    file([128, 128, 128, 128, 0]),
    file([0, 255, 47, 0]),
    file([0, 144, 60, 100], 2),
    file([], 0, 0x8001),
  ])
    assert.throws(() => M.read(bytes));
  const many = file([]);
  many[10] = 1;
  assert.throws(() => M.read(many), /128 tracks/);
  assert.throws(() => M.read(new Uint8Array(2 * 1024 * 1024 + 1)), /2 MiB/);
});
test('Sixteen-lane MIDI roundtrip retains the final lane and tempo', () => {
  const p = G.project().patterns[0];
  p.tracks.forEach(t => t.steps.forEach(s => (s.on = false)));
  Object.assign(p.tracks[15].steps[0], {on: true, velocity: 81, locks: {note: 72}});
  const m = M.read(G.midi(p, 110, 0, 1));
  assert.equal(m.parts[0].channel, 15);
  assert.equal(m.parts[0].notes[0].note, 72);
  assert.ok(Math.abs(m.bpm - 110) < 0.001);
});
test('Overlay preserves old twelve-lane material, tempo, other patterns and hidden notes', () => {
  const p = P.create('redline');
  p.patterns.forEach(pattern => (pattern.tracks = pattern.tracks.slice(0, 12)));
  p.active = 1;
  const migrated = G.validate(p),
    before = G.clone(migrated);
  const part = {
    name: 'Keys',
    channel: 0,
    notes: [
      {beat: 16, note: 60, velocity: 100, duration: 1},
      {beat: 16, note: 64, velocity: 80, duration: 0.25},
      {beat: 31.75, note: 67, velocity: 90, duration: 0.25},
      {beat: 32, note: 69, velocity: 90, duration: 0.25},
    ],
  };
  const result = M.overlay(migrated, part, 5, 12);
  assert.deepEqual(result.lanes, [12, 13]);
  assert.equal(result.count, 3);
  assert.equal(result.shortened, 1);
  assert.equal(result.project.patterns[1].tracks[12].steps[0].locks.note, 72);
  assert.equal(result.project.patterns[1].tracks[12].steps[63].locks.note, 79);
  assert.deepEqual(result.project.patterns[1].tracks.slice(0, 12), before.patterns[1].tracks.slice(0, 12));
  assert.deepEqual(
    result.project.patterns.filter((_, i) => i !== 1),
    before.patterns.filter((_, i) => i !== 1),
  );
  assert.equal(result.project.bpm, before.bpm);
  assert.deepEqual(migrated, before); // Planning import never mutates the open session.
  const hidden = G.project();
  hidden.patterns[0].tracks.forEach(t => (t.steps[63].on = true));
  assert.throws(() => M.overlay(hidden, {...part, notes: part.notes.slice(0, 1)}, 5), /Not enough/);
});
test('Overlay rejects too much polyphony, drums, empty windows and out-of-range notes atomically', () => {
  const p = P.create('redline');
  p.active = 1;
  const before = G.clone(p);
  const part = {channel: 0, name: 'Keys', notes: [{beat: 0, note: 60, velocity: 100, duration: 0.25}]};
  assert.throws(() => M.overlay(p, part), /Not enough/);
  assert.throws(() => M.overlay(p, {...part, channel: 9}), /melodic/);
  assert.throws(() => M.overlay(p, part, 2), /No notes/);
  assert.throws(() => M.overlay(p, part, 1, 48), /outside/);
  assert.deepEqual(p, before);
});
test('New original songs have distinct bass and lead phrases, playable arrangements and four free MIDI lanes', () => {
  const songs = ['cathedral', 'body', 'mirror'].map(id => P.create(id));
  for (const song of songs) {
    assert.deepEqual(G.validate(song), song);
    assert.equal(song.patterns[1].tracks.length, 16);
    assert.ok(song.patterns.every(p => p.tracks.slice(12).every(t => t.steps.every(s => !s.on))));
    const main = song.arrangement.find(s => s.name === 'Main');
    assert.deepEqual(
      main.lanes,
      Array.from({length: 12}, (_, i) => i),
    );
  }
  assert.equal(new Set(songs.map(p => JSON.stringify(p.patterns[1].tracks[4].steps))).size, 3);
  assert.equal(new Set(songs.map(p => JSON.stringify(p.patterns[1].tracks[7].steps))).size, 3);
});
test('Twelve-lane projects migrate to sixteen without changing any existing notes or arrangement lanes', () => {
  const raw = P.create('redline');
  raw.patterns.forEach(p => (p.tracks = p.tracks.slice(0, 12)));
  raw.arrangement.forEach(s => (s.lanes = s.lanes.filter(i => i < 12)));
  const before = G.clone(raw),
    out = G.validate(raw);
  out.patterns.forEach((p, i) => {
    assert.equal(p.tracks.length, 16);
    assert.deepEqual(p.tracks.slice(0, 12), before.patterns[i].tracks);
    assert.ok(p.tracks.slice(12).every(t => t.steps.every(s => !s.on)));
  });
  assert.deepEqual(out.arrangement, before.arrangement);
});
