/* Validated, portable performance data. No browser or audio dependencies. */
'use strict';
(function (root) {
  const clone = v => JSON.parse(JSON.stringify(v));
  const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const text = (v, d, n = 40) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d);
  const choice = (v, list, d) => (list.includes(v) ? v : d);
  const ranges = {
    cutoff: [0, 100, 100],
    resonance: [0.7, 6, 0.7],
    drive: [0, 1, 0],
    motion: [0, 1, 0],
    rate: [0.1, 8, 0.7],
    space: [0, 1, 0],
    transpose: [-24, 24, 0],
    cents: [-100, 100, 0],
    glide: [0.01, 0.4, 0.04],
  };
  const macroNames = ['Weight', 'Bite', 'Drift', 'Width', 'Air', 'Tension', 'Space', 'Pulse'];
  function controller(raw = {}) {
    raw = raw || {};
    return {
      enabled: raw.enabled !== false,
      scale: choice(raw.scale, ['chromatic', 'minor', 'dorian', 'whole', 'hirajoshi'], 'chromatic'),
      temperament: choice(raw.temperament, ['equal', 'just', 'pythagorean', '19edo'], 'equal'),
      root: Math.round(num(raw.root, 0, 11, 0)),
      bend: 0,
      ...Object.fromEntries(Object.entries(ranges).map(([k, [lo, hi, d]]) => [k, num(raw[k], lo, hi, d)])),
    };
  }
  const macros = v => Array.from({length: 8}, (_, i) => num(v?.[i], 0, 1, 0));
  const targets = v =>
    Array.isArray(v)
      ? [...new Set(v.filter(n => Number.isInteger(n) && n >= 0 && n < 16))]
      : Array.from({length: 16}, (_, i) => i);
  function scene(v, i) {
    return {
      name: text(v?.name, ['Intro', 'Warm', 'Unstable', 'Breakdown', 'Full force', 'Airborne', 'Nightfall', 'Home'][i]),
      controller: controller(v?.controller),
      macros: macros(v?.macros),
      targets: targets(v?.targets),
    };
  }
  const lane = v => ({
    level: num(v?.level, 0, 1.5, 1),
    pan: num(v?.pan, -1, 1, 0),
    low: num(v?.low, -18, 18, 0),
    mid: num(v?.mid, -18, 18, 0),
    high: num(v?.high, -18, 18, 0),
    delay: num(v?.delay, 0, 1, 0),
    reverb: num(v?.reverb, 0, 1, 0),
    mute: v?.mute === true,
    solo: v?.solo === true,
  });
  function validate(raw = {}) {
    raw = raw || {};
    const current = controller(raw.controller);
    return {
      version: 1,
      controller: current,
      slots: {
        a: controller(raw.slots?.a || current),
        b: controller(raw.slots?.b || {...current, cutoff: 65, drive: 0.25, motion: 0.4, space: 0.3}),
      },
      setups: (Array.isArray(raw.setups) ? raw.setups : [])
        .slice(0, 24)
        .map((s, i) => ({name: text(s?.name, `Setup ${i + 1}`), controller: controller(s?.controller)})),
      macros: macros(raw.macros),
      targets: targets(raw.targets),
      controllerTarget: choice(raw.controllerTarget, ['all', 'groove', 'synth', 'listen'], 'all'),
      scenes: Array.from({length: 8}, (_, i) => scene(raw.scenes?.[i], i)),
      morphBars: Math.round(num(raw.morphBars, 1, 8, 2)),
      mixer: {
        lanes: Array.from({length: 16}, (_, i) => lane(raw.mixer?.lanes?.[i])),
        drums: num(raw.mixer?.drums, 0, 1.5, 1),
        music: num(raw.mixer?.music, 0, 1.5, 1),
      },
      mappings: (Array.isArray(raw.mappings) ? raw.mappings : [])
        .slice(0, 128)
        .filter(
          m =>
            m &&
            typeof m.target === 'string' &&
            /^(controller\.(cutoff|resonance|drive|motion|rate|space|transpose|cents|glide)|macro\.[0-7]|synth\.(cutoff|resonance|position|motion|pulseWidth|glide|envelope|attack|release|drive|chorus|delay|reverb|volume)|mixer\.(?:[0-9]|1[0-5])\.(level|pan|low|mid|high|delay|reverb))$/.test(
              m.target,
            ),
        )
        .map(m => ({
          device: text(m.device, '*', 160),
          channel: Math.round(num(m.channel, 0, 15, 0)),
          cc: Math.round(num(m.cc, 0, 127, 0)),
          target: m.target,
        })),
      mods: (Array.isArray(raw.mods) ? raw.mods : []).slice(0, 4).map(m => ({
        source: choice(m?.source, ['sine', 'triangle', 'random', 'envelope', 'amplitude'], 'sine'),
        target: choice(m?.target, ['cutoff', 'motion', 'space', 'drive', 'cents'], 'cutoff'),
        depth: num(m?.depth, 0, 1, 0),
        beats: choice(m?.beats, [0.25, 0.5, 1, 2, 4, 8, 16, 32], 4),
        lane: Math.round(num(m?.lane, 0, 15, 0)),
        enabled: m?.enabled !== false,
      })),
    };
  }
  class Store {
    constructor(raw) {
      this.state = validate(raw);
      this.past = [];
      this.future = [];
      this.listeners = new Set();
      this.last = null;
      this.hold = null;
    }
    snapshot() {
      return clone(this.state);
    }
    project() {
      return clone(this.hold || this.state);
    }
    emit(reason) {
      for (const fn of this.listeners) fn(this.snapshot(), reason);
    }
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    update(fn, tag = 'edit', now = Date.now()) {
      const next = this.snapshot();
      fn(next);
      const valid = validate(next);
      if (JSON.stringify(valid) === JSON.stringify(this.state)) return;
      if (!this.hold) {
        if (!this.last || this.last.tag !== tag || now - this.last.time > 450) this.past.push(this.snapshot());
        this.past = this.past.slice(-80);
        this.future = [];
        this.last = {tag, time: now};
      }
      this.state = valid;
      this.emit(tag);
    }
    load(raw) {
      this.hold = null;
      this.state = validate(raw);
      this.past = [];
      this.future = [];
      this.last = null;
      this.emit('load');
    }
    undo() {
      if (this.hold || !this.past.length) return;
      this.future.push(this.snapshot());
      this.state = this.past.pop();
      this.last = null;
      this.emit('undo');
    }
    redo() {
      if (this.hold || !this.future.length) return;
      this.past.push(this.snapshot());
      this.state = this.future.pop();
      this.last = null;
      this.emit('redo');
    }
    beginHold() {
      if (!this.hold) {
        this.hold = this.snapshot();
        this.last = null;
      }
    }
    endHold() {
      if (!this.hold) return;
      this.state = this.hold;
      this.hold = null;
      this.emit('return');
    }
  }
  // A hardware control must cross the software value before taking ownership.
  function pickup(previous, value, current) {
    return (
      Math.abs(value - current) <= 1 / 127 ||
      (Number.isFinite(previous) && (previous - current) * (value - current) <= 0)
    );
  }
  function midi(bytes) {
    if (!bytes || bytes.length < 2) return null;
    const [status, a, b = 0] = bytes,
      channel = status & 15,
      type = status & 240;
    if (type === 144) return {type: b ? 'on' : 'off', channel, note: a, velocity: b / 127};
    if (type === 128) return {type: 'off', channel, note: a};
    if (type === 176) return {type: 'cc', channel, cc: a, value: b};
    if (type === 224) return {type: 'bend', channel, value: ((((b << 7) | a) - 8192) / 8192) * 2};
    if (type === 208) return {type: 'pressure', channel, value: a / 127};
    if (type === 160) return {type: 'pressure', channel, note: a, value: b / 127};
    return null;
  }
  function shape(settings, values, selected = true) {
    if (!selected) return settings;
    const [weight, bite, drift, width, air, tension, space, pulse] = values,
      s = {...settings};
    s.cutoff = Math.max(100, Math.min(16000, s.cutoff * 2 ** (air * 2 + tension * 2 - weight * 0.6)));
    s.color = Math.min(100, s.color + bite * 35);
    s.shape = Math.min(100, s.shape + tension * 30 + drift * 12);
    s.sweep = Math.min(100, s.sweep + tension * 20);
    s.decay = Math.max(0.04, s.decay * (1 - tension * 0.55 + pulse * 0.25));
    s.pan = Math.max(-100, Math.min(100, s.pan * (1 + width * 2) + (s.note % 2 ? -1 : 1) * width * 24));
    s.volume = Math.min(100, s.volume * (1 + weight * 0.18));
    s.performance = {bite, drift, width, space, pulse};
    return s;
  }
  function take(raw, validateProject, validateGrooveInstrument) {
    if (
      !raw ||
      raw.version !== 1 ||
      raw.kind !== 'afterhours-performance' ||
      !raw.initial?.groove?.project ||
      !Array.isArray(raw.events) ||
      raw.events.length > 20000
    )
      throw new Error('Choose an AFTERHOURS performance file (up to 20,000 gestures).');
    const duration = num(raw.duration, 0, 300, 0);
    const patch = v => {
      if (v?.id === 'groove-part') {
        if (!validateGrooveInstrument) throw new Error('Groove instrument validator required');
        return validateGrooveInstrument(v);
      }
      return {
        id: text(v?.id, 'forest', 40),
        ...Object.fromEntries(
          [
            'cutoff',
            'resonance',
            'position',
            'motion',
            'pulseWidth',
            'glide',
            'envelope',
            'attack',
            'release',
            'drive',
            'chorus',
            'delay',
            'reverb',
            'volume',
          ]
            .filter(k => Number.isFinite(v?.[k]))
            .map(k => [k, num(v[k], -100, 20000, 0)]),
        ),
      };
    };
    const id = v => text(v, 'note', 160);
    const events = raw.events
      .map(e => {
        if (!e || !Number.isFinite(e.time) || e.time < 0 || e.time > duration)
          throw new Error('Gesture time is outside this take.');
        let value;
        switch (e.type) {
          case 'state': {
            const clean = validate(e.value);
            value = Object.fromEntries(
              ['controller', 'macros', 'targets', 'controllerTarget', 'mixer', 'mods']
                .filter(k => Object.hasOwn(e.value || {}, k))
                .map(k => [k, clean[k]]),
            );
            break;
          }
          case 'noteOn':
            value = {
              id: id(e.value?.id),
              note: Math.round(num(e.value?.note, 0, 127, 60)),
              velocity: num(e.value?.velocity, 0, 1, 0.8),
            };
            break;
          case 'noteOff':
            value = {id: id(e.value?.id)};
            break;
          case 'tempo':
            value = num(e.value, 40, 240, 93);
            break;
          case 'bend':
            value = num(e.value, -2, 2, 0);
            break;
          case 'transport':
            value = choice(e.value, ['play', 'stop', 'rewind'], 'stop');
            break;
          case 'continuous':
            value = e.value === true;
            break;
          case 'pattern':
            value = Math.round(num(e.value, 0, 31, 0));
            break;
          case 'section':
            value = Math.round(num(e.value, 0, 31, 0));
            break;
          case 'patch':
            value = patch(e.value);
            break;
          case 'synthControl':
            if (
              ![
                'cutoff',
                'resonance',
                'position',
                'motion',
                'pulseWidth',
                'glide',
                'envelope',
                'attack',
                'release',
                'drive',
                'chorus',
                'delay',
                'reverb',
                'volume',
              ].includes(e.value?.key)
            )
              throw new Error('Unknown synth control');
            value = {key: e.value.key, value: num(e.value.value, -100, 20000, 0)};
            break;
          case 'expression':
            value = {
              prefix: id(e.value?.prefix),
              note: Number.isInteger(e.value?.note) ? Math.round(num(e.value.note, 0, 127, 60)) : undefined,
              type: choice(e.value?.type, ['bend', 'pressure'], 'pressure'),
              value: e.value?.type === 'bend' ? num(e.value?.value, -2, 2, 0) : num(e.value?.value, 0, 1, 0),
            };
            break;
          case 'panic':
            value = null;
            break;
          default:
            throw new Error('Unknown performance gesture');
        }
        return {time: e.time, type: e.type, value};
      })
      .sort((a, b) => a.time - b.time);
    if (raw.parts !== undefined && (!Array.isArray(raw.parts) || raw.parts.length > 64))
      throw new Error('A take can contain up to 64 parts.');
    const partIds = new Set();
    const parts = (raw.parts || [])
      .map(p => {
        if (
          !p ||
          !Number.isFinite(p.start) ||
          !Number.isFinite(p.end) ||
          p.start < 0 ||
          p.end > duration ||
          p.end - p.start < 0.05
        )
          throw new Error('Choose part start and end times within the take (at least 0.05 seconds apart).');
        const partId = text(p.id, '', 80);
        if (!partId || partIds.has(partId)) throw new Error('Each part needs a unique ID.');
        partIds.add(partId);
        return {id: partId, name: text(p.name, 'Untitled part', 60), start: p.start, end: p.end};
      })
      .sort((a, b) => a.start - b.start);
    const g = raw.initial.groove;
    return {
      version: 1,
      kind: 'afterhours-performance',
      name: text(raw.name, 'My performance', 80),
      duration,
      parts,
      initial: {
        groove: {
          project: validateProject(g.project),
          songMode: g.songMode === true,
          continuous: g.continuous === true,
          songStart: num(g.songStart, 0, 32768, 0),
          // These are elapsed transport clocks, not positions bounded by the arrangement.
          offsetTicks: num(g.offsetTicks, 0, Number.MAX_SAFE_INTEGER, 0),
          loopOrigin: num(g.loopOrigin, 0, Number.MAX_SAFE_INTEGER, 0),
          songOffset: num(g.songOffset, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
          running: g.running === true,
        },
        synth: patch(raw.initial.synth),
        bend: num(raw.initial.bend, -2, 2, 0),
        held: (Array.isArray(raw.initial.held) ? raw.initial.held : []).slice(0, 8).map(n => ({
          id: id(n?.id),
          note: Math.round(num(n?.note, 0, 127, 60)),
          velocity: num(n?.velocity, 0, 1, 0.8),
          bend: num(n?.bend, -2, 2, 0),
          pressure: num(n?.pressure, 0, 1, 1),
        })),
      },
      events,
    };
  }
  const api = {clone, controller, validate, Store, macroNames, pickup, midi, shape, take};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursPerformanceCore = api;
})(typeof window === 'undefined' ? globalThis : window);
