/* Червона рута — music and lyrics by Volodymyr Ivasiuk.
   Orchestral adaptation of the user-supplied four-page voice/piano score.
   Musical material is outside the software's Apache grant; see THIRD_PARTY.md. */
'use strict';
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./groove-core') : root.AfterhoursGroove;
  const metadata = {
    id: 'chervona-ruta',
    title: 'Червона рута · Orchestra',
    genre: 'Ukrainian orchestral song',
    bpm: 104,
    description:
      'Volodymyr Ivasiuk · G minor · two verses, full brass choruses and a quiet coda. Requires installed VSCO orchestra and Virtuosity Drums recordings.',
  };
  // Each token is pitch:quarter-note duration; R is a rest. Written bar numbers
  // start at 0 (the unnumbered opening bar), matching the supplied score.
  const voice = [
    ...Array(9).fill('R:4'),
    'R:1 D4:.5 D4:.5 Bb4:1 A4:.5 Bb4:.5',
    'G4:2 R:2',
    'R:1 G4:.5 A4:.5 Bb4:.5 A4:1 G4:.5',
    'F#4:1 D4:3',
    'R:1 D4:.5 D4:.5 C5:1 Bb4:.5 C5:.5',
    'A4:2 R:2',
    'R:1 C5:.5 C5:.5 C5:1 Bb4:.5 C5:.5',
    'D5:1 G4:3',
    'R:1 F4:.5 F4:.5 D5:1 C5:.5 D5:.5',
    'Bb4:2 R:2',
    'R:1 Bb4:.5 C5:.5 D5:1 C5:.5 Bb4:.5',
    'A4:1 F4:3',
    'R:1 F4:.5 F4:.5 Eb5:1 D5:.5 Eb5:.5',
    'C5:2 R:2',
    'R:1 C5:.5 C5:.5 C5:1 Bb4:.5 C5:.5',
    'D5:1 G4:3',
    'R:4',
    'Eb5:2 F5:1 Eb5:1',
    'D5:.5 C5:2.5 Bb4:.5 C5:.5',
    'D5:2 Eb5:1 D5:1',
    'C5:.5 Bb4:2.5 A4:.5 Bb4:.5',
    'C5:2 D5:.5 Eb5:1.5',
    'D5:1 C5:1 Bb4:1 A4:1',
    'Bb4:2 C5:2',
    'D5:3 R:1',
    'Eb5:2 F5:1 Eb5:1',
    'D5:.5 C5:2.5 Bb4:.5 C5:.5',
    'D5:2 Eb5:1 D5:1',
    'C5:.5 Bb4:2.5 A4:.5 Bb4:.5',
    'C5:2 D5:.5 Eb5:1.5',
    'D5:1 C5:1 Bb4:1 A4:1',
    'G4:3 R:1',
    'G4:3 R:1',
    'R:3 A4:.5 Bb4:.5',
    'C5:2 D5:.5 Eb5:1.5',
    'D5:1 C5:1 Bb4:1 A4:1',
    'G4:3 R:1',
    'R:3 A4:.5 Bb4:.5',
    'C5:2 D5:.5 Eb5:1.5',
    'D5:1 C5:1 Bb4:1 A4:1',
    'G4:3 R:1',
    ...Array(5).fill('R:4'),
  ];
  const lower = {
    26: 'C5:2 D5:1 C5:1',
    27: 'Bb4:.5 A4:2.5 G4:.5 A4:.5',
    28: 'Bb4:2 C5:1 Bb4:1',
    29: 'A4:.5 G4:2.5 F#4:.5 G4:.5',
    30: 'Ab4:2 Bb4:.5 C5:1.5',
    31: 'Bb4:1 A4:1 G4:1 F#4:1',
    32: 'G4:2 A4:2',
    33: 'Bb4:3 R:1',
    42: 'R:3 F#4:.5 G4:.5',
  };
  for (let bar = 34; bar <= 39; bar++) lower[bar] = lower[bar - 8];
  for (const bar of [43, 47]) lower[bar] = lower[30];
  for (const bar of [44, 48]) lower[bar] = lower[31];
  lower[46] = lower[42];

  const motif = 'R:1 D5:1 C5:.5 D5:.5 Eb5:.5 C5:.5';
  const answer = {
    0: motif,
    1: 'D5:3 R:1',
    2: motif,
    3: 'D5:3 R:1',
    4: motif,
    5: 'D5:3 Bb4:1',
    6: 'C5:1 Bb4:1 A4:1 G4:1',
    7: 'F#4:2 D4:2',
    8: 'R:1 D5:.5 G5:.5 F#5:.25 F5:.25 Eb5:.5 C5:.5 Bb4:.5',
    10: motif,
    11: 'D5:3 R:1',
    12: 'R:2 A4:1 Bb4:1',
    14: 'R:1 Eb5:1 D5:.5 F5:.5 Eb5:.5 C5:.5',
    15: 'D5:3 R:1',
    16: 'R:1 Bb4:1 C5:.5 D5:.5 C5:.5 Bb4:.5',
    17: 'Bb4:2 A4:1 G4:1',
    18: 'C4:1 Bb4:.5 F4:.5 Bb4:.5 C5:1 D5:.5',
    20: 'F4:.5 R:.5 F5:.5 C5:.5 F5:.5 G5:1 A5:.5',
    22: 'F4:.5 R:.5 Eb5:.5 C5:.5 Eb5:.5 G5:1.5',
    24: 'G4:1 G4:.5 D4:.5 Bb4:.5 D5:1 C5:.5',
    25: 'Bb4:2 R:2',
    27: 'R:1 F#4:.5 A4:.5 F5:.5 Eb5:.5 Bb4:.5 C5:.5',
    29: 'C5:.5 Bb4:.5 A4:.5 G4:.5 G4:.5 D4:.5 C4:.5 Bb3:.5',
    31: 'R:1 A4:1 G4:1 A4:1',
    32: 'G4:1 D4:.5 G4:.5 R:1 C4:.5 F4:.5',
    33: 'R:1 D4:.5 Bb4:.5 R:1 C5:.5 D5:.5',
    40: 'G4:1 D5:.5 G5:.5 C#5:.25 D5:.25 Bb4:.5 G4:.5 F4:.5',
    41: 'G4:.5 A4:1 Bb4:1 C5:1 D5:.5',
    42: 'D5:.5 Bb4:1 A4:1 G4:.5 A4:.5 Bb4:.5',
    43: 'C5:1 R:3',
    44: 'R:1 A4:1 G4:1 A4:1',
    45: 'G4:.5 A4:1 Bb4:1 C5:1 D5:.5',
    46: 'D5:.5 Bb4:1 A4:1 G4:.5 A4:.5 Bb4:.5',
    47: 'C5:1 R:3',
    48: 'R:1 A4:1 G4:1 A4:1',
    49: 'G4:.5 A4:1 Bb4:1 C5:1 Bb4:.5',
    50: 'Bb4:.5 G4:1 F4:1 G4:1 A4:.5',
    51: 'A4:.5 Bb4:1 C5:1 D5:1 Bb4:.5',
    52: 'Bb4:.5 A4:1 G4:1 A4:1 Bb4:.5',
    53: 'Bb4:1 Bb4:3',
    54: 'Bb4:4',
  };
  answer[35] = answer[27];
  answer[37] = answer[29];
  answer[39] = answer[31];
  const chords = {
    Gm: [43, 58, 62, 67],
    Cm: [48, 60, 63, 67],
    D7: [38, 60, 66, 69],
    F: [41, 57, 60, 65],
    Bb: [46, 58, 62, 65],
    Eb: [39, 58, 63, 67],
    Ab: [44, 60, 63, 68],
  };
  const harmony = (
    'Gm Gm Bb Bb Cm D7 Gm D7 Gm ' +
    'Gm Gm Cm D7 D7 D7 D7 Gm Gm Cm Cm F F Bb D7 Gm Gm ' +
    'Cm F Bb Gm Ab D7 Gm D7 Cm F Bb Gm Ab D7 Gm ' +
    'Gm D7 Ab D7 Gm D7 Ab D7 Gm Eb Gm D7 Gm Gm'
  ).split(' ');
  const lanes = [
    ['Flute · song / descant', 'vsco-flute', 49, -12],
    ['Trumpet · chorus melody', 'vsco-trumpet', 41, 16],
    ['Horn I · harmony', 'vsco-horn', 37, -25],
    ['Horn II · harmony', 'vsco-horn', 34, 25],
    ['Cellos · bass', 'vsco-cellos', 53, 12],
    ['Tuba · foundation', 'vsco-tuba', 39, 8],
    ['Trombone · low brass', 'vsco-trombone', 35, 20],
    ['Violins I · song', 'vsco-violins', 65, -32],
    ['Violins II · second voice', 'vsco-violins', 44, -18],
    ['Violas · inner voice', 'vsco-violas', 45, 16],
    ['Harp · arpeggios', 'vsco-harp', 37, -24],
    ['Harp · piano answers', 'vsco-harp', 52, 24],
    ['Cellos · tenor', 'vsco-cellos', 37, 30],
    ['Snare · light pulse', 'virtuosity-drums', 22, -8],
    ['Cymbals · phrases', 'virtuosity-drums', 21, 32],
    ['Low tom · transitions', 'virtuosity-drums', 29, -20],
  ];
  function pitch(name) {
    const [, letter, accidental, octave] = /^([A-G])([b#]?)(\d)$/.exec(name);
    return (
      (Number(octave) + 1) * 12 +
      {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[letter] +
      (accidental === 'b' ? -1 : accidental === '#' ? 1 : 0)
    );
  }
  function put(track, beat, note, duration, velocity) {
    const index = Math.round(beat * track.rate * 4);
    Object.assign(track.steps[index], {
      on: true,
      velocity,
      gate: Math.min(8, duration * track.rate * 4),
      locks: {note},
    });
  }
  function phrase(track, bar, line, velocity, transpose = 0) {
    let beat = bar * 4;
    for (const token of line.split(' ')) {
      const [name, length] = token.split(':'),
        duration = Number(length);
      if (name !== 'R') put(track, beat, pitch(name) + transpose, duration * 0.94, velocity);
      beat += duration;
    }
  }
  function create() {
    const project = G.project();
    const templates = project.patterns[0].tracks;
    Object.assign(project, {
      title: metadata.title,
      bpm: metadata.bpm,
      swing: 0,
      tonality: {root: 7, scale: 'minor'},
      mix: {space: 0.3, pump: 0},
      patterns: [],
      arrangement: [],
    });
    function section(name, first, last, texture) {
      const bars = last - first + 1,
        pattern = {length: bars * 16, tracks: []};
      pattern.tracks = lanes.map(([name, instrument, volume, pan], lane) => ({
        ...templates[lane],
        name,
        machine: 'Instrument',
        instrument,
        volume,
        pan,
        cutoff: 16000,
        rate: lane === 11 ? 1 : 0.5,
        length: bars * (lane === 11 ? 16 : 8),
        steps: Array.from({length: 64}, G.step),
      }));
      const t = pattern.tracks,
        full = texture === 'chorus' || texture === 'final';
      for (let source = first; source <= last; source++) {
        const bar = source - first,
          beat = bar * 4;
        const [bass, third, fifth, top] = chords[harmony[source]];
        const quiet = texture === 'coda',
          velocity = quiet ? Math.max(40, 78 - (source - 49) * 7) : full ? 99 : 77;
        phrase(t[7], bar, voice[source], velocity);
        if (source < 49) {
          if (full) {
            phrase(t[1], bar, voice[source], velocity - 7);
            phrase(t[0], bar, voice[source], velocity - 15);
          } else if (texture === 'verse2') phrase(t[0], bar, voice[source], velocity - 12, 12);
          else if (source >= 9) phrase(t[0], bar, voice[source], velocity - 17);
        }
        if (lower[source]) phrase(t[8], bar, lower[source], velocity - 12);
        else put(t[8], beat, top, quiet ? 3.9 : 3.6, velocity - 23);
        put(t[4], beat, bass, 3.85, velocity - 4);
        put(t[9], beat, fifth, 3.8, velocity - 19);
        put(t[12], beat, third - 12, 3.8, velocity - 22);
        if (!quiet && source !== 8 && source !== 25) {
          for (let eighth = 0; eighth < 8; eighth++)
            put(
              t[10],
              beat + eighth / 2,
              [bass + 12, third, fifth, top][eighth % 4],
              0.65,
              velocity - 24 + (eighth % 2) * 6,
            );
        }
        if (answer[source]) phrase(t[11], bar, answer[source], velocity - (full ? 20 : 3));
        if (source < 8) phrase(t[0], bar, answer[source], velocity - 12);
        if (full || texture === 'verse2' || source === 53 || source === 54) {
          put(t[2], beat, fifth, quiet ? 3.9 : 3.7, velocity - 16);
          put(t[3], beat, third, quiet ? 3.9 : 3.7, velocity - 19);
          put(t[5], beat, bass - (bass >= 41 ? 12 : 0), 3.7, velocity - 13);
          put(t[6], beat, bass + 12, 3.65, velocity - 19);
        }
        if (full) {
          put(t[13], beat + 1, 38, 0.2, 60);
          put(t[13], beat + 3, 38, 0.2, 70);
          put(t[14], beat, source === first ? 49 : 46, 1.5, source === first ? 70 : 42);
          put(t[15], beat, 41, 0.5, 64);
          if (source === last) {
            put(t[13], beat + 3.5, 38, 0.2, 48);
            put(t[15], beat + 3, 48, 0.3, 59);
            put(t[15], beat + 3.5, 41, 0.4, 67);
          }
        }
        // The final tonic is rearticulated softly: fixed-tempo gates are at most
        // one bar, so the printed cross-bar tie/fermata cannot be literal here.
        if (source === 54) {
          put(t[7], beat, 67, 4, 48);
          put(t[8], beat, 70, 4, 44);
          put(t[9], beat, 62, 4, 43);
          put(t[4], beat, 43, 4, 48);
        }
      }
      project.arrangement.push({name, pattern: project.patterns.length, bars, lanes: lanes.map((_, i) => i)});
      project.patterns.push(pattern);
    }
    section('Prelude · strings & harp', 0, 3, 'intro');
    section('Prelude · woodwind answer', 4, 7, 'intro');
    section('Pickup', 8, 8, 'intro');
    function verse(number, texture) {
      section(`Verse ${number} · opening`, 9, 12, texture);
      section(`Verse ${number} · answer`, 13, 16, texture);
      section(`Verse ${number} · rising`, 17, 20, texture);
      section(`Verse ${number} · cadence`, 21, 24, texture);
      section(`Verse ${number} · breath`, 25, 25, texture);
    }
    function chorus(number, last, texture) {
      section(`Chorus ${number} · Червону руту`, 26, 29, texture);
      section(`Chorus ${number} · melody`, 30, 33, texture);
      section(`Chorus ${number} · full orchestra`, 34, 37, texture);
      section(number === 1 ? 'First ending · repeat' : 'Final chorus · to coda', 38, last, texture);
    }
    verse(1, 'verse');
    chorus(1, 40, 'chorus');
    verse(2, 'verse2');
    chorus(2, 39, 'final');
    section('Second ending · echo I', 41, 44, 'final');
    section('Echo II · brass farewell', 45, 48, 'final');
    section('Coda · diminuendo', 49, 52, 'coda');
    section('G minor · final hold', 53, 54, 'coda');
    return G.validate(project);
  }
  const api = {metadata, create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursChervonaRuta = api;
})(typeof window === 'undefined' ? globalThis : window);
