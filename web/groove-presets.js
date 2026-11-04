/* Original demo arrangements and optional, separately supplied content packs. */
'use strict';
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./groove-core') : root.AfterhoursGroove;
  const all = [0, 1, 2, 3, 4, 5];
  const catalog = [
    {
      id: 'neon',
      title: 'Neon Afterimage',
      genre: 'Darkwave',
      bpm: 112,
      root: 33,
      swing: 0.035,
      space: 0.38,
      pump: 0.35,
      description: 'A driving octave bass, cold minor chords and restless metallic lights.',
      chords: [0, -5, -8, -7],
      bass: [0, 3, 6, 8, 11, 14],
      notes: [0, 12, 0, 0, 7, 12],
    },
    {
      id: 'rain',
      title: 'Rain on Concrete',
      genre: 'Trip hop',
      bpm: 84,
      root: 38,
      swing: 0.24,
      space: 0.48,
      pump: 0.12,
      description: 'A loping half-time pocket, deep D bass and suspended, smoky keys.',
      chords: [0, -3, -7, -5],
      bass: [0, 5, 10, 14],
      notes: [0, 7, 10, 0],
    },
    {
      id: 'velvet',
      title: 'Velvet Circuit',
      genre: 'Deep house',
      bpm: 122,
      root: 29,
      swing: 0.15,
      space: 0.3,
      pump: 0.58,
      description: 'Four to the floor, soft offbeat chords and a warm, syncopated F bass.',
      chords: [0, 5, -2, 3],
      bass: [0, 3, 6, 9, 12, 14],
      notes: [0, 7, 12, 0, 10, 7],
    },
    {
      id: 'pressure',
      title: 'Low Pressure',
      genre: 'Dub techno',
      bpm: 126,
      root: 31,
      swing: 0.06,
      space: 0.68,
      pump: 0.62,
      description: 'A round G pulse under spacious, filtered dub stabs and patient percussion.',
      chords: [0, 0, -5, -2],
      bass: [0, 7, 10],
      notes: [0, 0, 7],
    },
    {
      id: 'signal',
      title: 'Ghost Signal',
      genre: 'Electro',
      bpm: 132,
      root: 30,
      swing: 0.04,
      space: 0.22,
      pump: 0.3,
      description: 'Broken kicks, a short F-sharp bass sequence and glassy machine answers.',
      chords: [0, -2, -5, -7],
      bass: [0, 2, 5, 7, 10, 13, 15],
      notes: [0, 12, 7, 0, 10, 7, 12],
    },
    {
      id: 'dawn',
      title: 'Before the City Wakes',
      genre: 'Ambient breaks',
      bpm: 76,
      root: 36,
      swing: 0.1,
      space: 0.62,
      pump: 0.1,
      description: 'Slow C-minor harmony, sparse broken drums and long, drifting FM reflections.',
      chords: [0, -5, -3, -8],
      bass: [0, 10],
      notes: [0, 7],
    },
    {
      id: 'cathedral',
      title: 'Chrome Cathedral',
      genre: 'Synth pop',
      bpm: 110,
      root: 36,
      swing: 0.025,
      space: 0.42,
      pump: 0.22,
      description: 'Minor-key synth pop: a pulsing bass, glass bells and a wide chorus. Four free lanes for your MIDI.',
      chords: [0, -3, -8, -5],
      bass: [0, 3, 6, 8, 10, 14],
      notes: [0, 0, 12, 7, 0, 10],
    },
    {
      id: 'body',
      title: 'Body Electric',
      genre: 'Industrial EBM',
      bpm: 124,
      root: 30,
      swing: 0,
      space: 0.12,
      pump: 0.52,
      description: 'A dry, insistent machine rhythm with a clipped octave bass and metallic call and response.',
      chords: [0, 0, -2, 3],
      bass: [0, 2, 3, 6, 8, 10, 11, 14],
      notes: [0, 0, 12, 0, 7, 0, 12, 10],
    },
    {
      id: 'mirror',
      title: 'Mirrorball After Dark',
      genre: 'Italo disco',
      bpm: 118,
      root: 33,
      swing: 0.08,
      space: 0.26,
      pump: 0.38,
      description: 'A bouncing octave bass, bright seventh chords and a playful sixteenth-note arpeggio.',
      chords: [0, -5, -3, -7],
      bass: [0, 2, 4, 6, 8, 10, 12, 14],
      notes: [0, 12, 0, 12, 7, 19, 0, 12],
    },
    {
      id: 'shadow',
      title: 'Shadow Circuit',
      genre: 'Post-punk',
      bpm: 118,
      root: 33,
      swing: 0.025,
      space: 0.36,
      pump: 0.24,
      description: 'Sixteen parts: wiry octave bass, chiming synths and a restless live-feel drum machine.',
      chords: [0, -5, -8, -7],
      bass: [0, 2, 5, 6, 8, 10, 13, 14],
      notes: [0, 12, 7, 0, 0, 12, 10, 7],
    },
    {
      id: 'overpass',
      title: 'Midnight Overpass',
      genre: 'Cinematic synthwave',
      bpm: 106,
      root: 36,
      swing: 0.015,
      space: 0.46,
      pump: 0.32,
      description: 'Sixteen parts of warm saw bass, wide minor chords, glass arpeggios and a soaring night-drive hook.',
      chords: [0, -3, -8, -5],
      bass: [0, 2, 4, 6, 8, 10, 12, 14],
      notes: [0, 12, 0, 7, 0, 12, 0, 10],
    },
    {
      id: 'relay',
      title: 'Acid Rain Relay',
      genre: 'Acid breaks',
      bpm: 134,
      root: 30,
      swing: 0.11,
      space: 0.24,
      pump: 0.38,
      description: 'Sixteen parts: broken kicks, a sliding filter sequence, clipped chords and stereo machine replies.',
      chords: [0, 0, -2, 3],
      bass: [0, 1, 3, 5, 6, 8, 9, 11, 13, 15],
      notes: [0, 12, 7, 0, 10, 0, 12, 3, 7, 0],
    },
    {
      id: 'orchid',
      title: 'Iron Orchid',
      genre: 'Industrial techno',
      bpm: 138,
      root: 29,
      swing: 0,
      space: 0.18,
      pump: 0.62,
      description:
        'Sixteen parts: a heavy four-on-the-floor engine, hammered metal, low pulses and a sharp siren motif.',
      chords: [0, 0, -5, -2],
      bass: [0, 3, 6, 7, 8, 11, 14, 15],
      notes: [0, 0, 12, 7, 0, 10, 0, 7],
    },
    {
      id: 'redline',
      title: 'Redline Ritual',
      genre: 'Darksynth',
      bpm: 130,
      root: 28,
      swing: 0,
      space: 0.16,
      pump: 0.58,
      description:
        'Sixteen layers of distorted bass, octave leads, racing arpeggios and industrial drums. A 96-bar night chase with a stripped-back breakdown.',
    },
    {
      id: 'redline-overdrive',
      title: 'Redline Ritual — Overdrive',
      genre: 'Aggressive darksynth',
      bpm: 160,
      root: 26,
      swing: 0,
      space: 0.08,
      pump: 0.68,
      description:
        'A faster, darker Redline: 160 BPM, heavy vintage analog bass, industrial hits, dissonant riffs and hard stop-start drops. 112 bars.',
    },
    {
      id: 'letters',
      title: 'Neon Letters',
      genre: '80s synth pop',
      bpm: 116,
      root: 33,
      swing: 0.025,
      space: 0.32,
      pump: 0.25,
      description:
        'Rust analog bass, a bright plucked sequence and an answering lead. An original 64-bar synth-pop song with four free lanes.',
      chords: [0, -5, -8, -7],
      bass: [0, 3, 6, 8, 11, 14],
      notes: [0, 12, 0, 7, 0, 12],
      hook: [12, 15, 19, 15, 14, 12, 7, 10],
      hookSteps: [0, 3, 6, 8, 10, 12, 14, 15],
      chorus: 'Letters in neon',
    },
    {
      id: 'glass',
      title: 'Glass Platforms',
      genre: '80s new wave',
      bpm: 104,
      root: 38,
      swing: 0.045,
      space: 0.4,
      pump: 0.15,
      description:
        'A restrained broken rhythm, dark pulse bass and a spacious call-and-response melody. Four lanes remain free for your own parts.',
      chords: [0, -3, -7, -5],
      bass: [0, 5, 7, 10, 14],
      notes: [0, 0, 7, 12, 10],
      hook: [19, 17, 15, 14, 12, 10],
      hookSteps: [0, 4, 7, 10, 12, 15],
      chorus: 'Across the glass',
    },
    {
      id: 'satellite',
      title: 'Satellite Hearts',
      genre: '80s Italo pop',
      bpm: 124,
      root: 36,
      swing: 0.015,
      space: 0.27,
      pump: 0.35,
      description:
        'Bouncing octave bass, moving pulse arpeggios and an ascending chorus hook. An original 64-bar song built around the Rust voice.',
      chords: [0, -8, -5, -7],
      bass: [0, 2, 4, 6, 8, 10, 12, 14],
      notes: [0, 12, 7, 19, 0, 12, 7, 12],
      hook: [7, 12, 15, 19, 22, 19, 15, 12],
      hookSteps: [0, 2, 4, 6, 8, 10, 12, 14],
      chorus: 'Satellite hearts',
    },
  ];
  function darksynth(c) {
    const p = G.project(),
      full = Array.from({length: G.trackCount}, (_, i) => i);
    Object.assign(p, {title: c.title, bpm: c.bpm, swing: c.swing, mix: {space: c.space, pump: c.pump}});
    p.patterns.forEach((pattern, variation) => {
      pattern.length = 64;
      pattern.tracks.forEach(t => {
        t.length = 64;
        t.steps.forEach(s => {
          s.on = false;
          s.locks = {};
          s.chance = 100;
          s.repeat = 1;
        });
      });
      const [kick, snare, hat, lead, bass, chord, sub, octave, arp, drone, iron, crash, tom, bell, shaker, answer] =
        pattern.tracks;
      Object.assign(kick, {
        name: 'Piston / kick',
        note: 35,
        shape: 14,
        color: 10,
        sweep: 65,
        contour: 84,
        decay: 0.23,
        cutoff: 2900,
        volume: 84,
      });
      Object.assign(snare, {
        name: 'Steel / snare',
        note: 55,
        shape: 86,
        color: 80,
        sweep: 12,
        contour: 82,
        decay: 0.18,
        cutoff: 11000,
        volume: 74,
      });
      Object.assign(hat, {
        name: 'Sparks / hats',
        note: 82,
        shape: 70,
        color: 90,
        decay: 0.045,
        cutoff: 14000,
        volume: 47,
        pan: 18,
      });
      Object.assign(lead, {
        machine: 'Saw',
        name: 'Razor / lead',
        note: 64,
        shape: 45,
        color: 58,
        sweep: 23,
        contour: 55,
        decay: 0.18,
        cutoff: 5600,
        volume: 72,
        pan: -9,
      });
      lead.lfo = {target: 'pitch', depth: 2.5, division: 0.5, shape: 'sine'};
      Object.assign(bass, {
        machine: 'Saw',
        name: 'Motor / bass',
        note: c.root + 12,
        shape: 89,
        color: 24,
        sweep: 46,
        contour: 78,
        decay: 0.09,
        cutoff: variation === 0 ? 800 : 1700,
        volume: 61,
        pan: 0,
      });
      Object.assign(chord, {
        name: 'Voltage / fifths',
        note: 52,
        chord: 'fifth',
        shape: 46,
        color: 25,
        sweep: 0,
        contour: 70,
        decay: 0.5,
        cutoff: 2400,
        volume: 44,
        pan: 12,
      });
      Object.assign(sub, {
        name: 'Undertow / sub',
        note: c.root,
        shape: 0,
        color: 14,
        sweep: 0,
        contour: 85,
        decay: 0.1,
        cutoff: 180,
        volume: 53,
        pan: 0,
      });
      Object.assign(octave, {
        name: 'Blade / octave',
        note: 76,
        shape: 76,
        color: 44,
        sweep: 14,
        contour: 75,
        decay: 0.12,
        cutoff: 6800,
        volume: 40,
        pan: 24,
      });
      Object.assign(arp, {
        name: 'Chase / arpeggio',
        note: 76,
        shape: 34,
        color: 68,
        sweep: 18,
        contour: 80,
        decay: 0.075,
        cutoff: 4100,
        volume: 42,
        pan: -27,
      });
      arp.lfo = {target: 'pan', depth: 18, division: 2, shape: 'sine'};
      Object.assign(drone, {
        name: 'Dread / drone',
        note: 52,
        shape: 16,
        color: 23,
        sweep: 0,
        contour: 4,
        decay: 1.6,
        cutoff: 1250,
        volume: 32,
        pan: -16,
      });
      drone.lfo = {target: 'cutoff', depth: 12, division: 8, shape: 'triangle'};
      Object.assign(iron, {
        name: 'Foundry / impacts',
        note: 53,
        shape: 92,
        color: 77,
        sweep: 45,
        contour: 78,
        decay: 0.13,
        cutoff: 6200,
        volume: 49,
        pan: -22,
        algorithm: 'serial',
      });
      Object.assign(crash, {
        name: 'Shrapnel / crash',
        note: 87,
        shape: 84,
        color: 95,
        sweep: 0,
        contour: 65,
        decay: 0.7,
        cutoff: 12500,
        volume: 38,
        pan: 32,
      });
      Object.assign(tom, {
        name: 'Hydraulic / tom',
        note: 43,
        shape: 42,
        color: 32,
        sweep: 36,
        decay: 0.12,
        cutoff: 2500,
        volume: 37,
        pan: -32,
      });
      Object.assign(bell, {
        name: 'Beacon / bell',
        note: 88,
        shape: 48,
        color: 44,
        sweep: 0,
        decay: 0.24,
        cutoff: 5200,
        volume: 27,
        pan: 36,
      });
      Object.assign(shaker, {
        name: 'Static / shaker',
        note: 85,
        shape: 90,
        color: 100,
        decay: 0.025,
        cutoff: 13000,
        volume: 22,
        pan: -40,
      });
      Object.assign(answer, {
        name: 'Siren / answer',
        note: 76,
        shape: 22,
        color: 40,
        sweep: 8,
        decay: 0.16,
        cutoff: 3200,
        volume: 28,
        pan: 30,
      });
      const put = (t, index, note, velocity = 100, gate = 0.75, locks = {}) =>
        Object.assign(t.steps[index], {on: true, velocity, gate, locks: {...(note === null ? {} : {note}), ...locks}});
      const roots = [0, 0, 5, -2]; // E pedal, then A and D: our own four-bar phrase.
      const riffs = [
        [0, 0, 12, 0, 7, 0, 10, 7],
        [0, 0, 7, 10, 0, 12, 7, 0],
        [0, 0, 12, 7, 0, 7, 10, 12],
        [0, 0, 7, 0, 10, 7, 3, 2],
      ];
      const melody = [
        [0, 7, 10, 7, 3, 2],
        [0, 12, 10, 7, 2, 3],
        [0, 7, 12, 10, 7, 3],
        [0, 3, 7, 5, 3, 2],
      ];
      for (let bar = 0; bar < 4; bar++) {
        const at = bar * 16,
          root = c.root + roots[bar];
        [0, 4, 8, 12].forEach((n, i) => put(kick, at + n, null, i === 0 ? 119 : 108));
        [4, 12].forEach(n => put(snare, at + n, null, 113));
        [0, 2, 4, 6, 8, 10, 12, 14].forEach((n, i) =>
          put(hat, at + n, null, i % 2 ? 83 : 49, 0.65, {decay: n === 14 ? 0.085 : 0.04}),
        );
        [0, 2, 3, 6, 8, 10, 12, 14].forEach((n, i) =>
          put(bass, at + n, root + 12 + riffs[bar][i], i % 4 === 0 ? 117 : 92, 0.68, {
            cutoff: (variation === 0 ? 700 + bar * 180 : 1700) + (i % 3) * 190,
          }),
        );
        [0, 10].forEach((n, i) => put(chord, at + n, root + 24, i ? 64 : 83, i ? 0.8 : 1.6));
        if (variation === 1 || variation === 3) {
          [0, 3, 6, 8, 11, 14].forEach((n, i) =>
            put(
              lead,
              at + n,
              root + 36 + melody[bar][i] + (variation === 3 && bar === 3 ? 12 : 0),
              i === 0 ? 110 : 92,
              i === 2 || i === 5 ? 2 : 1.2,
            ),
          );
        }
        if (variation !== 2) {
          [0, 6, 8, 14].forEach((n, i) => put(sub, at + n, root, i % 2 ? 90 : 110, 1.5));
          [3, 7, 10, 15].forEach((n, i) =>
            put(iron, at + n, root + 24 + [0, 7, 0, 10][i], i === 3 ? 97 : 76, 0.5, {
              pan: i % 2 ? -32 : 30,
              shape: i === 3 ? 100 : 82,
            }),
          );
          if (bar === 0 || bar === 2) put(crash, at, null, bar === 0 ? 105 : 70, 1);
          put(drone, at, root + 24, 74, 2);
          if (variation === 1 || variation === 3) {
            [0, 6, 11].forEach((n, i) => put(octave, at + n, root + 48 + melody[bar][i * 2], 85, 1.3));
            const arpeggio = [0, 7, 12, 7, 3, 10, 7, 2];
            for (let n = 1; n < 16; n += 2)
              put(arp, at + n, root + 48 + arpeggio[(n - 1) / 2], n % 4 === 1 ? 87 : 66, 0.5, {
                cutoff: variation === 3 ? 6200 : 3600,
              });
            if (variation === 3 && bar === 3) {
              [12, 14, 15].forEach((n, i) => put(iron, at + n, root + 31 + i * 3, 88 + i * 10, 0.4));
              put(crash, at + 15, null, 68, 0.5, {decay: 0.16});
            }
          }
        } else {
          put(drone, at, root + 24, 66, 2, {decay: 2, cutoff: 850});
          if (bar === 3) [12, 14, 15].forEach((n, i) => put(iron, at + n, root + 36, 45 + i * 16, 0.4, {decay: 0.06}));
        }
        if (variation === 0 && bar === 3)
          [10, 13, 14, 15].forEach((n, i) => {
            put(snare, at + n, null, 52 + i * 15, 0.5, {decay: 0.07});
            snare.steps[at + n].condition = '2:2';
          });
        if (variation === 1 || variation === 3) {
          [5, 13].forEach((n, i) => put(tom, at + n, root + 12 + i * 7, 70, 0.5));
          put(bell, at + 14, root + 55, 72, 0.8);
          [3, 7, 11, 15].forEach(n => put(shaker, at + n, null, n === 15 ? 72 : 53, 0.5));
          [9, 15].forEach((n, i) => put(answer, at + n, root + 36 + [10, 7][i], 76, 1.1));
        }
        if (variation === 3) {
          [7, 15].forEach(n => put(hat, at + n, null, 46, 0.5, {pan: -30, decay: 0.035}));
          if (bar === 3) {
            [10, 13, 14, 15].forEach((n, i) => put(snare, at + n, null, 60 + i * 13, 0.5, {decay: 0.08}));
            put(kick, at + 15, null, 92);
          }
        }
        if (variation === 2) {
          // An independent, spacious phrase for the intro and breakdown.
          [kick, snare, hat, bass, chord].forEach(t => {
            for (let n = at; n < at + 16; n++) t.steps[n].on = false;
          });
          put(chord, at, root + 24, 85, 2, {cutoff: 1100});
          put(lead, at + 6, root + 43, 67, 2, {cutoff: 1700});
          put(lead, at + 12, root + 39, 58, 2, {cutoff: 1250});
          put(hat, at + 14, null, 50);
          chord.decay = 1.8;
          lead.decay = 0.8;
          lead.volume = 53;
        }
      }
    });
    p.arrangement = [
      {name: 'Cold ignition', pattern: 2, bars: 8, lanes: [2, 3, 5, 9, 10]},
      {name: 'Motor rising', pattern: 0, bars: 8, lanes: [0, 1, 2, 4, 6, 10, 11]},
      {name: 'Redline', pattern: 1, bars: 16, lanes: full},
      {name: 'Pursuit', pattern: 3, bars: 16, lanes: full},
      {name: 'Blackout', pattern: 2, bars: 8, lanes: [3, 5, 9, 10]},
      {name: 'Reignite', pattern: 0, bars: 8, lanes: [0, 1, 2, 4, 6, 10, 11]},
      {name: 'Overdrive', pattern: 3, bars: 16, lanes: full},
      {name: 'Last exit', pattern: 1, bars: 8, lanes: full},
      {name: 'Afterburn', pattern: 2, bars: 8, lanes: [3, 5]},
    ];
    return G.validate(p);
  }
  function redlineOverdrive(c) {
    // Keep the original song intact; reuse its instruments, then write a new score.
    const p = darksynth(c),
      full = Array.from({length: G.trackCount}, (_, i) => i);
    p.patterns.push(G.clone(p.patterns[0]), G.clone(p.patterns[2]));
    p.tonality = {root: 2, scale: 'minor'};
    p.performance = G.validate({...p, performance: {}}).performance;
    // Leave the sub and kick central; clear low-end space in the upper layers.
    for (const lane of [3, 5, 7, 8, 9, 10, 11, 13, 14, 15])
      Object.assign(p.performance.mixer.lanes[lane], {low: -9, high: -2});
    Object.assign(p.performance.mixer.lanes[4], {low: 1, mid: 2, high: -4});
    const put = (track, at, note, velocity = 100, gate = 0.55, locks = {}) =>
      Object.assign(track.steps[at], {on: true, velocity, gate, locks: {...(note === null ? {} : {note}), ...locks}});
    p.patterns.forEach((pattern, variation) => {
      for (const track of pattern.tracks) track.steps = Array.from({length: 64}, () => G.step());
      const [kick, snare, hat, lead, bass, chord, sub, octave, arp, drone, iron, crash, tom, bell, shaker, answer] =
        pattern.tracks;
      const main = variation === 1 || variation === 3,
        final = variation === 3,
        blackout = variation === 2,
        build = variation === 4,
        ending = variation === 5;
      Object.assign(kick, {name: 'Ram / kick', note: 33, shape: 26, sweep: 78, decay: 0.17, volume: 85});
      Object.assign(snare, {name: 'Rivet / snare', shape: 94, color: 90, decay: 0.12, volume: 78});
      Object.assign(hat, {decay: 0.028, cutoff: 10000, volume: 37});
      Object.assign(bass, {
        machine: 'Analog',
        name: 'Valve / analog bass',
        shape: 23,
        color: 34,
        sweep: 26,
        contour: 48,
        decay: 0.14,
        cutoff: 540,
        volume: 80,
        pan: 0,
      });
      bass.lfo.depth = 0;
      Object.assign(lead, {
        name: 'Razor / low lead',
        shape: 96,
        color: 28,
        sweep: 35,
        contour: 88,
        decay: 0.095,
        cutoff: 3300,
        volume: 65,
      });
      lead.lfo.depth = 0;
      Object.assign(chord, {name: 'Crusher / fifths', shape: 72, decay: 0.17, cutoff: 1600, volume: 36});
      Object.assign(sub, {decay: 0.1, volume: 31});
      Object.assign(octave, {
        machine: 'Saw',
        name: 'Blade / high answer',
        shape: 86,
        decay: 0.07,
        cutoff: 3800,
        volume: 31,
      });
      Object.assign(arp, {name: 'Panic / sequence', shape: 66, color: 42, decay: 0.035, cutoff: 2700, volume: 31});
      Object.assign(drone, {name: 'Dread / low drone', decay: 1.1, cutoff: 650, volume: 31});
      Object.assign(iron, {name: 'Anvil / impacts', shape: 100, color: 89, decay: 0.075, cutoff: 4200, volume: 46});
      Object.assign(crash, {decay: 0.36, cutoff: 8000, volume: 28});
      Object.assign(tom, {decay: 0.09, volume: 42});
      Object.assign(bell, {name: 'Alarm / dissonance', shape: 78, color: 67, decay: 0.11, cutoff: 2700, volume: 26});
      Object.assign(shaker, {decay: 0.018, cutoff: 10000, volume: 20});
      Object.assign(answer, {name: 'Grinding / response', shape: 97, color: 17, decay: 0.08, cutoff: 2100, volume: 37});
      // A low pedal with connected notes and a different turnaround in each bar.
      // Keep the filter accents restrained so the saw/pulse body carries the riff.
      const roots = [0, 0, 1, -2],
        rhythm = [0, 2, 3, 6, 8, 10, 11, 14],
        gates = [1.85, 0.85, 2.65, 1.8, 1.85, 0.85, 2.6, 1.65],
        bassRiff = [
          [0, 0, 0, 3, 0, 0, 1, 0],
          [0, 0, 7, 5, 0, 3, 1, 0],
          [0, 0, 0, 3, 0, 0, 7, 6],
          [0, 0, 3, 1, 0, 7, 6, 0],
        ],
        hook = [
          [0, 0, 7, 6, 3, 1],
          [0, 12, 10, 7, 6, 1],
          [0, 7, 6, 3, 1, 0],
          [0, 3, 1, 0, 6, 7],
        ];
      for (let bar = 0; bar < 4; bar++) {
        const at = bar * 16,
          root = c.root + roots[bar];
        if (ending) {
          if (bar === 0) {
            put(kick, at, null, 124);
            put(crash, at, null, 100);
            put(bass, at, c.root + 12, 112, 5, {decay: 0.8, cutoff: 380});
            put(chord, at, c.root + 24, 85, 6, {decay: 1.8, cutoff: 900});
            put(drone, at, c.root + 12, 75, 8, {decay: 2});
          }
          continue;
        }
        if (blackout) {
          // Half-time menace before the faster rhythm returns.
          put(kick, at, null, 116);
          put(snare, at + 8, null, 114, 0.5, {decay: 0.19});
          [0, 6, 10, 14].forEach((n, i) =>
            put(bass, at + n, root + 12 + [0, 3, 1, 0][i], i ? 99 : 114, i ? 1.8 : 4.8, {cutoff: 380}),
          );
          put(sub, at, root, 105, 3);
          put(drone, at, root + 12, 80, 8, {decay: 1.4});
          put(chord, at, root + 24, 78, 6, {decay: 0.9, cutoff: 900});
          put(bell, at + 12, root + 42, 69, 1.3);
          [2, 6, 10, 14].forEach(n => put(hat, at + n, null, 57));
          continue;
        }
        [0, 4, 8, 12].forEach(n => put(kick, at + n, null, n === 0 ? 124 : 114));
        [4, 12].forEach(n => put(snare, at + n, null, 119));
        for (let n = 0; n < 16; n++)
          if (main || n % 2 === 0) put(hat, at + n, null, n % 2 ? 43 : n % 4 === 2 ? 79 : 53, 0.4);
        rhythm.forEach((n, i) =>
          put(
            bass,
            at + n,
            root + 12 + bassRiff[bar][final && i >= 6 ? 13 - i : i],
            i === 0 || i === 4 ? 117 : i === 1 || i === 5 ? 89 : 103,
            gates[i],
            {cutoff: (main ? 580 : 420) + (i === 3 || i === 7 ? 110 : 0)},
          ),
        );
        [0, 8].forEach(n => put(sub, at + n, root, 101, 2.2));
        [3, 7, 11, 15].forEach((n, i) => put(iron, at + n, root + 24 + [0, 6, 0, 1][i], i % 2 ? 88 : 66, 0.4));
        if (bar === 0) put(crash, at, null, 100);
        if (main) {
          [0, 3, 6, 8, 11, 14].forEach((n, i) =>
            put(lead, at + n, root + 36 + hook[bar][i], i === 0 ? 116 : 101, i === 5 ? 1.5 : 0.75),
          );
          [0, 8].forEach(n => put(chord, at + n, root + 24, 90, 1.4));
          [3, 11, 14].forEach((n, i) => put(octave, at + n, root + 48 + hook[bar][i * 2], 81, 0.6));
          for (let n = 0; n < 16; n++)
            put(arp, at + n, root + 36 + [0, 12, 7, 13, 0, 10, 6, 7][n % 8], n % 4 === 0 ? 76 : 56, 0.32);
          put(drone, at, root + 12, 65, 4);
          [7, 15].forEach((n, i) => put(tom, at + n, root + 12 + i * 6, 86));
          put(bell, at + 14, root + 42, 78);
          [3, 7, 11, 15].forEach(n => put(shaker, at + n, null, 63));
          [7, 15].forEach((n, i) => put(answer, at + n, root + 24 + [6, 1][i], 97, 0.8));
          if (final) {
            [6, 14].forEach(n => put(kick, at + n, null, 98));
            [5, 13].forEach(n => put(answer, at + n, root + 36, 82));
          }
        }
        if (build) {
          put(drone, at, c.root + 12, 76, 4);
          const spacing = bar < 2 ? 4 : bar === 2 ? 2 : 1;
          for (let n = 0; n < 16; n += spacing)
            put(snare, at + n, null, 52 + bar * 13 + n, 0.3, {decay: 0.055, cutoff: 2200 + bar * 1500});
        }
        if ((main || build) && bar === 3) {
          [10, 13, 14].forEach((n, i) => put(snare, at + n, null, 80 + i * 15, 0.4, {decay: 0.065}));
          // A short gap makes the next downbeat hit harder.
          for (const track of pattern.tracks) for (let n = build ? 12 : 15; n < 16; n++) track.steps[at + n].on = false;
        }
      }
    });
    p.arrangement = [
      {name: 'Ignition / low motor', pattern: 0, bars: 4, lanes: [0, 2, 4, 6, 10]},
      {name: 'Pressure / rise', pattern: 4, bars: 4, lanes: [0, 1, 2, 4, 6, 9, 10, 11]},
      {name: 'Redline / first strike', pattern: 1, bars: 16, lanes: full},
      {name: 'Pursuit / double kick', pattern: 3, bars: 16, lanes: full},
      {name: 'Blackout / half time', pattern: 2, bars: 8, lanes: [0, 1, 2, 4, 5, 6, 9, 13]},
      {name: 'Detonator / rise', pattern: 4, bars: 4, lanes: [0, 1, 2, 4, 6, 9, 10]},
      {name: 'Overdrive / second strike', pattern: 1, bars: 16, lanes: full},
      {name: 'Tunnel / stripped motor', pattern: 0, bars: 8, lanes: [0, 1, 2, 4, 6, 10]},
      {name: 'No brakes / final assault', pattern: 3, bars: 16, lanes: full},
      {name: 'Last exit / blades', pattern: 3, bars: 16, lanes: full.filter(n => n !== 9)},
      {name: 'Impact / power down', pattern: 5, bars: 4, lanes: [0, 4, 5, 9, 11]},
    ];
    return G.validate(p);
  }
  function sixteen(c) {
    const p = G.project(),
      full = Array.from({length: G.trackCount}, (_, i) => i);
    const punk = c.id === 'shadow',
      wave = c.id === 'overpass',
      acid = c.id === 'relay';
    const hard = c.id === 'orchid';
    Object.assign(p, {title: c.title, bpm: c.bpm, swing: c.swing, mix: {space: c.space, pump: c.pump}});
    const hook = punk
      ? [12, 7, 3, 7, 10, 7, 5, 3]
      : wave
        ? [12, 10, 7, 3, 5, 7, 10, 7]
        : acid
          ? [0, 3, 7, 10, 12, 7, 3, 2]
          : [12, 12, 7, 10, 12, 15, 10, 7];
    p.patterns.forEach((pattern, variation) => {
      pattern.length = 64;
      pattern.tracks.forEach(t => {
        t.length = 64;
        t.steps.forEach(s =>
          Object.assign(s, {on: false, chance: 100, repeat: 1, condition: 'always', micro: 0, locks: {}}),
        );
      });
      const [kick, snare, hats, clap, bass, chord, sub, lead, arp, pad, tom, crash, rim, bell, shaker, answer] =
        pattern.tracks;
      const voices = [
        [
          kick,
          'Kick',
          'Floor / kick',
          {
            note: hard ? 33 : 36,
            shape: hard ? 28 : 12,
            color: 12,
            sweep: 62,
            contour: 80,
            decay: hard ? 0.27 : 0.2,
            cutoff: 2400,
            volume: 80,
            pan: 0,
          },
        ],
        [
          snare,
          'Snare',
          'Wire / snare',
          {
            note: punk ? 54 : 50,
            shape: hard ? 80 : 58,
            color: 72,
            decay: wave ? 0.22 : 0.13,
            cutoff: 9200,
            volume: 58,
            pan: -4,
          },
        ],
        [
          hats,
          'Metal',
          'Needle / hats',
          {note: 82, shape: 60, color: 86, decay: 0.035, cutoff: 12500, volume: 30, pan: 18},
        ],
        [
          clap,
          'Snare',
          'Room / clap',
          {note: 66, shape: 83, color: 95, sweep: 0, decay: 0.07, cutoff: 6500, volume: 24, pan: 25},
        ],
        [
          bass,
          acid ? 'DualVCO' : 'Ladder',
          'Current / bass',
          {
            note: c.root + 12,
            shape: acid ? 62 : hard ? 74 : punk ? 43 : 28,
            color: wave ? 35 : 16,
            sweep: acid ? 62 : 22,
            contour: 72,
            decay: punk ? 0.15 : 0.09,
            cutoff: variation === 0 ? 500 : acid ? 1700 : 950,
            volume: 46,
            pan: 0,
          },
        ],
        [
          chord,
          'Chord',
          'Halo / chords',
          {
            note: 57,
            chord: hard ? 'fifth' : 'minor7',
            shape: 21,
            color: wave ? 22 : 40,
            sweep: 0,
            decay: wave ? 0.9 : 0.35,
            cutoff: 2400,
            volume: wave ? 32 : 25,
            pan: -17,
          },
        ],
        [
          sub,
          'Tone',
          'Foundation / sub',
          {note: c.root, shape: 0, color: 8, sweep: 0, decay: 0.14, cutoff: 190, volume: 39, pan: 0},
        ],
        [
          lead,
          wave ? 'Wavetable' : hard ? 'DualVCO' : 'Ladder',
          'Signal / hook',
          {
            note: 69,
            shape: hard ? 65 : wave ? 24 : 38,
            color: punk ? 47 : 30,
            sweep: 9,
            decay: wave ? 0.33 : 0.17,
            cutoff: hard ? 3100 : 4500,
            volume: wave ? 43 : 36,
            pan: -10,
          },
        ],
        [
          arp,
          'DualVCO',
          'Prism / arp',
          {note: 72, shape: acid ? 65 : 22, color: 68, sweep: 35, decay: 0.09, cutoff: 5000, volume: 26, pan: 33},
        ],
        [
          pad,
          'WavePad',
          'Horizon / pad',
          {
            note: 57,
            chord: 'minor7',
            shape: 9,
            color: 52,
            sweep: 75,
            contour: 8,
            decay: 1.7,
            cutoff: 1200,
            volume: 23,
            pan: 14,
          },
        ],
        [
          tom,
          'Perc',
          'Transit / tom',
          {note: 43, shape: 31, color: 26, sweep: 38, decay: 0.13, cutoff: 2700, volume: 29, pan: -32},
        ],
        [
          crash,
          'Metal',
          'Flare / crash',
          {note: 89, shape: 78, color: 94, sweep: 0, decay: 0.65, cutoff: 11000, volume: 26, pan: 27},
        ],
        [
          rim,
          'Perc',
          'Click / rim',
          {note: 74, shape: hard ? 87 : 37, color: hard ? 78 : 29, decay: 0.045, cutoff: 5800, volume: 25, pan: -38},
        ],
        [
          bell,
          'Wavetable',
          'Glass / bell',
          {note: 81, shape: 45, color: 58, sweep: 0, decay: 0.23, cutoff: 6200, volume: 23, pan: 38},
        ],
        [
          shaker,
          'Metal',
          'Air / shaker',
          {note: 91, shape: 88, color: 100, decay: 0.04, cutoff: 14000, volume: 17, pan: -24},
        ],
        [
          answer,
          'DualVCO',
          'Echo / answer',
          {note: 69, shape: 20, color: 41, sweep: 5, decay: 0.2, cutoff: 2800, volume: 25, pan: 25},
        ],
      ];
      for (const [t, machine, name, settings] of voices) Object.assign(t, {machine, name}, settings);
      lead.lfo = {target: 'pitch', depth: wave ? 1.5 : 0, division: 0.5, shape: 'sine'};
      arp.lfo = {target: 'pan', depth: 22, division: 2, shape: 'triangle'};
      pad.lfo = {target: 'cutoff', depth: 9, division: 8, shape: 'sine'};
      const put = (t, step, note, velocity = 90, gate = 0.7, locks = {}) =>
        Object.assign(t.steps[step], {on: true, velocity, gate, locks: {...(note === null ? {} : {note}), ...locks}});
      for (let bar = 0; bar < 4; bar++) {
        const at = bar * 16,
          root = c.root + c.chords[bar];
        const kicks = acid
          ? [
              [0, 3, 6, 10],
              [0, 6, 8, 11],
              [0, 2, 7, 10],
              [0, 6, 10, 14],
            ][bar]
          : punk
            ? [0, 6, 8, 11]
            : [0, 4, 8, 12];
        kicks.forEach((n, i) => put(kick, at + n, null, i ? 100 : 115));
        [4, 12].forEach(n => {
          put(snare, at + n, null, 108);
          put(clap, at + n, null, wave ? 90 : 70, 0.5);
        });
        (hard ? [2, 6, 10, 14] : [0, 2, 4, 6, 8, 10, 12, 14]).forEach((n, i) =>
          put(hats, at + n, null, i % 2 ? 82 : 57, 0.4),
        );
        c.bass.forEach((n, i) =>
          put(
            bass,
            at + n,
            root + 12 + c.notes[(i + (variation === 3 ? bar : 0)) % c.notes.length],
            i % 3 ? 88 : 112,
            acid ? 0.55 : 1.1,
            acid ? {cutoff: [850, 3200, 1600, 4200][(i + bar + variation) % 4], shape: i % 3 ? 53 : 79} : {},
          ),
        );
        [0, 8].forEach(n => put(sub, at + n, root, 87, 1.2));
        (acid || hard ? [2, 10] : [0, 8]).forEach(n => put(chord, at + n, root + 24, 83, wave ? 2 : 0.8));
        put(pad, at, root + 24, 72, 2);
        (hard ? [3, 7, 11, 15] : [1, 7, 9, 15]).forEach((n, i) =>
          put(arp, at + n, root + 36 + [0, 7, 10, 3][(i + bar) % 4], 68, 0.6),
        );
        const leadSteps = acid ? [2, 5, 9, 14] : hard ? [0, 3, 8, 14] : [0, 3, 6, 10];
        leadSteps.forEach((n, i) =>
          put(
            lead,
            at + n,
            root + 24 + hook[(bar * 2 + i + (variation === 3 ? 2 : 0)) % hook.length],
            i ? 89 : 105,
            wave ? 2 : 1.3,
          ),
        );
        [5, 13].forEach((n, i) => put(rim, at + n, null, i ? 79 : 57, 0.5));
        [3, 7, 11, 15].forEach((n, i) => put(shaker, at + n, null, i % 2 ? 73 : 51, 0.4));
        put(bell, at + (bar % 2 ? 14 : 6), root + 48 + (bar % 2 ? 7 : 0), 76, 1.2);
        [11, 15].forEach((n, i) => put(answer, at + n, root + 36 + [7, 3][(i + bar) % 2], 72, 1.2));
        put(tom, at + 14, root + 12, 82, 0.6);
        if (bar === 0) put(crash, at, null, 90, 1);
        if (bar === 3) {
          [10, 13, 15].forEach((n, i) => put(tom, at + n, root + 12 + [7, 3, 0][i], 74 + i * 8, 0.6));
          put(snare, at + 15, null, 62, 0.5, {decay: 0.06});
          if (variation === 3) {
            put(kick, at + 15, null, 87);
            snare.steps[at + 15].repeat = 2;
          }
        }
        if (acid) {
          put(snare, at + 7, null, 43, 0.4);
          snare.steps[at + 7].micro = 0.12;
        }
        if (variation === 0) {
          // Verse: give the bass room; the hook arrives with pattern B.
          [lead, answer, bell].forEach(t => {
            for (let n = at; n < at + 16; n++) t.steps[n].on = false;
          });
        } else if (variation === 2) {
          // Breakdown has its own sparse melody and long, filtered harmony.
          [kick, snare, clap, bass, sub, arp, tom, crash, rim, shaker].forEach(t => {
            for (let n = at; n < at + 16; n++) t.steps[n].on = false;
          });
          leadSteps.forEach(n => {
            lead.steps[at + n].on = false;
          });
          put(lead, at + 4, root + 36 + hook[bar], 74, 2, {cutoff: 1700});
          put(lead, at + 12, root + 31, 62, 2, {cutoff: 1300});
          chord.decay = 1.6;
          chord.cutoff = 1100;
          lead.decay = 0.6;
        } else if (variation === 3) {
          [7, 15].forEach(n => put(hats, at + n, null, 48, 0.4, {pan: -15}));
          put(chord, at + 14, root + 31, 64, 0.7, {cutoff: 3300});
        }
      }
    });
    const names = punk
      ? [
          'Streetlight',
          'Footsteps',
          'Shadow circuit',
          'Crossed wires',
          'Empty platform',
          'Current returns',
          'Last train',
          'Daybreak',
        ]
      : wave
        ? [
            'City lights',
            'On the ramp',
            'Midnight run',
            'Tunnel vision',
            'Quiet skyline',
            'Back on the road',
            'Open highway',
            'Rearview',
          ]
        : acid
          ? [
              'Signal test',
              'Transmission',
              'Acid rain',
              'Reroute',
              'Dead channel',
              'Reconnect',
              'Relay overload',
              'Clear signal',
            ]
          : [
              'Cold steel',
              'Pressure rising',
              'Iron bloom',
              'Hammer room',
              'Power cut',
              'Restart',
              'Full force',
              'Cooling down',
            ];
    const layout = [
      [2, 4, [5, 7, 9, 13]],
      [0, 8, [0, 1, 2, 4, 6, 10, 12, 14]],
      [1, 16, full],
      [3, 8, full],
      [2, 8, [2, 5, 7, 9, 13]],
      [0, 8, [0, 1, 2, 3, 4, 6, 8, 10, 11, 12, 14]],
      [3, 16, full],
      [2, 4, [5, 7, 9, 13]],
    ];
    p.arrangement = layout.map(([pattern, bars, lanes], i) => ({name: names[i], pattern, bars, lanes}));
    return G.validate(p);
  }
  function synthpop(c) {
    const p = G.project(),
      full = Array.from({length: 12}, (_, i) => i);
    Object.assign(p, {title: c.title, bpm: c.bpm, swing: c.swing, mix: {space: c.space, pump: c.pump}});
    p.patterns.forEach((pattern, variation) => {
      pattern.length = 64;
      pattern.tracks.forEach(t => {
        t.length = 64;
        t.steps.forEach(s => Object.assign(s, {on: false, chance: 100, repeat: 1, locks: {}}));
      });
      const [kick, snare, hat, clap, bass, chord, sub, lead, arp, pad, tom, crash] = pattern.tracks;
      const setup = (t, machine, name, values) =>
        Object.assign(t, {
          machine,
          name,
          shape: 25,
          color: 45,
          sweep: 35,
          contour: 55,
          decay: 0.22,
          cutoff: 3200,
          volume: 40,
          pan: 0,
          lfo: {target: 'shape', depth: 0, division: 4, shape: 'sine'},
          ...values,
        });
      setup(kick, 'Kick', 'Floor / kick', {note: 35, shape: 12, color: 10, sweep: 50, volume: 78, cutoff: 2200});
      setup(snare, 'Snare', 'Tape / snare', {
        note: 54,
        shape: 72,
        color: 72,
        sweep: 10,
        decay: 0.16,
        volume: 54,
        cutoff: 11000,
      });
      setup(hat, 'Metal', 'Silver / hats', {
        note: 82,
        shape: 65,
        color: 85,
        sweep: 0,
        decay: 0.045,
        volume: 28,
        cutoff: 14000,
        pan: 20,
      });
      setup(clap, 'Snare', 'Clap / echo', {
        note: 62,
        shape: 92,
        color: 90,
        sweep: 0,
        decay: 0.1,
        volume: 22,
        cutoff: 6500,
        pan: -18,
      });
      setup(bass, 'Analog', 'Circuit / bass', {
        note: c.root,
        shape: 29,
        color: 38,
        sweep: 54,
        contour: 32,
        decay: 0.12,
        volume: 65,
        cutoff: variation === 2 ? 420 : 720,
      });
      setup(chord, 'WavePad', 'Glass / chords', {
        note: c.root + 24,
        chord: 'minor7',
        shape: 12,
        sweep: 12,
        decay: 0.65,
        volume: 24,
        cutoff: 2400,
        pan: 15,
      });
      setup(sub, 'Tone', 'Foundation / sub', {
        note: c.root,
        shape: 0,
        color: 0,
        sweep: 0,
        decay: 0.15,
        volume: 25,
        cutoff: 190,
      });
      setup(lead, 'Analog', 'Signal / hook', {
        note: c.root + 24,
        shape: 30,
        color: 48,
        sweep: 28,
        contour: 50,
        decay: 0.32,
        volume: 52,
        cutoff: 2800,
        pan: -8,
      });
      setup(arp, 'Analog', 'Neon / plucks', {
        note: c.root + 36,
        shape: 40,
        color: 68,
        sweep: 65,
        contour: 20,
        decay: 0.09,
        volume: 32,
        cutoff: 1700,
        pan: -28,
      });
      setup(pad, 'WavePad', 'Horizon / pad', {
        note: c.root + 24,
        chord: 'minor7',
        shape: 10,
        sweep: 65,
        contour: 8,
        decay: 1.6,
        volume: 17,
        cutoff: 1200,
        pan: 24,
      });
      setup(tom, 'Perc', 'Turn / tom', {
        note: 46,
        shape: 25,
        color: 15,
        sweep: 45,
        decay: 0.17,
        volume: 36,
        cutoff: 2200,
        pan: -20,
      });
      setup(crash, 'Metal', 'Air / accents', {
        note: 80,
        shape: 82,
        color: 85,
        sweep: 0,
        decay: 0.65,
        volume: 17,
        cutoff: 12000,
        pan: 30,
      });
      const put = (t, index, note, velocity = 90, gate = 0.65) => {
        Object.assign(t.steps[index], {on: true, velocity, gate, locks: {note}});
      };
      for (let bar = 0; bar < 4; bar++) {
        const at = bar * 16,
          root = c.root + c.chords[bar];
        (c.id === 'glass' ? [0, 6, 10] : [0, 4, 8, 12]).forEach(n => put(kick, at + n, 35, n === 0 ? 105 : 92));
        [4, 12].forEach(n => {
          put(snare, at + n, 54, 100);
          put(clap, at + n, 62, 76);
        });
        for (let n = 0; n < 16; n += 2) put(hat, at + n, 82, n % 4 ? 76 : 48, 0.35);
        c.bass.forEach((n, i) => put(bass, at + n, root + c.notes[i], i % 2 ? 85 : 103, c.id === 'glass' ? 1.2 : 0.7));
        [0, 8].forEach(n => {
          put(sub, at + n, root, 85, 1.5);
          put(chord, at + n, root + 24, 76, 1.8);
        });
        put(pad, at, root + 24, 74, 2);
        c.hookSteps.forEach((n, i) => {
          const interval = c.hook[(i + (variation === 3 ? 2 : 0)) % c.hook.length];
          put(lead, at + n, root + 12 + interval, i % 3 ? 86 : 103, c.id === 'glass' ? 1.5 : 0.9);
        });
        const sequence = c.id === 'satellite' ? [0, 7, 12, 15] : c.id === 'glass' ? [0, 10, 7, 3] : [0, 3, 7, 12];
        for (let n = 1; n < 16; n += c.id === 'glass' ? 4 : 2)
          put(arp, at + n, root + 24 + sequence[Math.floor(n / 2) % 4], 72 + (n % 3) * 7, 0.4);
        if (bar === 3) [11, 14, 15].forEach((n, i) => put(tom, at + n, 48 - i * 3, 80 + i * 5));
        if (bar === 0) put(crash, at, 80, 80);
        if (variation === 3 && bar % 2) {
          put(snare, at + 15, 56, 65);
          put(lead, at + 13, root + 36, 80, 0.5);
        }
      }
    });
    p.arrangement = [
      {name: 'Transmission', pattern: 2, bars: 4, lanes: [2, 8, 9]},
      {name: 'First verse', pattern: 0, bars: 8, lanes: [0, 1, 2, 4, 5, 6, 8]},
      {name: c.chorus, pattern: 1, bars: 16, lanes: full},
      {name: 'Second verse', pattern: 0, bars: 8, lanes: [0, 1, 2, 4, 5, 6, 8, 10]},
      {name: 'Night crossing', pattern: 2, bars: 8, lanes: [2, 4, 7, 9]},
      {name: 'Final transmission', pattern: 3, bars: 16, lanes: full},
      {name: 'Distant lights', pattern: 2, bars: 4, lanes: [8, 9]},
    ];
    return G.validate(p);
  }
  const packed = new Map();
  function register(pack) {
    if (pack?.version !== 1 || !Array.isArray(pack.presets) || !pack.presets.length || pack.presets.length > 64)
      throw new Error('Invalid content pack');
    const entries = pack.presets.map(entry => {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[a-z0-9-]{1,64}$/.test(entry.id) ||
        typeof entry.title !== 'string' ||
        !entry.project
      )
        throw new Error('Invalid content preset');
      const project = G.validate(JSON.parse(JSON.stringify(entry.project)));
      return {
        id: entry.id,
        title: entry.title,
        genre: String(entry.genre || 'Content pack'),
        description: String(entry.description || ''),
        bpm: project.bpm,
        project,
      };
    });
    const ids = entries.map(entry => entry.id);
    if (new Set(ids).size !== ids.length || ids.some(id => catalog.some(c => c.id === id)))
      throw new Error('Duplicate content preset');
    const demo = pack.demo ? JSON.parse(JSON.stringify(pack.demo)) : null;
    if (
      demo &&
      (typeof demo.label !== 'string' ||
        !ids.includes(demo.preset) ||
        !Number.isInteger(demo.startSection) ||
        demo.startSection < 0 ||
        !entries.find(e => e.id === demo.preset).project.arrangement?.length ||
        demo.startSection >= entries.find(e => e.id === demo.preset).project.arrangement.length)
    )
      throw new Error('Invalid content demo');
    // Validate the whole pack before changing the catalog or exposing its demo.
    const metadata = [];
    for (const {project, ...entry} of entries) {
      packed.set(entry.id, project);
      metadata.push(entry);
    }
    if (pack.prepend === true) catalog.unshift(...metadata);
    else catalog.push(...metadata);
    if (demo) api.demo = demo;
  }
  function create(id) {
    if (packed.has(id)) return JSON.parse(JSON.stringify(packed.get(id)));
    const c = catalog.find(p => p.id === id);
    if (!c) throw new Error('Unknown track preset');
    if (['letters', 'glass', 'satellite'].includes(id)) return synthpop(c);
    if (id === 'redline') return darksynth(c);
    if (id === 'redline-overdrive') return redlineOverdrive(c);
    if (['shadow', 'overpass', 'relay', 'orchid'].includes(id)) return sixteen(c);
    const p = G.project();
    p.title = c.title;
    p.bpm = c.bpm;
    p.swing = c.swing;
    p.mix = {space: c.space, pump: c.pump};
    const slow = ['rain', 'dawn'].includes(id),
      four = ['velvet', 'pressure', 'neon', 'cathedral', 'body', 'mirror'].includes(id);
    p.patterns.forEach((pattern, variation) => {
      pattern.length = 64;
      pattern.tracks.forEach(t => {
        t.length = 64;
        t.steps.forEach(s => {
          s.on = false;
          s.locks = {};
          s.chance = 100;
          s.repeat = 1;
        });
      });
      const [kick, snare, hat, perc, bass, chord] = pattern.tracks;
      Object.assign(kick, {
        name: 'Floor / body',
        note: slow ? 33 : 35,
        shape: 10,
        color: 12,
        sweep: 38,
        contour: 74,
        decay: slow ? 0.32 : 0.24,
        cutoff: 2100,
        volume: 74,
      });
      Object.assign(snare, {
        name: 'Wire / backbeat',
        note: slow ? 54 : 57,
        shape: 80,
        color: 82,
        sweep: 8,
        contour: 75,
        decay: slow ? 0.17 : 0.115,
        cutoff: 8500,
        volume: slow ? 61 : 56,
      });
      Object.assign(hat, {
        name: 'Alloy / air',
        note: 81,
        shape: 76,
        color: 89,
        decay: 0.047,
        cutoff: 13000,
        volume: slow ? 39 : 43,
        pan: 15,
      });
      Object.assign(perc, {
        name: 'Glass / reply',
        note: c.root + 48,
        shape: id === 'signal' ? 34 : 14,
        color: 26,
        sweep: 0,
        decay: slow ? 0.55 : 0.28,
        cutoff: 6200,
        volume: slow ? 48 : 45,
        pan: 24,
      });
      Object.assign(bass, {
        name: 'Fundamental / bass',
        note: c.root,
        shape: id === 'neon' ? 44 : id === 'signal' ? 38 : 19,
        color: 15,
        sweep: 0,
        contour: 70,
        decay: id === 'pressure' ? 0.16 : 0.22,
        cutoff: id === 'neon' ? 1550 : id === 'signal' ? 2300 : 950,
        volume: 57,
        pan: 0,
      });
      Object.assign(chord, {
        name: 'Memory / harmony',
        note: c.root + 24,
        shape: id === 'pressure' ? 32 : 20,
        color: 30,
        sweep: 0,
        contour: slow ? 8 : 45,
        decay: id === 'pressure' ? 0.65 : slow ? 2 : 0.85,
        cutoff: id === 'pressure' ? 1650 : 3400,
        volume: slow ? 60 : 56,
        pan: -8,
      });
      chord.lfo = {target: 'cutoff', depth: slow ? 14 : 7, division: 16, shape: 'sine'};
      const put = (t, at, velocity = 100, locks = {}, extra = {}) =>
        Object.assign(t.steps[at], {on: true, velocity, locks, ...extra});
      for (let bar = 0; bar < 4; bar++) {
        const base = bar * 16,
          transpose = c.chords[bar];
        const kicks = four ? [0, 4, 8, 12] : id === 'signal' ? [0, 6, 10] : [0, 6, 11];
        kicks.forEach((n, i) => put(kick, base + n, i ? 104 : 116));
        if (variation === 3 && bar === 3) put(kick, base + 14, 87);
        (slow ? [8] : [4, 12]).forEach(n => put(snare, base + n, bar % 2 ? 103 : 109, {}, {micro: 0.025}));
        if (variation !== 2 && bar % 2)
          put(snare, base + (slow ? 15 : 11), 39, {decay: 0.07, cutoff: 4800}, {micro: -0.05});
        const hats = id === 'dawn' ? [2, 7, 10, 14] : id === 'pressure' ? [2, 6, 10, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
        hats.forEach((n, i) =>
          put(
            hat,
            base + n,
            i % 2 ? 80 : 53,
            {decay: n === 14 && variation > 0 ? 0.12 : 0.045},
            {micro: i % 2 ? 0.025 : 0},
          ),
        );
        if (variation === 3) [3, 11, 15].forEach(n => put(hat, base + n, 35, {pan: -20, decay: 0.035}));
        // A four-bar call and response, played above the chord rather than the bass.
        const motif = [
          [7, 10, 12, 7],
          [3, 7, 10, 14],
          [0, 7, 10, 12],
          [7, 3, 2, 0],
        ][bar];
        const replies = id === 'pressure' ? [7, 15] : slow ? [3, 10, 14] : [3, 7, 10, 14];
        replies.forEach((n, i) => {
          if (variation === 2 && i > 0) return;
          put(
            perc,
            base + n,
            i === 0 ? 100 : 76 + i * 4,
            {note: c.root + 48 + transpose + motif[i], cutoff: variation === 3 ? 7600 : 5400},
            {condition: variation === 0 ? '2:2' : 'always', micro: 0.025},
          );
        });
        c.bass.forEach((n, i) =>
          put(
            bass,
            base + n,
            i === 0 ? 112 : 87 + (i % 3) * 6,
            {note: c.root + transpose + c.notes[i], cutoff: bass.cutoff * (variation === 3 ? 1.4 : 1)},
            {gate: id === 'neon' ? 0.85 : slow ? 1.4 : 0.62},
          ),
        );
        const stabs = id === 'velvet' ? [2, 10] : id === 'pressure' ? [3, 14] : [0];
        stabs.forEach((n, i) =>
          put(
            chord,
            base + n,
            i ? 77 : 94,
            {note: c.root + 24 + transpose, cutoff: chord.cutoff * (bar % 2 ? 0.78 : 1)},
            {gate: slow ? 2 : id === 'neon' ? 1.8 : 0.65},
          ),
        );
      }
      // C is a melodic breathing space; D lifts the filter and adds a last-bar fill.
      if (variation === 2) {
        hat.steps.forEach((s, i) => {
          if (i % 4 !== 2) s.on = false;
        });
        bass.steps.forEach((s, i) => {
          if (i % 16 !== 0) s.on = false;
          else s.gate = 2;
        });
        chord.decay = 2;
        chord.cutoff *= 0.75;
      }
      if (variation === 3) {
        put(snare, 62, 60, {decay: 0.07}, {repeat: 2});
        put(perc, 63, 53, {note: c.root + 43}, {repeat: 2});
      }
    });
    if (['cathedral', 'body', 'mirror'].includes(id)) {
      const disco = id === 'mirror',
        ebm = id === 'body';
      p.patterns.forEach((pattern, variation) => {
        const [kick, snare, hat, perc, bass, chord, sub, lead, arp, pad, tom, accent] = pattern.tracks;
        Object.assign(bass, {
          machine: 'Saw',
          shape: ebm ? 77 : disco ? 24 : 38,
          color: 22,
          decay: ebm ? 0.07 : 0.15,
          cutoff: ebm ? 1250 : 1800,
          volume: 52,
        });
        Object.assign(chord, {
          chord: disco ? 'major7' : 'minor7',
          volume: 38,
          decay: disco ? 0.35 : 1.2,
          cutoff: disco ? 4800 : 2300,
        });
        Object.assign(perc, {
          name: 'Glass / bell',
          machine: 'Tone',
          shape: 43,
          color: 38,
          sweep: 0,
          decay: 0.35,
          volume: 35,
        });
        Object.assign(sub, {
          name: 'Anchor / sub',
          note: c.root,
          shape: 0,
          color: 5,
          decay: 0.1,
          cutoff: 220,
          volume: 32,
        });
        Object.assign(lead, {
          name: 'Voice / melody',
          shape: ebm ? 68 : 26,
          color: 34,
          sweep: 0,
          decay: 0.22,
          cutoff: disco ? 6200 : 3400,
          volume: 37,
          pan: -16,
        });
        Object.assign(arp, {
          name: 'Prism / arpeggio',
          shape: 19,
          color: 38,
          decay: 0.08,
          cutoff: 3800,
          volume: 27,
          pan: 28,
        });
        Object.assign(pad, {
          name: 'Halo / pad',
          machine: 'Chord',
          chord: disco ? 'major7' : 'minor7',
          shape: 12,
          color: 22,
          contour: 0,
          decay: 1.6,
          cutoff: 1500,
          volume: 25,
          pan: -23,
        });
        Object.assign(tom, {name: 'Relay / tom', shape: 64, sweep: 30, decay: 0.1, volume: 32, pan: -30});
        Object.assign(accent, {name: 'Open / hat', decay: 0.19, volume: 24, pan: 35});
        const put = (t, at, note, velocity = 85, gate = 1) =>
          Object.assign(t.steps[at], {on: true, velocity, gate, locks: {note}});
        const phrase = disco
          ? [7, 12, 14, 12, 7, 4, 2, 0]
          : ebm
            ? [0, 0, 7, 0, 10, 7, 12, 10]
            : [7, 10, 12, 14, 12, 7, 3, 2];
        for (let bar = 0; bar < 4; bar++) {
          const at = bar * 16,
            root = c.root + c.chords[bar];
          put(pad, at, root + 24, 72, 2);
          if (variation !== 2) {
            [0, 8].forEach(n => put(sub, at + n, root, 85, 1.5));
            [6, 14].forEach(n => put(accent, at + n, 83, 70, 0.6));
            [7, 15].forEach((n, i) => put(tom, at + n, root + 19 + i * 5, 65, 0.5));
          }
          if (variation === 1 || variation === 3) {
            (disco ? [0, 2, 5, 6, 8, 10, 13, 14] : ebm ? [2, 6, 10, 14] : [0, 3, 6, 10, 12, 14]).forEach((n, i) =>
              put(lead, at + n, root + 36 + phrase[(i + bar * 2) % phrase.length], i % 3 ? 82 : 101, disco ? 0.8 : 1.6),
            );
            (disco ? [1, 3, 5, 7, 9, 11, 13, 15] : [3, 7, 11, 15]).forEach((n, i) =>
              put(arp, at + n, root + 48 + [0, 7, disco ? 4 : 3, 12][i % 4], 68 + (i % 2) * 12, 0.55),
            );
          }
          if (ebm) {
            snare.decay = 0.09;
            chord.volume = 27;
            pad.volume = 17;
            [3, 11].forEach(n => put(kick, at + n, 35, 70, 0.6));
          }
        }
      });
    }
    p.arrangement = [
      {name: 'Arrival', pattern: 2, bars: 8, lanes: [2, 3, 5]},
      {name: 'Pulse', pattern: 0, bars: 8, lanes: [0, 2, 4, 5]},
      {name: 'Main', pattern: 1, bars: 8, lanes: all},
      {name: 'Motion', pattern: 3, bars: 8, lanes: all},
      {name: 'Weightless', pattern: 2, bars: 8, lanes: [2, 3, 4, 5]},
      {name: 'Return', pattern: 3, bars: 8, lanes: all},
      {name: 'Afterglow', pattern: 1, bars: 8, lanes: all},
      {name: 'Departure', pattern: 2, bars: 8, lanes: [2, 5]},
    ];
    if (['cathedral', 'body', 'mirror'].includes(id))
      p.arrangement.forEach(section => {
        section.lanes =
          section.pattern === 2
            ? [2, 3, 5, 9]
            : section.pattern === 0
              ? [0, 1, 2, 4, 5, 6, 10, 11]
              : Array.from({length: 12}, (_, i) => i);
      });
    return G.validate(p);
  }
  function sectionAt(project, tick) {
    let start = 0;
    for (const [index, s] of (project.arrangement || []).entries()) {
      const end = start + s.bars * 32;
      if (tick < end) return {...s, index, start, end, localTick: tick - start};
      start = end;
    }
    return null;
  }
  function songEvents(project, tick, options = {}) {
    const s = sectionAt(project, tick);
    if (!s) return [];
    return G.events(project.patterns[s.pattern], s.localTick, options)
      .filter(e => s.lanes.includes(e.lane))
      .map(e => ({...e, beat: Math.max(s.start / 8, e.beat + s.start / 8)}));
  }
  const api = {catalog, create, register, demo: null, sectionAt, songEvents};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursPresets = api;
})(typeof window === 'undefined' ? globalThis : window);
