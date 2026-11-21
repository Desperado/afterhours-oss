'use strict';
/* Local phrase harmonizer. Its output is an ordinary editable Groove project. */
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./groove-core.js') : root.AfterhoursGroove;
  const scales = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10]};
  const pc = n => ((n % 12) + 12) % 12;
  function tonality(notes) {
    let best = null;
    for (const [scale, intervals] of Object.entries(scales))
      for (let root = 0; root < 12; root++) {
        const score = notes.reduce((sum, n, i) => {
          const pitch = pc(n.note - root),
            weight = Math.min(2, n.duration) * n.velocity;
          return (
            sum +
            weight * (intervals.includes(pitch) ? 2 : -4) +
            (pitch === 0 ? weight * 0.35 + (i === notes.length - 1 ? 0.5 : 0) : 0)
          );
        }, 0);
        if (!best || score > best.score) best = {root, scale, score};
      }
    return {root: best.root, scale: best.scale};
  }
  function compose(raw, options = {}) {
    const bpm = Number(options.bpm ?? 100),
      style = options.style || 'groove';
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Темп має бути 40–240 BPM.');
    if (!['groove', 'gentle', 'pulse'].includes(style)) throw new Error('Вибери стиль акомпанементу.');
    if (!Array.isArray(raw) || !raw.length) throw new Error('Спочатку зіграй кілька нот.');
    if (raw.length > 256) throw new Error('Забагато нот. Зіграй коротшу фразу до 4 тактів.');
    const notes = raw
      .map(n => {
        if (
          !n ||
          !Number.isInteger(n.note) ||
          n.note < 24 ||
          n.note > 96 ||
          !Number.isFinite(n.start) ||
          n.start < 0 ||
          !Number.isFinite(n.duration) ||
          n.duration <= 0 ||
          !Number.isFinite(n.velocity) ||
          n.velocity <= 0 ||
          n.velocity > 1
        )
          throw new Error('Для цієї версії зіграй ноти C1–C7 з коректною тривалістю.');
        return {...n};
      })
      .sort((a, b) => a.start - b.start);
    const origin = notes[0].start,
      beat = 60 / bpm;
    for (const n of notes) {
      n.start = (n.start - origin) / beat;
      n.duration /= beat;
    }
    const end = Math.max(...notes.map(n => n.start + n.duration));
    if (end > 16.125 || notes.some(n => Math.round(n.start * 4) >= 64))
      throw new Error('Фраза довша за 4 такти. Зіграй коротше або збільш темп.');
    const bars = Math.max(1, Math.min(4, Math.ceil((end - 0.01) / 4))),
      length = bars * 16;
    const key = tonality(notes),
      scale = scales[key.scale];
    const chords = Array.from({length: bars}, (_, bar) => {
      const melody = notes.filter(n => n.start < (bar + 1) * 4 && n.start + n.duration > bar * 4);
      let best = null;
      for (let degree = 0; degree < 7; degree++) {
        const tones = [0, 2, 4].map(
          offset => key.root + scale[(degree + offset) % 7] + (degree + offset >= 7 ? 12 : 0),
        );
        const score =
          melody.reduce((sum, n) => {
            const overlap = Math.min(n.start + n.duration, (bar + 1) * 4) - Math.max(n.start, bar * 4);
            return sum + overlap * n.velocity * (tones.some(t => pc(t) === pc(n.note)) ? 3 : -1);
          }, 0) + (degree === 0 ? 0.15 : 0);
        if (!best || score > best.score) best = {tones, score};
      }
      return best.tones;
    });
    const lead = Array.from({length: 8}, () => new Map());
    let shortened = 0;
    for (const n of notes) {
      const position = Math.min(length - 1, Math.round(n.start * 4));
      const lane = lead.find(slots => !slots.has(position));
      if (!lane) throw new Error('На одному кроці більше 8 нот. Зіграй простішу фразу.');
      if (n.duration > 2) shortened++;
      lane.set(position, {
        on: true,
        velocity: Math.round(n.velocity * 127),
        gate: Math.max(0.1, Math.min(8, n.duration * 4)),
        locks: {note: n.note},
      });
    }
    const project = G.project();
    project.title =
      'Jam · ' + ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][key.root] + ' ' + key.scale;
    project.bpm = bpm;
    project.swing = 0;
    project.tonality = key;
    project.mix = {space: style === 'gentle' ? 0.35 : 0.18, pump: style === 'pulse' ? 0.2 : 0};
    project.continuous = true;
    for (let variation = 0; variation < 4; variation++) {
      const pattern = project.patterns[variation];
      pattern.length = length;
      pattern.tracks.forEach((t, lane) => {
        t.length = length;
        t.steps = Array.from({length: 64}, G.step);
        t.mute = lane >= 8 && lead[lane - 8].size === 0;
        if (lane >= 8) {
          Object.assign(t, {
            machine: 'Tone',
            name: 'Твоя фраза ' + (lane - 7),
            note: 60,
            shape: 15,
            color: 18,
            sweep: 0,
            contour: 20,
            decay: 0.18,
            cutoff: 6500,
            volume: 58,
          });
          for (const [position, value] of lead[lane - 8]) Object.assign(t.steps[position], value);
        }
      });
      const tracks = pattern.tracks;
      const hit = (lane, position, note, gate = 0.7, velocity = 90) => {
        Object.assign(tracks[lane].steps[position], {on: true, gate, velocity, locks: note === null ? {} : {note}});
      };
      tracks[0].name = 'Kick';
      tracks[1].name = 'Snare';
      tracks[2].name = 'Hats';
      tracks[3].name = 'Percussion';
      Object.assign(tracks[4], {machine: 'Tone', name: 'Бас під фразу', note: 36, volume: 53, cutoff: 900});
      for (let voice = 0; voice < 3; voice++)
        Object.assign(tracks[5 + voice], {
          machine: 'Tone',
          name: 'Гармонія ' + (voice + 1),
          note: 60,
          shape: style === 'pulse' ? 40 : 12,
          color: 24,
          sweep: 0,
          contour: 20,
          decay: 0.6,
          cutoff: 2300,
          volume: style === 'gentle' ? 26 : 22,
          pan: (voice - 1) * 28,
        });
      for (let bar = 0; bar < bars; bar++) {
        const base = bar * 16,
          chord = chords[bar],
          root = 36 + pc(chord[0]);
        for (const p of style === 'pulse' ? [0, 4, 8, 12] : [0, 8, ...(variation === 3 ? [14] : [])])
          hit(0, base + p, null);
        for (const p of [4, 12]) hit(1, base + p, null, 0.7, style === 'gentle' ? 50 : 88);
        for (let p = 0; p < 16; p += style === 'gentle' ? 4 : 2) hit(2, base + p, null, 0.5, p % 4 ? 48 : 68);
        if (variation > 0 && style !== 'gentle') hit(3, base + 15, null, 0.5, 55);
        for (const p of style === 'gentle' ? [0, 8] : [0, 6, 8, 14])
          hit(4, base + p, root + (p === 14 ? 7 : 0), p === 0 ? 3 : 1.6, 90);
        chord.forEach((note, voice) => {
          for (const p of style === 'pulse' ? [2, 6, 10, 14] : [0, 8])
            hit(5 + voice, base + p, 48 + note, style === 'pulse' ? 1.2 : 7.5, 72);
        });
      }
    }
    project.arrangement = [
      {pattern: 0, bars, name: 'Тема', lanes: Array.from({length: 16}, (_, i) => i)},
      {pattern: 1, bars, name: 'Рух', lanes: Array.from({length: 16}, (_, i) => i)},
      {pattern: 2, bars, name: 'Простір', lanes: Array.from({length: 16}, (_, i) => i).filter(i => i !== 1 && i !== 3)},
      {pattern: 3, bars, name: 'Повернення', lanes: Array.from({length: 16}, (_, i) => i)},
    ];
    return {project: G.validate(project), bars, key, shortened, count: notes.length};
  }
  const api = {compose};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursJamCore = api;
})(typeof window === 'undefined' ? globalThis : window);
