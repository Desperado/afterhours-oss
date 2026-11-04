// @ts-check
const {test, expect} = require('@playwright/test');
const G = require('../../web/groove-core');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
});

test('all six migrated Synth presets use Rust on a fresh page', async ({page}) => {
  for (const id of ['grand-bass', 'grand-lead', 'ppg-pluck', 'ppg-lead', 'third-horizon', 'third-prism']) {
    await page.goto('/');
    await page.locator('#ws-synth').click();
    await page.locator(`[data-patch="${id}"]`).click();
    await page.evaluate(() => {
      window.__rustNotes = [];
      const noteOn = AfterhoursSynthAudio.prototype.noteOn;
      AfterhoursSynthAudio.prototype.noteOn = function (...args) {
        const result = noteOn.apply(this, args);
        __rustNotes.push([...this.voices].some(v => v.nodes.some(n => n instanceof AudioWorkletNode)));
        return result;
      };
    });
    await page.keyboard.down('a');
    await expect.poll(() => page.evaluate(() => __rustNotes), {message: id}).toEqual([true]);
    await page.keyboard.up('a');
  }
});

test('a migrated Synth preset still plays its fallback when wavetable preparation fails', async ({page}) => {
  await page.route('**/wavetable-worker.js', r => r.abort());
  await page.goto('/');
  await page.locator('#ws-synth').click();
  await page.locator('[data-patch="grand-bass"]').click();
  await page.evaluate(() => {
    const noteOn = AfterhoursSynthAudio.prototype.noteOn;
    AfterhoursSynthAudio.prototype.noteOn = function (...args) {
      const result = noteOn.apply(this, args);
      window.__fallback = this.voices.size > 0 && !AfterhoursVoice.ready(this.context);
      return result;
    };
  });
  await page.keyboard.down('a');
  await expect.poll(() => page.evaluate(() => window.__fallback)).toBe(true);
  await page.keyboard.up('a');
});

test('Copilot: semantic piano activation plays one short note without duplicating held input', async ({page}) => {
  await page.goto('/');
  await page.locator('#ws-synth').click();
  await page.evaluate(() => {
    window.__notes = [];
    const on = AfterhoursSynthAudio.prototype.noteOn;
    AfterhoursSynthAudio.prototype.noteOn = function (...args) {
      __notes.push(args[1]);
      return on.apply(this, args);
    };
  });
  const key = page.getByRole('button', {name: 'C4', exact: true});
  await key.dispatchEvent('click', {detail: 0});
  await expect.poll(() => page.evaluate(() => __notes.length)).toBe(1);
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  await key.click();
  await expect.poll(() => page.evaluate(() => __notes.length)).toBe(2);
  await key.focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('#synth-notes')).toHaveText('C4');
  await page.keyboard.up('Enter');
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  expect(await page.evaluate(() => __notes.length)).toBe(3);
});

test('loop length changes every lane while page selection only changes the view', async ({page}) => {
  const p = G.project();
  p.patterns[0].tracks.forEach(t =>
    t.steps.forEach(s => {
      s.on = false;
    }),
  );
  p.patterns[0].tracks[0].steps[48].on = true;
  await page.addInitScript(p => {
    if (!localStorage.getItem('afterhours-fm-project-v1'))
      localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(p));
  }, p);
  await page.goto('/');
  const length = n => page.locator(`#groove-lengths [data-length="${n}"]`);
  await length(16).click();
  await page.locator('#groove-pages').getByRole('button', {name: 'Page 4', exact: true}).click();
  await expect(page.locator('#groove-pattern-status')).toContainText('16 steps · viewing 49–64');
  await expect(page.locator('#groove-step-0-48')).toHaveClass(/beyond/);
  await length(64).click();
  await expect(page.locator('#groove-step-0-48')).not.toHaveClass(/beyond/);
  await expect(page.locator('#groove-step-0-48')).toHaveClass(/\bon\b/);
  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('afterhours-fm-project-v1')).patterns[0].tracks.map(t => t.length),
      ),
    )
    .toEqual(Array(16).fill(64));
  const stored = G.validate(await page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))));
  expect(G.events(stored.patterns[0], 96).map(e => e.index)).toEqual([48]);
  await page.reload();
  await expect(length(64)).toHaveAttribute('aria-pressed', 'true');
  for (const n of [32, 48]) {
    await length(n).click();
    await expect(page.locator('#groove-length')).toHaveValue(String(n));
  }
});

