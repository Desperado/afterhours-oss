// @ts-check
const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
});

test('new groove voices render, decay, and respond to filter, blend, resonance and motion', async ({page}) => {
  const result = await page.evaluate(async () => {
    const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const render = async (machine, overrides = {}) => {
      const ctx = new OfflineAudioContext(2, 24000 * 4, 24000);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const engine = new FMGrooveAudio(ctx, 120);
      const settings = {
        ...AfterhoursGroove.project().patterns[0].tracks[4],
        machine,
        note: 60,
        cutoff: 3500,
        color: 50,
        sweep: 0,
        shape: 25,
        decay: 0.2,
        volume: 65,
        ...overrides,
      };
      engine.hit({lane: 4, settings, velocity: 0.85, gate: 2}, 0.02);
      const b = await ctx.startRendering(),
        a = b.getChannelData(0);
      const output = {
        a: Float32Array.from(a),
        rms: rms(a),
        tail: rms(a.slice(60000)),
        finite: a.every(Number.isFinite),
        voices: engine.voices.size,
      };
      engine.dispose();
      return output;
    };
    const output = [];
    for (const machine of ['Ladder', 'DualVCO', 'Wavetable', 'WavePad']) {
      const base = await render(machine),
        deltas = {};
      for (const [key, value] of [
        ['cutoff', 180],
        ['shape', 90],
        ['color', 95],
        ['sweep', 85],
      ]) {
        const changed = await render(machine, {[key]: value});
        deltas[key] = rms(base.a.map((v, i) => v - changed.a[i]));
      }
      output.push({machine, rms: base.rms, finite: base.finite, tail: base.tail, voices: base.voices, deltas});
    }
    // Compare only wave motion: no filter envelope, same note, frames, effects and level.
    const wave = async motion => {
      const ctx = new OfflineAudioContext(1, 24000 * 3, 24000);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const v = AfterhoursTimbres.create(
        ctx,
        {family: 'wave', hz: 220, time: 0, cutoff: 8000, resonance: 0.5, position: 0.5, motion},
        ctx.destination,
      );
      v.sources.forEach(o => {
        o.start(0);
        o.stop(2.9);
      });
      return (await ctx.startRendering()).getChannelData(0);
    };
    const still = await wave(0),
      moving = await wave(1);
    return {output, motionDelta: rms(still.map((v, i) => v - moving[i]))};
  });
  for (const voice of result.output) {
    expect(voice.finite, voice.machine).toBe(true);
    expect(voice.rms, voice.machine).toBeGreaterThan(0.001);
    expect(voice.tail, voice.machine).toBeLessThan(0.00001);
    expect(voice.voices, voice.machine).toBe(0);
    for (const [key, delta] of Object.entries(voice.deltas))
      expect(delta, `${voice.machine} ${key}`).toBeGreaterThan(0.0001);
  }
  expect(result.motionDelta).toBeGreaterThan(0.005);
});

test('hardware-inspired keyboard patches play and save wave blend and motion', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#ws-synth').click();
  for (const id of ['grand-bass', 'grand-lead', 'ppg-pluck', 'ppg-lead', 'third-horizon', 'third-prism']) {
    await page.locator(`[data-patch="${id}"]`).click();
    await page.keyboard.down('a');
    await expect(page.locator('#synth-notes')).toHaveText('C4');
    await page.keyboard.up('a');
  }
  await page.getByRole('slider', {name: 'Synth Wave blend', exact: true}).press('End');
  await page.getByRole('slider', {name: 'Synth Motion', exact: true}).press('Home');
  await page.reload();
  await page.locator('#ws-synth').click();
  await expect(page.locator('[data-patch="third-prism"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', {name: 'Synth Wave blend', exact: true})).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByRole('slider', {name: 'Synth Motion', exact: true})).toHaveAttribute('aria-valuenow', '0');
  await page.locator('[data-patch="grand-bass"]').click();
  await expect(page.getByRole('slider', {name: 'Synth Motion', exact: true})).toBeHidden();
  expect(errors).toEqual([]);
});

test('the Ladder β filter switch persists, survives import and plays live without errors', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  await page.locator('#ws-groove').click();
  await page.locator('.track-name').nth(4).click();
  await page.getByRole('combobox', {name: 'Machine type'}).selectOption('Ladder');
  const filter = page.locator('#groove-filter-model');
  await expect(filter.getByRole('radio', {name: 'Biquad'})).toHaveAttribute('aria-checked', 'true');
  await filter.getByRole('radio', {name: 'Ladder β'}).click();
  await expect(page.locator('#status-text')).toContainText('Ladder β filter on new notes');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('afterhours-fm-project-v1') || 'null')?.patterns[0].tracks[4].filter,
      ),
    )
    .toBe('ladder');
  await page.reload();
  await page.locator('.track-name').nth(4).click();
  await expect(page.locator('#groove-filter-model').getByRole('radio', {name: 'Ladder β'})).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Unknown filter models fall back to Biquad when a project is validated.
  expect(
    await page.evaluate(() => {
      const project = AfterhoursGroove.project();
      project.patterns[0].tracks[4].filter = 'transistor';
      return AfterhoursGroove.validate(project).patterns[0].tracks[4].filter;
    }),
  ).toBe('biquad');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.locator('#groove-step-4-0').scrollIntoViewIfNeeded();
  await page.locator('.audition').nth(4).click();
  await page.waitForTimeout(1500);
  await page.locator('#transport-stop').click();
  expect(errors).toEqual([]);
});
