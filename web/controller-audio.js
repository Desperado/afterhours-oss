'use strict';
// Project-backed performance layer. Offline renders take a frozen copy.
window.AfterhoursController = (() => {
  const controls = {
    cutoff: {label: 'Tone', min: 0, max: 100, step: 1, value: 100},
    resonance: {label: 'Resonance', min: 0.7, max: 6, step: 0.1, value: 0.7},
    drive: {label: 'Heat', min: 0, max: 1, step: 0.01, value: 0},
    motion: {label: 'Movement', min: 0, max: 1, step: 0.01, value: 0},
    rate: {label: 'Motion rate', min: 0.1, max: 8, step: 0.1, value: 0.7},
    space: {label: 'Space', min: 0, max: 1, step: 0.01, value: 0},
    transpose: {label: 'Transpose', min: -24, max: 24, step: 1, value: 0},
    cents: {label: 'Fine tune', min: -100, max: 100, step: 1, value: 0},
    glide: {label: 'Glide', min: 0.01, max: 0.4, step: 0.01, value: 0.04},
  };
  const scales = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    whole: [0, 2, 4, 6, 8, 10],
    hirajoshi: [0, 2, 3, 7, 8],
  };
  const defaults = () => ({
    enabled: true,
    scale: 'chromatic',
    temperament: 'equal',
    root: 0,
    bend: 0,
    ...Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.value])),
  });
  let state = defaults(),
    overlay = {},
    target = 'all';
  const effective = () => ({...state, ...overlay});
  const sessions = new Set(),
    listeners = new Set();
  const snapshot = () => ({...state});
  function change(values) {
    const oldBend = state.bend;
    for (const [key, c] of Object.entries(controls))
      if (Number.isFinite(values[key])) state[key] = Math.max(c.min, Math.min(c.max, values[key]));
    if (typeof values.enabled === 'boolean') state.enabled = values.enabled;
    if (scales[values.scale]) state.scale = values.scale;
    if (['equal', 'just', 'pythagorean', '19edo'].includes(values.temperament)) state.temperament = values.temperament;
    if (Number.isInteger(values.root)) state.root = ((values.root % 12) + 12) % 12;
    if (Number.isFinite(values.bend)) state.bend = Math.max(-2, Math.min(2, values.bend));
    sessions.forEach(s => s.apply(effective()));
    listeners.forEach(fn => fn(snapshot()));
    if (oldBend !== state.bend) window.AfterhoursPerformance?.event('bend', state.bend);
  }
  function cents(note, s = state) {
    if (!s.enabled) return 0;
    const transposed = note + s.transpose,
      relative = transposed - s.root;
    // Search adjacent octaves too; ties choose the lower note consistently.
    let nearest = -Infinity,
      distance = Infinity;
    const octave = Math.floor(relative / 12);
    for (let o = octave - 1; o <= octave + 1; o++)
      for (const degree of scales[s.scale]) {
        const candidate = o * 12 + degree,
          d = Math.abs(candidate - relative);
        if (d < distance) {
          nearest = candidate;
          distance = d;
        }
      }
    const pc = ((nearest % 12) + 12) % 12;
    const ratios = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
    const pythagorean = [
      0, 90.225, 203.91, 294.135, 407.82, 498.045, 611.73, 701.955, 792.18, 905.865, 996.09, 1109.775,
    ];
    let offset = 0;
    if (s.temperament === 'just') offset = 1200 * Math.log2(ratios[pc]) - pc * 100;
    if (s.temperament === 'pythagorean') offset = pythagorean[pc] - pc * 100;
    if (s.temperament === '19edo') offset = (Math.round((nearest / 12) * 19) * 1200) / 19 - nearest * 100;
    return (nearest + s.root - note + s.bend) * 100 + offset + s.cents;
  }
  class Session {
    constructor(ctx, frozen, scope = 'groove') {
      this.scope = scope;
      this.ctx = ctx;
      this.state = {...(frozen || state)};
      this.tuners = new Set();
      const gain = v => {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
      this.input = gain(1);
      this.dry = gain(1);
      this.wet = gain(0);
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.clean = gain(1);
      this.dirty = gain(0);
      this.shaper = ctx.createWaveShaper();
      this.shaper.curve = Float32Array.from({length: 2049}, (_, i) => Math.tanh((i / 1024 - 1) * 4) / Math.tanh(4));
      this.shaper.oversample = '2x';
      this.pulse = gain(1);
      this.pan = ctx.createStereoPanner();
      this.lfo = ctx.createOscillator();
      this.depth = gain(0);
      this.width = gain(0);
      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = 0.375;
      this.feedback = gain(0.28);
      this.echo = gain(0);
      this.limit = ctx.createDynamicsCompressor();
      this.limit.threshold.value = -6;
      this.limit.knee.value = 6;
      this.limit.ratio.value = 16;
      this.limit.attack.value = 0.002;
      const destination = window.AfterhoursAudio?.output(ctx) || ctx.destination;
      this.input.connect(this.dry).connect(destination);
      this.input.connect(this.filter);
      this.filter.connect(this.clean).connect(this.pulse);
      this.filter.connect(this.shaper).connect(this.dirty).connect(this.pulse);
      this.pulse.connect(this.pan).connect(this.limit);
      this.pan.connect(this.delay).connect(this.echo).connect(this.limit);
      this.delay.connect(this.feedback).connect(this.delay);
      this.limit.connect(this.wet).connect(destination);
      this.lfo.connect(this.depth).connect(this.pulse.gain);
      this.lfo.connect(this.width).connect(this.pan.pan);
      this.lfo.start();
      this.live = ctx instanceof AudioContext && !frozen;
      this.apply(this.live ? effective() : this.state, true);
      if (this.live) sessions.add(this);
    }
    apply(s, immediate = false) {
      s = {...s, enabled: s.enabled && (!this.live || target === 'all' || target === this.scope)};
      this.state = {...s};
      const t = this.ctx.currentTime;
      const set = (p, v) => (immediate ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.02));
      const active = s.enabled && (s.cutoff < 100 || s.resonance > 0.7 || s.drive > 0 || s.motion > 0 || s.space > 0);
      set(this.dry.gain, active ? 0 : 1);
      set(this.wet.gain, active ? 1 : 0);
      set(this.filter.frequency, Math.min(this.ctx.sampleRate * 0.45, 80 * 250 ** (s.cutoff / 100)));
      set(this.filter.Q, s.resonance);
      set(this.clean.gain, 1 - s.drive);
      set(this.dirty.gain, s.drive);
      set(this.pulse.gain, 1 - s.motion * 0.25);
      set(this.depth.gain, s.motion * 0.25);
      set(this.width.gain, s.motion * 0.65);
      set(this.lfo.frequency, s.rate);
      set(this.echo.gain, s.space * 0.45);
      for (const tuner of this.tuners)
        tuner.source.offset.setTargetAtTime(cents(tuner.note, s) + tuner.extra, t, s.glide);
    }
    tune(note, oscillators, when = this.ctx.currentTime, extra = 0) {
      const source = this.ctx.createConstantSource(),
        tuner = {source, note, extra};
      source.offset.value = cents(note, this.state) + extra;
      oscillators.forEach(o => source.connect(o.detune));
      this.tuners.add(tuner);
      source.onended = () => {
        source.disconnect();
        this.tuners.delete(tuner);
      };
      source.start(when);
      return source;
    }
    clearTail() {
      this.pan.disconnect(this.delay);
      this.delay.disconnect();
      this.feedback.disconnect();
      this.delay = this.ctx.createDelay(1);
      this.delay.delayTime.value = 0.375;
      this.pan.connect(this.delay).connect(this.echo);
      this.delay.connect(this.feedback).connect(this.delay);
    }
    dispose() {
      sessions.delete(this);
      this.lfo.stop();
      for (const t of this.tuners) {
        try {
          t.source.stop();
        } catch {
          /* Already ended. */
        }
        t.source.disconnect();
      }
      this.tuners.clear();
      for (const key of [
        'input',
        'dry',
        'wet',
        'filter',
        'clean',
        'dirty',
        'shaper',
        'pulse',
        'pan',
        'lfo',
        'depth',
        'width',
        'delay',
        'feedback',
        'echo',
        'limit',
      ])
        this[key].disconnect();
    }
  }
  return {
    controls,
    snapshot,
    change,
    cents,
    Session,
    defaults,
    setTarget(value) {
      if (target === value) return;
      target = value;
      sessions.forEach(s => s.apply(effective()));
    },
    overlay(values) {
      if (JSON.stringify(overlay) === JSON.stringify(values)) return;
      overlay = values;
      sessions.forEach(s => s.apply(effective()));
    },
    reset: () => change(defaults()),
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
