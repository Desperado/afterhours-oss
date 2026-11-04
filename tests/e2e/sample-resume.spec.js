const {test, expect} = require('@playwright/test');
const {clock, advance} = require('./helpers/groove-clock');

test('ordinary playback resumes early samples once and clears offsets on restart or section change', async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await clock(page);
  await page.evaluate(async () => {
    const {S, transport} = AfterhoursGrooveApp;
    S.data = AfterhoursGroove.project();
    S.data.bpm = 120;
    S.data.swing = 0;
    for (const track of S.data.patterns[0].tracks) for (const step of track.steps) step.on = false;
    const track = S.data.patterns[0].tracks[12];
    Object.assign(track, {machine: 'Sample', rate: 0.5, sample: {id: 'test', bpm: 120, offset: 0}});
    Object.assign(track.steps[1], {on: true, gate: 2, micro: -0.4});
    AfterhoursSamples.prepare = async () => {};
    FMGrooveAudio.prototype.hit = function (event, time) {
      __clock.events.push({time, index: event.index, skip: event.sampleSkip || 0, gate: event.gate});
    };
    S.resumePosition = {offsetTicks: 3, loopOrigin: 0, songOffset: 0};
    await transport.play();
  });
  await advance(page, 0.6);
  const hits = await page.evaluate(() => __clock.events);
  expect(hits).toHaveLength(1);
  expect(hits[0].skip).toBeCloseTo(0.075, 8);
  expect(hits[0].gate).toBeCloseTo(0.925, 8);
  expect(hits[0].time).toBeCloseTo(0.25, 8);
  await page.evaluate(() => AfterhoursGrooveApp.transport.restart());
  await advance(page, 1.1);
  const restarted = await page.evaluate(() => __clock.events);
  expect(restarted).toHaveLength(1);
  expect(restarted[0].skip).toBe(0);
  expect(restarted[0].gate).toBe(1);
  expect(restarted[0].time).toBeCloseTo(0.8, 8);

  await page.evaluate(async () => {
    const {S, transport} = AfterhoursGrooveApp;
    transport.stop();
    S.songMode = true;
    S.data.arrangement = [
      {name: 'First', pattern: 0, bars: 1, lanes: [12]},
      {name: 'Second', pattern: 0, bars: 1, lanes: [12]},
    ];
    const track = S.data.patterns[0].tracks[12];
    track.steps[1].on = false;
    Object.assign(track.steps[0], {on: true, gate: 2, micro: -0.4});
    Object.assign(track.steps[8], {on: true, gate: 2, micro: -0.4});
    S.resumePosition = {offsetTicks: 31, loopOrigin: 0, songOffset: 0};
    await transport.play();
  });
  await advance(page, 1.7);
  // Step 8 belongs beyond the first section's grid boundary. Only the next section's
  // step 0 should play, with its full slice and no offset from the previous section.
  const nextSection = await page.evaluate(() => __clock.events);
  expect(nextSection).toHaveLength(1);
  expect(nextSection[0].index).toBe(0);
  expect(nextSection[0].skip).toBe(0);
  expect(nextSection[0].gate).toBe(1);
  expect(nextSection[0].time).toBeCloseTo(1.4125, 8);
});

test('resumed sample audio equals the remaining original playback at different tempos', async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const results = [];
    for (const bpm of [90, 120, 180])
      for (const config of [
        {rate: 1, gate: 8, repeat: 1, resume: 8},
        {rate: 0.5, gate: 0.1, repeat: 1, resume: 2},
        {rate: 0.5, gate: 2, repeat: 4, resume: 2},
        {rate: 0.5, gate: 2, repeat: 1, resume: 3, step: 1, micro: -0.4},
        {rate: 0.5, gate: 0.1, repeat: 1, resume: 3, step: 1, micro: -0.4},
        {rate: 0.5, gate: 2, repeat: 4, resume: 3, step: 1, micro: -0.4},
        {rate: 0.5, gate: 2, repeat: 1, resume: 2, step: 1, micro: -0.4},
      ]) {
        const pattern = AfterhoursGroove.project().patterns[0];
        for (const track of pattern.tracks) for (const step of track.steps) step.on = false;
        const track = pattern.tracks[12];
        Object.assign(track, {
          machine: 'Sample',
          rate: config.rate,
          volume: 100,
          pan: 0,
          sample: {id: 'resume-test', offset: 0.1, bpm: 120},
        });
        Object.assign(track.steps[config.step || 0], {
          on: true,
          gate: config.gate,
          repeat: config.repeat,
          velocity: 127,
          micro: config.micro || 0,
        });
        const render = async from => {
          const ctx = new OfflineAudioContext(2, 144000, 48000);
          const buffer = ctx.createBuffer(1, 192000, 48000);
          const samples = buffer.getChannelData(0);
          // A varying source detects wrong source offsets as well as wrong durations.
          for (let i = 0; i < samples.length; i++) samples[i] = 0.2 + 0.1 * Math.sin(i / 3000);
          const original = AfterhoursSamples.get;
          AfterhoursSamples.get = () => buffer;
          try {
            const engine = {context: ctx, bpm, voices: new Set(), mixer: {channel: () => ctx.destination}};
            for (let tick = from; tick < 24; tick++)
              for (const e of AfterhoursGroove.events(pattern, tick, {sampleResumeTick: from > 0 ? from : null}))
                FMGrooveAudio.prototype.sampleHit.call(engine, e, ((e.beat - from / 8) * 60) / bpm);
            return (await ctx.startRendering()).getChannelData(0);
          } finally {
            AfterhoursSamples.get = original;
          }
        };
        const full = await render(0),
          resumed = await render(config.resume);
        const skip = Math.round((config.resume / 8) * (60 / bpm) * 48000);
        let maxError = 0,
          energy = 0;
        for (let i = 0; i < full.length - skip; i++) {
          maxError = Math.max(maxError, Math.abs(full[i + skip] - resumed[i]));
          energy += resumed[i] ** 2;
        }
        results.push({bpm, ...config, maxError, energy});
      }
    return results;
  });
  for (const result of results) {
    expect(result.maxError, JSON.stringify(result)).toBeLessThan(0.0001);
    if (result.gate === 0.1) expect(result.energy).toBe(0);
    else expect(result.energy).toBeGreaterThan(1);
  }
});
