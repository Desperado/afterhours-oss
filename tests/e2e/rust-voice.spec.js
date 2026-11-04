// @ts-check
const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const P = require('../../web/groove-presets');

test('Rust voices follow Performance mixer mute including their echo sends', async ({page}) => {
  await page.goto('/');
  const energies = await page.evaluate(async () => {
    const out = [];
    for (const mute of [false, true]) {
      const ctx = new OfflineAudioContext(2, 48000, 24000);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const state = AfterhoursPerformanceCore.validate();
      Object.assign(state.mixer.lanes[7], {mute, delay: 0.7, reverb: 0.5});
      const renderer = new FMGrooveAudio(ctx, 120, AfterhoursController.defaults(), state);
      renderer.setMix({space: 1});
      renderer.hit(
        {lane: 7, settings: AfterhoursPresets.create('letters').patterns[1].tracks[7], velocity: 1, gate: 0.5, beat: 0},
        0.02,
      );
      const samples = (await ctx.startRendering()).getChannelData(0);
      out.push(samples.reduce((sum, x) => sum + x * x, 0));
      renderer.dispose();
    }
    return out;
  });
  expect(energies[0]).toBeGreaterThan(1);
  expect(energies[1]).toBeLessThan(1e-7);
});

async function openAnalogSong(page) {
  const project = P.create('letters');
  project.bpm = 120;
  project.arrangement = [{name: 'Rust export', pattern: 1, bars: 5, lanes: [4, 7, 8]}];
  await page.addInitScript(project => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
    localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(project));
  }, project);
  await page.goto('/');
}

test('Rust song export remains audible across the four-bar render boundary', async ({page}) => {
  await openAnalogSong(page);
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-song-wav').click()]);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.readUInt32LE(24)).toBe(48000);
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect((bytes.length - 44) / 288000).toBeCloseTo(16, 3);
  for (const [from, to] of [
    [0.2, 1.8],
    [7.8, 8.2],
    [8.2, 9.8],
  ]) {
    let energy = 0;
    for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++)
      energy += (bytes.readIntLE(44 + i * 6, 3) / 8388608) ** 2;
    expect(Math.sqrt(energy / ((to - from) * 48000))).toBeGreaterThan(0.005);
  }
});

async function failRustModule(page) {
  await page.evaluate(() => {
    const prototype = Object.getPrototypeOf(new OfflineAudioContext(1, 128, 48000).audioWorklet);
    const add = prototype.addModule;
    prototype.addModule = function (url, ...args) {
      if (String(url).includes('voice-worklet.js')) return Promise.reject(new Error('Simulated module failure'));
      return add.call(this, url, ...args);
    };
  });
}

test('unavailable Rust worklet reports an error and prevents a silent song export', async ({page}) => {
  await openAnalogSong(page);
  await failRustModule(page);
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.locator('#groove-export').click();
  await page.locator('#groove-song-wav').click();
  await expect(page.getByRole('status').filter({hasText: 'Rust voice unavailable'})).toBeVisible();
  // The status names the underlying load error, not just "unavailable".
  await expect(page.getByRole('status').filter({hasText: 'Simulated module failure'})).toBeVisible();
  expect(downloads).toHaveLength(0);
  await expect(page.locator('#groove-song-wav')).toBeEnabled();
});

test('changing machine stops playback and an unavailable Rust voice prevents restarting', async ({page}) => {
  await page.goto('/');
  await failRustModule(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#ws-groove').click();
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.getByLabel('Machine type', {exact: true}).selectOption('Analog');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  await expect(page.locator('#status-text')).toHaveText('Groove stopped');
  await page.locator('#transport-play').click();
  await expect(page.locator('#status-text')).toContainText('Rust voice unavailable');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  expect(errors).toEqual([]);
});

test('Rust voice keeps future notes alive, cancels before onset and survives shared-memory growth', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rate = 24000,
      ctx = new OfflineAudioContext(2, rate * 15, rate);
    if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
    const errors = [],
      voices = [];
    const make = (start, end, side) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = side;
      pan.connect(ctx.destination);
      const v = AfterhoursVoice.create(
        ctx,
        {
          hz: 220,
          time: start,
          cutoff: 4000,
          resonance: 1,
          position: 0.5,
          attack: 0.005,
          decay: 0.1,
          sustain: 0.6,
          release: 0.1,
        },
        pan,
      );
      v.nodes[0].onprocessorerror = () => errors.push('processor error');
      v.sources[0].start(start);
      v.release(start + 0.3);
      v.sources[0].stop(end);
      voices.push(v);
      return v;
    };
    make(12.5, 13, -1);
    const cancelled = make(13.5, 14, 1);
    cancelled.sources[0].stop(0.2);
    // Allocate enough voices to grow WASM memory after the first voice attached its views.
    for (let i = 0; i < 384; i++) make(14.5, 14.9, 1).sources[0].stop(0.1);
    const audio = await ctx.startRendering(),
      left = audio.getChannelData(0),
      right = audio.getChannelData(1);
    const rms = (data, from, to) =>
      Math.sqrt(data.subarray(from * rate, to * rate).reduce((a, x) => a + x * x, 0) / ((to - from) * rate));
    const values = {
      errors,
      before: rms(left, 0, 12.5),
      note: rms(left, 12.55, 12.8),
      tail: rms(left, 13.1, 15),
      cancelled: rms(right, 0, 15),
    };
    voices.forEach(v => v.nodes.forEach(n => n.disconnect()));
    return values;
  });
  expect(result.errors).toEqual([]);
  expect(result.before).toBe(0);
  expect(result.note).toBeGreaterThan(0.02);
  expect(result.tail).toBe(0);
  expect(result.cancelled).toBeLessThan(1e-7);
});

