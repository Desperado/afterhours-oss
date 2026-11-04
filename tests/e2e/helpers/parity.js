'use strict';
// Renders one note through the Rust worklets and through the Web Audio fallback graph they
// replaced (a context without the worklet), then compares them. A case is a Groove hit
// ({lane, settings, gate}) or a Synth note ({patch, note, release}).
async function compare(page, cases) {
  return page.evaluate(async cases => {
    const rate = 48000;
    async function render(c, rust) {
      const ctx = new OfflineAudioContext(2, rate * (c.seconds || 1.5), rate);
      // Both sides load the Ladder β filter; only the Rust side loads the voice worklets.
      if (!(await AfterhoursLadder.prepare(ctx))) throw new Error('Ladder filter did not load');
      if (rust && !(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      // Onset on a render-quantum boundary (frame 2560): Chrome applies a mid-quantum
      // setValueAtTime on oscillator frequency only from the next quantum, so unaligned
      // Web Audio sweeps start up to 128 frames late, differently on every hit.
      const onset = 2560 / rate;
      let nodes, engine;
      if (c.patch) {
        engine = new AfterhoursSynthAudio(ctx);
        engine.setPatch(AfterhoursSynthAudio.presets.find(p => p.id === c.patch));
        engine.noteOn('note', c.note ?? 57, 0.8, onset);
        engine.noteOff('note', c.release ?? 1);
        // Live control changes while the note is held, as the Synth panel makes them. Rust
        // voices receive them as messages, which reach the audio thread asynchronously (like
        // UI changes in realtime), so let them arrive before rendering continues.
        if (c.change)
          ctx.suspend(c.change.at).then(() => {
            for (const [key, value] of Object.entries(c.change.values)) engine.set(key, value);
            return new Promise(resolve => setTimeout(resolve, 100)).then(() => ctx.resume());
          });
        nodes = [...engine.voices][0].nodes;
      } else {
        engine = new FMGrooveAudio(ctx, 120, AfterhoursController.defaults(), AfterhoursPerformanceCore.validate());
        const settings = {...AfterhoursGroove.project().patterns[0].tracks[c.lane], ...c.settings};
        nodes = engine.hit({lane: c.lane, settings, velocity: 0.9, gate: c.gate ?? 0.5, beat: 0}, onset).nodes;
      }
      const usesWorklet = nodes.some(n => n instanceof AudioWorkletNode);
      const buffer = await ctx.startRendering();
      engine.dispose?.();
      return {left: buffer.getChannelData(0), right: buffer.getChannelData(1), usesWorklet, nodes: nodes.length};
    }
    const correlate = (a, b, lag, from, to) => {
      let ab = 0,
        aa = 0,
        bb = 0;
      for (let i = from; i < to; i++) {
        ab += a[i] * b[i + lag];
        aa += a[i] ** 2;
        bb += b[i + lag] ** 2;
      }
      return {correlation: ab / Math.sqrt(aa * bb), levelDb: 10 * Math.log10(bb / aa)};
    };
    const results = [];
    for (const c of cases) {
      const legacy = await render(c, false),
        rust = await render(c, true),
        margin = c.lags || 0,
        from = margin,
        to = legacy.left.length - margin;
      // Positive lags would mean Rust is late; Chrome's oversampled WaveShaper delays the old voices instead.
      let best = {lag: 0, correlation: -2, levelDb: 0};
      for (let lag = -margin; lag <= 0; lag++) {
        const r = correlate(legacy.left, rust.left, lag, from, to);
        if (r.correlation > best.correlation) best = {lag, ...r};
      }
      const right = correlate(legacy.right, rust.right, best.lag, from, to);
      // Loudness contour in 20 ms windows from 20 ms after onset, where the reference is within
      // 50 dB of its peak. (Oversampling delayed old voices past their attack ramps.)
      const window = rate / 50,
        db = (data, start) => {
          let sum = 0;
          for (let j = start; j < start + window; j++) sum += data[j] ** 2;
          return 10 * Math.log10(sum / window + 1e-20);
        };
      const contour = [];
      for (let i = 2560 + window; i + window <= to; i += window)
        contour.push([db(legacy.left, i), db(rust.left, i + best.lag)]);
      const peak = Math.max(...contour.map(([a]) => a));
      results.push({
        name: c.name,
        usesWorklet: [legacy.usesWorklet, rust.usesWorklet],
        nodes: [legacy.nodes, rust.nodes],
        finite: rust.left.every(Number.isFinite) && rust.right.every(Number.isFinite),
        lag: best.lag,
        correlation: Math.min(best.correlation, right.correlation),
        levelDb: best.levelDb,
        contourError: Math.max(0, ...contour.filter(([a]) => a > peak - 50).map(([a, b]) => Math.abs(a - b))),
      });
    }
    return results;
  }, cases);
}

module.exports = {compare};
