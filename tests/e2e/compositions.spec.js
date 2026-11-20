// @ts-check
const {test, expect} = require('@playwright/test');
const G = require('../../web/groove-core');
const P = require('../../web/groove-presets');
const Performance = require('../../web/performance-core');
const fs = require('node:fs');
const {clock, advance} = require('./helpers/groove-clock');
const key = 'afterhours-fm-project-v1';

function fixture() {
  const p = G.project();
  p.bpm = 120;
  p.patterns.forEach((pattern, i) => {
    pattern.length = 64;
    pattern.tracks.forEach(t => {
      t.length = 64;
      t.steps.forEach(s => {
        s.on = false;
      });
    });
    pattern.tracks[0].steps[0].on = true;
    pattern.tracks[0].note = 36 + i * 12;
  });
  return p;
}
async function open(page, project = fixture()) {
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.addInitScript(
    ({key, project}) => {
      localStorage.setItem('afterhours-workspace', 'groove');
      localStorage.setItem('afterhours-engine', 'groove');
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project));
    },
    {key, project},
  );
  await page.goto('/');
}
test('long patterns switch at the next bar, keep tails and update only when audible', async ({page}) => {
  await open(page);
  await clock(page);
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  const stops = await page.evaluate(() => __clock.stops);
  await page.locator('#groove-patterns button').filter({hasText: 'B'}).click();
  await advance(page, 2.1);
  await expect(page.locator('#groove-patterns button[aria-pressed="true"]')).toHaveText('Aplay');
  expect(await page.evaluate(() => __clock.events.find(e => e.note === 48)?.time)).toBeCloseTo(2.25, 7);
  await advance(page, 2.26);
  await expect(page.locator('#groove-patterns button[aria-pressed="true"]')).toHaveText('Bplay');
  expect(await page.evaluate(() => __clock.stops)).toBe(stops);
});

test('a queued change can be cancelled inside the audio scheduling lookahead', async ({page}) => {
  await open(page);
  await clock(page);
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  const stops = await page.evaluate(() => __clock.stops);
  await page.locator('#groove-patterns button').filter({hasText: 'B'}).click();
  await advance(page, 2.1);
  expect(await page.evaluate(() => __clock.events.some(e => e.note === 48))).toBe(true);
  await page.locator('#groove-patterns button').filter({hasText: 'A'}).click();
  await advance(page, 2.3);
  await expect(page.locator('#groove-patterns button[aria-pressed="true"]')).toHaveText('Aplay');
  expect(await page.evaluate(() => __clock.events.some(e => e.note === 48))).toBe(false);
  expect(await page.evaluate(() => __clock.cancelled)).toEqual([32]);
  expect(await page.evaluate(() => __clock.stops)).toBe(stops);
});

test('preset auditions preserve the original session across reloads and restore its locks', async ({page}) => {
  const original = fixture();
  original.patterns[0].tracks[4].steps[3].locks = {note: 49, cutoff: 2300};
  await open(page, original);
  await page.locator('#groove-preset').selectOption('neon');
  await page.locator('#groove-load-preset').click();
  await expect(page.locator('#groove-track-title')).toHaveText('Neon Afterimage');
  await expect(page.locator('#groove-arrangement button')).toHaveCount(8);
  await page.locator('#groove-preset').selectOption('rain');
  await page.locator('#groove-load-preset').click();
  await page.reload();
  await page.locator('#groove-restore').click();
  await expect(page.locator('#groove-track-title')).toHaveText('Your session');
  expect(G.validate(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key))).toEqual({
    ...G.validate(original),
    performance: Performance.validate(),
  });
  await expect(page.locator('#groove-restore')).toBeDisabled();
});

test('the public orchestra preset loads all score sections and survives reloading', async ({page}) => {
  await open(page);
  await page.locator('#groove-preset').selectOption('chervona-ruta');
  await page.locator('#groove-load-preset').click();
  await expect(page.locator('#groove-track-title')).toHaveText('Червона рута · Orchestra');
  await expect(page.locator('#groove-arrangement button')).toHaveCount(25);
  await expect(page.locator('#groove-arrangement button').last()).toContainText('G minor · final hold');
  await page.reload();
  const project = await page.evaluate(() => AfterhoursGrooveApp.S.data);
  expect(project.arrangement.reduce((sum, s) => sum + s.bars, 0)).toBe(86);
  expect(project.patterns[8].tracks.every(t => t.machine === 'Instrument')).toBe(true);
  expect(project.tonality).toEqual({root: 7, scale: 'minor'});
});

test('song mode follows section lanes and finishes on its audio clock', async ({page}) => {
  const p = fixture();
  p.arrangement = [
    {name: 'Intro', pattern: 0, bars: 1, lanes: [2]},
    {name: 'Drop', pattern: 1, bars: 1, lanes: [0]},
  ];
  await open(page, p);
  await clock(page);
  await page.locator('#groove-song').click();
  await expect(page.locator('#groove-section')).toContainText('2-bar arrangement');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await expect(page.locator('#groove-patterns button').filter({hasText: 'B'})).toBeDisabled();
  await advance(page, 0.5);
  await expect(page.locator('#groove-section')).toHaveText('Intro · bar 1/1');
  expect(await page.evaluate(() => __clock.events)).toEqual([]);
  await advance(page, 2.3);
  await expect(page.locator('#groove-section')).toHaveText('Drop · bar 1/1');
  expect(await page.evaluate(() => __clock.events[0].time)).toBeCloseTo(2.25, 7);
  const stops = await page.evaluate(() => __clock.stops);
  await advance(page, 4.26);
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  expect(await page.evaluate(() => __clock.timers.size)).toBe(0);
  expect(await page.evaluate(() => __clock.stops)).toBe(stops);
});

