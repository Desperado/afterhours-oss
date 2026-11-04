/* Playback-only sound tour. The score and saved instrument patches stay untouched. */
'use strict';
(function (root) {
  const stages = [
    [
      'ensemble',
      'The recorded ensemble',
      'Flutes carry the march above brass, bowed strings, harp and marching percussion. Hear the original arrangement first.',
    ],
    [
      'flutes',
      'Flute · breath and phrasing',
      'The recorded flutes come forward. Every two bars, short detached gates change to longer phrases; the accompaniment stays quiet.',
    ],
    [
      'brass',
      'Brass · weight and attack',
      'Trumpet, horn, trombone and tuba take the foreground. Compare softer, short attacks with stronger, longer notes every two bars.',
    ],
    [
      'strings',
      'Strings · bow and sustain',
      'Violins, violas and cellos move forward. Compare clipped notes with longer bowed gates every two bars. These use the installed sustain recordings.',
    ],
    [
      'dynamics',
      'Sampling · soft to strong',
      'An eight-bar crescendo changes note velocity. The sampler selects the installed velocity regions and cycles alternate recordings where the instrument provides them.',
    ],
    [
      'wavetable',
      'Wavetable · hollow to glass',
      'The flute part plays through the wavetable voice. Color sweeps between Fourier frames while motion and filtering reshape the tone; the other players remain sampled.',
    ],
    [
      'analog',
      'Analog · moving bass',
      'The tuba part becomes a dual-oscillator bass with a resonant ladder filter. Hear its cutoff open and close against the recorded ensemble.',
    ],
    [
      'space',
      'Space · close to room',
      'Every two bars, the real mixer switches between dry sound and shared convolution reverb plus tempo delay. Listen to the tails between phrases.',
    ],
    [
      'finale',
      'Back to the orchestra',
      'All original sampled voices and the original mix return. The tour holds here; choose any chapter to explore again.',
    ],
  ].map(([id, title, description]) => ({id, title, description}));
  const duration = 32; // Eight 4/4 bars, in beats, independent of tempo.
  function position(command, beat) {
    const elapsed = Math.max(0, beat - command.beat);
    const index = Math.min(stages.length - 1, command.index + (command.auto ? Math.floor(elapsed / duration) : 0));
    return {index, phase: (elapsed % duration) / duration, beat: elapsed, id: stages[index].id};
  }
  function transform(event, state, amount = 1) {
    if (!amount || ['ensemble', 'finale', 'space'].includes(state.id)) return event;
    const e = {...event, settings: {...event.settings}},
      s = e.settings;
    const flute = s.instrument === 'vsco-flute' && s.machine === 'Instrument';
    const brass =
      ['vsco-trumpet', 'vsco-horn', 'vsco-trombone', 'vsco-tuba'].includes(s.instrument) && s.machine === 'Instrument';
    const strings = ['vsco-violins', 'vsco-violas', 'vsco-cellos'].includes(s.instrument) && s.machine === 'Instrument';
    const long = Math.floor(state.beat / 8) % 2 === 1;
    const blend = (a, b) => a + (b - a) * amount;
    const focus = state.id === 'flutes' ? flute : state.id === 'brass' ? brass : strings;
    if (['flutes', 'brass', 'strings'].includes(state.id)) {
      if (!focus) s.volume *= blend(1, 0.3);
      else {
        e.gate = blend(e.gate, long ? Math.max(e.gate, 0.8) : Math.min(e.gate, 0.14));
        if (state.id === 'brass') e.velocity = blend(e.velocity, long ? 0.95 : 0.5);
      }
    }
    if (state.id === 'dynamics' && s.machine === 'Instrument') e.velocity = blend(e.velocity, 0.28 + state.phase * 0.7);
    if (state.id === 'wavetable') {
      if (flute)
        Object.assign(s, {
          machine: 'Wavetable',
          color: 5 + state.phase * 90,
          sweep: 65 * amount,
          shape: 25,
          cutoff: 1500 + state.phase * 9000,
          decay: 0.2,
          volume: Math.min(36, s.volume),
          lfo: {...s.lfo, depth: 0},
        });
      else s.volume *= blend(1, 0.5);
    }
    if (state.id === 'analog' && s.machine === 'Instrument' && s.instrument === 'vsco-tuba')
      Object.assign(s, {
        machine: 'DualVCO',
        filter: 'ladder',
        color: 55,
        sweep: 35 * amount,
        shape: 48,
        cutoff: 250 + (0.5 - 0.5 * Math.cos(state.phase * Math.PI * 4)) * 3500 * amount,
        decay: 0.18,
        volume: Math.min(45, s.volume),
        lfo: {...s.lfo, depth: 0},
      });
    return e;
  }
  function room(base, state, amount) {
    if (state.id !== 'space') return base;
    const out = JSON.parse(JSON.stringify(base)),
      wet = Math.floor(state.beat / 8) % 2 === 1;
    for (const lane of out.mixer.lanes) {
      lane.reverb = wet ? 0.65 * amount : 0;
      lane.delay = wet ? 0.28 * amount : 0;
    }
    return out;
  }
  const api = {stages, duration, position, transform, room};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursDemoCore = api;
})(typeof window === 'undefined' ? globalThis : window);
