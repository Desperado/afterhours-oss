// @ts-check
const {test, expect} = require('@playwright/test');
const {compare} = require('./helpers/parity');

test('Stop, lane mute and voice stealing cancel queued direct Rust notes', async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const rate = 48000,
      results = [];
    for (const lane of [4, 7]) {
      for (const action of ['play', 'stop', 'mute', 'steal', 'fade sounding']) {
        const ctx = new OfflineAudioContext(2, rate / 4, rate);
        if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
        const engine = new FMGrooveAudio(
          ctx,
          120,
          AfterhoursController.defaults(),
          AfterhoursPerformanceCore.validate(),
        );
        engine.setMix({space: 0});
        const settings = {...AfterhoursGroove.project().patterns[0].tracks[lane], note: 45, volume: 80, decay: 0.5},
          voice = engine.hit({settings, lane, velocity: 0.9, gate: 1, beat: 0}, 0.02);
        if (voice.amp) throw new Error('Expected the direct Rust path');
        if (action === 'stop') engine.stop();
        else if (action === 'mute') engine.stopLane(lane);
        else if (action === 'steal') engine.silence(voice);
        else if (action === 'fade sounding')
          ctx.suspend(0.1).then(async () => {
            engine.silence(voice);
            await new Promise(resolve => setTimeout(resolve, 100));
            return ctx.resume();
          });
        // Realtime commands cross a MessagePort. Let them arrive before the offline
        // context races through the entire note faster than realtime.
        await new Promise(resolve => setTimeout(resolve, 100));
        const data = (await ctx.startRendering()).getChannelData(0),
          energy = (from, to) =>
            data.slice(Math.round(from * rate), Math.round(to * rate)).reduce((sum, x) => sum + x * x, 0);
        results.push({lane, action, total: energy(0, 0.25), before: energy(0.02, 0.09), after: energy(0.15, 0.25)});
        engine.dispose();
      }
    }
    return results;
  });
  for (const lane of [4, 7]) {
    const played = results.find(r => r.lane === lane && r.action === 'play'),
      faded = results.find(r => r.lane === lane && r.action === 'fade sounding');
    expect(played.before, `lane ${lane} plays normally`).toBeGreaterThan(1);
    expect(faded.before, `lane ${lane} keeps the sounding note`).toBe(played.before);
    expect(faded.after, `lane ${lane} fades to silence`).toBeLessThan(played.after * 0.001);
    for (const r of results.filter(r => r.lane === lane && ['stop', 'mute', 'steal'].includes(r.action)))
      expect(r.total, `lane ${lane}: ${r.action} before onset`).toBe(0);
  }
});

const fm = [
  {name: 'Kick', lane: 0},
  {name: 'Snare', lane: 1},
  {name: 'Metal', lane: 2},
  {name: 'Perc', lane: 3},
  {name: 'Tone', lane: 4},
  {name: 'Chord', lane: 5},
  {name: 'Tone serial, bright, swept', lane: 4, settings: {algorithm: 'serial', shape: 80, color: 70, sweep: 60}},
  {name: 'Kick long contour', lane: 0, settings: {contour: 100, shape: 60, sweep: 100}},
  {name: 'Metal dark color', lane: 2, settings: {color: 5, cutoff: 4000}},
  {name: 'Chord major7 long gate', lane: 5, gate: 2, settings: {chord: 'major7', contour: 0}},
  ...['shape', 'pitch', 'cutoff', 'pan'].map(target => ({
    name: `Tone ${target} LFO`,
    lane: 4,
    settings: {shape: 65, cutoff: 700, lfo: {target, depth: 80, division: 0.5, shape: 'triangle'}},
  })),
];

test('Rust FM machines render the same audio as the Web Audio graph they replace', async ({page}) => {
  await page.goto('/');
  for (const r of await compare(page, fm)) {
    expect(r.usesWorklet, r.name).toEqual([false, true]);
    expect(r.finite, r.name).toBe(true);
    expect(r.correlation, r.name).toBeGreaterThan(0.9999);
    expect(Math.abs(r.levelDb), r.name).toBeLessThan(0.01);
    expect(r.contourError, r.name).toBeLessThan(0.05);
  }
});

