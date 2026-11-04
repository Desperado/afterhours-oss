const {test, expect} = require('@playwright/test');
const fs = require('node:fs');

function tone(seconds = 1) {
  const rate = 16000,
    frames = Math.round(seconds * rate),
    b = Buffer.alloc(44 + frames * 2);
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
  b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    b.writeInt16LE(Math.round(Math.sin((i * 220 * 2 * Math.PI) / rate) * 3276), 44 + i * 2);
  return b;
}

async function bank(page, id, notes = [60]) {
  const regions = notes.map(note => ({
    sample: note.toString(16).padStart(24, '0') + '.flac',
    lo: note,
    hi: note,
    root: note,
    lovel: 0,
    hivel: 127,
    take: 0,
    takes: 1,
    attack: 0.001,
    release: 0.02,
    volume: 0,
    veltrack: 100,
    oneShot: id === 'virtuosity-drums',
  }));
  await page.route(`**/${id}/manifest.json`, r => r.fulfill({json: {version: 1, id, regions}}));
  for (const region of regions)
    await page.route(`**/${id}/${region.sample}`, r =>
      r.fulfill({body: tone(region.root === 46 ? 3 : region.root === 42 ? 0.03 : 1), contentType: 'audio/wav'}),
    );
}

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
});

test('cached instruments remain ready while an unrelated bank is loading', async ({page}) => {
  await bank(page, 'growlybass');
  let blocked;
  await page.route('**/vsco-flute/manifest.json', route => {
    blocked = route;
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const pattern = id => [{tracks: [{machine: 'Instrument', instrument: id}]}];
    await AfterhoursInstruments.prepare(pattern('growlybass'));
    window.pendingBank = AfterhoursInstruments.prepare(pattern('vsco-flute')).catch(() => {});
  });
  await expect.poll(() => !!blocked).toBe(true);
  await page.evaluate(() => {
    AfterhoursInstruments.prepare([{tracks: [{machine: 'Instrument', instrument: 'growlybass'}]}]).then(() => {
      window.cachedReady = true;
    });
  });
  try {
    await expect.poll(() => page.evaluate(() => !!window.cachedReady), {timeout: 1500}).toBe(true);
  } finally {
    await blocked.fulfill({status: 404, body: ''});
    await page.evaluate(() => window.pendingBank);
  }
});

test('audition loads only the selected lane, even when other banks are missing', async ({page}) => {
  await bank(page, 'growlybass');
  let unrelatedRequests = 0;
  await page.route('**/vsco-flute/manifest.json', route => {
    unrelatedRequests++;
    return route.fulfill({status: 404, body: ''});
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const {S} = AfterhoursGrooveApp;
    Object.assign(S.data.patterns[0].tracks[4], {machine: 'Instrument', instrument: 'growlybass', note: 60});
    Object.assign(S.data.patterns[1].tracks[5], {machine: 'Instrument', instrument: 'vsco-flute'});
    await AfterhoursInstruments.prepare([{tracks: [S.data.patterns[0].tracks[4]]}]);
    await AfterhoursGrooveApp.transport.auditionLane(4);
  });
  await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
  expect(unrelatedRequests).toBe(0);
  await expect(page.locator('#status-text')).toContainText('Audition');
});