test('Rust pulse width, modulation, saturation and tuning change the rendered signal', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async extra => {
      const rate = 24000,
        ctx = new OfflineAudioContext(1, rate, rate);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const v = AfterhoursVoice.create(
        ctx,
        {
          hz: 220,
          time: 0,
          oscA: 1,
          oscB: 1,
          detune: 0,
          drift: 0,
          sub: 0,
          cutoff: 9000,
          resonance: 0.5,
          position: 0.5,
          attack: 0.005,
          sustain: 0.8,
          decay: 0.05,
          release: 0.1,
          pulseWidth: 0.5,
          ...extra,
        },
        ctx.destination,
      );
      if (extra.cents) v.oscillators[0].detune.value = extra.cents;
      v.sources[0].start(0.01);
      v.release(0.8);
      v.sources[0].stop(0.95);
      const data = (await ctx.startRendering()).getChannelData(0);
      v.nodes.forEach(n => n.disconnect());
      return data;
    };
    const base = await render({}),
      narrow = await render({pulseWidth: 0.2}),
      motion = await render({motion: 1, pwmRate: 3}),
      driven = await render({drive: 0.9}),
      octave = await render({cents: 1200});
    const delta = data => Math.sqrt(data.reduce((sum, x, i) => sum + (x - base[i]) ** 2, 0) / data.length);
    const amplitude = (data, hz) => {
      let re = 0,
        im = 0;
      for (let i = 4800; i < 16800; i++) {
        re += data[i] * Math.cos((2 * Math.PI * hz * i) / 24000);
        im += data[i] * Math.sin((2 * Math.PI * hz * i) / 24000);
      }
      return Math.hypot(re, im) / 12000;
    };
    return {
      deltas: [narrow, motion, driven].map(delta),
      base220: amplitude(base, 220),
      octave220: amplitude(octave, 220),
      octave440: amplitude(octave, 440),
      finite: [base, narrow, motion, driven, octave].every(a => a.every(x => Number.isFinite(x) && Math.abs(x) < 2)),
    };
  });
  expect(result.finite).toBe(true);
  for (const delta of result.deltas) expect(delta).toBeGreaterThan(0.01);
  expect(result.base220).toBeGreaterThan(0.01);
  expect(result.octave440).toBeGreaterThan(result.octave220 * 20);
});

for (const id of ['letters', 'glass', 'satellite']) {
  test(`${id} renders its chorus with audible Rust lanes and releases all voices`, async ({page}) => {
    await page.goto('/');
    const result = await page.evaluate(async id => {
      const p = AfterhoursPresets.create(id),
        rate = 24000,
        seconds = (16 * 60) / p.bpm;
      const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 4) * rate), rate);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Rust voice did not load');
      const a = new FMGrooveAudio(ctx, p.bpm);
      a.setMix(p.mix);
      const events = Array.from({length: 128}, (_, tick) =>
        AfterhoursGroove.events(p.patterns[1], tick, {swing: p.swing}),
      ).flat();
      for (const e of events) a.hit(e, 0.02 + (e.beat * 60) / p.bpm);
      const audio = await ctx.startRendering(),
        left = audio.getChannelData(0),
        right = audio.getChannelData(1);
      let energy = 0,
        peak = 0,
        stereo = 0;
      for (let i = 0; i < left.length; i++) {
        energy += left[i] ** 2;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        stereo += (left[i] - right[i]) ** 2;
      }
      const remaining = a.voices.size;
      a.dispose();
      const isolated = new OfflineAudioContext(1, Math.ceil((seconds + 4) * rate), rate);
      if (!(await AfterhoursVoice.prepare(isolated))) throw new Error('Rust voice did not load');
      const solo = new FMGrooveAudio(isolated, p.bpm);
      for (const e of events.filter(e => e.settings.machine === 'Analog')) solo.hit(e, 0.02 + (e.beat * 60) / p.bpm);
      const rendered = await isolated.startRendering();
      const analogEnergy = rendered.getChannelData(0).reduce((sum, x) => sum + x * x, 0);
      solo.dispose();
      return {
        energy,
        peak,
        stereo,
        remaining,
        analogEnergy,
        analog: events.filter(e => e.settings.machine === 'Analog').length,
      };
    }, id);
    expect(result.analog).toBeGreaterThan(50);
    expect(result.analogEnergy).toBeGreaterThan(10);
    expect(result.energy).toBeGreaterThan(20);
    expect(result.peak).toBeGreaterThan(0.05);
    expect(result.peak).toBeLessThan(1);
    expect(result.stereo).toBeGreaterThan(1);
    expect(result.remaining).toBe(0);
  });
}
