'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  Core = require('../web/performance-core'),
  Clock = require('../web/performance-midi-clock'),
  Groove = require('../web/groove-core');
const keys = {id: 'keys', name: 'MPK mini Plus II MIDI', manufacturer: 'AKAI'},
  daw = {...keys, id: 'daw', name: 'MPK mini Plus II DAW'};
function rig() {
  const window = new EventTarget(),
    document = new EventTarget(),
    store = new Core.Store(),
    notes = new Set(),
    values = new Map(),
    actions = [];
  const P = {
    core: Core,
    store,
    snapshot: () => store.snapshot(),
    targets: new Map(),
    register(id, t) {
      this.targets.set(id, t);
    },
    event() {},
  };
  for (const target of ['macro.0', 'macro.1', 'synth.cutoff', 'mixer.0.level', 'mixer.8.level']) {
    values.set(target, 0.5);
    P.targets.set(target, {min: 0, max: 1, get: () => values.get(target), set: v => values.set(target, v)});
  }
  const synth = {
    snapshot: () => ({id: 'forest'}),
    off: id => notes.delete(id),
    midiOn: async (id, note) => {
      notes.add(id);
      return {note};
    },
    expression() {},
    held: () => [],
  };
  const App = {
    S: {selected: 0, data: Groove.project()},
    save() {},
    ui: {refreshSound() {}},
    track() {
      return this.S.data.patterns[this.S.data.active].tracks[this.S.selected];
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: {},
    Event,
    CustomEvent,
    requestAnimationFrame: fn => fn(),
    AfterhoursPerformance: P,
    AfterhoursSynth: synth,
    AfterhoursGroove: Groove,
    AfterhoursGrooveApp: App,
  });
  vm.runInContext(fs.readFileSync('web/mpk-controls.js', 'utf8'), context);
  context.AfterhoursMPKControls = window.AfterhoursMPKControls;
  vm.runInContext(fs.readFileSync('web/performance-midi.js', 'utf8'), context);
  window.addEventListener('afterhours:midiaction', e => actions.push(e.detail));
  return {
    M: window.AfterhoursLiveMIDI,
    window,
    store,
    notes,
    values,
    actions,
    App,
    P,
    controls: window.AfterhoursMPKControls,
  };
}
test('parser rejects truncated and invalid messages; program pads and relative formats are explicit', () => {
  for (const bytes of [
    [0x90, 60],
    [0xb0, 1],
    [0x90, 128, 1],
    [0x90, 60, -1],
    [60, 1, 2],
  ])
    assert.equal(Core.midi(bytes), null);
  assert.deepEqual(Core.midi([0xc9, 12]), {type: 'program', channel: 9, number: 12});
  for (const [mode, up, down, idle] of [
    ['twos-complement', 1, 127, 0],
    ['binary-offset', 65, 63, 64],
    ['sign-magnitude', 1, 65, 64],
  ]) {
    assert.equal(Core.relative(up, mode), 1);
    assert.equal(Core.relative(down, mode), -1);
    assert.equal(Math.abs(Core.relative(idle, mode)), 0);
  }
});
test('MPK profile scopes automatic ports, prevents DAW notes, preserves piano and consumes learned pads on their channel only', () => {
  const {M, store, notes, actions} = rig();
  store.update(s => {
    s.midi.profile = 'mpk-mini-plus-ii';
  });
  for (const input of [
    daw,
    {...keys, id: 'plugin', name: 'MPK mini Plus II Plugin'},
    {...keys, id: 'other', name: 'Other keys'},
  ])
    M.receive(input, [0x90, 60, 100]);
  assert.equal(notes.size, 0);
  M.learn(['mpk.pad.0']);
  M.receive(keys, [0x99, 36, 80]);
  assert.equal(actions.length, 0);
  assert.equal(notes.size, 0);
  M.receive(keys, [0x89, 36, 0]);
  M.receive(keys, [0x99, 36, 100]);
  M.receive(keys, [0x89, 36, 0]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].velocity, 100 / 127);
  M.receive(keys, [0x90, 36, 100]);
  assert.equal(notes.size, 1);
  M.receive(keys, [0x80, 36, 0]);
  assert.equal(notes.size, 0);
  const saved = JSON.parse(JSON.stringify(store.project()));
  store.load(saved);
  assert.equal(store.state.mappings[0].type, 'note');
  assert.equal(store.state.mappings[0].channel, 9);
  store.update(s => {
    s.midi.padMode = 'notes';
  });
  M.receive(keys, [0x99, 36, 100]);
  assert.equal(notes.size, 1);
  store.update(s => {
    s.midi.padMode = 'drums';
  });
  assert.equal(notes.size, 0, 'changing pad mode must release held pad notes before note-off is consumed');
});
test('learning a specific control replaces a conflicting wildcard binding', () => {
  const {M, store, values} = rig();
  store.load({mappings: [{device: '*', channel: 0, cc: 21, target: 'macro.0'}]});
  M.learn(['macro.1'], 'direct');
  M.receive(keys, [0xb0, 21, 0]);
  M.receive(keys, [0xb0, 21, 127]);
  assert.equal(values.get('macro.0'), 0.5);
  assert.equal(values.get('macro.1'), 1);
  assert.equal(store.state.mappings.length, 1);
});
test('knob wizard ignores repeated CCs, relative turns move immediately, banks rearm absolute pickup', () => {
  const {M, store, values} = rig();
  store.update(s => {
    s.midi.profile = 'mpk-mini-plus-ii';
    s.midi.knobBank = 'macros';
  });
  M.learn(['mpk.knob.0', 'mpk.knob.1'], 'twos-complement');
  M.receive(keys, [0xb0, 21, 1]);
  M.receive(keys, [0xb0, 21, 2]);
  M.receive(keys, [0xb0, 22, 1]);
  assert.equal(store.state.mappings.length, 2);
  M.receive(keys, [0xb0, 21, 1]);
  assert.equal(values.get('macro.0'), 0.5 + 1 / 127);
  M.receive(keys, [0xb0, 21, 127]);
  assert.equal(values.get('macro.0'), 0.5);
  store.update(s => {
    s.mappings[0].mode = 'absolute';
  });
  M.receive(keys, [0xb0, 21, 0]);
  assert.equal(values.get('macro.0'), 0.5);
  M.receive(keys, [0xb0, 21, 100]);
  assert.equal(values.get('macro.0'), 100 / 127);
  store.update(s => {
    s.midi.knobBank = 'mixer-b';
  });
  M.receive(keys, [0xb0, 21, 120]);
  assert.equal(values.get('mixer.8.level'), 0.5);
  M.receive(keys, [0xb0, 21, 0]);
  assert.equal(values.get('mixer.8.level'), 0);
});
test('CC actions fire on presses, program changes retrigger, note-only transport needs no release, replay ignores input', () => {
  const {M, window, store, notes, actions} = rig();
  M.learn(['action.play-stop']);
  M.receive(daw, [0xb0, 30, 127]);
  M.receive(daw, [0xb0, 30, 0]);
  M.receive(daw, [0xb0, 30, 127]);
  M.receive(daw, [0xb0, 30, 127]);
  assert.equal(actions.length, 1);
  M.receive(daw, [0xb0, 30, 0]);
  M.receive(daw, [0xb0, 30, 127]);
  assert.equal(actions.length, 2);
  M.learn(['action.stop']);
  M.receive(daw, [0x90, 44, 100]);
  M.receive(daw, [0x90, 44, 100]);
  M.receive(daw, [0x90, 44, 100]);
  assert.equal(actions.length, 4);
  assert.equal(notes.size, 0);
  M.learn(['action.scene.0']);
  M.receive(keys, [0xc9, 12]);
  M.receive(keys, [0xc9, 12]);
  assert.equal(actions.length, 5);
  window.AfterhoursPerformanceStudio = {replaying: true};
  M.receive(keys, [0xc9, 12]);
  assert.equal(actions.length, 5);
  store.load(store.project());
  assert.equal(store.state.mappings.length, 3);
});
test('legacy absolute CC mappings and sustain still work after reload', () => {
  const {M, store, values, notes} = rig();
  store.load({mappings: [{device: '*', channel: 0, cc: 21, target: 'macro.0'}]});
  M.receive(keys, [0xb0, 21, 0]);
  M.receive(keys, [0xb0, 21, 127]);
  assert.equal(values.get('macro.0'), 1);
  M.receive(keys, [0x90, 60, 127]);
  M.receive(keys, [0xb0, 64, 127]);
  M.receive(keys, [0x80, 60, 0]);
  assert.equal(notes.size, 1);
  M.receive(keys, [0xb0, 64, 0]);
  assert.equal(notes.size, 0);
});
test('MIDI clock schedules 24 pulses per beat, cancels queued ticks at Stop and keeps outputs isolated', () => {
  const clock = new Clock(),
    messages = [],
    other = [],
    output = {send: (bytes, at) => messages.push({bytes, at}), clear: () => messages.push({clear: true})};
  clock.tick({running: true, beat: 0, bpm: 120}, 0);
  assert.equal(messages.length, 0);
  clock.select(output);
  for (let ms = 0; ms < 1000; ms += 25) clock.tick({running: true, beat: ms / 500, bpm: 120}, ms);
  const pulses = messages.filter(m => m.bytes?.[0] === 0xf8 && m.at < 1000);
  assert.equal(pulses.length, 48);
  assert.deepEqual(messages[0].bytes, [0xfa]);
  for (let i = 1; i < pulses.length; i++) assert.ok(Math.abs(pulses[i].at - pulses[i - 1].at - 500 / 24) < 0.001);
  clock.tick({running: false}, 1000);
  assert.deepEqual(messages.slice(-2), [{clear: true}, {bytes: [0xfc], at: undefined}]);
  clock.select({send: b => other.push(b), clear() {}});
  clock.tick({running: true, beat: 8, bpm: 90}, 2000);
  assert.deepEqual(other.slice(0, 2), [[0xf2, 32, 0], [0xfb]]);
  const length = messages.length;
  clock.tick({running: true, beat: 8.1, bpm: 150}, 2025);
  assert.equal(messages.length, length);
});
test('profile validation bounds bindings and lane hits survive take export', () => {
  const state = Core.validate({
    midi: {profile: 'unknown', padMode: '__proto__'},
    mappings: [
      {target: 'action.delete'},
      {target: 'mpk.pad.16'},
      {target: 'action.record', type: 'program', number: 999},
    ],
  });
  assert.equal(state.midi.profile, 'generic');
  assert.equal(state.midi.padMode, 'drums');
  assert.equal(state.mappings.length, 1);
  assert.equal(state.mappings[0].number, 127);
  const G = require('../web/groove-core');
  const take = Core.take(
    {
      version: 1,
      kind: 'afterhours-performance',
      duration: 1,
      initial: {groove: {project: G.project()}, synth: {id: 'forest'}},
      events: [{time: 0, type: 'laneHit', value: {lane: 9, velocity: 0.4}}],
    },
    G.validate,
  );
  assert.deepEqual(take.events[0].value, {lane: 9, velocity: 0.4});
});

