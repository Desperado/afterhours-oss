'use strict';
/* Equal-tempered note names and playable standard-tuning suggestions. No audio analysis. */
(function (root) {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const pc = n => ((n % 12) + 12) % 12;
  const noteName = n => `${names[pc(n)]}${Math.floor(n / 12) - 1}`;
  const qualities = [
    ['maj7', [0, 4, 7, 11]],
    ['m7', [0, 3, 7, 10]],
    ['7', [0, 4, 7, 10]],
    ['', [0, 4, 7]],
    ['m', [0, 3, 7]],
    ['sus2', [0, 2, 7]],
    ['sus4', [0, 5, 7]],
    ['5', [0, 7]],
  ];
  function chord(notes) {
    const pitches = [...new Set(notes.map(pc))].sort((a, b) => a - b);
    if (pitches.length < 2) return null;
    const bass = pc(Math.min(...notes));
    // Prefer the lowest note as root when a suspended chord has two readings.
    for (const root of [bass, ...pitches.filter(n => n !== bass)])
      for (const [quality, intervals] of qualities)
        if (intervals.length === pitches.length && intervals.every(n => pitches.includes(pc(root + n))))
          return {root, quality, name: names[root] + quality};
    return null;
  }
  const guitarTuning = [40, 45, 50, 55, 59, 64];
  const shapes = {
    '': [
      [0, 2, 2, 1, 0, 0],
      [-1, 0, 2, 2, 2, 0],
    ],
    m: [
      [0, 2, 2, 0, 0, 0],
      [-1, 0, 2, 2, 1, 0],
    ],
    7: [
      [0, 2, 0, 1, 0, 0],
      [-1, 0, 2, 0, 2, 0],
    ],
    m7: [
      [0, 2, 0, 0, 0, 0],
      [-1, 0, 2, 0, 1, 0],
    ],
    maj7: [
      [0, 2, 1, 1, 0, 0],
      [-1, 0, 2, 1, 2, 0],
    ],
    sus2: [null, [-1, 0, 2, 2, 0, 0]],
    sus4: [
      [0, 2, 2, 2, 0, 0],
      [-1, 0, 2, 2, 3, 0],
    ],
    5: [
      [0, 2, 2, -1, -1, -1],
      [-1, 0, 2, 2, -1, -1],
    ],
  };
  function fingering(c) {
    if (!c || !shapes[c.quality]) return null;
    return shapes[c.quality]
      .flatMap((shape, i) => {
        if (!shape) return [];
        const offset = pc(c.root - (i ? 9 : 4));
        return [shape.map(fret => (fret < 0 ? -1 : fret + offset))];
      })
      .sort((a, b) => Math.max(...a) - Math.max(...b))[0];
  }
  function bassPositions(note) {
    return [28, 33, 38, 43]
      .map((open, string) => ({string: ['E', 'A', 'D', 'G'][string], fret: note - open}))
      .filter(p => p.fret >= 0 && p.fret <= 24)
      .sort((a, b) => a.fret - b.fret);
  }
  const api = {noteName, chord, fingering, bassPositions, guitarTuning};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursPlayalong = api;
})(typeof window === 'undefined' ? globalThis : window);
