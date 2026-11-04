'use strict';
/* Original, hardware-inspired voices with a Biquad or Ladder filter (see create). Neither
   is a measurement of a manufacturer's circuit or a reproduction of its wavetables. */
const afterhoursTimbreCache = new WeakMap();
window.AfterhoursTimbres = {
  create(ctx, p, destination) {
    if (p.family === 'analog') return AfterhoursVoice.create(ctx, p, destination);
    // Rust renders these voices; the Web Audio graph below is the fallback.
    if (AfterhoursVoice.ready(ctx)) return AfterhoursVoice.timbre(ctx, p, destination);
    const nodes = [],
      sources = [],
      oscillators = [],
      blends = [];
    const gain = value => {
      const n = ctx.createGain();
      n.gain.value = value;
      nodes.push(n);
      return n;
    };
    const osc = (type, ratio = 1, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = p.hz * ratio;
      o.detune.value = detune;
      nodes.push(o);
      sources.push(o);
      oscillators.push(o);
      return o;
    };
    const mix = gain(1),
      pre = gain(1 + (p.drive || 0) * 3);
    let cached = afterhoursTimbreCache.get(ctx);
    if (!cached) {
      cached = {curve: Float32Array.from({length: 1025}, (_, i) => Math.tanh((i / 512 - 1) * 1.4) / Math.tanh(1.4))};
      afterhoursTimbreCache.set(ctx, cached);
    }
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = 20;
    dc.Q.value = 0.5;
    // Ladder: the Rust/WebAssembly ladder saturates inside its feedback loop.
    // Biquad: a waveshaper followed by two biquads approximates a 24 dB lowpass.
    const ladder =
      p.filter === 'ladder' && window.AfterhoursLadder?.ready(ctx) ? AfterhoursLadder.create(ctx, p.time) : null;
    const filters = ladder ? [] : [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    if (ladder) {
      nodes.push(ladder.node, dc);
      mix.connect(pre).connect(ladder.node).connect(dc).connect(destination);
    } else {
      const shaper = ctx.createWaveShaper();
      shaper.curve = cached.curve;
      shaper.oversample = '2x';
      filters.forEach(f => {
        f.type = 'lowpass';
      });
      nodes.push(shaper, ...filters, dc);
      mix.connect(pre).connect(shaper).connect(filters[0]).connect(filters[1]).connect(dc).connect(destination);
    }
    const d = p.detune ?? 4,
      wave = p.family === 'wave';
    if (wave) {
      // Original Fourier frames: a hollow fundamental and a glassy upper spectrum.
      // Continuous crossfades move between frames without rebuilding oscillators.
      const frame = bright => {
        const real = new Float32Array(65),
          imag = new Float32Array(65);
        for (let k = 1; k <= 64; k++)
          imag[k] = bright ? (k === 1 ? 0.7 : Math.sin(k * 1.73) ** 2 / k ** 0.8) : k % 2 ? 1 / k ** 1.8 : 0.08 / k;
        return ctx.createPeriodicWave(real, imag);
      };
      const frames = cached.frames || (cached.frames = [frame(false), frame(true)]);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.16;
      nodes.push(lfo);
      sources.push(lfo);
      for (let layer = 0; layer < 3; layer++) {
        const pair = [];
        for (let f = 0; f < 2; f++) {
          const o = osc('sine', 1, (layer - 1) * d),
            level = gain(0),
            depth = gain(0);
          o.setPeriodicWave(frames[f]);
          o.connect(level).connect(mix);
          lfo.connect(depth).connect(level.gain);
          pair.push({level, depth});
        }
        blends.push(pair);
      }
    } else if (p.family === 'dual') {
      for (const [ratio, cents] of [
        [1, -d],
        [p.osc2Ratio || 1, d],
      ]) {
        const tri = osc('triangle', ratio, cents),
          saw = osc('sawtooth', ratio, cents);
        const a = gain(0),
          b = gain(0);
        tri.connect(a).connect(mix);
        saw.connect(b).connect(mix);
        blends.push([{level: a}, {level: b}]);
      }
      osc('square', 0.5).connect(gain(0.09)).connect(mix);
    } else {
      const a = gain(0),
        b = gain(0);
      osc('sawtooth', 1, -d).connect(a).connect(mix);
      osc('square', p.osc2Ratio || 1, d)
        .connect(b)
        .connect(mix);
      blends.push([{level: a}, {level: b}]);
      osc('triangle', 0.5).connect(gain(0.14)).connect(mix);
    }
    let previous = {};
    const set = (values, at = ctx.currentTime, initial = false) => {
      const cutoff = Math.max(40, Math.min(ctx.sampleRate * 0.42, values.cutoff)),
        resonance = Math.max(0.1, Math.min(12, values.resonance));
      if (initial || values.cutoff !== previous.cutoff || values.resonance !== previous.resonance) {
        const sweep = frequency => {
          if (initial) {
            frequency.setValueAtTime(cutoff, at);
            frequency.exponentialRampToValueAtTime(
              Math.min(ctx.sampleRate * 0.42, cutoff * (1 + (p.envelope || 0) * 5)),
              at + 0.012,
            );
            frequency.exponentialRampToValueAtTime(cutoff, at + Math.max(0.025, p.decay || 0.3));
          } else {
            frequency.cancelScheduledValues(at);
            frequency.setTargetAtTime(cutoff, at, 0.02);
          }
        };
        if (ladder) {
          // Resonance 0.5–6.75 (Shape 0–100) maps to ladder feedback 0–3.9, just below self-oscillation.
          ladder.resonance.setTargetAtTime(Math.min(3.95, Math.max(0, (resonance - 0.5) * 0.62)), at, 0.015);
          sweep(ladder.cutoff);
        } else
          filters.forEach((f, i) => {
            f.Q.setTargetAtTime(i ? 0.707 : 0.6 + resonance * 0.42, at, 0.015);
            sweep(f.frequency);
          });
      }
      const position = Math.max(0, Math.min(1, values.position ?? 0.5)),
        motion = Math.max(0, Math.min(1, values.motion || 0));
      for (const pair of blends)
        for (let i = 0; i < 2; i++) {
          pair[i].level.gain.setTargetAtTime((i ? position : 1 - position) * (wave ? 0.28 : 0.35), at, 0.02);
          pair[i].depth?.gain.setTargetAtTime(
            (i ? 1 : -1) * Math.min(position, 1 - position) * motion * 0.26,
            at,
            0.02,
          );
        }
      previous = {...values};
    };
    set(p, p.time, true);
    return {nodes, sources, oscillators, filters: ladder ? [ladder] : filters, pre, set};
  },
};