test('guided learning reports progress, skips without replacing mappings and cancels on project changes', () => {
  const {M, store, actions} = rig();
  const progress = [];
  M.learn(['mpk.knob.0', 'mpk.pad.0', 'action.play'], 'absolute', p => progress.push({...p}));
  assert.equal(progress.at(-1).target, 'mpk.knob.0');
  M.receive(keys, [0xb0, 20, 64]);
  assert.equal(progress.at(-1).target, 'mpk.pad.0');
  M.receive(keys, [0xb0, 20, 65]);
  assert.equal(progress.at(-1).index, 1);
  M.skip();
  assert.equal(progress.at(-1).target, 'action.play');
  M.receive(daw, [0x90, 110, 127]);
  assert.equal(progress.at(-1).index, 3);
  assert.equal(progress.at(-1).target, undefined);
  assert.equal(actions.length, 0);
  assert.equal(store.snapshot().mappings.length, 2);
  M.learn(['mpk.pad.0'], 'absolute', p => progress.push({...p}));
  store.update(s => {
    s.midi.padMode = 'mute';
  });
  assert.equal(progress.at(-1).cancelled, true);
});

test('central encoder learns relative direction and survives validation without becoming a button', () => {
  for (const [forward, backward, mode] of [
    [1, 127, 'twos-complement'],
    [65, 63, 'binary-offset'],
  ]) {
    const {M, store, actions} = rig();
    store.update(s => {
      s.midi.profile = 'mpk-mini-plus-ii';
    });
    M.learn(['mpk.instrument']);
    M.receive(daw, [0xb0, 16, forward]);
    assert.equal(store.snapshot().mappings[0].mode, mode);
    assert.equal(actions.length, 0);
    M.receive(daw, [0xb0, 16, forward]);
    M.receive(daw, [0xb0, 16, backward]);
    assert.deepEqual(
      actions.map(a => a.direction),
      [1, -1],
    );
  }
});