const saw = [
  {name: 'Saw', lane: 7},
  {name: 'Saw bright, driven, swept', lane: 7, settings: {shape: 100, color: 100, sweep: 100, cutoff: 9000}},
  {name: 'Saw low, clean', lane: 7, settings: {note: 33, shape: 0, sweep: 0, cutoff: 1200}},
  {name: 'Saw shape LFO', lane: 7, settings: {lfo: {target: 'shape', depth: 100, division: 0.5, shape: 'square'}}},
].map(c => ({...c, lags: 200}));

test('Rust Saw matches the Web Audio level and waveform, without the old oversampling delay', async ({page}) => {
  await page.goto('/');
  for (const r of await compare(page, saw)) {
    expect(r.usesWorklet, r.name).toEqual([false, true]);
    expect(r.finite, r.name).toBe(true);
    // PolyBLEP saws and a different oversampling filter: the same sound, not identical samples.
    expect(r.correlation, r.name).toBeGreaterThan(0.995);
    expect(Math.abs(r.levelDb), r.name).toBeLessThan(0.1);
    // Windows straddling the 72% sustain step differ by the old 2.3 ms delay.
    expect(r.contourError, r.name).toBeLessThan(1.5);
    // The old WaveShaper's 2× oversampling delayed Saw by about 2.3 ms; Rust starts on time.
    expect(r.lag, r.name).toBeLessThan(-50);
  }
});

test('live Groove keys sustain in Rust until key-up, then release from that level', async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const rate = 48000,
      keyUp = 1.6,
      decay = 0.2;
    async function render(lane, rust, release) {
      const ctx = new OfflineAudioContext(2, rate * 2.5, rate);
      if (rust && !(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const patch = {
        lane,
        track: {...AfterhoursGroove.project().patterns[0].tracks[lane], decay},
        gate: 0.25,
        mix: {space: 0},
      };
      const instrument = new AfterhoursGrooveInstrument(ctx, patch, 120);
      instrument.noteOn('a', 45, 0.9, 2560 / rate);
      // Key-up arrives while rendering, as it does from a keyboard. Rust voices receive it
      // as a message, which reaches the audio thread asynchronously like realtime input.
      if (release)
        ctx.suspend(keyUp).then(async () => {
          instrument.noteOff('a', keyUp);
          await new Promise(resolve => setTimeout(resolve, 100));
          return ctx.resume();
        });
      const left = (await ctx.startRendering()).getChannelData(0);
      return {left, voices: instrument.renderer.voices.size};
    }
    const out = [];
    for (const lane of [4, 7]) {
      const held = await render(lane, true, false),
        released = await render(lane, true, true),
        legacy = lane === 4 ? await render(lane, false, true) : null;
      const at = t => Math.round(t * rate);
      const energy = (data, from, to) => data.slice(at(from), at(to)).reduce((s, x) => s + x * x, 0);
      let ab = 0,
        aa = 0,
        bb = 0;
      if (legacy)
        for (let i = 0; i < at(keyUp); i++) {
          ab += legacy.left[i] * released.left[i];
          aa += legacy.left[i] ** 2;
          bb += released.left[i] ** 2;
        }
      out.push({
        lane,
        identicalBeforeKeyUp: released.left.slice(0, at(keyUp)).every((x, i) => x === held.left[i]),
        legacyBeforeKeyUp: legacy ? ab / Math.sqrt(aa * bb) : 1,
        // Fraction of the sustained note's energy left 5–10 ms and 120–125 ms after key-up.
        early: energy(released.left, keyUp + 0.005, keyUp + 0.01) / energy(held.left, keyUp + 0.005, keyUp + 0.01),
        late: energy(released.left, keyUp + 0.12, keyUp + 0.125) / energy(held.left, keyUp + 0.12, keyUp + 0.125),
        after: energy(released.left, keyUp + decay + 0.06, 2.5),
        voices: released.voices,
      });
    }
    return out;
  });
  for (const r of results) {
    const name = `lane ${r.lane}`;
    expect(r.identicalBeforeKeyUp, name).toBe(true);
    // Until key-up a live key matches the scheduled Web Audio note exactly.
    expect(r.legacyBeforeKeyUp, name).toBeGreaterThan(0.9999);
    // The release starts from the held level (no jump), then falls exponentially to silence.
    expect(r.early, name).toBeGreaterThan(0.5);
    expect(r.late, name).toBeLessThan(0.01);
    expect(r.after, name).toBe(0);
    expect(r.voices, name).toBe(0);
  }
});

