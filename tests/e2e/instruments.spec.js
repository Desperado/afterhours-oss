const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function tone(frequency, amplitude) {
  const rate = 16000,
    b = Buffer.alloc(44 + rate * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++)
    b.writeInt16LE(Math.round(Math.sin((i * frequency * 2 * Math.PI) / rate) * amplitude * 32767), 44 + i * 2);
  return b;
}

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
});

test('recorded instruments preserve dynamics, cycle takes, transpose and release live notes', async ({page}) => {
  const regions = [];
  for (let take = 0; take < 4; take++)
    for (let layer = 0; layer < 2; layer++) {
      const sample = (take * 2 + layer).toString(16).padStart(24, '0') + '.flac';
      regions.push({
        sample,
        lo: 0,
        hi: 127,
        root: 60,
        lovel: layer ? 81 : 0,
        hivel: layer ? 127 : 80,
        attack: 0.001,
        release: 0.05,
        volume: 0,
        veltrack: 100,
        take,
        takes: 4,
      });
      await page.route(`**/growlybass/${sample}`, r =>
        r.fulfill({body: tone(220 + take * 30, layer ? 0.8 : 0.4), contentType: 'audio/wav'}),
      );
    }
  await page.route('**/growlybass/manifest.json', r => r.fulfill({json: {version: 1, id: 'growlybass', regions}}));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const G = AfterhoursGroove,
      track = {
        ...G.project().patterns[0].tracks[4],
        machine: 'Instrument',
        instrument: 'growlybass',
        note: 60,
        volume: 80,
        cutoff: 16000,
      };
    await Promise.all([
      AfterhoursInstruments.prepare([{tracks: [track]}]),
      AfterhoursInstruments.prepare([{tracks: [track]}]),
    ]);
    const sequence = new Map();
    const takes = Array.from({length: 5}, () => AfterhoursInstruments.regions('growlybass', 60, 0.9, sequence)[0].take);
    async function render(velocity, note = 60, held = false) {
      const ctx = new OfflineAudioContext(2, 16000, 16000);
      const renderer = new FMGrooveAudio(ctx, 120);
      const voice = renderer.hit({lane: 4, settings: track, velocity, gate: 0.2}, 0.01, held);
      const sample = voice.sources[0].buffer,
        rate = voice.sources[0].playbackRate.value;
      if (held) voice.release(0.4);
      // Check pitch on a second independent held voice, then silence it.
      const shifted = renderer.hit({lane: 4, settings: {...track, note}, velocity, gate: 0.2}, 0.01, true);
      const transposition = shifted.sources[0].playbackRate.value;
      renderer.silence(shifted);
      const audio = await ctx.startRendering();
      const rms = (a, b) =>
        Math.sqrt(
          audio
            .getChannelData(0)
            .slice(a * 16000, b * 16000)
            .reduce((n, x) => n + x * x, 0) /
            ((b - a) * 16000),
        );
      return {
        rms: rms(0.03, 0.08),
        late: rms(0.25, 0.35),
        tail: rms(0.7, 0.8),
        transposition,
        rate,
        samplePeak: Math.max(...sample.getChannelData(0)),
        remaining: renderer.voices.size,
      };
    }
    return {takes, quiet: await render(0.4), loud: await render(0.9), held: await render(0.9, 72, true)};
  });
  expect(result.takes).toEqual([0, 1, 2, 3, 0]);
  expect(result.loud.rms).toBeGreaterThan(result.quiet.rms * 3);
  expect(result.loud.samplePeak).toBeGreaterThan(result.quiet.samplePeak * 1.9);
  expect(result.loud.late).toBeLessThan(0.00001);
  expect(result.held.late).toBeGreaterThan(0.005);
  expect(result.held.tail).toBeLessThan(0.00001);
  expect(result.held.transposition).toBe(2);
  expect(result.held.remaining).toBe(0);
});

test('missing instruments report an actionable error', async ({page}) => {
  await page.route('**/growlybass/manifest.json', r => r.fulfill({status: 404, body: ''}));
  await page.goto('/');
  const message = await page.evaluate(async () => {
    try {
      await AfterhoursInstruments.prepare([{tracks: [{machine: 'Instrument', instrument: 'growlybass'}]}]);
    } catch (e) {
      return e.message;
    }
  });
  expect(message).toContain('Instrument not installed: growlybass');
});

test('Match Groove keeps a newly added empty instrument lane selected', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = AfterhoursGrooveApp.S;
    const track = state.data.patterns[state.data.active].tracks[7];
    Object.assign(track, {machine: 'Instrument', instrument: 'vsco-flute', note: 72});
    for (const p of state.data.patterns)
      p.tracks[7].steps.forEach(s => {
        s.on = false;
      });
    state.selected = 7;
  });
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  const matched = await page.evaluate(() => AfterhoursSynth.snapshot());
  expect(matched.lane).toBe(7);
  expect(matched.track.instrument).toBe('vsco-flute');
});

test('installed banks render and play through the matched Synth keyboard', async ({page}) => {
  test.setTimeout(300000);
  test.skip(
    !fs.existsSync(
      'web/instruments/growlybass/' + require('../../web/instruments/growlybass/manifest.json').regions[0].sample,
    ),
    'Install instrument recordings for the real-library check',
  );
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#ws-groove').click();
  await page.evaluate(async () => {
    await AfterhoursInstruments.prepare(
      AfterhoursInstrumentCatalog.map(item => ({tracks: [{machine: 'Instrument', instrument: item.id}]})),
    );
  });
  const banks = await page.evaluate(async () => {
    const results = [];
    for (const item of AfterhoursInstrumentCatalog) {
      const note =
        item.drums || ['growlybass', 'freepats-guitar', 'vsco-tuba'].includes(item.id)
          ? 36
          : item.id === 'vsco-flute'
            ? 72
            : 60;
      const track = {
        ...AfterhoursGroove.project().patterns[0].tracks[4],
        machine: 'Instrument',
        instrument: item.id,
        note,
        cutoff: 16000,
        volume: 70,
      };
      const ctx = new OfflineAudioContext(2, 24000, 48000),
        renderer = new FMGrooveAudio(ctx, 120);
      renderer.hit({lane: 4, settings: track, velocity: 0.9, gate: 0.5}, 0.01);
      const b = await ctx.startRendering();
      results.push({id: item.id, peak: b.getChannelData(0).reduce((n, x) => Math.max(n, Math.abs(x)), 0)});
    }
    return results;
  });
  for (const bank of banks) expect(bank.peak, bank.id).toBeGreaterThan(0.0001);
  // The keyboard follows the sampled lane and produces an actual BufferSource voice.
  await page.evaluate(() => {
    Object.assign(AfterhoursGrooveApp.S.data.patterns[0].tracks[0], {
      machine: 'Instrument',
      instrument: 'vsco-flute',
      note: 72,
    });
    AfterhoursGrooveApp.S.selected = 0;
  });
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  await page.evaluate(() => {
    const hit = FMGrooveAudio.prototype.hit;
    FMGrooveAudio.prototype.hit = function (...args) {
      const v = hit.apply(this, args);
      if (args[2]) window.__recordedKey = !!v?.sources.some(s => s instanceof AudioBufferSourceNode);
      return v;
    };
  });
  await page.keyboard.down('a');
  await expect.poll(() => page.evaluate(() => window.__recordedKey)).toBe(true);
  await page.keyboard.up('a');
  expect(errors).toEqual([]);
  await page.screenshot({path: '.context/sampled-instruments-playable.png'});
});