test('bank switching pauses learning and consumes button messages without mapping or playing them', () => {
  const {M, store, actions, notes} = rig();
  const progress = [];
  M.learn(['mpk.pad.8', 'mpk.pad.9'], 'absolute', step => progress.push({...step}));
  M.pause();
  for (const bytes of [
    [0x90, 80, 127],
    [0x80, 80, 0],
    [0xb0, 49, 127],
    [0xc0, 12],
    [0x99, 44, 100],
  ])
    M.receive(daw, bytes);
  assert.equal(store.snapshot().mappings.length, 0);
  assert.equal(progress.length, 1);
  assert.equal(actions.length, 0);
  assert.equal(notes.size, 0);
  M.resume();
  M.receive(keys, [0x99, 44, 100]);
  const binding = store.snapshot().mappings[0];
  assert.equal(binding.target, 'mpk.pad.8');
  assert.equal(binding.number, 44);
  assert.equal(binding.type, 'note');
  assert.equal(progress.at(-1).target, 'mpk.pad.9');
  M.cancel();
  M.resume();
  assert.equal(progress.at(-1).cancelled, true);
});

test('extended learning protects existing buttons when a SHIFT combination emits the same message', () => {
  const {M, store, actions} = rig();
  M.learn(['action.undo']);
  M.receive(daw, [0x90, 110, 127]);
  M.learn(['action.redo', 'action.jam-confirm'], 'absolute', undefined, true);
  M.receive(daw, [0x90, 110, 127]);
  assert.equal(store.state.mappings.find(m => m.number === 110).target, 'action.undo');
  assert.equal(actions.length, 0);
  M.receive(daw, [0x90, 111, 127]);
  M.receive(daw, [0x90, 112, 127]);
  M.receive(daw, [0x90, 112, 127]);
  assert.equal(actions.at(-1).target, 'action.jam-confirm');
  const saved = Core.validate(store.project());
  assert.deepEqual(
    saved.mappings.map(m => m.target),
    ['action.undo', 'action.redo', 'action.jam-confirm'],
  );
  for (const target of [
    'action.metronome',
    'action.quantize',
    'action.knob-bank-prev',
    'action.continue',
    'action.jam-listen',
    'action.jam-cancel',
  ]) {
    assert.equal(
      Core.validate({mappings: [{type: 'note', number: 80, channel: 0, device: '*', target}]}).mappings[0]?.target,
      target,
    );
  }
});

