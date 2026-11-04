'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  G = require('../web/groove-core.js');
function empty() {
  const p = G.project().patterns[0];
  p.tracks.forEach(t =>
    t.steps.forEach(s => {
      s.on = false;
      s.locks = {};
    }),
  );
  return p;
}
test('Long melodic gates survive validation, scheduling and MIDI export', () => {
  const project = G.project();
  project.patterns[0] = empty();
  const t = project.patterns[0].tracks[4];
  t.rate = 0.5;
  t.steps[0].on = true;
  t.steps[0].gate = 8;
  const saved = G.validate(JSON.parse(JSON.stringify(project))).patterns[0];
  assert.equal(saved.tracks[4].steps[0].gate, 8);
  assert.equal(G.events(saved, 0)[0].gate, 4);
  const midi = require('../web/groove-midi').read(G.midi(saved, 40, 0, 1));
  assert.equal(midi.parts[0].notes[0].duration, 4);
  t.steps[0].gate = 100;
  assert.equal(G.validate(project).patterns[0].tracks[4].steps[0].gate, 8);
});
test('Starter kit and slots have independent steps', () => {
  const p = G.project();
  assert.deepEqual(
    p.patterns[0].tracks.slice(0, 6).map(t => t.machine),
    ['Kick', 'Snare', 'Metal', 'Perc', 'Tone', 'Chord'],
  );
  assert.equal(p.patterns[0].tracks[4].note, 28);
  p.patterns[0].tracks[0].steps[0].locks.shape = 99;
  assert.equal(p.patterns[1].tracks[0].steps[0].locks.shape, undefined);
});