test('the synth plays chords and releases input; a stale audio resume cannot duplicate a note', async ({page}) => {
  await page.goto('/');
  await page.locator('#ws-synth').click();
  await expect(page.locator('#synth-patches button')).toHaveCount(16);
  await page.evaluate(() => {
    const apply = AfterhoursSynthAudio.prototype.apply;
    AfterhoursSynthAudio.prototype.apply = function () {
      window.__synth = this;
      return apply.call(this);
    };
    window.__resumes = [];
    AudioContext.prototype.resume = () => new Promise(resolve => __resumes.push(resolve));
  });
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  await page.keyboard.down('a');
  await page.evaluate(async () => {
    __resumes.splice(0).forEach(resolve => resolve());
    await Promise.resolve();
  });
  expect(await page.evaluate(() => __synth.held.size)).toBe(1);
  expect(await page.evaluate(() => __synth.voices.size)).toBe(1);
  await expect(page.locator('#synth-notes')).toHaveText('C4');
  await page.keyboard.up('a');
  expect(await page.evaluate(() => __synth.held.size)).toBe(0);
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  await page.evaluate(() => {
    AudioContext.prototype.resume = () => Promise.resolve();
  });
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.keyboard.down('g');
  await expect(page.locator('#synth-notes')).toHaveText('C4 · E4 · G4');
  await page.locator('#synth-panic').click();
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  expect(await page.evaluate(() => __synth.held.size)).toBe(0);
  for (const key of ['a', 'd', 'g']) await page.keyboard.up(key);
  await page.locator('[data-patch="organ"]').click();
  await page.getByRole('slider', {name: 'Synth Filter', exact: true}).press('Home');
  await page.reload();
  await page.locator('#ws-synth').click();
  await expect(page.locator('[data-patch="organ"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', {name: 'Synth Filter', exact: true})).toHaveAttribute('aria-valuenow', '80');
  await page.keyboard.down('a');
  await page.locator('#ws-groove').click();
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  await page.keyboard.up('a');
});

test('all sixteen synth patches render finite stereo audio and audible release tails', async ({page}) => {
  await page.goto('/');
  const patches = await page.evaluate(async () => {
    const results = [];
    for (const patch of AfterhoursSynthAudio.presets) {
      const ctx = new OfflineAudioContext(2, 3 * 24000, 24000),
        synth = new AfterhoursSynthAudio(ctx);
      if (patch.family && !(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice failed to load');
      synth.setPatch(patch);
      for (const note of [60, 64, 67]) {
        synth.noteOn(note, note, 0.8, 0.02);
        synth.noteOff(note, 0.65);
      }
      const audio = await ctx.startRendering(),
        left = audio.getChannelData(0),
        right = audio.getChannelData(1);
      let peak = 0,
        energy = 0,
        tail = 0,
        stereo = 0;
      for (let i = 0; i < left.length; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        energy += left[i] ** 2;
        stereo += (left[i] - right[i]) ** 2;
        if (i > 24000) tail += left[i] ** 2;
      }
      results.push({
        id: patch.id,
        peak,
        rms: Math.sqrt(energy / left.length),
        tail: Math.sqrt(tail / (left.length - 24000)),
        stereo,
      });
      synth.dispose();
    }
    return results;
  });
  expect(patches).toHaveLength(16);
  for (const p of patches) {
    expect(Number.isFinite(p.peak), p.id).toBe(true);
    expect(p.peak, p.id).toBeLessThan(1);
    expect(p.rms, p.id).toBeGreaterThan(0.004);
    expect(p.tail, p.id).toBeGreaterThan(0.00001);
    expect(p.stereo, p.id).toBeGreaterThan(0.001);
  }
  expect(new Set(patches.map(p => p.rms.toFixed(4))).size).toBeGreaterThan(3);
});

test('Panic silences both voices and effect tails even after a patch change', async ({page}) => {
  await page.goto('/');
  const levels = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(2, 2 * 24000, 24000),
      synth = new AfterhoursSynthAudio(ctx);
    synth.setPatch({...AfterhoursSynthAudio.presets[0], delay: 1, reverb: 1});
    synth.noteOn('held', 60, 1, 0.02);
    const pause = ctx.suspend(0.4).then(async () => {
      synth.panic();
      synth.setPatch(AfterhoursSynthAudio.presets[3]);
      await ctx.resume();
    });
    const audio = await ctx.startRendering();
    await pause;
    const a = audio.getChannelData(0),
      rms = (from, to) => {
        let sum = 0;
        for (let i = from * 24000; i < to * 24000; i++) sum += a[i] ** 2;
        return Math.sqrt(sum / ((to - from) * 24000));
      };
    const result = {before: rms(0.1, 0.3), after: rms(0.6, 1.5), held: synth.held.size};
    synth.dispose();
    return result;
  });
  expect(levels.before).toBeGreaterThan(0.005);
  expect(levels.after).toBeLessThan(0.00001);
  expect(levels.held).toBe(0);
});
