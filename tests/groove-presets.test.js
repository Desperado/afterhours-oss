'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const G = require('../web/groove-core'),
  P = require('../web/groove-presets');
const ids = ['shadow', 'overpass', 'relay', 'orchid'];

test('Redline Overdrive is a separate faster score with full drops, a breakdown and a finite ending', () => {
  const original = P.create('redline'),
    p = P.create('redline-overdrive');
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(p))), p);
  assert.equal(original.bpm, 130);
  assert.equal(p.bpm, 160);
  assert.equal(p.patterns.length, 6);
  assert.equal(
    p.arrangement.reduce((sum, s) => sum + s.bars, 0),
    112,
  );
  const on = track => track.steps.filter(s => s.on).length;
  for (const pattern of p.patterns) assert.equal(pattern.tracks[4].machine, 'Analog');
  const bassNotes = p.patterns[1].tracks[4].steps.filter(s => s.on);
  assert.ok(
    bassNotes.every(s => s.gate >= 0.8),
    'bass notes must sustain rather than click through short stabs',
  );
  assert.ok(
    bassNotes.some(s => s.gate > 2),
    'the riff needs longer held notes',
  );
  assert.ok(on(p.patterns[3].tracks[0]) > on(p.patterns[1].tracks[0]));
  assert.notDeepEqual(p.patterns[1].tracks[3].steps, original.patterns[1].tracks[3].steps);
  assert.notDeepEqual(p.patterns[1].tracks[4].steps, p.patterns[3].tracks[4].steps);
  let start = 0;
  for (const section of p.arrangement) {
    assert.equal(P.sectionAt(p, start).name, section.name);
    const events = Array.from({length: section.bars * 32}, (_, i) => P.songEvents(p, start + i)).flat();
    assert.ok(events.length > 0, section.name);
    assert.ok(events.every(e => section.lanes.includes(e.lane) && G.notes(e.settings).every(n => n >= 24 && n <= 96)));
    if (section.lanes.length === 16) assert.equal(new Set(events.map(e => e.lane)).size, 16);
    start += section.bars * 32;
  }
  assert.deepEqual(P.songEvents(p, start), []);
  assert.ok(
    p.patterns[5].tracks.every(t => t.steps.slice(1).every(s => !s.on)),
    'ending must decay without retriggering',
  );
  assert.deepEqual(P.create('redline'), original, 'creating the variant must leave the original untouched');
});

test('new songs play all sixteen lanes in both main and final sections', () => {
  for (const id of ids) {
    const p = P.create(id);
    assert.deepEqual(G.validate(p), p, id);
    assert.equal(
      p.arrangement.reduce((sum, s) => sum + s.bars, 0),
      72,
    );
    let start = 0;
    for (const section of p.arrangement) {
      if (section.pattern === 1 || section.pattern === 3) {
        const events = Array.from({length: 128}, (_, tick) => P.songEvents(p, start + tick, {swing: p.swing})).flat();
        assert.deepEqual(
          [...new Set(events.map(e => e.lane))].sort((a, b) => a - b),
          Array.from({length: 16}, (_, i) => i),
          `${id}: ${section.name}`,
        );
        assert.ok(events.every(e => e.beat >= start / 8 && e.beat < (start + 128) / 8));
        assert.ok(events.every(e => e.settings.note >= 24 && e.settings.note <= 96));
      }
      start += section.bars * 32;
    }
    assert.deepEqual(P.songEvents(p, start), []);
    assert.ok(p.arrangement[0].lanes.length <= 4);
    assert.ok(p.arrangement[4].lanes.length <= 5);
    assert.notDeepEqual(p.patterns[1].tracks[7].steps, p.patterns[3].tracks[7].steps, `${id}: final hook must develop`);
  }
});

test('new songs have different bass rhythms, melodies and named sections', () => {
  const songs = ids.map(id => P.create(id));
  for (const lane of [4, 7])
    assert.equal(new Set(songs.map(p => JSON.stringify(p.patterns[1].tracks[lane].steps))).size, 4);
  assert.equal(new Set(songs.map(p => p.arrangement[2].name)).size, 4);
  assert.equal(new Set(P.catalog.map(c => c.id)).size, P.catalog.length);
});

test('hardware-inspired machines survive saving and WavePad exports the full chord', () => {
  for (const id of ids) {
    const p = G.validate(JSON.parse(JSON.stringify(P.create(id))));
    for (const pattern of p.patterns) {
      assert.ok(['Ladder', 'DualVCO'].includes(pattern.tracks[4].machine));
      assert.equal(pattern.tracks[8].machine, 'DualVCO');
      assert.equal(pattern.tracks[9].machine, 'WavePad');
      assert.equal(pattern.tracks[13].machine, 'Wavetable');
      const pad = pattern.tracks[9];
      assert.deepEqual(G.notes(pad), [pad.note, pad.note + 3, pad.note + 7, pad.note + 10]);
    }
  }
});

test('Rust synthpop songs round-trip, develop their hooks and leave four lanes free', () => {
  const songs = ['letters', 'glass', 'satellite'].map(id => P.create(id));
  for (const p of songs) {
    assert.deepEqual(G.validate(JSON.parse(JSON.stringify(p))), p);
    assert.equal(
      p.arrangement.reduce((sum, s) => sum + s.bars, 0),
      64,
    );
    for (const pattern of p.patterns) {
      for (const lane of [4, 7, 8]) assert.equal(pattern.tracks[lane].machine, 'Analog');
      assert.ok(pattern.tracks.slice(12).every(t => t.steps.every(s => !s.on)));
    }
    assert.notDeepEqual(p.patterns[1].tracks[7].steps, p.patterns[3].tracks[7].steps);
    const events = Array.from({length: 64 * 32}, (_, tick) => P.songEvents(p, tick)).flat();
    assert.ok(events.every(e => e.settings.note >= 24 && e.settings.note <= 96));
    assert.ok(events.some(e => e.settings.machine === 'Analog'));
    assert.deepEqual(P.songEvents(p, 64 * 32), []);
  }
  for (const lane of [4, 7])
    assert.equal(new Set(songs.map(p => JSON.stringify(p.patterns[1].tracks[lane].steps))).size, 3);
});
