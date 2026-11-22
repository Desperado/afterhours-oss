'use strict';
const {test, expect} = require('@playwright/test');

const heldNotes = page => page.evaluate(() => AfterhoursSynth.held().map(note => note.note));

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.addInitScript(() => localStorage.setItem('afterhours-lang', 'en'));
});

test('the MPK widget plays Afterhours without Web MIDI and releases its notes on close', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', {value: undefined}));
  await page.goto('/');
  const profile = () =>
    page.evaluate(() => {
      const {profile, native} = AfterhoursPerformance.store.state.midi;
      return {profile, native};
    });
  const before = await profile();
  await page.locator('#performance-toggle').click();
  const open = page.getByRole('button', {name: 'Open MPK emulator'});
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const widget = page.getByRole('region', {name: 'MPK mini Plus II emulator'});
  await expect(widget.locator('.screen')).toContainText('STOP');
  await page.locator('#performance-close').click();
  await expect(widget).toBeVisible();

  const play = widget.getByRole('button', {name: 'Play / Stop'});
  await play.click();
  await expect(widget.locator('.screen')).toContainText('PLAY');
  await play.click();
  await expect(widget.locator('.screen')).toContainText('STOP');
  const hold = widget.getByRole('button', {name: 'Hold encoder'});
  await hold.click();
  await widget.getByRole('button', {name: 'Pad A3', exact: true}).click();
  await hold.click();
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.selected)).toBe(2);

  await widget.getByRole('button', {name: 'Sustain', exact: true}).click();
  await widget.getByRole('button', {name: 'C4', exact: true}).click({delay: 150});
  await expect.poll(() => heldNotes(page)).toHaveLength(1);
  await widget.getByRole('button', {name: 'Close emulator'}).click();
  await expect(widget).toHaveCount(0);
  await expect.poll(() => heldNotes(page)).toEqual([]);
  expect(await profile()).toEqual(before);
});

test('the MPK widget restores the selected USB input and keeps the hardware clock output', async ({page}) => {
  await page.addInitScript(() => {
    const port = {id: 'input', name: 'USB keys', state: 'connected'};
    const output = {id: 'clock', name: 'USB clock', state: 'connected', send() {}, clear() {}};
    const midi = {inputs: new Map([[port.id, port]]), outputs: new Map([[output.id, output]])};
    Object.defineProperty(navigator, 'requestMIDIAccess', {value: async () => midi});
    window.usbKey = (status, velocity) => port.onmidimessage?.({data: Uint8Array.of(status, 62, velocity)});
  });
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.locator('#perf-midi summary').click();
  await page.locator('#performance-midi-connect').click();
  const input = page.locator('#performance-midi-input');
  const clock = page.locator('#performance-midi-clock');
  await input.selectOption('input');
  await clock.selectOption('clock');
  const open = page.getByRole('button', {name: 'Open MPK emulator'});
  await open.click();
  await expect(input).toHaveValue('*');
  await expect(clock).toHaveValue('clock');
  await page.evaluate(() => window.usbKey(0x90, 100));
  expect(await heldNotes(page)).toEqual([]);
  await page.getByRole('button', {name: 'Close emulator'}).click();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(input).toHaveValue('input');
  await expect(clock).toHaveValue('clock');
  await page.evaluate(() => window.usbKey(0x90, 100));
  await expect.poll(() => heldNotes(page)).toHaveLength(1);
  await page.evaluate(() => window.usbKey(0x80, 0));
  await expect.poll(() => heldNotes(page)).toEqual([]);
});

test('the sidebar opens the MPK widget and its controls keep working in a separate window', async ({page}) => {
  await page.goto('/');
  const toggle = page.getByRole('button', {name: 'MPK emulator', exact: true});
  await toggle.click();
  await expect(page.locator('#performance-panel')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const widget = page.getByRole('region', {name: 'MPK mini Plus II emulator'});
  await widget.getByRole('button', {name: 'PAD BANK A/B'}).click();
  await expect(widget.getByRole('button', {name: 'Pad B1', exact: true})).toBeVisible();

  async function detach() {
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      widget.getByRole('button', {name: 'Open in separate window'}).click(),
    ]);
    await expect(widget).toHaveCount(0);
    return popup;
  }
  const popup = await detach();
  await expect(popup.getByRole('button', {name: 'Pad B1', exact: true})).toBeVisible();
  const play = popup.getByRole('button', {name: 'Play / Stop'});
  await play.click();
  await expect(popup.locator('.screen')).toContainText('PLAY');
  await Promise.all([popup.waitForEvent('close'), popup.getByRole('button', {name: 'Dock in Afterhours'}).click()]);
  await expect(widget.locator('.screen')).toContainText('PLAY');
  await widget.getByRole('button', {name: 'Play / Stop'}).click();
  await expect(widget.locator('.screen')).toContainText('STOP');

  const secondPopup = await detach();
  await secondPopup.getByRole('button', {name: 'Sustain', exact: true}).click();
  await secondPopup.getByRole('button', {name: 'C4', exact: true}).click({delay: 150});
  await expect.poll(() => heldNotes(page)).toHaveLength(1);
  await secondPopup.close();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => heldNotes(page)).toEqual([]);
});
