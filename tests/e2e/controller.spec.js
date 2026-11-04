const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
});

test('controller experiments keep instruments intact, recall A/B, release bend and reset', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#ws-synth').click();
  await page.locator('[data-patch="third-horizon"]').click();
  const stored = await page.evaluate(() => {
    const {performance, ...project} = AfterhoursGrooveLive.snapshot().project;
    return [project, localStorage.getItem('afterhours-synth-v1')];
  });
  await page.locator('#controller-toggle').click();
  await expect(page.locator('#synth-workspace')).toBeVisible();
  await page.locator('#controller-preset').selectOption('glass');
  await page.locator('#controller-save-a').click();
  await page.locator('#controller-scale').selectOption('whole');
  await page.getByRole('slider', {name: 'Controller Transpose', exact: true}).press('End');
  await page.locator('#controller-save-b').click();
  await page.locator('#controller-a').click();
  await expect(page.locator('#controller-scale')).toHaveValue('chromatic');
  await expect(page.getByRole('slider', {name: 'Controller Transpose', exact: true})).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await page.locator('#controller-b').click();
  await expect(page.locator('#controller-scale')).toHaveValue('whole');
  await expect(page.getByRole('slider', {name: 'Controller Transpose', exact: true})).toHaveAttribute(
    'aria-valuenow',
    '24',
  );
  const pad = page.locator('#controller-pad'),
    rect = await pad.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.25, rect.y + rect.height * 0.25);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => AfterhoursController.snapshot().cutoff)).toBeCloseTo(25, 0);
  expect(await page.evaluate(() => AfterhoursController.snapshot().motion)).toBeCloseTo(0.75, 1);
  await page.locator('#controller-bend-up').focus();
  await page.keyboard.down('Space');
  expect(await page.evaluate(() => AfterhoursController.snapshot().bend)).toBe(2);
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => AfterhoursController.snapshot().bend)).toBe(0);
  await page.keyboard.down('Enter');
  await page.locator('#controller-bypass').focus();
  await page.keyboard.up('Enter');
  expect(await page.evaluate(() => AfterhoursController.snapshot().bend)).toBe(0);
  await page.locator('#controller-bypass').click();
  expect(await page.evaluate(() => AfterhoursController.cents(61))).toBe(0);
  await page.locator('#controller-reset').click();
  expect(await page.evaluate(() => AfterhoursController.snapshot())).toMatchObject({
    enabled: true,
    cutoff: 100,
    motion: 0,
    transpose: 0,
    cents: 0,
    scale: 'chromatic',
    temperament: 'equal',
  });
  // Controller state now belongs to the project; the underlying instruments stay intact.
  expect(
    await page.evaluate(() => {
      AfterhoursGrooveLive.flush();
      const {performance, ...project} = AfterhoursGroove.validate(
        JSON.parse(localStorage.getItem('afterhours-fm-project-v1')),
      );
      return [project, localStorage.getItem('afterhours-synth-v1')];
    }),
  ).toEqual(stored);
  for (const width of [390, 900]) {
    await page.setViewportSize({width, height: 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.reload();
  expect(await page.evaluate(() => AfterhoursController.snapshot().transpose)).toBe(0);
  expect(errors).toEqual([]);
});

test('tuning changes held synth and every melodic groove machine but leaves drums alone', async ({page}) => {
  const result = await page.evaluate(async () => {
    const C = AfterhoursController,
      ctx = new AudioContext();
    await ctx.resume();
    const synth = new AfterhoursSynthAudio(ctx);
    synth.noteOn('held', 64);
    const initial = [...synth.controller.tuners][0].source.offset.value;
    C.change({temperament: 'just'});
    // Pitch glide advances on the audio clock, which can lag wall time during startup.
    const settledAt = ctx.currentTime + 0.3,
      deadline = performance.now() + 5000;
    while (ctx.currentTime < settledAt && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    const settled = ctx.currentTime >= settledAt;
    const held = [...synth.controller.tuners][0].source.offset.value;
    C.change({scale: 'whole', temperament: 'equal', transpose: 12});
    const pending = C.cents(61),
      expectedJust = C.cents(64, {...C.snapshot(), scale: 'chromatic', temperament: 'just', transpose: 0});
    synth.noteOff('held');
    synth.dispose();
    await ctx.close();
    const voices = [];
    for (const machine of [
      'Kick',
      'Snare',
      'Metal',
      'Perc',
      'Tone',
      'Chord',
      'Saw',
      'Ladder',
      'DualVCO',
      'Wavetable',
      'WavePad',
    ]) {
      const offline = new OfflineAudioContext(1, 24000, 24000);
      if (!(await AfterhoursVoice.prepare(offline))) throw new Error('Rust voice did not load');
      const groove = new FMGrooveAudio(offline);
      const settings = {...AfterhoursGroove.project().patterns[0].tracks[4], machine, note: 61, decay: 0.1};
      groove.hit({lane: 4, settings, velocity: 0.5, gate: 0.1}, 0.01);
      voices.push({machine, tuners: [...groove.controller.tuners].map(t => t.source.offset.value)});
      await offline.startRendering();
      voices.at(-1).remaining = groove.controller.tuners.size;
      groove.dispose();
    }
    C.reset();
    return {initial, held, expectedJust, pending, voices, settled};
  });
  expect(result.settled).toBe(true);
  expect(result.initial).toBe(0);
  expect(result.expectedJust).toBeCloseTo(-13.686, 2);
  expect(result.held).toBeCloseTo(result.expectedJust, 0);
  expect(result.pending).toBe(1100);
  for (const voice of result.voices) {
    if (['Kick', 'Snare', 'Metal', 'Perc'].includes(voice.machine)) expect(voice.tuners, voice.machine).toEqual([]);
    else {
      expect(voice.tuners.length, voice.machine).toBeGreaterThan(0);
      expect(voice.tuners[0], voice.machine).toBe(1100);
    }
    expect(voice.remaining, voice.machine).toBe(0);
  }
});

test('controller produces audible FX and pitch changes, transparent bypass and bounded stereo tails', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const C = AfterhoursController,
      rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const render = async values => {
      C.reset();
      C.change(values);
      const ctx = new OfflineAudioContext(2, 24000 * 5, 24000),
        bus = new C.Session(ctx);
      const osc = ctx.createOscillator(),
        amp = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      amp.gain.value = 0.15;
      osc.connect(amp).connect(bus.input);
      const tuner = bus.tune(57, [osc]);
      tuner.stop(0.7);
      osc.start();
      osc.stop(0.7);
      const audio = await ctx.startRendering(),
        left = Float32Array.from(audio.getChannelData(0)),
        right = audio.getChannelData(1);
      const output = {
        left,
        finite: left.every(Number.isFinite) && right.every(Number.isFinite),
        peak: Math.max(...left.map(Math.abs)),
        tail: rms(left.slice(24000 * 4)),
        stereo: rms(left.map((v, i) => v - right[i])),
      };
      bus.dispose();
      return output;
    };
    const base = await render({}),
      variants = [];
    for (const values of [
      {cutoff: 55},
      {drive: 0.8},
      {motion: 0.8},
      {space: 0.8},
      {transpose: 12},
      {cutoff: 10, resonance: 6, drive: 1, space: 1, motion: 1},
    ]) {
      const changed = await render(values);
      variants.push({delta: rms(changed.left.map((v, i) => v - base.left[i])), ...changed, left: undefined});
    }
    const bypass = await render({enabled: false, cutoff: 0, drive: 1, space: 1, transpose: 24});
    // Recording's existing EQ/bypass must still feed this layer.
    const recording = async values => {
      C.reset();
      C.change(values);
      const ctx = new OfflineAudioContext(2, 24000, 24000),
        source = ctx.createOscillator();
      source.frequency.value = 440;
      const media = {paused: false, ended: false, addEventListener() {}},
        fx = new LiveEffects(media);
      fx.connect(ctx, source);
      fx.bypassed = true;
      fx.apply(true);
      source.start();
      source.stop(0.7);
      const a = (await ctx.startRendering()).getChannelData(0);
      fx.controller.dispose();
      return Float32Array.from(a);
    };
    const cleanRecording = await recording({}),
      shapedRecording = await recording({cutoff: 0});
    C.reset();
    return {
      variants,
      bypassDelta: rms(bypass.left.map((v, i) => v - base.left[i])),
      recordingDelta: rms(shapedRecording.map((v, i) => v - cleanRecording[i])),
    };
  });
  expect(result.bypassDelta).toBeLessThan(0.000001);
  expect(result.recordingDelta).toBeGreaterThan(0.1);
  for (const variant of result.variants) {
    expect(variant.delta).toBeGreaterThan(0.005);
    expect(variant.finite).toBe(true);
    expect(variant.peak).toBeLessThan(1);
    expect(variant.tail).toBeLessThan(0.0001);
  }
  expect(result.variants[2].stereo).toBeGreaterThan(0.005);
});

