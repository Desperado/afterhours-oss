'use strict';
/* A recorded walkthrough of the emulated MPK, for people rather than CI.
   MPK_SHOWCASE=1 npx playwright test mpk-showcase → frames and a video in test-results/mpk-showcase/. */
const {test, expect} = require('@playwright/test');
const {MPK} = require('./helpers/mpk-emulator');
test.use({viewport: {width: 1440, height: 900}, video: {mode: 'on', size: {width: 1440, height: 900}}});
test.skip(process.env.MPK_SHOWCASE !== '1', 'Set MPK_SHOWCASE=1 to record the walkthrough.');
test('MPK walkthrough: build a song, menus, songs, takes, Plugin mode', async ({page}) => {
  test.setTimeout(120000);
  const dir = 'test-results/mpk-showcase/';
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  const mpk = await MPK.install(page, {view: true});
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  const shot = name => page.locator('#mpk-view').screenshot({path: dir + name + '.png'});
  const pause = ms => page.waitForTimeout(ms);
  await pause(600);
  await shot('01-unplugged-firmware');
  await page.locator('#performance-midi-native').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
  await pause(900);
  await shot('02-connected');
  await page.locator('#song-new').click();
  await mpk.press('pad-bank', {shift: true});
  await mpk.press('play');
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  for (const pad of ['A1', 'A3', 'A2', 'A3', 'A1', 'A3', 'A2', 'A3']) {
    await mpk.pad(pad, {velocity: 110});
    await pause(240);
  }
  await shot('03-beat-pads-playing');
  await mpk.holdEncoder(async () => {
    await pause(500);
    await shot('04-encoder-held');
    await mpk.pad(5);
  });
  await pause(500);
  await mpk.press('record', {shift: true});
  await mpk.keyDown(48);
  await pause(350);
  await shot('05-recording-keys');
  await mpk.keyUp(48);
  for (const note of [51, 55, 53]) await mpk.playKey(note, {ms: 300});
  await pause(500);
  await mpk.holdShift(async () => {
    await pause(400);
    await shot('06-shift-held-pad-labels');
  });
  await mpk.pad(7, {shift: true});
  await pause(700);
  await shot('07-firmware-chord-type-menu');
  await mpk.pad(7, {shift: true});
  await pause(700);
  await mpk.press('bank+', {shift: true});
  await pause(800);
  await shot('08-song-browse');
  await mpk.press('play');
  await pause(600);
  await mpk.press('record');
  await pause(900);
  await shot('09-take-recording');
  await mpk.press('play');
  await pause(900);
  await mpk.press('plugin-daw');
  await pause(900);
  await shot('10-plugin-mode');
  await mpk.press('plugin-daw');
  await pause(1200);
  await shot('11-back-to-daw');
  await page.screenshot({path: dir + 'full-app.png'});
});