test('cold replay preloads initial and later sampled patches before capture and preserves note timing', async ({
  page,
}) => {
  await bank(page, 'growlybass');
  await bank(page, 'vsco-flute');
  const pending = new Map();
  for (const id of ['growlybass', 'vsco-flute'])
    await page.route(`**/${id}/manifest.json`, route => pending.set(id, route));
  await page.goto('/');
  const take = await page.evaluate(() => {
    const patch = instrument =>
      AfterhoursGrooveInstrument.validate({
        lane: 4,
        track: {...AfterhoursGroove.project().patterns[0].tracks[4], machine: 'Instrument', instrument, note: 60},
      });
    return JSON.stringify({
      version: 1,
      kind: 'afterhours-performance',
      name: 'Cold sampled replay',
      duration: 1.2,
      initial: {
        groove: AfterhoursGrooveLive.snapshot(),
        synth: patch('growlybass'),
        held: [{id: 'initial', note: 60, velocity: 1}],
      },
      events: [
        {time: 0.3, type: 'noteOff', value: {id: 'initial'}},
        {time: 0.5, type: 'patch', value: patch('vsco-flute')},
        {time: 0.6, type: 'noteOn', value: {id: 'later', note: 60, velocity: 1}},
        {time: 1, type: 'noteOff', value: {id: 'later'}},
      ],
    });
  });
  await page
    .locator('#performance-file')
    .setInputFiles({name: 'cold.json', mimeType: 'application/json', buffer: Buffer.from(take)});
  await expect(page.locator('#performance-print')).toBeEnabled();
  await page.evaluate(() => {
    window.__replayHits = [];
    const hit = FMGrooveAudio.prototype.hit;
    FMGrooveAudio.prototype.hit = function (e, ...args) {
      __replayHits.push({instrument: e.settings.instrument, time: this.context.currentTime});
      return hit.call(this, e, ...args);
    };
    window.__replaying = AfterhoursPerformanceStudio.replay(true);
  });
  try {
    for (const id of ['growlybass', 'vsco-flute']) {
      await expect.poll(() => pending.has(id)).toBe(true);
      expect(await page.evaluate(() => AfterhoursAudio.recording)).toBe(false);
      expect(await page.evaluate(() => __replayHits.length)).toBe(0);
      // Force a load longer than either note: replay must not count this time.
      await page.waitForTimeout(400);
      await pending.get(id).fallback();
    }
    await page.evaluate(() => __replaying);
    await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.replaying)).toBe(false);
    await expect(page.locator('#performance-status')).toContainText('Edited replay printed');
    const result = await page.evaluate(async () => {
      const bytes = await AfterhoursPerformanceStudio.audio.arrayBuffer(),
        view = new DataView(bytes),
        rate = view.getUint32(24, true);
      const rms = (start, end) => {
        let sum = 0,
          count = 0;
        for (let i = Math.round(start * rate); i < Math.round(end * rate); i++) {
          const value = view.getInt16(44 + i * 4, true) / 32768;
          sum += value * value;
          count++;
        }
        return Math.sqrt(sum / count);
      };
      return {hits: __replayHits, first: rms(0.08, 0.22), gap: rms(0.4, 0.47), second: rms(0.73, 0.9)};
    });
    expect(result.hits.map(h => h.instrument)).toEqual(['growlybass', 'vsco-flute']);
    expect(result.hits[1].time - result.hits[0].time).toBeGreaterThan(0.5);
    expect(result.first).toBeGreaterThan(0.001);
    expect(result.gap).toBeLessThan(0.0001);
    expect(result.second).toBeGreaterThan(0.001);
  } finally {
    for (const route of pending.values()) await route.fallback().catch(() => {});
  }
});

test('hat choking follows attack times in either lane scheduling order', async ({page}) => {
  await bank(page, 'virtuosity-drums', [42, 46]);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const track = {
      ...AfterhoursGroove.project().patterns[0].tracks[0],
      machine: 'Instrument',
      instrument: 'virtuosity-drums',
      volume: 60,
      cutoff: 16000,
    };
    await AfterhoursInstruments.prepare([{tracks: [track]}]);
    const results = [];
    // Earlier closed hats must not silence later opens. Later closes must silence earlier opens,
    // even if a different lane queued the closed hit first. The earliest close always wins.
    for (const events of [
      [
        [46, 0.25],
        [42, 0.15],
      ],
      [
        [42, 0.3],
        [46, 0.1],
      ],
      [
        [46, 0.1],
        [42, 0.3],
        [42, 0.2],
      ],
    ]) {
      const ctx = new OfflineAudioContext(2, 16000, 16000),
        renderer = new FMGrooveAudio(ctx, 120);
      for (const [note, time] of events)
        renderer.hit({lane: 0, settings: {...track, note}, velocity: 1, gate: 1}, time);
      const audio = (await ctx.startRendering()).getChannelData(0);
      const rms = (a, b) =>
        Math.sqrt(audio.slice(a * 16000, b * 16000).reduce((n, x) => n + x * x, 0) / ((b - a) * 16000));
      results.push({early: rms(0.12, 0.14), late: rms(0.36, 0.42), between: rms(0.25, 0.28)});
      renderer.dispose();
    }
    return results;
  });
  expect(results[0].late).toBeGreaterThan(0.001);
  expect(results[1].early).toBeGreaterThan(0.001);
  expect(results[1].late).toBeLessThan(0.00001);
  expect(results[2].between).toBeLessThan(0.00001);
});

