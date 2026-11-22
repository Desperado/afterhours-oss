'use strict';
// One bank definition is shared by native DAW encoders and learned User Presets.
window.AfterhoursMPKControls = (() => {
  const P = AfterhoursPerformance,
    App = AfterhoursGrooveApp,
    G = AfterhoursGroove;
  const banks = [
    ['synth', 'Live Synth'],
    ['macros', 'Macros'],
    ['mixer-a', 'Levels 1–8'],
    ['mixer-b', 'Levels 9–16'],
    ['track-sound', 'Track sound'],
    ['track-mix', 'Track mixer'],
    ['track-motion', 'Track motion'],
    ['track-rhythm', 'Track rhythm'],
    ['synth-extra', 'Synth extra'],
  ];
  let pending = false;
  function changed(pattern, lane, path) {
    App.save();
    window.dispatchEvent(new CustomEvent('afterhours:groove-sound', {detail: {pattern, lane, path}}));
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      App.ui.refreshSound();
    });
  }
  const read = (object, path) => path.split('.').reduce((v, key) => v[key], object);
  const write = (object, path, value) => {
    const keys = path.split('.'),
      key = keys.pop();
    keys.reduce((v, k) => v[k], object)[key] = value;
  };
  function control(path, label, min, max, step = 0, options) {
    const id = 'mpk.track.' + path;
    P.register(id, {
      label,
      min,
      max,
      step,
      get: () => {
        const value = read(App.track(), path);
        return options ? Math.max(0, options.indexOf(value)) : (value ?? min);
      },
      set: (value, {pattern = App.S.data.active, lane = App.S.selected, replay = false} = {}) => {
        if ((!replay && window.AfterhoursPerformanceStudio?.replaying) || !Number.isFinite(value)) return;
        const track = App.S.data.patterns[pattern]?.tracks[lane];
        if (!track) return;
        value = Math.max(min, Math.min(max, value));
        if (path === 'instrumentRelease' && value > 0) value = Math.max(0.005, value);
        if (step) value = Math.round(value / step) * step;
        const next = options ? options[Math.round(value)] : value;
        if (
          read(track, path) === next ||
          (path === 'instrumentRelease' && !next && track.instrumentRelease === undefined)
        )
          return;
        if (path === 'instrumentRelease' && !next) delete track.instrumentRelease;
        else write(track, path, next);
        if (pattern === App.S.playing && path === 'mute' && next) App.transport.stopLane(lane);
        if (pattern === App.S.playing && path === 'solo' && next)
          App.S.data.patterns[pattern].tracks.forEach((t, i) => {
            if (!t.solo) App.transport.stopLane(i);
          });
        if (!replay) P.event('trackControl', {pattern, lane, path, value});
        changed(pattern, lane, path);
      },
      format: value =>
        ['mute', 'solo'].includes(path)
          ? value
            ? 'On'
            : 'Off'
          : options
            ? String(options[Math.round(value)])
            : path === 'cutoff'
              ? `${Math.round(value)} Hz`
              : path === 'instrumentRelease' && !value
                ? 'Recorded'
                : ['decay', 'instrumentRelease'].includes(path)
                  ? `${value.toFixed(2)} s`
                  : String(Number(value.toFixed(2))),
    });
    return id;
  }
  for (const [key, [label, min, max, step]] of Object.entries(G.controls))
    control(key, label, min, max, key === 'note' ? step : 0);
  control('instrumentRelease', 'Release', 0, 2);
  control('algorithm', 'FM algorithm', 0, 1, 1, ['parallel', 'serial']);
  control('chord', 'Chord', 0, 2, 1, ['minor7', 'major7', 'fifth']);
  control('filter', 'Filter model', 0, 1, 1, ['biquad', 'ladder']);
  control('lfo.depth', 'LFO depth', 0, 100);
  control('lfo.target', 'LFO target', 0, 3, 1, ['shape', 'cutoff', 'pitch', 'pan']);
  control('lfo.division', 'LFO period', 0, 6, 1, [0.25, 0.5, 1, 2, 4, 8, 16]);
  control('lfo.shape', 'LFO shape', 0, 3, 1, ['sine', 'triangle', 'square', 'sawtooth']);
  control('length', 'Loop steps', 1, 64, 1);
  control('rate', 'Track speed', 0, 2, 1, [0.5, 1, 2]);
  control('mute', 'Track mute', 0, 1, 1, [false, true]);
  control('solo', 'Track solo', 0, 1, 1, [false, true]);
  const mix = key => `mixer.${App.S.selected}.${key}`;
  const track = key => 'mpk.track.' + key;
  function targetId(bank, i) {
    if (bank === 'macros') return 'macro.' + i;
    if (bank === 'mixer-a' || bank === 'mixer-b') return `mixer.${i + (bank === 'mixer-b' ? 8 : 0)}.level`;
    if (bank === 'track-mix') return mix(['level', 'pan', 'low', 'mid', 'high', 'drive', 'delay', 'reverb'][i]);
    const t = App.track();
    const patch = AfterhoursSynth.snapshot();
    const matched = patch.family === 'groove' && patch.lane === App.S.selected;
    if (bank === 'track-sound' || (bank === 'synth' && matched)) {
      if (t.machine === 'Sample')
        return [track('volume'), track('pan'), ...['low', 'mid', 'high', 'drive', 'delay', 'reverb'].map(mix)][i];
      if (t.machine === 'Instrument')
        return ['cutoff', 'instrumentRelease', 'volume', 'pan']
          .map(track)
          .concat(['low', 'drive', 'delay', 'reverb'].map(mix))[i];
      return ['cutoff', 'shape', 'color', 'sweep', 'contour', 'decay', 'volume', 'pan'].map(track)[i];
    }
    if (bank === 'track-motion') {
      if (['Sample', 'Instrument'].includes(t.machine)) return null;
      const chord = t.machine === 'Chord';
      const filter = ['Ladder', 'DualVCO', 'Wavetable', 'WavePad'].includes(t.machine);
      return [
        'note',
        chord ? 'chord' : filter ? 'filter' : ['Saw', 'Analog'].includes(t.machine) ? 'contour' : 'algorithm',
        'lfo.depth',
        'lfo.target',
        'lfo.division',
        'lfo.shape',
        t.machine === 'WavePad' ? 'chord' : 'decay',
        'cutoff',
      ].map(track)[i];
    }
    if (bank === 'track-rhythm')
      return [
        'length',
        'rate',
        'mute',
        'solo',
        t.machine === 'Sample' ? null : 'note',
        t.machine === 'Sample' ? null : t.machine === 'Instrument' ? 'instrumentRelease' : 'decay',
        'volume',
        'pan',
      ].map(key => (key ? track(key) : null))[i];
    if (patch.family === 'groove') return null;
    const keys =
      bank === 'synth-extra'
        ? ['drive', 'chorus', 'pulseWidth', 'glide', 'envelope', 'volume', 'delay', 'reverb']
        : ['cutoff', 'resonance', 'position', 'motion', 'attack', 'release', 'delay', 'reverb'];
    const key = keys[i];
    if (
      (['position', 'envelope'].includes(key) && !patch.family) ||
      (key === 'motion' && !['wave', 'analog'].includes(patch.family)) ||
      (['pulseWidth', 'glide'].includes(key) && patch.family !== 'analog')
    )
      return null;
    return 'synth.' + key;
  }
  const target = (bank, i) => P.targets.get(targetId(bank, i));
  // Part of a turn that a control's own rounding swallowed. On-screen knobs round to their step
  // (0.01 for macros), so a SHIFT (fine) tick of 1/508 would otherwise never move them.
  const residue = new WeakMap();
  function turn(t, delta, fine = false) {
    if (!t || !delta || window.AfterhoursPerformanceStudio?.replaying) return;
    const amount = (delta * (t.max - t.min)) / (fine ? 508 : 127);
    if (t.step) {
      t.set(Math.max(t.min, Math.min(t.max, t.get() + Math.sign(delta) * Math.max(t.step, Math.abs(amount)))));
      return;
    }
    const carried = Math.sign(residue.get(t) || 0) === Math.sign(delta) ? residue.get(t) : 0;
    const wanted = Math.max(t.min, Math.min(t.max, t.get() + amount + carried));
    t.set(wanted);
    residue.set(t, wanted - t.get());
  }
  const format = t => {
    const value = t.get();
    if (t.format) return t.format(value);
    return Math.round(((value - t.min) / (t.max - t.min)) * 100) + '%';
  };
  return {banks, targetId, target, turn, format};
})();