test('Redline uses sixteen active lanes, survives JSON import and makes space before the final drop', () => {
  const P = require('../web/groove-presets'),
    p = P.create('redline');
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(p))), p);
  assert.equal(p.bpm, 130);
  assert.equal(
    p.arrangement.reduce((n, s) => n + s.bars, 0),
    96,
  );
  p.patterns.forEach(pattern => {
    assert.equal(pattern.tracks.length, 16);
    assert.equal(pattern.tracks[3].machine, 'Saw');
    assert.equal(pattern.tracks[4].machine, 'Saw');
  });
  const sectionEvents = name => {
    const index = p.arrangement.findIndex(s => s.name === name);
    const start = p.arrangement.slice(0, index).reduce((n, s) => n + s.bars * 32, 0);
    return Array.from({length: 128}, (_, t) => P.songEvents(p, start + t)).flat();
  };
  const blackout = sectionEvents('Blackout'),
    drop = sectionEvents('Overdrive');
  assert.ok(blackout.length > 0 && blackout.every(e => [3, 5, 9, 10].includes(e.lane)));
  assert.deepEqual(
    [...new Set(drop.map(e => e.lane))].sort((a, b) => a - b),
    Array.from({length: 16}, (_, i) => i),
  );
  assert.ok(drop.length > blackout.length * 3);
  assert.deepEqual(P.songEvents(p, 96 * 32), []);
  for (const c of P.catalog) assert.equal(P.create(c.id).patterns[0].tracks.length, 16);
});
test('Per-step locks affect only their hit, including level and pan', () => {
  const p = empty(),
    t = p.tracks[4];
  t.steps[0].on = true;
  t.steps[1].on = true;
  t.steps[0].locks = {note: 31, shape: 80, volume: 20, pan: -80};
  const locked = G.events(p, 0)[0],
    base = G.events(p, 2)[0];
  assert.equal(locked.settings.note, 31);
  assert.equal(locked.settings.shape, 80);
  assert.equal(locked.settings.pan, -80);
  assert.equal(base.settings.shape, 18);
  assert.equal(t.note, 28);
});
test('Independent lane length and speed produce a polymeter', () => {
  const p = empty(),
    t = p.tracks[0];
  t.length = 3;
  t.rate = 2;
  t.steps[0].on = true;
  assert.equal(G.events(p, 3)[0].index, 0);
  assert.equal(G.events(p, 2).length, 0);
  t.rate = 0.5;
  assert.equal(G.events(p, 2).length, 0);
  assert.equal(G.events(p, 12)[0].index, 0);
});
test('Retrigs preserve velocity and apply swing and microtiming in beats', () => {
  const p = empty(),
    s = p.tracks[0].steps[1];
  Object.assign(s, {on: true, repeat: 4, velocity: 64, micro: -0.2, gate: 0.8});
  const events = G.events(p, 2, {swing: 0.4});
  assert.equal(events.length, 4);
  assert.equal(events[0].beat, 0.25);
  assert.equal(events[3].beat, 0.4375);
  assert.equal(events[0].gate, 0.05);
  assert.equal(events[0].velocity, 64 / 127);
});
test('Probability, conditional cycles, fill, mute and solo filter hits', () => {
  const p = empty(),
    t = p.tracks[0],
    s = t.steps[0];
  s.on = true;
  s.chance = 0;
  assert.equal(G.events(p, 0).length, 0);
  s.chance = 100;
  s.condition = '2:2';
  assert.equal(G.events(p, 0).length, 0);
  assert.equal(G.events(p, 64).length, 1);
  s.condition = 'fill';
  assert.equal(G.events(p, 0).length, 0);
  assert.equal(G.events(p, 0, {fill: true}).length, 1);
  s.condition = 'always';
  p.tracks[1].solo = true;
  assert.equal(G.events(p, 0).length, 0);
  t.solo = true;
  assert.equal(G.events(p, 0).length, 1);
  t.mute = true;
  assert.equal(G.events(p, 0).length, 0);
});
test('Project validation rejects broken structure and bounds imported controls', () => {
  assert.throws(() => G.validate({version: 1, patterns: []}));
  const raw = G.project();
  raw.bpm = Infinity;
  raw.patterns[0].tracks[0].cutoff = -999;
  raw.patterns[0].tracks[0].steps[0].locks = JSON.parse('{"shape":999,"__proto__":{"polluted":true}}');
  const result = G.validate(raw);
  assert.equal(result.bpm, 93);
  assert.equal(result.patterns[0].tracks[0].cutoff, 100);
  assert.deepEqual(result.patterns[0].tracks[0].steps[0].locks, {shape: 100});
  assert.equal({}.polluted, undefined);
  raw.patterns[0].tracks[0].steps = [];
  assert.throws(() => G.validate(raw));
});
function parseMidi(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.toString('ascii', 0, 4), 'MThd');
  assert.equal(b.readUInt16BE(10), 17);
  assert.equal(b.readUInt16BE(12), 480);
  const tracks = [];
  let offset = 14;
  for (let lane = 0; lane < 17; lane++) {
    assert.equal(b.toString('ascii', offset, offset + 4), 'MTrk');
    const end = offset + 8 + b.readUInt32BE(offset + 4);
    offset += 8;
    let time = 0;
    const events = [];
    const vlq = () => {
      let n = 0,
        v;
      do {
        v = b[offset++];
        n = n * 128 + (v & 127);
      } while (v & 128);
      return n;
    };
    while (offset < end) {
      time += vlq();
      const status = b[offset++];
      if (status === 255) {
        const type = b[offset++],
          size = vlq();
        events.push({time, type, data: [...b.subarray(offset, offset + size)]});
        offset += size;
      } else {
        assert.ok(status >= 128 && status <= 159);
        events.push({time, status, note: b[offset++], velocity: b[offset++]});
      }
    }
    assert.equal(offset, end);
    tracks.push(events);
  }
  assert.equal(offset, b.length);
  return tracks;
}
test('MIDI contains sixteen separate note lanes, tempo, locked pitches, retrigs and chord notes', () => {
  const p = empty();
  Object.assign(p.tracks[4].steps[0], {on: true, velocity: 92, repeat: 2, locks: {note: 31}});
  p.tracks[5].steps[0].on = true;
  Object.assign(p.tracks[15].steps[0], {on: true, locks: {note: 87}});
  const tracks = parseMidi(G.midi(p, 120, 0, 1));
  assert.deepEqual(tracks[0][0].data, [7, 161, 32]);
  const bass = tracks[5].filter(e => e.status === 148);
  assert.deepEqual(
    bass.map(e => [e.time, e.note, e.velocity]),
    [
      [120, 31, 92],
      [180, 31, 92],
    ],
  );
  assert.deepEqual(
    tracks[6].filter(e => e.status === 149).map(e => e.note),
    [52, 55, 59, 62],
  );
  assert.equal(tracks[1].filter(e => e.status).length, 0);
  assert.deepEqual(
    tracks[16].filter(e => e.status === 159).map(e => e.note),
    [87],
  );
});
test('MIDI ends overlapping same-pitch gates before retriggering', () => {
  const p = empty();
  p.length = 2;
  for (const s of p.tracks[4].steps.slice(0, 2)) Object.assign(s, {on: true, gate: 2});
  const events = parseMidi(G.midi(p, 120, 0, 1))[5].filter(e => e.status);
  assert.deepEqual(
    events.map(e => [e.time, e.status, e.note]),
    [
      [120, 148, 28],
      [240, 132, 28],
      [240, 148, 28],
      [480, 132, 28],
    ],
  );
});
test('Microtiming scales with lane speed and coinciding same-pitch hits never leave a note hanging', () => {
  const p = empty(),
    t = p.tracks[0];
  t.rate = 2;
  p.length = 1;
  Object.assign(t.steps[0], {on: true, micro: 0.3});
  Object.assign(t.steps[1], {on: true, micro: -0.2});
  const [a, b] = [0, 1].map(tick => G.events(p, tick)[0]);
  assert.ok(a.beat < b.beat, 'a faster lane keeps step order');
  assert.ok(Math.abs(b.beat - a.beat - 0.125 * 0.5) < 1e-9);
  // Swing can still land two 2x steps on one tick; MIDI must merge them instead of stacking note-ons.
  t.steps[0].on = t.steps[1].on = false;
  p.length = 4;
  Object.assign(t.steps[3], {on: true, micro: 0.4});
  Object.assign(t.steps[4], {on: true, micro: -0.4});
  const kick = parseMidi(G.midi(p, 120, 0.2, 1))[1].filter(e => e.status);
  let held = 0;
  for (const e of kick) {
    held += e.status >= 144 ? 1 : -1;
    assert.ok(held >= 0 && held <= 1);
  }
  assert.equal(held, 0);
  assert.equal(kick.filter(e => e.status >= 144).length, 1);
});