test('windowed offline rendering matches scheduling every hit up front', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rate = 48000,
      bpm = 130,
      pattern = AfterhoursPresets.create('redline').patterns[1],
      hits = [];
    for (let n = 0; n < 64; n++)
      for (const event of AfterhoursGroove.events(pattern, n, {swing: 0}))
        hits.push({event, time: (event.beat + 0.25) * (60 / bpm)});
    hits.sort((a, b) => a.time - b.time);
    const out = [];
    for (const windowed of [false, true]) {
      const ctx = new OfflineAudioContext(2, rate * 6, rate);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const engine = new FMGrooveAudio(ctx, bpm, AfterhoursController.defaults(), AfterhoursPerformanceCore.validate());
      let buffer;
      if (windowed) buffer = await engine.render(hits, 0.1);
      else {
        for (const {event, time} of hits) engine.hit(event, time);
        buffer = await ctx.startRendering();
      }
      out.push(buffer.getChannelData(0));
      engine.dispose();
    }
    let difference = 0,
      energy = 0;
    for (let i = 0; i < out[0].length; i++) {
      difference = Math.max(difference, Math.abs(out[0][i] - out[1][i]));
      energy += out[0][i] ** 2;
    }
    return {hits: hits.length, difference, energy};
  });
  expect(result.hits).toBeGreaterThan(100);
  expect(result.energy).toBeGreaterThan(1);
  expect(result.difference).toBeLessThan(1e-6);
});

test('windowed export preserves Pump when kicks interrupt a recovery ramp', async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const rate = 48000,
      results = [];
    for (const step of [0.05, 0.1]) {
      const out = [];
      for (const windowed of [false, true]) {
        const ctx = new OfflineAudioContext(2, rate, rate);
        if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
        const engine = new FMGrooveAudio(
          ctx,
          120,
          AfterhoursController.defaults(),
          AfterhoursPerformanceCore.validate(),
        );
        engine.setMix({pump: 1});
        // A constant music signal isolates the gain envelope from voice waveforms and
        // the limiter. Silent kicks trigger exactly the same production Pump path.
        const source = ctx.createConstantSource();
        source.offset.value = 0.2;
        engine.music.disconnect();
        engine.music.connect(ctx.destination);
        source.connect(engine.music);
        source.start();
        const settings = AfterhoursGroove.project().patterns[0].tracks[0],
          hits = [0.12, 0.24].map(time => ({
            time,
            event: {settings, lane: 0, velocity: 0, gate: 0.25, beat: time * 2},
          }));
        let buffer;
        if (windowed) buffer = await engine.render(hits, step);
        else {
          for (const {event, time} of hits) engine.hit(event, time);
          buffer = await ctx.startRendering();
        }
        out.push(buffer.getChannelData(0));
        engine.dispose();
      }
      let difference = 0;
      for (let i = 0; i < rate; i++) difference = Math.max(difference, Math.abs(out[0][i] - out[1][i]));
      results.push({
        step,
        difference,
        ducked: out[1][Math.round(0.13 * rate)],
        recovered: out[1][Math.round(0.6 * rate)],
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.difference, `window ${result.step}`).toBeLessThan(1e-7);
    expect(result.ducked).toBeLessThan(0.04);
    expect(result.recovered).toBeCloseTo(0.2, 6);
  }
});
