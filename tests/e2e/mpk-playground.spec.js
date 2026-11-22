'use strict';
/* Afterhours with the emulated MPK connected and drawn, to play by hand: click pads, keys and buttons;
   scroll on knobs and the encoder. Run with npm run play:mpk; close the window to finish. */
const {test, expect} = require('@playwright/test');

test.skip(process.env.MPK_PLAYGROUND !== '1', 'Run with npm run play:mpk.');
test('MPK playground', async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.locator('#performance-midi-emulator').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
  await page.waitForEvent('close', {timeout: 0});
});
