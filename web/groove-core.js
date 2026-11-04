/* Pattern data and event planning shared by realtime, offline render and MIDI. */
'use strict';
(function (root) {
  const Performance =
    typeof module !== 'undefined' && module.exports ? require('./performance-core.js') : root.AfterhoursPerformanceCore;
  const instruments =
    typeof module !== 'undefined' && module.exports
      ? require('./instrument-catalog.js')
      : root.AfterhoursInstrumentCatalog;
  const starterMachines = ['Kick', 'Snare', 'Metal', 'Perc', 'Tone', 'Chord'];
  const machines = [
    ...starterMachines,
    'Saw',
    'Ladder',
    'DualVCO',
    'Wavetable',
    'WavePad',
    'Analog',
    'Sample',
    'Instrument',
  ];
  const trackCount = 16,
    kit = [...starterMachines, 'Tone', 'Saw', 'Saw', 'Tone', 'Perc', 'Metal', 'Perc', 'Tone', 'Metal', 'Saw'];
  const controls = {
    note: ['Pitch', 24, 96, 1],
    shape: ['Shape', 0, 100, 1],
    color: ['Color', 0, 100, 1],
    sweep: ['Sweep', 0, 100, 1],
    contour: ['Contour', 0, 100, 1],
    decay: ['Decay', 0.04, 2, 0.01],
    cutoff: ['Filter', 100, 16000, 50],
    volume: ['Level', 0, 100, 1],
    pan: ['Pan', -100, 100, 1],
  };
  const lockKeys = ['note', 'shape', 'color', 'sweep', 'contour', 'decay', 'cutoff', 'volume', 'pan'];
  const number = (v, min, max, fallback) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  const integer = (v, min, max, fallback) => Math.round(number(v, min, max, fallback));
  const choice = (v, options, fallback) => (options.includes(v) ? v : fallback);
  const clone = v => JSON.parse(JSON.stringify(v));
  const step = () => ({
    on: false,
    velocity: 100,
    chance: 100,
    micro: 0,
    repeat: 1,
    gate: 0.7,
    condition: 'always',
    locks: {},
  });
  function track(machine, i) {
    const defaults = [
      [36, 15, 10, 60, 60, 0.38, 2600, 78, 0],
      [50, 55, 60, 12, 65, 0.18, 10000, 45, 0],
      [78, 70, 85, 0, 50, 0.08, 12000, 25, 18],
      [55, 38, 50, 30, 65, 0.18, 6000, 36, -22],
      [28, 18, 20, 0, 35, 0.38, 650, 55, 0],
      [52, 30, 35, 0, 25, 1.1, 3000, 32, 12],
    ];
    const preset = i < 6 ? i : Math.max(0, starterMachines.indexOf(machine));
    return {
      machine,
      name:
        ['Sub kick', 'Wire snare', 'Alloy hats', 'Glass perc', 'Night FM bass', 'Minor lights'][i] || `Layer ${i + 1}`,
      ...Object.fromEntries(Object.keys(controls).map((k, j) => [k, defaults[preset][j]])),
      length: 32,
      rate: 1,
      mute: false,
      solo: false,
      algorithm: 'parallel',
      chord: 'minor7',
      filter: 'biquad',
      lfo: {target: 'shape', depth: 0, division: 4, shape: 'sine'},
      steps: Array.from({length: 64}, step),
    };
  }
  function pattern(variation = 0) {
    const tracks = kit.map(track);
    const hits = [
      [0, 8, 16, 22, 24],
      [4, 12, 20, 28],
      Array.from({length: 16}, (_, i) => i * 2),
      [7, 15, 23, 30],
      [0, 6, 10, 16, 22, 26],
      [0, 16],
    ];
    tracks.forEach((t, i) =>
      (hits[i] || []).forEach((s, j) => {
        t.steps[s].on = true;
        t.steps[s].velocity = i === 2 ? (j % 2 ? 65 : 90) : 100;
        if (i === 4) t.steps[s].locks.note = [28, 28, 31, 28, 35, 26][j];
        if (i === 3) {
          t.steps[s].chance = 70;
          t.steps[s].locks.shape = 25 + j * 15;
        }
      }),
    );
    if (variation) {
      tracks[0].steps[30].on = true;
      tracks[1].steps[31].on = true;
      tracks[1].steps[31].repeat = variation + 1;
    }
    return {length: 32, tracks};
  }
  function project() {
    return {
      version: 1,
      bpm: 93,
      swing: 0.12,
      active: 0,
      continuous: false,
      patterns: Array.from({length: 4}, (_, i) => pattern(i)),
    };
  }
  // Shared by project import and the live keyboard's matched instrument snapshot.
  function sound(t, i = 4) {
    const out = track(choice(t.machine, machines, kit[i]), i);
    out.name = typeof t.name === 'string' ? t.name.slice(0, 40) : out.name;
    for (const [key, [, min, max]] of Object.entries(controls)) out[key] = number(t[key], min, max, out[key]);
    out.length = integer(t.length, 1, 64, 32);
    out.rate = choice(t.rate, [0.5, 1, 2], 1);
    out.mute = t.mute === true;
    out.solo = t.solo === true;
    out.algorithm = choice(t.algorithm, ['parallel', 'serial'], 'parallel');
    out.chord = choice(t.chord, ['minor7', 'major7', 'fifth'], 'minor7');
    out.filter = choice(t.filter, ['biquad', 'ladder'], 'biquad');
    out.lfo = {
      target: choice(t.lfo?.target, ['shape', 'cutoff', 'pitch', 'pan'], 'shape'),
      depth: number(t.lfo?.depth, 0, 100, 0),
      division: choice(t.lfo?.division, [0.25, 0.5, 1, 2, 4, 8, 16], 4),
      shape: choice(t.lfo?.shape, ['sine', 'triangle', 'square', 'sawtooth'], 'sine'),
    };
    if (out.machine === 'Instrument') {
      if (!instruments.some(item => item.id === t.instrument)) throw new Error('Choose an installed instrument.');
      out.instrument = t.instrument;
    }
    if (out.machine === 'Sample') {
      if (!/^[a-z0-9-]{1,64}$/.test(t.sample?.id || '')) throw new Error('Audio lane needs a local sample ID.');
      out.sample = {
        id: t.sample.id,
        offset: number(t.sample.offset, 0, 3600, 0),
        bpm: number(t.sample.bpm, 40, 240, 100),
      };
    }
    delete out.steps;
    return out;
  }
  function validate(raw) {
    if (
      !raw ||
      raw.version !== 1 ||
      !Array.isArray(raw.patterns) ||
      raw.patterns.length < 4 ||
      raw.patterns.length > 32
    )
      throw new Error('Choose an AFTERHOURS FM project (version 1, 4–32 patterns).');
    const result = project();
    result.continuous = raw.continuous === true;
    if (
      raw.tonality &&
      Number.isInteger(raw.tonality.root) &&
      raw.tonality.root >= 0 &&
      raw.tonality.root < 12 &&
      ['major', 'minor'].includes(raw.tonality.scale)
    )
      result.tonality = {root: raw.tonality.root, scale: raw.tonality.scale};
    if (raw.performance) result.performance = Performance.validate(raw.performance);
    if (typeof raw.title === 'string') result.title = raw.title.slice(0, 80);
    if (raw.mix && typeof raw.mix === 'object')
      result.mix = {space: number(raw.mix.space, 0, 1, 0), pump: number(raw.mix.pump, 0, 1, 0)};
    if (Array.isArray(raw.arrangement))
      result.arrangement = raw.arrangement.slice(0, 32).map(s => ({
        pattern: integer(s?.pattern, 0, raw.patterns.length - 1, 0),
        bars: integer(s?.bars, 1, 32, 8),
        name: typeof s?.name === 'string' ? s.name.slice(0, 30) : 'Section',
        lanes: Array.isArray(s?.lanes)
          ? [...new Set(s.lanes.filter(n => Number.isInteger(n) && n >= 0 && n < trackCount))]
          : Array.from({length: trackCount}, (_, i) => i),
      }));
    result.bpm = number(raw.bpm, 40, 240, 93);
    result.swing = number(raw.swing, 0, 0.9, 0);
    result.active = integer(raw.active, 0, raw.patterns.length - 1, 0);
    result.patterns = raw.patterns.map((p, pi) => {
      if (!p || !Array.isArray(p.tracks) || p.tracks.length < 6 || p.tracks.length > trackCount)
        throw new Error(`Pattern ${pi + 1} needs 6–16 tracks.`);
      return {
        length: integer(p.length, 1, 64, 32),
        tracks: Array.from({length: trackCount}, (_, i) => {
          const t = p.tracks[i];
          if (i >= p.tracks.length) {
            const blank = track(kit[i], i);
            blank.length = integer(p.length, 1, 64, 32);
            return blank;
          }
          if (!t || !Array.isArray(t.steps) || t.steps.length !== 64) throw new Error('Each track needs 64 steps.');
          const out = sound(t, i);
          out.steps = t.steps.map(s => {
            if (!s || typeof s !== 'object') return step();
            const locks = {};
            for (const k of lockKeys)
              if (s.locks && Number.isFinite(s.locks[k]))
                locks[k] = number(s.locks[k], controls[k][1], controls[k][2], out[k]);
            return {
              on: s.on === true,
              velocity: integer(s.velocity, 1, 127, 100),
              chance: number(s.chance, 0, 100, 100),
              micro: number(s.micro, -0.4, 0.4, 0),
              repeat: integer(s.repeat, 1, 4, 1),
              gate: number(s.gate, 0.1, 8, 0.7),
              condition: choice(s.condition, ['always', '1:2', '2:2', 'fill', '!fill'], 'always'),
              locks,
            };
          });
          return out;
        }),
      };
    });
    return result;
  }
  function random(tick, lane, seed = 1729) {
    let n = Math.imul(tick + 1, 374761393) ^ Math.imul(lane + 1, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // One tick = 1/32 note. Tempo and offsets are expressed in quarter-note beats.
  // Keep sampleResumeTick fixed across the resumed phrase, including later grid ticks.
  function events(p, tick, {swing = 0, fill = false, seed = 1729, sampleResumeTick = null} = {}) {
    const solo = p.tracks.some(t => t.solo);
    return p.tracks.flatMap((t, lane) => {
      if (t.mute || (solo && !t.solo)) return [];
      const position = (tick * t.rate) / 2,
        duration = 0.25 / t.rate;
      function at(position) {
        if (!Number.isInteger(position)) return [];
        const triggerTick = (position * 2) / t.rate,
          index = position % t.length,
          s = t.steps[index],
          cycle = Math.floor(position / t.length);
        if (
          !s.on ||
          random(triggerTick, lane, seed) >= s.chance / 100 ||
          (s.condition === 'fill' && !fill) ||
          (s.condition === '!fill' && fill) ||
          (s.condition === '1:2' && cycle % 2 !== 0) ||
          (s.condition === '2:2' && cycle % 2 !== 1)
        )
          return [];
        // Swing follows the 16th grid; microtiming is a fraction of this lane's own step.
        const offset = (Math.floor(triggerTick / 2) % 2 ? swing * 0.5 * 0.25 : 0) + s.micro * duration;
        return Array.from({length: s.repeat}, (_, r) => ({
          lane,
          index,
          beat: triggerTick / 8 + offset + (r * duration) / s.repeat,
          gate: (s.gate * duration) / s.repeat,
          velocity: s.velocity / 127,
          settings: {...t, ...s.locks},
        }));
      }
      if (t.machine !== 'Sample' || sampleResumeTick === null) return at(position);
      // A gate lasts at most eight steps, plus positive microtiming and swing.
      // Look back across lane cycles, but never invent triggers before playback began.
      // Later grid triggers can already have sounded due to negative microtiming.
      // Trim those against the same resume cursor when their grid tick is scheduled,
      // so every trigger is emitted once and stays within its pattern/section.
      const first =
        tick === sampleResumeTick ? Math.max(0, Math.ceil(position - 8.4 - (swing * 0.125) / duration)) : position;
      const resumed = [];
      for (let prior = first; prior <= Math.floor(position); prior++)
        for (const event of at(prior)) {
          const start = Math.max(0, event.beat),
            sampleSkip = Math.max(0, sampleResumeTick / 8 - start),
            gate = event.gate - sampleSkip;
          if (gate <= 0) continue;
          resumed.push({
            ...event,
            beat: Math.max(sampleResumeTick / 8, start),
            gate,
            ...(sampleSkip ? {sampleSkip} : {}),
          });
        }
      return resumed;
    });
  }
  function notes(settings) {
    return ['Chord', 'WavePad'].includes(settings.machine)
      ? {minor7: [0, 3, 7, 10], major7: [0, 4, 7, 11], fifth: [0, 7, 12]}[settings.chord].map(n => n + settings.note)
      : [settings.note];
  }
  function midi(p, bpm, swing, cycles = 4) {
    const ppq = 480,
      totalTicks = p.length * 2 * cycles,
      lead = 0.25;
    const bytes = s => Array.from(s, c => c.charCodeAt(0));
    const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const vlq = n => {
      const b = [n & 127];
      while ((n >>>= 7)) b.unshift((n & 127) | 128);
      return b;
    };
    const chunk = data => [...bytes('MTrk'), ...u32(data.length), ...data];
    const tempo = Math.round(60000000 / bpm),
      end = Math.round((totalTicks / 8 + lead) * ppq);
    const conductor = chunk([
      0,
      255,
      81,
      3,
      (tempo >>> 16) & 255,
      (tempo >>> 8) & 255,
      tempo & 255,
      0,
      255,
      88,
      4,
      4,
      2,
      24,
      8,
      ...vlq(end),
      255,
      47,
      0,
    ]);
    const lanes = p.tracks.map(() => []);
    for (let tick = 0; tick < totalTicks; tick++)
      for (const e of events(p, tick, {swing})) {
        if (e.settings.machine === 'Sample') continue;
        for (const n of notes(e.settings)) {
          const start = Math.round((e.beat + lead) * ppq),
            stop = start + Math.max(1, Math.round(e.gate * ppq));
          lanes[e.lane].push({start, stop, note: Math.round(n), velocity: Math.round(e.velocity * 127)});
        }
      }
    const tracks = lanes.map((list, i) => {
      const name = bytes(p.tracks[i].name.replace(/[^\x20-\x7e]/g, '?'));
      const data = [0, 255, 3, name.length, ...name];
      let previous = 0;
      // MIDI has one note-off per pitch/channel. End an overlapping gate before
      // its next trigger, so an old note-off cannot cut the new note short.
      // Two hits of one pitch on the same tick merge into the louder note.
      list.sort((a, b) => a.start - b.start);
      const last = new Map(),
        messages = [],
        kept = [];
      for (const note of list) {
        const prior = last.get(note.note);
        if (prior && prior.start === note.start) {
          prior.stop = Math.max(prior.stop, note.stop);
          prior.velocity = Math.max(prior.velocity, note.velocity);
          continue;
        }
        if (prior) prior.stop = Math.min(prior.stop, note.start);
        last.set(note.note, note);
        kept.push(note);
      }
      for (const n of kept) messages.push([n.start, [144 + i, n.note, n.velocity]], [n.stop, [128 + i, n.note, 0]]);
      messages.sort((a, b) => a[0] - b[0] || a[1][0] - b[1][0]);
      for (const [time, msg] of messages) {
        data.push(...vlq(time - previous), ...msg);
        previous = time;
      }
      return chunk([...data, ...vlq(Math.max(0, end - previous)), 255, 47, 0]);
    });
    return new Uint8Array([
      ...bytes('MThd'),
      0,
      0,
      0,
      6,
      0,
      1,
      0,
      tracks.length + 1,
      1,
      224,
      ...conductor,
      ...tracks.flat(),
    ]);
  }
  // Compact only untouched empty steps; disabled notes and locks remain editable.
  function serialize(p) {
    const empty = JSON.stringify(step());
    return JSON.stringify(p, (key, value) => {
      if (key === 'steps' && Array.isArray(value)) return value.map(s => (JSON.stringify(s) === empty ? null : s));
      return value;
    });
  }
  const api = {
    step,
    serialize,
    trackCount,
    machines,
    controls,
    lockKeys,
    project,
    validate,
    sound,
    clone,
    events,
    notes,
    midi,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursGroove = api;
})(typeof window === 'undefined' ? globalThis : window);
