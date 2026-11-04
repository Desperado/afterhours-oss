'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  P = require('../web/performance-core'),
  G = require('../web/groove-core');
test('project-backed performance validation bounds imports and leaves old projects compatible', () => {
  const old = G.project();
  assert.deepEqual(G.validate(old), old);
  const raw = {
    ...old,
    performance: {
      controller: {cutoff: 999, bend: 2, root: -2},
      macros: [NaN, 2, -1],
      targets: [-1, 0, 0, 15, 16],
      mixer: {lanes: [{level: 9, low: -99}]},
      mappings: [{target: '__proto__'}, {target: 'macro.0', cc: 999}],
    },
  };
  const v = G.validate(raw).performance;
  assert.equal(v.controller.cutoff, 100);
  assert.equal(v.controller.bend, 0);
  assert.deepEqual(v.targets, [0, 15]);
  assert.deepEqual(v.macros, [0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(v.mixer.lanes[0].level, 1.5);
  assert.equal(v.mixer.lanes[0].low, -18);
  assert.equal(v.mappings.length, 1);
  assert.equal(v.mappings[0].cc, 127);
});
test('undo coalesces a drag, redo branches safely, and held experiments never persist', () => {
  const s = new P.Store();
  s.update(v => (v.macros[0] = 0.2), 'weight', 1000);
  s.update(v => (v.macros[0] = 0.4), 'weight', 1100);
  s.update(v => (v.controller.cutoff = 40), 'tone', 1200);
  s.undo();
  assert.equal(s.snapshot().controller.cutoff, 100);
  assert.equal(s.snapshot().macros[0], 0.4);
  s.undo();
  assert.equal(s.snapshot().macros[0], 0);
  s.redo();
  assert.equal(s.snapshot().macros[0], 0.4);
  const before = s.snapshot(),
    past = s.past.length;
  s.beginHold();
  s.update(v => (v.macros[0] = 1));
  assert.equal(s.snapshot().macros[0], 1);
  assert.deepEqual(s.project(), before);
  s.undo();
  assert.equal(s.snapshot().macros[0], 1);
  s.endHold();
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.past.length, past);
  s.update(v => (v.macros[1] = 0.3));
  assert.equal(s.future.length, 0);
  s.load();
  assert.equal(s.past.length, 0);
});
test('MIDI parser preserves channels, velocity-zero releases, pressure and wheel; pickup waits for crossing', () => {
  assert.deepEqual(P.midi([0x92, 60, 127]), {type: 'on', channel: 2, note: 60, velocity: 1});
  assert.equal(P.midi([0x92, 60, 0]).type, 'off');
  assert.equal(P.midi([0xe3, 0, 64]).value, 0);
  assert.equal(P.midi([0xd4, 127]).value, 1);
  assert.equal(P.midi([0xa4, 61, 32]).note, 61);
  assert.equal(P.midi([0xf8]), null);
  assert.equal(P.pickup(undefined, 0.1, 0.5), false);
  assert.equal(P.pickup(0.1, 0.6, 0.5), true);
  assert.equal(P.pickup(0.6, 0.7, 0.5), false);
  assert.equal(P.pickup(undefined, 0.5, 0.5), true);
});
test('neutral macros preserve every sound control; selected macros leave the original patch untouched', () => {
  const s = G.project().patterns[0].tracks[4],
    before = P.clone(s),
    neutral = P.shape(s, Array(8).fill(0));
  for (const k of Object.keys(s)) assert.deepEqual(neutral[k], s[k], k);
  assert.equal(P.shape(s, Array(8).fill(1), false), s);
  const shaped = P.shape(s, Array(8).fill(1));
  assert.deepEqual(s, before);
  assert.notEqual(shaped.cutoff, s.cutoff);
  assert.ok(shaped.decay < s.decay);
  assert.equal(shaped.performance.drift, 1);
});
test('portable takes validate projects, bound expression, reject unknown gestures and invalid times', () => {
  const raw = {
    version: 1,
    kind: 'afterhours-performance',
    duration: 2,
    initial: {groove: {project: G.project()}, synth: {id: 'forest'}},
    events: [
      {time: 1, type: 'expression', value: {prefix: 'midi:test:', type: 'pressure', value: -2}},
      {time: 0.2, type: 'noteOn', value: {id: 'a', note: 60, velocity: 0.7}},
    ],
  };
  const t = P.take(raw, G.validate);
  assert.equal(t.events[0].type, 'noteOn');
  assert.equal(t.events[1].value.value, 0);
  assert.equal(t.initial.groove.project.patterns.length, 4);
  assert.throws(() => P.take({...raw, events: [{time: 3, type: 'panic'}]}, G.validate));
  assert.throws(() => P.take({...raw, events: [{time: 0, type: 'eval'}]}, G.validate));
  assert.throws(() => P.take({...raw, events: Array(20001).fill({time: 0, type: 'panic'})}, G.validate));
});
test('take parts keep names and time ranges, support old files, and reject invalid boundaries and duplicate IDs', () => {
  const raw = {
    version: 1,
    kind: 'afterhours-performance',
    duration: 8,
    initial: {groove: {project: G.project()}, synth: {id: 'forest'}},
    events: [],
  };
  assert.deepEqual(P.take(raw, G.validate).parts, []);
  const parts = [
    {id: 'chorus', name: 'Chorus', start: 4, end: 8},
    {id: 'intro', name: 'Intro', start: 0, end: 4},
  ];
  assert.deepEqual(P.take({...raw, parts}, G.validate).parts, [parts[1], parts[0]]);
  for (const bad of [
    [{id: 'a', start: -1, end: 2}],
    [{id: 'a', start: 0, end: 9}],
    [{id: 'a', start: 2, end: 2}],
    [{id: 'a', start: 0, end: Infinity}],
    [{id: 'a', start: NaN, end: 2}],
    [parts[0], parts[0]],
    Array(65).fill(parts[0]),
  ])
    assert.throws(() => P.take({...raw, parts: bad}, G.validate));
});

test('Rust voice controls survive saved takes and patch changes', () => {
  const initial = {id: 'clockwork-pulse', pulseWidth: 0.27, glide: 0.12};
  const raw = {
    version: 1,
    kind: 'afterhours-performance',
    duration: 2,
    initial: {groove: {project: G.project()}, synth: initial},
    events: [
      {time: 0.2, type: 'synthControl', value: {key: 'pulseWidth', value: 0.6}},
      {time: 0.4, type: 'synthControl', value: {key: 'glide', value: 0.2}},
      {time: 1, type: 'patch', value: {...initial, pulseWidth: 0.4, glide: 0.08}},
    ],
  };
  const take = P.take(JSON.parse(JSON.stringify(raw)), G.validate);
  assert.deepEqual(take.initial.synth, initial);
  assert.deepEqual(take.events, raw.events);
});

test('MIDI Learn retains pulse-width and glide mappings through updates and project reload', () => {
  const mappings = ['synth.pulseWidth', 'synth.glide'].map((target, i) => ({
    device: 'Keys',
    channel: 0,
    cc: 20 + i,
    target,
  }));
  const store = new P.Store();
  store.update(s => {
    s.mappings = mappings;
  }, 'midi-learn');
  assert.deepEqual(store.snapshot().mappings, mappings);
  assert.deepEqual(new P.Store(JSON.parse(JSON.stringify(store.project()))).snapshot().mappings, mappings);
});

test('take validation preserves long-running clocks together, including fractional song and pattern positions', () => {
  for (const clocks of [
    {offsetTicks: 40010, songOffset: -40000, loopOrigin: 40000},
    {offsetTicks: 90010.5, songOffset: -90000, loopOrigin: 90000},
    {offsetTicks: 100010.25, songOffset: 0, loopOrigin: 100000},
  ]) {
    const raw = {
      version: 1,
      kind: 'afterhours-performance',
      duration: 1,
      events: [],
      initial: {groove: {project: G.project(), ...clocks}, synth: {id: 'forest'}},
    };
    const saved = P.take(JSON.parse(JSON.stringify(raw)), G.validate).initial.groove;
    for (const [key, value] of Object.entries(clocks)) assert.equal(saved[key], value);
    assert.equal(saved.offsetTicks + saved.songOffset, clocks.offsetTicks + clocks.songOffset);
    assert.equal(saved.offsetTicks - saved.loopOrigin, clocks.offsetTicks - clocks.loopOrigin);
  }
});
