/* Song-key suggestions and live-input mapping. Stored performances use resolved MIDI notes. */
'use strict';
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./groove-core') : root.AfterhoursGroove;
  const scales = {
    chromatic: Array.from({length: 12}, (_, i) => i),
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    minorLeading: [0, 2, 3, 5, 7, 8, 10, 11],
  };
  const melodic = t =>
    !['Kick', 'Snare', 'Metal', 'Perc', 'Sample'].includes(t.machine) &&
    !(t.machine === 'Instrument' && t.instrument === 'virtuosity-drums');
  const pc = n => ((n % 12) + 12) % 12;
  function notes(track) {
    if (!track || !melodic(track)) return [];
    return track.steps.slice(0, track.length).flatMap(s => (s.on ? G.notes({...track, ...s.locks}) : []));
  }
  function suggest(project, selected = 4) {
    const pool = project.patterns.flatMap(p => p.tracks.flatMap(notes));
    if (!pool.length) return null;
    const histogram = Array(12).fill(0);
    for (const note of pool) histogram[pc(note)]++;
    let key = project.tonality;
    const estimated = !key;
    if (!key) {
      // Pitch-class profile estimate; label it as a suggestion, never a transcription.
      const profiles = {
        major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
      };
      let best = -Infinity;
      for (const [scale, profile] of Object.entries(profiles)) {
        const mean = profile.reduce((a, b) => a + b) / 12;
        const norm = Math.sqrt(profile.reduce((n, v) => n + (v - mean) ** 2, 0));
        for (let root = 0; root < 12; root++) {
          const score = histogram.reduce(
            (sum, count, pitch) => sum + (count * (profile[pc(pitch - root)] - mean)) / norm,
            0,
          );
          if (score > best) {
            best = score;
            key = {root, scale};
          }
        }
      }
    }
    let scale = key.scale;
    if (scale === 'minor' && histogram[pc(key.root + 11)] > 0) scale = 'minorLeading';
    let lane = selected;
    let pitches = project.patterns.flatMap(p => notes(p.tracks[lane]));
    if (!pitches.length) {
      lane = project.patterns[project.active].tracks.findIndex((_, i) =>
        project.patterns.some(p => notes(p.tracks[i]).length),
      );
      pitches = project.patterns.flatMap(p => notes(p.tracks[lane]));
    }
    const sorted = pitches.slice().sort((a, b) => a - b),
      median = sorted[Math.floor(sorted.length / 2)];
    let octave = 4,
      best = -Infinity;
    for (let o = 1; o <= 6; o++) {
      const base = (o + 1) * 12;
      const score = pitches.filter(n => n >= base && n <= base + 24).length * 100 - Math.abs(base + 12 - median);
      if (score > best) {
        best = score;
        octave = o;
      }
    }
    return {root: key.root, scale, octave, lane, estimated, name: project.patterns[project.active].tracks[lane].name};
  }
  function snap(note, root, scale) {
    const allowed = scales[scale] || scales.chromatic;
    for (let distance = 0; distance < 12; distance++)
      for (const candidate of [note - distance, note + distance])
        if (candidate >= 0 && candidate <= 127 && allowed.includes(pc(candidate - root))) return candidate;
    return note;
  }
  const api = {scales, suggest, snap};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursSynthKey = api;
})(typeof window === 'undefined' ? globalThis : window);