test('cancelled closed hats restore or recompute open tails without reviving cancelled notes', async ({page}) => {
  await bank(page, 'virtuosity-drums', [42, 46]);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const track = {
      ...AfterhoursGroove.project().patterns[0].tracks[0],
      machine: 'Instrument',
      instrument: 'virtuosity-drums',
      volume: 60,
      cutoff: 16000,
    };
    await AfterhoursInstruments.prepare([{tracks: [track]}]);
    const results = [];
    for (const cancel of ['all-closes', 'first-close', 'last-close', 'open-too', 'after-close', 'new-open']) {
      const ctx = new OfflineAudioContext(2, 19200, 16000),
        renderer = new FMGrooveAudio(ctx, 120);
      for (const [lane, note, time, planTick] of [
        [0, 46, 0.1, 0],
        [1, 42, 0.3, 32],
        [2, 42, 0.6, 64],
      ])
        renderer.hit({lane, planTick, settings: {...track, note}, velocity: 1, gate: 1}, time);
      ctx.suspend(cancel === 'after-close' ? 0.4 : 0.2).then(() => {
        if (cancel === 'first-close') renderer.stopLane(1);
        else if (cancel === 'last-close') renderer.stopLane(2);
        else {
          if (['open-too', 'new-open'].includes(cancel)) renderer.stopLane(0);
          renderer.cancelFromTick(32);
          if (cancel === 'new-open')
            renderer.hit({lane: 0, planTick: 16, settings: {...track, note: 46}, velocity: 1, gate: 1}, 0.25);
        }
        return ctx.resume();
      });
      const data = (await ctx.startRendering()).getChannelData(0);
      const rms = (a, b) =>
        Math.sqrt(data.slice(a * 16000, b * 16000).reduce((n, x) => n + x * x, 0) / ((b - a) * 16000));
      results.push({cancel, middle: rms(0.43, 0.48), late: rms(0.8, 0.9)});
      renderer.dispose();
    }
    return results;
  });
  for (const result of results) {
    if (['all-closes', 'first-close', 'new-open'].includes(result.cancel)) expect(result.middle).toBeGreaterThan(0.001);
    else expect(result.middle).toBeLessThan(0.00001);
    if (['all-closes', 'new-open'].includes(result.cancel)) expect(result.late).toBeGreaterThan(0.001);
    else expect(result.late).toBeLessThan(0.00001);
  }
});

test('sampled melodies use controller pitch and clean up tuners after release or cancellation', async ({page}) => {
  await bank(page, 'growlybass', [60, 61, 64]);
  await bank(page, 'virtuosity-drums', [46]);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const track = {
      ...AfterhoursGroove.project().patterns[0].tracks[4],
      machine: 'Instrument',
      instrument: 'growlybass',
      note: 60,
      volume: 60,
      cutoff: 16000,
    };
    await AfterhoursInstruments.prepare([{tracks: [track, {...track, instrument: 'virtuosity-drums'}]}]);
    const results = [];
    for (const [note, changes, drums, cancel] of [
      [60, {}],
      [60, {transpose: 12}],
      [61, {scale: 'minor'}],
      [64, {temperament: 'just'}],
      [60, {cents: 50, bend: 2}],
      [60, {transpose: 12, enabled: false}],
      [46, {transpose: 12}, true],
      [60, {transpose: 12}, false, true],
    ]) {
      const ctx = new OfflineAudioContext(2, 64000, 16000),
        state = {...AfterhoursController.defaults(), ...changes},
        renderer = new FMGrooveAudio(ctx, 120, state),
        voice = renderer.hit(
          {
            lane: 4,
            settings: {...track, note, instrument: drums ? 'virtuosity-drums' : 'growlybass'},
            velocity: 1,
            gate: 1,
          },
          0.01,
          true,
        );
      const active = renderer.controller.tuners.size;
      if (cancel) renderer.silence(voice);
      else voice.release(0.6);
      const data = (await ctx.startRendering()).getChannelData(0);
      const crossings = [];
      for (let i = 0.1 * 16000; i < 0.4 * 16000; i++)
        if (data[i] <= 0 && data[i + 1] > 0) crossings.push(i - data[i] / (data[i + 1] - data[i]));
      results.push({
        active,
        remaining: renderer.controller.tuners.size,
        voices: renderer.voices.size,
        frequency: crossings.length > 1 ? ((crossings.length - 1) * 16000) / (crossings.at(-1) - crossings[0]) : 0,
        expected: 220 * 2 ** ((drums ? 0 : AfterhoursController.cents(note, state)) / 1200),
        cancel,
        drums,
        bend: voice.bend.offset.value,
      });
      renderer.dispose();
    }
    return results;
  });
  for (const result of results) {
    expect(result.active).toBe(result.drums ? 0 : 1);
    expect(result.remaining).toBe(0);
    expect(result.voices).toBe(0);
    expect(result.bend).toBe(0);
    if (result.cancel) expect(result.frequency).toBe(0);
    else expect(Math.abs(result.frequency - result.expected)).toBeLessThan(0.03);
  }
});

