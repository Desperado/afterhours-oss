'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/groove-core');
const P = require('../web/groove-presets');
const M = require('../web/groove-midi');

function passage(project, index) {
  const start = project.arrangement.slice(0, index).reduce((n, s) => n + s.bars * 32, 0);
  return Array.from({length: project.arrangement[index].bars * 32}, (_, tick) =>
    P.songEvents(project, start + tick),
  ).flat();
}

test('Червона рута expands both verses and alternate endings into a finite public song', () => {
  const p = P.create('chervona-ruta');
  assert.ok(P.catalog.some(c => c.id === 'chervona-ruta' && c.description.includes('Ivasiuk')));
  assert.equal(p.bpm, 104);
  assert.deepEqual(p.tonality, {root: 7, scale: 'minor'});
  assert.deepEqual(G.validate(JSON.parse(G.serialize(p))), p);
  assert.equal(
    p.arrangement.reduce((n, s) => n + s.bars, 0),
    86,
  );
  assert.equal(p.arrangement.length, 25);
  assert.equal(p.arrangement[11].bars, 3, 'first ending includes written bar 40');
  assert.equal(p.arrangement[20].bars, 2, 'second pass skips the first ending');
  assert.equal(p.arrangement[21].name, 'Second ending · echo I');
  assert.deepEqual(P.songEvents(p, 86 * 32), []);
  for (let i = 0; i < 5; i++) {
    const melody = index =>
      passage(p, index)
        .filter(e => e.lane === 7)
        .map(e => [e.settings.note, e.gate]);
    assert.deepEqual(melody(3 + i), melody(12 + i), 'repeat preserves the vocal melody');
  }
  p.patterns[0].tracks[0].steps[0].on = true;
  assert.equal(P.create('chervona-ruta').patterns[0].tracks[0].steps[0].on, false);
});

test('the score melody, tied chorus and sixteenth-note pickup survive event and MIDI planning', () => {
  const p = P.create('chervona-ruta');
  const opening = passage(p, 3)
    .filter(e => e.lane === 7)
    .slice(0, 5);
  assert.deepEqual(
    opening.map(e => e.settings.note),
    [62, 62, 70, 69, 70],
  );
  assert.deepEqual(
    opening.map(e => e.beat),
    [37, 37.5, 38, 39, 39.5],
  );
  const chorus = passage(p, 8).filter(e => e.lane === 7);
  assert.deepEqual(
    chorus.slice(0, 7).map(e => e.settings.note),
    [75, 77, 75, 74, 72, 70, 72],
  );
  assert.ok(chorus[4].gate > 2.3, 'the tied C lasts across the beat without retriggering');
  const pickup = passage(p, 2).filter(e => e.lane === 11);
  assert.deepEqual(
    pickup.map(e => e.beat),
    [33, 33.5, 34, 34.25, 34.5, 35, 35.5],
  );
  const midi = M.read(G.midi(p.patterns[2], p.bpm, 0, 1));
  const harp = midi.parts.find(part => part.name.includes('piano answers'));
  assert.ok(harp);
  assert.deepEqual(
    harp.notes.map(n => n.note),
    [74, 79, 78, 77, 75, 72, 70],
  );
});

test('the orchestra plays all sixteen lanes within recorded ranges and leaves a quiet final hold', () => {
  const p = P.create('chervona-ruta'),
    instruments = new Set();
  for (let i = 0; i < p.arrangement.length; i++) {
    const events = passage(p, i);
    assert.ok(events.length, p.arrangement[i].name);
    if (i === 8 || i === 19)
      assert.equal(new Set(events.map(e => e.lane)).size, 16, 'full chorus includes the whole ensemble');
    for (const e of events) {
      const s = e.settings,
        velocity = Math.round(e.velocity * 127);
      assert.equal(s.machine, 'Instrument');
      instruments.add(s.instrument);
      const map = require(`../web/instruments/${s.instrument}/manifest.json`);
      assert.ok(
        map.regions.some(r => r.lo <= s.note && r.hi >= s.note && r.lovel <= velocity && r.hivel >= velocity),
        `${s.name}: unrecorded note ${s.note}, velocity ${velocity}`,
      );
    }
  }
  assert.equal(instruments.size, 10);
  const coda = passage(p, 23);
  assert.ok(
    coda.every(e => e.lane < 13),
    'percussion rests through the diminuendo',
  );
  const finalBar = passage(p, 24).filter(e => e.beat >= 340);
  assert.ok(finalBar.length >= 4);
  assert.ok(
    finalBar.every(e => e.beat === 340 && e.velocity < 0.5),
    'final chord holds without late retriggers',
  );
});
