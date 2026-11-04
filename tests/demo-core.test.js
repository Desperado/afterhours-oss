'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const D = require('../web/demo-core'),
  P = require('../web/groove-presets');
const G = require('../web/groove-core');

test('tour follows beats, holds the finale and restarts a manual chapter without changing tempo', () => {
  const auto = {beat: 0, index: 0, auto: true};
  assert.equal(D.position(auto, 31.999).id, 'ensemble');
  assert.equal(D.position(auto, 32).id, 'flutes');
  assert.equal(D.position(auto, 256).id, 'finale');
  assert.equal(D.position(auto, 512).id, 'finale');
  assert.equal(D.position({beat: 40, index: 5, auto: false}, 400).id, 'wavetable');
  assert.equal(D.position({beat: 40, index: 5, auto: true}, 72).id, 'analog');
});

test('every tour chapter transforms its instrument families and preserves the score', () => {
  const project = G.project();
  for (const pattern of project.patterns) {
    for (const track of pattern.tracks) for (const step of track.steps) step.on = false;
    ['vsco-flute', 'vsco-trumpet', 'vsco-violins', 'vsco-tuba'].forEach((instrument, lane) => {
      const t = pattern.tracks[lane];
      Object.assign(t, {machine: 'Instrument', instrument, note: 60});
      Object.assign(t.steps[0], {on: true, gate: 0.5});
    });
  }
  project.arrangement = [{name: 'Test ensemble', pattern: 0, bars: 80, lanes: [0, 1, 2, 3]}];
  const original = JSON.stringify(project);
  for (let chapter = 0; chapter < 9; chapter++) {
    const state = D.position({beat: chapter * 32, index: chapter, auto: true}, chapter * 32);
    const events = Array.from({length: chapter === 8 ? 128 : 256}, (_, n) =>
      P.songEvents(project, 256 + chapter * 256 + n),
    ).flat();
    assert.ok(events.length, state.id);
    const transformed = events.map(e => D.transform(e, state));
    for (const [i, e] of transformed.entries()) {
      assert.equal(e.beat, events[i].beat);
      assert.equal(e.lane, events[i].lane);
      assert.equal(e.settings.note, events[i].settings.note);
      assert.ok(e.gate > 0 && e.velocity > 0 && e.velocity <= 1);
      assert.strictEqual(D.transform(events[i], state, 0), events[i]);
    }
    if (state.id === 'wavetable') assert.ok(transformed.some(e => e.settings.machine === 'Wavetable'));
    if (state.id === 'analog')
      assert.ok(transformed.some(e => e.settings.machine === 'DualVCO' && e.settings.filter === 'ladder'));
    if (state.id === 'strings') assert.ok(transformed.some(e => e.settings.instrument === 'vsco-violins'));
    const family = {flutes: 'vsco-flute', brass: 'vsco-trumpet', strings: 'vsco-violins'}[state.id];
    if (family) {
      const note = events.find(e => e.settings.instrument === family);
      assert.ok(note, `${family} must have a scored part in its chapter`);
      assert.ok(Math.abs(D.transform(note, {...state, beat: 0}).gate - Math.min(note.gate, 0.14)) < 1e-9);
      assert.ok(Math.abs(D.transform(note, {...state, beat: 8}).gate - Math.max(note.gate, 0.8)) < 1e-9);
    }
    if (state.id === 'dynamics') {
      const note = events.find(e => e.settings.machine === 'Instrument');
      assert.ok(Math.abs(D.transform(note, {...state, phase: 0}).velocity - 0.28) < 1e-9);
      assert.ok(Math.abs(D.transform(note, {...state, phase: 1}).velocity - 0.98) < 1e-9);
    }
  }
  assert.equal(JSON.stringify(project), original, 'no demo change can enter saved patterns or exports');
});

test('room comparison changes actual sends on a copy of the performance state', () => {
  const base = require('../web/performance-core').validate(),
    original = JSON.stringify(base);
  const dry = D.room(base, {id: 'space', beat: 0}, 1),
    wet = D.room(base, {id: 'space', beat: 8}, 0.5);
  assert.ok(dry.mixer.lanes.every(l => l.delay === 0 && l.reverb === 0));
  assert.ok(wet.mixer.lanes.every(l => l.delay === 0.14 && l.reverb === 0.325));
  assert.equal(JSON.stringify(base), original);
});