test('a held sampled note follows controller changes while it is sounding', async ({page}) => {
  await bank(page, 'growlybass');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const track = {
      ...AfterhoursGroove.project().patterns[0].tracks[4],
      machine: 'Instrument',
      instrument: 'growlybass',
      note: 60,
      volume: 60,
      cutoff: 16000,
    };
    await AfterhoursInstruments.prepare([{tracks: [track]}]);
    const ctx = new OfflineAudioContext(2, 16000, 16000),
      renderer = new FMGrooveAudio(ctx, 120, AfterhoursController.defaults());
    renderer.hit({lane: 4, settings: track, velocity: 1, gate: 1}, 0.01, true).release(0.8);
    // Apply the same session update used by live controller gestures after the attack.
    ctx.suspend(0.2).then(() => {
      renderer.controller.apply({...AfterhoursController.defaults(), transpose: 12});
      return ctx.resume();
    });
    const audio = (await ctx.startRendering()).getChannelData(0);
    const frequency = (start, end) => {
      const crossings = [];
      for (let i = start * 16000; i < end * 16000; i++)
        if (audio[i] <= 0 && audio[i + 1] > 0) crossings.push(i - audio[i] / (audio[i + 1] - audio[i]));
      return ((crossings.length - 1) * 16000) / (crossings.at(-1) - crossings[0]);
    };
    const result = {
      before: frequency(0.05, 0.15),
      after: frequency(0.42, 0.52),
      remaining: renderer.controller.tuners.size,
    };
    renderer.dispose();
    return result;
  });
  expect(result.before).toBeCloseTo(220, 0);
  expect(Math.abs(result.after - 440)).toBeLessThan(2);
  expect(result.remaining).toBe(0);
});

for (const includeClose of [true, false])
  test(`song export respects hat chokes across chunks (next lane ${includeClose ? 'included' : 'excluded'})`, async ({
    page,
  }, testInfo) => {
    await bank(page, 'virtuosity-drums', [42, 46]);
    await page.goto('/');
    await page.locator('#ws-groove').click();
    await page.evaluate(includeClose => {
      const {S, ui} = AfterhoursGrooveApp;
      S.data = AfterhoursGroove.project();
      S.data.bpm = 120;
      S.data.swing = 0;
      for (const p of S.data.patterns) for (const t of p.tracks) for (const step of t.steps) step.on = false;
      for (const [pattern, note, step] of [
        [1, 46, 15],
        [2, 42, 0],
      ]) {
        const t = S.data.patterns[pattern].tracks[0];
        Object.assign(t, {machine: 'Instrument', instrument: 'virtuosity-drums', note, volume: 60, cutoff: 16000});
        t.steps[step].on = true;
        t.steps[step].velocity = 127;
      }
      S.data.arrangement = [
        {name: 'Empty', pattern: 0, bars: 3, lanes: [0]},
        {name: 'Open', pattern: 1, bars: 1, lanes: [0]},
        {name: 'Close', pattern: 2, bars: 1, lanes: includeClose ? [0] : [1]},
      ];
      const hit = FMGrooveAudio.prototype.hit;
      window.closedHits = 0;
      FMGrooveAudio.prototype.hit = function (event, ...args) {
        if (event.settings.machine === 'Instrument' && event.settings.note === 42) window.closedHits++;
        return hit.call(this, event, ...args);
      };
      ui.renderAll();
    }, includeClose);
    await page.locator('#groove-export').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-song-wav').click()]);
    const file = testInfo.outputPath('hats.wav');
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    const rms = (start, end) => {
      let sum = 0,
        count = 0;
      for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++) {
        const sample = bytes.readIntLE(44 + i * 6, 3) / 8388608;
        sum += sample * sample;
        count++;
      }
      return Math.sqrt(sum / count);
    };
    expect(rms(7.91, 7.96)).toBeGreaterThan(0.001);
    if (includeClose) expect(rms(8.2, 8.5)).toBeLessThan(0.00001);
    else expect(rms(8.2, 8.5)).toBeGreaterThan(0.001);
    expect(await page.evaluate(() => window.closedHits)).toBe(includeClose ? 1 : 0);
  });
