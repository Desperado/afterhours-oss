// @ts-check
const {test, expect} = require('@playwright/test');

test('Redline Overdrive reloads, renders its dense drop safely and exports the full song', async ({page}, testInfo) => {
  test.setTimeout(240000);
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
  });
  await page.goto('/');
  await page.locator('#groove-preset').selectOption('redline-overdrive');
  await page.locator('#groove-load-preset').click();
  await page.reload();
  await expect(page.locator('#groove-track-title')).toHaveText('Redline Ritual — Overdrive');
  await expect(page.locator('#groove-section')).toContainText('112-bar arrangement');
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.patterns[1].tracks[4].machine)).toBe('Analog');
  const metrics = await page.evaluate(async () => {
    const p = AfterhoursGrooveApp.S.data,
      ctx = new OfflineAudioContext(2, 48000 * 8, 48000);
    if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
    const engine = new FMGrooveAudio(ctx, p.bpm, p.performance.controller, p.performance);
    engine.setMix(p.mix);
    const events = Array.from({length: 128}, (_, i) => AfterhoursGroove.events(p.patterns[3], i)).flat();
    const result = await engine.render(events.map(event => ({event, time: 0.05 + (event.beat * 60) / p.bpm})));
    let peak = 0,
      sum = 0,
      finite = true;
    for (const value of result.getChannelData(0)) {
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
      finite &&= Number.isFinite(value);
    }
    engine.dispose();
    return {bpm: p.bpm, peak, rms: Math.sqrt(sum / result.length), finite};
  });
  expect(metrics.bpm).toBe(160);
  expect(metrics.finite).toBe(true);
  expect(metrics.peak).toBeLessThan(0.99);
  expect(metrics.rms).toBeGreaterThan(0.025);
  await page.screenshot({path: testInfo.outputPath('redline-overdrive.png')});
  await page.locator('#groove-export').click();
  const pending = page.waitForEvent('download', {timeout: 210000});
  await page.locator('#groove-song-wav').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('redline-ritual-overdrive-160bpm.wav');
  const output = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(output);
  await expect(page.locator('#status-text')).toContainText('Full song exported');
  const bytes = require('node:fs').readFileSync(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt32LE(24)).toBe(48000);
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect(bytes.length).toBe(44 + 174 * 48000 * 6);
  await testInfo.attach('dense-drop-metrics', {body: JSON.stringify(metrics), contentType: 'application/json'});
});

test('Redline loads its full arrangement and Saw voices survive a reload', async ({page}) => {
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
  });
  await page.goto('/');
  await page.locator('#groove-preset').selectOption('redline');
  await page.locator('#groove-load-preset').click();
  await expect(page.locator('#groove-track-title')).toHaveText('Redline Ritual');
  await expect(page.locator('#groove-section')).toContainText('96-bar arrangement');
  await expect(page.locator('#groove-arrangement button')).toHaveCount(9);
  await page.reload();
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1')));
  expect(project.patterns[1].tracks[4].machine).toBe('Saw');
  expect(project.patterns[1].tracks[3].machine).toBe('Saw');
  await expect(page.locator('#groove-track-title')).toHaveText('Redline Ritual');
  await expect(page.locator('#groove-restore')).toBeEnabled();
  expect(project.patterns.every(p => p.tracks.length === 16)).toBe(true);
  await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
  await page.locator('#groove-song').click();
  await page.getByRole('button', {name: 'Select track 16 Saw', exact: true}).click();
  const step = page.locator('#groove-step-15-1');
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          AfterhoursGroove.validate(JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))).patterns[0].tracks[15]
            .steps[1].on,
      ),
    )
    .toBe(true);
  await page.locator('#groove-step-14-1').focus();
  await page.keyboard.press('ArrowDown');
  await expect(step).toBeFocused();
  await page.reload();
  await expect(step).toHaveAttribute('aria-pressed', 'true');
});