test('track knobs resolve the current lane, clamp values, support fine turns and stop only muted/unsoloed voices', () => {
  const {App, controls} = rig(),
    stopped = [];
  App.S.playing = 0;
  App.S.engine = {stopLane: i => stopped.push(i)};
  const first = App.track().cutoff;
  controls.turn(controls.target('track-sound', 0), 1, true);
  assert.equal(App.track().cutoff, first + 15900 / 508);
  App.S.selected = 15;
  controls.target('track-sound', 0).set(99999);
  assert.equal(App.track().cutoff, 16000);
  assert.equal(App.S.data.patterns[0].tracks[0].cutoff, first + 15900 / 508);
  controls.target('track-rhythm', 0).set(2.7);
  assert.equal(App.track().length, 3);
  controls.turn(controls.target('track-rhythm', 2), 1);
  assert.equal(App.track().mute, true);
  assert.deepEqual(stopped, [15]);
  controls.turn(controls.target('track-rhythm', 2), -1);
  assert.equal(App.track().mute, false);
  assert.deepEqual(stopped, [15]);
  stopped.length = 0;
  controls.turn(controls.target('track-rhythm', 3), 1);
  assert.deepEqual(
    stopped,
    Array.from({length: 15}, (_, i) => i),
  );
  controls.target('track-rhythm', 1).set(0);
  assert.equal(App.track().rate, 0.5);
  assert.equal(controls.format(controls.target('track-rhythm', 3)), 'On');
  App.track().machine = 'Instrument';
  assert.equal(controls.targetId('track-sound', 1), 'mpk.track.instrumentRelease');
  const release = controls.target('track-sound', 1);
  assert.equal(controls.format(release), 'Recorded');
  controls.turn(release, 1);
  assert.ok(App.track().instrumentRelease > 0);
  controls.turn(release, -1);
  assert.equal(App.track().instrumentRelease, undefined);
  assert.equal(controls.target('track-motion', 0), undefined);
  App.track().machine = 'Sample';
  assert.equal(controls.targetId('track-sound', 2), 'mixer.15.low');
  assert.equal(controls.target('track-rhythm', 4), undefined);
  App.track().machine = 'WavePad';
  assert.equal(controls.targetId('track-motion', 1), 'mpk.track.filter');
  assert.equal(controls.targetId('track-motion', 6), 'mpk.track.chord');
});

test('learned absolute track knobs rearm pickup when selecting a different track', () => {
  const {M, store, App} = rig();
  store.load({
    midi: {profile: 'mpk-mini-plus-ii', knobBank: 'track-sound'},
    mappings: [{device: '*', channel: 0, cc: 21, mode: 'absolute', target: 'mpk.knob.0'}],
  });
  App.track().cutoff = 100;
  M.receive(keys, [176, 21, 0]);
  M.receive(keys, [176, 21, 64]);
  assert.ok(App.track().cutoff > 8000);
  App.S.selected = 1;
  App.track().cutoff = 16000;
  M.receive(keys, [176, 21, 65]);
  assert.equal(App.track().cutoff, 16000);
  M.receive(keys, [176, 21, 127]);
  M.receive(keys, [176, 21, 64]);
  assert.ok(App.track().cutoff < 9000);
});
