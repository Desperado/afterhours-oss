const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const {clock, advance} = require('./helpers/groove-clock');

async function oneBar(page) {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#ws-groove').click();
  await page.evaluate(() => {
    const {S, ui} = AfterhoursGrooveApp;
    S.data = AfterhoursGroove.project();
    S.data.bpm = 120;
    S.data.arrangement = [{name: 'One bar', pattern: 0, bars: 1, lanes: [0]}];
    S.songMode = true;
    ui.renderAll();
  });
}
async function looping(page) {
  await oneBar(page);
  await clock(page);
  await page.evaluate(async () => {
    AfterhoursGrooveLive.continuous(true);
    await AfterhoursGrooveLive.play();
  });
}

test('a take captured before a planned wrap resumes the audible pass without a replay error', async ({page}) => {
  await looping(page);
  await advance(page, 2.1); // First pass ends at 2.25; the lookahead has queued the next pass.
  const initial = await page.evaluate(() => {
    const groove = AfterhoursGrooveLive.snapshot();
    const take = AfterhoursPerformanceCore.take(
      JSON.parse(
        JSON.stringify({
          version: 1,
          kind: 'afterhours-performance',
          duration: 1,
          initial: {groove, synth: {id: 'forest'}},
          events: [],
        }),
      ),
      AfterhoursGroove.validate,
    );
    window.__savedGroove = take.initial.groove;
    return {groove, planned: AfterhoursGrooveApp.S.songOffset};
  });
  expect(initial.planned).toBe(-32);
  expect(initial.groove.offsetTicks).toBeCloseTo(29.6);
  expect(initial.groove.songOffset).toBe(0);
  await page.evaluate(async () => {
    AfterhoursGrooveLive.restore(__savedGroove);
    await AfterhoursGrooveLive.play();
  });
  await advance(page, 2.8);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(true);
  expect(await page.evaluate(() => __clock.events.some(e => e.tick === 32))).toBe(true);
  expect(await page.locator('#status-text').textContent()).not.toContain('Cannot read');
});

test('disabling Continuous Play cancels a queued wrap and preserves the current pass tails', async ({page}) => {
  await looping(page);
  await advance(page, 2.1);
  expect(await page.evaluate(() => __clock.events.some(e => e.tick >= 32))).toBe(true);
  const stops = await page.evaluate(() => __clock.stops);
  await page.locator('#groove-continuous').click();
  expect(await page.evaluate(() => __clock.cancelled)).toEqual([32]);
  expect(await page.evaluate(() => __clock.events.some(e => e.tick >= 32))).toBe(false);
  expect(await page.evaluate(() => __clock.events.some(e => e.tick < 32))).toBe(true);
  await advance(page, 2.4);
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(false);
  expect(await page.evaluate(() => __clock.stops)).toBe(stops);
  await expect(page.locator('#status-text')).toContainText('Song finished');
});

test('disabling after a wrap is audible finishes that pass instead of cutting it short', async ({page}) => {
  await looping(page);
  await advance(page, 2.3);
  const current = await page.evaluate(() => AfterhoursGrooveLive.snapshot());
  expect(current.offsetTicks).toBeGreaterThan(32);
  expect(current.songOffset).toBe(-32);
  await page.locator('#groove-continuous').click();
  expect(await page.evaluate(() => __clock.cancelled)).toEqual([]);
  await advance(page, 4.1);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(true);
  await advance(page, 4.4);
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(false);
  expect(await page.evaluate(() => __clock.events.some(e => e.tick >= 64))).toBe(false);
});

test('Continuous Play survives reload, project export/import and restoring a preset backup', async ({page}) => {
  await oneBar(page);
  await page.locator('#groove-continuous').click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))?.continuous))
    .toBe(true);
  await page.reload();
  await expect(page.locator('#groove-continuous')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-project').click()]);
  const bytes = fs.readFileSync(await download.path());
  expect(JSON.parse(bytes.toString()).continuous).toBe(true);
  await page.locator('#groove-continuous').click();
  await page.locator('#groove-file').setInputFiles({name: 'looping.json', mimeType: 'application/json', buffer: bytes});
  await expect(page.locator('#groove-continuous')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#groove-preset').selectOption('neon');
  await page.locator('#groove-load-preset').click();
  await expect(page.locator('#groove-continuous')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#groove-restore').click();
  await expect(page.locator('#groove-continuous')).toHaveAttribute('aria-pressed', 'true');
});

test('a take recorded after long-running playback resumes at the same song position', async ({page}) => {
  await looping(page);
  await advance(page, 2500.90625); // 40,010.5 ticks; preserves the half-tick as well as the pass offset.
  const initial = await page.evaluate(() => {
    const groove = AfterhoursGrooveLive.snapshot();
    const raw = {
      version: 1,
      kind: 'afterhours-performance',
      duration: 1,
      events: [],
      initial: {groove, synth: {id: 'forest'}},
    };
    window.__longTake = AfterhoursPerformanceCore.take(JSON.parse(JSON.stringify(raw)), AfterhoursGroove.validate);
    return {
      before: groove.offsetTicks + groove.songOffset,
      after: __longTake.initial.groove.offsetTicks + __longTake.initial.groove.songOffset,
    };
  });
  expect(initial.before).toBeCloseTo(10.5);
  expect(initial.after).toBe(initial.before);
  await page.evaluate(async () => {
    AfterhoursGrooveLive.restore(__longTake.initial.groove);
    await AfterhoursGrooveLive.play();
  });
  await advance(page, 2501.1875); // First resumed tick is 11, half a tick after the lead-in.
  const resumed = await page.evaluate(() => ({
    running: AfterhoursGrooveApp.S.running,
    tick: AfterhoursGrooveApp.transport.audibleFrame()?.tick,
  }));
  expect(resumed).toEqual({running: true, tick: 11});
});