test('native Saw renders audible controls, bounded extremes and a clean release', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    async function render(changes = {}) {
      const ctx = new OfflineAudioContext(2, 48000, 24000);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const engine = new FMGrooveAudio(ctx, 130);
      const settings = {...AfterhoursPresets.create('redline').patterns[1].tracks[4], ...changes};
      engine.hit({settings, lane: 4, velocity: 1, gate: 0.25}, 0.02);
      const buffer = await ctx.startRendering(),
        samples = buffer.getChannelData(0);
      const rms = (start, end) =>
        Math.sqrt(samples.slice(start, end).reduce((sum, x) => sum + x * x, 0) / (end - start));
      const metrics = {
        finite: samples.every(Number.isFinite),
        peak: Math.max(...samples.slice(0, 18000).map(Math.abs)),
        rms: rms(1000, 4500),
        tail: rms(36000, 48000),
        voices: engine.voices.size,
      };
      engine.dispose();
      return {metrics, samples: [...samples.slice(1000, 4500)]};
    }
    const base = await render(),
      variants = [];
    for (const changes of [
      {shape: 0},
      {color: 100},
      {sweep: 0},
      {machine: 'Tone'},
      {
        note: 96,
        shape: 100,
        color: 100,
        sweep: 100,
        cutoff: 16000,
        volume: 100,
        lfo: {target: 'shape', depth: 100, division: 0.25, shape: 'square'},
      },
    ]) {
      const output = await render(changes);
      variants.push({
        ...output.metrics,
        difference: Math.sqrt(
          output.samples.reduce((sum, x, i) => sum + (x - base.samples[i]) ** 2, 0) / output.samples.length,
        ),
      });
    }
    return {base: base.metrics, variants};
  });
  for (const output of [result.base, ...result.variants]) {
    expect(output.finite).toBe(true);
    expect(output.rms).toBeGreaterThan(0.001);
    expect(output.peak).toBeLessThan(0.99);
    expect(output.tail).toBeLessThan(0.0001);
    expect(output.voices).toBe(0);
  }
  for (const variant of result.variants) expect(variant.difference).toBeGreaterThan(0.001);
});

test('all sixteen Redline layers render audible audio and the extra ten change the mix', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const project = AfterhoursPresets.create('redline'),
      pattern = project.patterns[1];
    const events = Array.from({length: 128}, (_, tick) => AfterhoursGroove.events(pattern, tick)).flat();
    async function render(lanes) {
      const ctx = new OfflineAudioContext(2, 24000 * 10, 24000),
        engine = new FMGrooveAudio(ctx, project.bpm);
      engine.setMix(project.mix);
      for (const event of events.filter(e => lanes.includes(e.lane)))
        engine.hit(event, 0.05 + (event.beat * 60) / project.bpm);
      const output = await ctx.startRendering(),
        samples = output.getChannelData(0);
      let sum = 0,
        peak = 0,
        finite = true;
      for (const x of samples) {
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
        finite &&= Number.isFinite(x);
      }
      engine.dispose();
      return {rms: Math.sqrt(sum / samples.length), peak, finite, samples};
    }
    const layers = [];
    for (let lane = 0; lane < 16; lane++) {
      const {samples, ...metrics} = await render([lane]);
      layers.push(metrics);
    }
    const full = await render(Array.from({length: 16}, (_, i) => i)),
      original = await render([0, 1, 2, 3, 4, 5]);
    const difference = Math.sqrt(
      full.samples.reduce((sum, x, i) => sum + (x - original.samples[i]) ** 2, 0) / full.samples.length,
    );
    return {layers, mix: {finite: full.finite, peak: full.peak}, difference};
  });
  expect(result.layers).toHaveLength(16);
  for (const layer of result.layers) {
    expect(layer.finite).toBe(true);
    expect(layer.rms).toBeGreaterThan(0.0005);
  }
  expect(result.mix.finite).toBe(true);
  expect(result.mix.peak).toBeLessThan(0.99);
  expect(result.difference).toBeGreaterThan(0.005);
});
