const {test, expect} = require('@playwright/test');
const {clock, advance} = require('./helpers/groove-clock');

async function setup(page) {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#ws-groove').click();
  await page.evaluate(() => {
    const {S, ui} = AfterhoursGrooveApp,
      G = AfterhoursGroove;
    S.data = G.project();
    S.data.bpm = 120;
    const p = S.data.patterns[0];
    p.tracks.forEach(t => t.steps.forEach(s => (s.on = false)));
    const bass = p.tracks[4],
      guitar = p.tracks[5];
    bass.name = 'Bass';
    bass.note = 28;
    guitar.name = 'Guitar chords';
    guitar.machine = 'Chord';
    guitar.chord = 'minor7';
    guitar.note = 57;
    for (const t of [bass, guitar]) Object.assign(t.steps[0], {on: true, gate: 4});
    guitar.steps[0].locks.note = 60;
    S.data.arrangement = [{name: 'Guide', pattern: 0, bars: 1, lanes: [4, 5]}];
    S.songMode = true;
    ui.renderAll();
  });
  await clock(page);
}

test('optional guide follows locked notes, gates, tuning, mixer mute and stop', async ({page}) => {
  await setup(page);
  await expect(page.locator('#groove-playalong')).toBeHidden();
  await page.locator('#groove-playalong-toggle').click();
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await advance(page, 0.35);
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Cm7');
  await expect(page.locator('#groove-guitar-diagram svg')).toHaveAttribute('aria-label', /^Cm7, low E/);
  await expect(page.locator('#groove-bass-notes')).toHaveText('E1');
  await expect(page.locator('#groove-bass-position')).toContainText('E string · fret 0');
  await page.evaluate(() => {
    __clock.engine.controller = {state: {...AfterhoursController.defaults(), enabled: true, transpose: 2}};
  });
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Dm7');
  await page.evaluate(() => {
    __clock.engine.performance = AfterhoursPerformanceCore.validate();
    __clock.engine.performance.mixer.lanes[5].mute = true;
  });
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Rest');
  await advance(page, 1);
  await expect(page.locator('#groove-bass-notes')).toHaveText('Rest');
  await page.evaluate(() => AfterhoursGrooveLive.stop());
  await expect(page.locator('#groove-guitar-diagram svg')).toHaveCount(0);
  await page.locator('#groove-guitar-source').selectOption('5');
  await page.reload();
  await expect(page.locator('#groove-playalong-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#groove-guitar-source')).toHaveValue('5');
});

test('guide respects section lane masks and queued section changes', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    const {S} = AfterhoursGrooveApp;
    S.data.arrangement.push({name: 'Bass only', pattern: 0, bars: 1, lanes: [4]});
  });
  await page.locator('#groove-playalong-toggle').click();
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await advance(page, 0.35);
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Cm7');
  await advance(page, 2.35);
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Rest');
  await expect(page.locator('#groove-bass-notes')).toHaveText('E1');
});

test('auto harmony groups split chord parts without adding the melody and follows the music fader', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    const {S} = AfterhoursGrooveApp,
      tracks = S.data.patterns[0].tracks;
    for (const [lane, name, note] of [
      [5, 'Guitar root', 55],
      [6, 'Guitar third', 58],
      [7, 'Guitar fifth', 62],
      [9, 'Violin melody', 69],
    ]) {
      Object.assign(tracks[lane], {name, machine: 'Tone', note});
      Object.assign(tracks[lane].steps[0], {on: true, gate: 4, locks: {}});
    }
    S.data.arrangement[0].lanes = [4, 5, 6, 7, 9];
  });
  await page.locator('#groove-playalong-toggle').click();
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await advance(page, 0.35);
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Gm');
  await expect(page.locator('#groove-guitar-notes')).toHaveText('G3 · B♭3 · D4');
  await page.evaluate(() => {
    __clock.engine.performance = AfterhoursPerformanceCore.validate();
    __clock.engine.performance.mixer.music = 0;
  });
  await expect(page.locator('#groove-guitar-chord')).toHaveText('Rest');
  await expect(page.locator('#groove-bass-notes')).toHaveText('Rest');
});

test('hidden playback bounds queues and finishes without animation frames', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
    document.dispatchEvent(new Event('visibilitychange'));
    AfterhoursGrooveApp.S.data.continuous = true;
    return AfterhoursGrooveLive.play();
  });
  await advance(page, 600);
  const state = await page.evaluate(() => ({
    running: AfterhoursGrooveApp.S.running,
    frames: AfterhoursGrooveApp.S.visuals.length,
    hits: AfterhoursGrooveApp.S.hits.length,
    ahead: AfterhoursGrooveApp.S.nextTime - __clock.engine.context.currentTime,
  }));
  expect(state.running).toBe(true);
  expect(state.frames).toBeLessThan(30);
  expect(state.hits).toBeLessThan(20);
  expect(state.ahead).toBeGreaterThan(0.1);
  await page.evaluate(() => AfterhoursGrooveLive.continuous(false));
  await advance(page, 603);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(false);
  await expect(page.locator('#status-text')).toContainText('Song finished');
});