test('full song export contains both sections and a tail in stereo PCM', async ({page}) => {
  const p = P.create('neon');
  p.bpm = 120;
  p.arrangement = [
    {name: 'Keys', pattern: 2, bars: 1, lanes: [5]},
    {name: 'Main', pattern: 1, bars: 1, lanes: [0, 1, 2, 3, 4, 5]},
  ];
  await open(page, p);
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-song-wav').click()]);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt32LE(24)).toBe(48000);
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect((bytes.length - 44) / 288000).toBeCloseTo(10, 3);
  const rms = (from, to) => {
    let sum = 0;
    for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++)
      sum += (bytes.readIntLE(44 + i * 6, 3) / 8388608) ** 2;
    return Math.sqrt(sum / ((to - from) * 48000));
  };
  expect(rms(0.2, 1.8)).toBeGreaterThan(0.002);
  expect(rms(2.2, 3.8)).toBeGreaterThan(0.005);
  expect(rms(4, 4.6)).toBeGreaterThan(0.00001);
});

test('cancelling a future kick removes its pump automation without silencing the music', async ({page}) => {
  await open(page);
  const ratio = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(2, 24000, 24000),
      engine = new FMGrooveAudio(ctx, 120);
    engine.setMix({pump: 1});
    const tone = ctx.createOscillator(),
      gain = ctx.createGain();
    gain.gain.value = 0.1;
    tone.connect(gain).connect(engine.music);
    tone.start();
    tone.stop(1);
    const kick = AfterhoursGroove.project().patterns[0].tracks[0];
    engine.hit({settings: kick, lane: 0, velocity: 1, gate: 0.5, planTick: 32}, 0.6);
    engine.cancelFromTick(32);
    const audio = await ctx.startRendering(),
      samples = audio.getChannelData(0);
    const rms = (a, b) => {
      let sum = 0;
      for (let i = a; i < b; i++) sum += samples[i] ** 2;
      return Math.sqrt(sum / (b - a));
    };
    const result = rms(16320, 17280) / rms(7200, 9600);
    engine.dispose();
    return result;
  });
  expect(ratio).toBeGreaterThan(0.95);
});

test('named sections select a start point and jump on the next audible bar without stopping tails', async ({page}) => {
  const p = fixture();
  p.arrangement = [
    {name: 'Intro', pattern: 0, bars: 4, lanes: [0]},
    {name: 'Main', pattern: 1, bars: 4, lanes: [0]},
    {name: 'Final', pattern: 2, bars: 4, lanes: [0]},
  ];
  await open(page, p);
  await clock(page);
  await page.locator('#groove-arrangement button').filter({hasText: 'Main'}).click();
  await expect(page.locator('#groove-song')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await advance(page, 0.5);
  await expect(page.locator('#groove-section')).toHaveText('Main · bar 1/4');
  expect(await page.evaluate(() => __clock.events[0].note)).toBe(48);
  const stops = await page.evaluate(() => __clock.stops);
  await page.locator('#groove-arrangement button').filter({hasText: 'Final'}).click();
  await advance(page, 2.1);
  expect(await page.evaluate(() => __clock.events.find(e => e.note === 60)?.time)).toBeCloseTo(2.25, 7);
  await expect(page.locator('#groove-section')).toContainText('Main · bar 1/4');
  // Retarget even after the first destination has entered the audio lookahead.
  await page.locator('#groove-arrangement button').filter({hasText: 'Intro'}).click();
  await advance(page, 2.3);
  await expect(page.locator('#groove-section')).toHaveText('Intro · bar 1/4');
  expect(await page.evaluate(() => __clock.events.some(e => e.note === 60))).toBe(false);
  expect(await page.evaluate(() => __clock.events.find(e => e.note === 36)?.time)).toBeCloseTo(2.25, 7);
  expect(await page.evaluate(() => __clock.stops)).toBe(stops);
});

test('return to start clears a selected song offset and a pending section jump', async ({page}) => {
  const p = fixture();
  p.arrangement = [
    {name: 'Intro', pattern: 0, bars: 4, lanes: [0]},
    {name: 'Main', pattern: 1, bars: 4, lanes: [0]},
  ];
  await open(page, p);
  await clock(page);
  await page.locator('#groove-arrangement button').filter({hasText: 'Main'}).click();
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await advance(page, 0.5);
  await page.locator('#groove-arrangement button').filter({hasText: 'Main'}).click();
  await page.locator('#transport-start').click();
  await advance(page, 0.7);
  await expect(page.locator('#groove-section')).toHaveText('Intro · bar 1/4');
  expect(await page.evaluate(() => __clock.events[0].note)).toBe(36);
});