test('Stop and Synth Panic clear the controller echo too', async ({page}) => {
  const results = await page.evaluate(async () => {
    const results = [],
      rms = a => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
    for (const kind of ['groove', 'synth']) {
      AfterhoursController.reset();
      AfterhoursController.change({space: 1});
      const ctx = new OfflineAudioContext(2, 24000 * 2, 24000);
      const engine = kind === 'groove' ? new FMGrooveAudio(ctx) : new AfterhoursSynthAudio(ctx);
      if (kind === 'groove')
        engine.hit(
          {
            lane: 4,
            settings: {...AfterhoursGroove.project().patterns[0].tracks[4], machine: 'Saw', note: 57, decay: 0.04},
            velocity: 0.8,
            gate: 0.05,
          },
          0.01,
        );
      else {
        engine.setPatch({
          ...AfterhoursSynthAudio.presets[0],
          attack: 0.005,
          release: 0.04,
          chorus: 0,
          delay: 0,
          reverb: 0,
        });
        engine.noteOn('short', 57, 0.8, 0.01);
        engine.noteOff('short', 0.08);
      }
      const paused = ctx.suspend(0.6),
        rendering = ctx.startRendering();
      await paused;
      if (kind === 'groove') engine.stop();
      else engine.panic();
      await ctx.resume();
      const audio = await rendering,
        data = audio.getChannelData(0);
      results.push({kind, before: rms(data.slice(2400, 12000)), after: rms(data.slice(16800))});
      engine.dispose();
    }
    AfterhoursController.reset();
    return results;
  });
  for (const result of results) {
    expect(result.before, result.kind).toBeGreaterThan(0.0001);
    expect(result.after, result.kind).toBeLessThan(0.0000001);
  }
});