test('recording beat mapping preserves offset, tempo changes and endpoint extrapolation', () => {
  const B = require('../web/beat-grid.js'),
    beats = [0.37, 0.87, 1.37, 1.82, 2.27];
  for (const [beat, seconds] of [
    [-1, -0.13],
    [0, 0.37],
    [0.5, 0.62],
    [2.5, 1.595],
    [4, 2.27],
    [5, 2.72],
  ]) {
    assert.ok(Math.abs(B.timeAt(beats, beat) - seconds) < 1e-9);
    assert.ok(Math.abs(B.beatAt(beats, seconds) - beat) < 1e-9);
  }
});

test('six-lane projects retain their notes and arrangement while gaining ten independent empty lanes', () => {
  const legacy = G.project();
  legacy.patterns.forEach(p => {
    p.tracks = p.tracks.slice(0, 6);
    p.length = 48;
  });
  legacy.arrangement = [{name: 'Old mix', pattern: 0, bars: 4, lanes: [0, 4, 5]}];
  const before = G.clone(legacy),
    migrated = G.validate(legacy);
  migrated.patterns.forEach((p, i) => {
    assert.deepEqual(p.tracks.slice(0, 6), before.patterns[i].tracks);
    assert.equal(p.tracks.length, 16);
    assert.ok(p.tracks.slice(6).every(t => t.length === 48 && t.steps.every(s => !s.on)));
  });
  assert.deepEqual(migrated.arrangement, before.arrangement);
  migrated.patterns[0].tracks[11].steps[0].on = true;
  assert.equal(migrated.patterns[1].tracks[11].steps[0].on, false);
  legacy.patterns[0].tracks.push(...G.project().patterns[0].tracks.slice(0, 11));
  assert.throws(() => G.validate(legacy), /6–16 tracks/);
});

test('Continuous Play is a validated project setting with a false default for old files', () => {
  const p = G.project();
  p.continuous = true;
  assert.equal(G.validate(JSON.parse(G.serialize(p))).continuous, true);
  for (const value of [undefined, null, false, 'true', 1])
    assert.equal(G.validate({...p, continuous: value}).continuous, false);
});
