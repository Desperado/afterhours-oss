'use strict';
/* End-to-end MPK mini Plus II scenarios, played on the emulated controller as a person would.
   Each test reads like a user story: physical presses in, display, lights and music out. */
const {test, expect} = require('@playwright/test');
const {MPK} = require('./helpers/mpk-emulator');

let mpk;
test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  mpk = await MPK.install(page);
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.locator('#performance-toggle').click();
});

const app = {
  selected: page => page.evaluate(() => AfterhoursGrooveApp.S.selected),
  running: page => page.evaluate(() => AfterhoursGrooveLive.clock().running),
  title: page => page.evaluate(() => AfterhoursGrooveApp.S.data.title),
  steps: (page, lane) =>
    page.evaluate(
      lane =>
        AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[lane].steps.filter(s => s.on)
          .length,
      lane,
    ),
  recording: page => page.evaluate(() => AfterhoursPerformanceStudio.recording),
  midi: page => page.evaluate(() => AfterhoursPerformance.store.state.midi),
};
async function connect(page) {
  await page.locator('#performance-midi-native').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
}
async function playing(page) {
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
}

test('plugging in: the display, transport light and track pads come up in DAW mode', async ({page}) => {
  await mpk.expectScreen(['Preset:DAW']);
  await connect(page);
  const track = (await app.selected(page)) + 1;
  await mpk.expectScreen([
    await app.title(page),
    undefined,
    new RegExp(`^STOP \\d+ T${String(track).padStart(2, '0')} B1$`),
  ]);
  // The selected track's pad is yellow; the others show their track colours.
  await expect.poll(async () => (await mpk.light(`A${track}`)).color).toBe(13);
  await expect.poll(async () => (await mpk.light(track === 1 ? 'A2' : 'A1')).color).toBeGreaterThan(0);
  await playing(page);
  await mpk.expectScreen([undefined, undefined, /^PLAY /]);
  await expect.poll(async () => (await mpk.light('play')).animation).toBe(6);
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(false);
  await mpk.expectScreen([undefined, undefined, /^STOP /]);
});

test('build a song from scratch using only the controller after New song', async ({page}) => {
  await connect(page);
  await page.locator('#song-new').click();
  // SHIFT + PAD BANK cycles the pad mode: drums → beat.
  await mpk.press('pad-bank', {shift: true});
  await expect.poll(async () => (await app.midi(page)).padMode).toBe('beat');
  await playing(page);
  // Kick on A1, snare on A2, twice each.
  for (const pad of ['A1', 'A2', 'A1', 'A2']) {
    await mpk.pad(pad, {velocity: 110});
    await page.waitForTimeout(120);
  }
  await expect.poll(() => app.steps(page, 0)).toBeGreaterThan(0);
  await expect.poll(() => app.steps(page, 1)).toBeGreaterThan(0);
  // Hold the encoder and strike pad 5 to choose the bass track.
  await mpk.holdEncoder(() => mpk.pad(5));
  expect(await app.selected(page)).toBe(4);
  await mpk.expectScreen([undefined, /^T05 /]);
  // SHIFT + Record arms the keys; the display says KEYS and Record lights steadily.
  await mpk.press('record', {shift: true});
  await mpk.expectScreen([undefined, undefined, /^KEYS /]);
  // The keys now play the bass track's sound; the display names it rather than "undefined".
  // (The track name shown on selection fades after two seconds.)
  await expect.poll(async () => (await mpk.screen())[1]).not.toMatch(/^T\d\d /);
  expect((await mpk.screen())[1]).toMatch(/^(?!undefined$)\S/);
  expect(await app.recording(page)).toBe(false);
  for (const note of [36, 39, 43]) await mpk.playKey(note, {ms: 260});
  await expect.poll(() => app.steps(page, 4)).toBeGreaterThan(0);
  const bass = await app.steps(page, 4);
  // UNDO removes the bass pass only; SHIFT + UNDO brings it back.
  await mpk.press('undo');
  await expect.poll(() => app.steps(page, 4)).toBe(0);
  expect(await app.steps(page, 0)).toBeGreaterThan(0);
  await mpk.press('undo', {shift: true});
  await expect.poll(() => app.steps(page, 4)).toBe(bass);
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(false);
});

test('SHIFT + pad opens the firmware menu without changing the track, and SHIFT + the same pad closes it', async ({
  page,
}) => {
  await connect(page);
  const before = await app.selected(page);
  await mpk.pad(7, {shift: true});
  await mpk.expectScreen(['Chord Type']);
  expect(await app.selected(page)).toBe(before);
  // Inside the menu, the encoder belongs to the firmware: the instrument does not change.
  const instrument = await page.evaluate(() => AfterhoursSynth.snapshot().id);
  await mpk.turnEncoder(2);
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe(instrument);
  await mpk.pad(7, {shift: true});
  // Afterhours takes the screen back after the firmware closes its menu.
  await mpk.expectScreen([await app.title(page), undefined, /^STOP /]);
  expect(await app.selected(page)).toBe(before);
});

test('PLUGIN/DAW leaves DAW mode safely and pressing it again reconnects by itself', async ({page}) => {
  await connect(page);
  await mpk.press('plugin-daw');
  await expect(page.locator('#performance-midi-hardware')).toContainText('PLUGIN/DAW');
  await mpk.expectScreen(['Preset:Plugin']);
  // Plugin-mode controls go to the Plugin port, which Afterhours ignores.
  const macros = await page.evaluate(() => AfterhoursPerformance.store.state.macros.join());
  await mpk.press('play');
  await mpk.turnKnob(1, 10);
  expect(await app.running(page)).toBe(false);
  expect(await page.evaluate(() => AfterhoursPerformance.store.state.macros.join())).toBe(macros);
  await mpk.press('plugin-daw');
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
  await mpk.expectScreen([await app.title(page), undefined, /^STOP /]);
});

test('BANK buttons page the eight knobs; knobs change the shown parameter and SHIFT makes it finer', async ({page}) => {
  await connect(page);
  await mpk.press('bank+');
  await expect.poll(async () => (await app.midi(page)).knobBank).toBe('macros');
  await mpk.expectScreen([undefined, 'Macros']);
  await mpk.turnKnob(1, 10);
  const coarse = await page.evaluate(() => AfterhoursPerformance.store.state.macros[0]);
  expect(coarse).toBeGreaterThan(0);
  await mpk.expectScreen([undefined, /^1 /]);
  await mpk.holdShift(() => mpk.turnKnob(1, 10));
  const fine = (await page.evaluate(() => AfterhoursPerformance.store.state.macros[0])) - coarse;
  expect(fine).toBeGreaterThan(0);
  expect(fine).toBeLessThan(coarse);
  await mpk.press('bank-');
  await expect.poll(async () => (await app.midi(page)).knobBank).toBe('synth');
});

test('the central encoder changes my instrument; SHIFT + encoder changes the pattern', async ({page}) => {
  await connect(page);
  const instrument = await page.evaluate(() => AfterhoursSynth.snapshot().id);
  await mpk.turnEncoder(1);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.snapshot().id)).not.toBe(instrument);
  await mpk.turnEncoder(-1);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe(instrument);
  const pattern = await page.evaluate(() => AfterhoursGrooveApp.S.data.active);
  await mpk.holdShift(() => mpk.turnEncoder(1));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.data.active)).not.toBe(pattern);
});

test('SHIFT + BANK browses songs on the display; Play loads and starts the chosen one', async ({page}) => {
  await connect(page);
  const before = await app.title(page);
  await mpk.press('bank+', {shift: true});
  await mpk.expectScreen([/^> /, 'Play = load song']);
  expect(await app.title(page)).toBe(before);
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(true);
  expect(await app.title(page)).not.toBe(before);
  await mpk.expectScreen([await app.title(page)]);
});

test('Record captures a take; Play/Stop during playback stops the song and saves the take', async ({page}) => {
  await connect(page);
  await mpk.press('record');
  await expect.poll(() => app.recording(page)).toBe(true);
  await mpk.expectScreen([undefined, undefined, /^REC /]);
  await expect.poll(() => mpk.light('record')).toEqual({color: 127, animation: 9});
  await playing(page);
  await mpk.playKey(60, {ms: 200});
  await mpk.press('play');
  await expect.poll(() => app.recording(page)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  await expect.poll(async () => (await mpk.light('record')).color).toBe(0);
});

test('pad bank B reaches tracks 9–16, both for playing and for selecting', async ({page}) => {
  await connect(page);
  await mpk.holdEncoder(() => mpk.pad('B3'));
  expect(await app.selected(page)).toBe(10);
  expect((await mpk.state()).padBank).toBe(1);
  await mpk.expectScreen([undefined, /^T11 /]);
  await page.evaluate(() => {
    window.__auditioned = [];
    const audition = AfterhoursGrooveLive.audition;
    AfterhoursGrooveLive.audition = (lane, velocity) => (__auditioned.push(lane), audition(lane, velocity));
  });
  await mpk.pad(8);
  await expect.poll(() => page.evaluate(() => __auditioned)).toEqual([15]);
});

test('jam: push the encoder, play a phrase, push again and the band is generated', async ({page}) => {
  await connect(page);
  await mpk.pushEncoder();
  await expect.poll(() => page.evaluate(() => AfterhoursJam.mode)).toBe('listening');
  for (const note of [60, 62, 64, 67]) await mpk.playKey(note, {ms: 150});
  await mpk.pushEncoder();
  await expect.poll(() => page.evaluate(() => AfterhoursJam.mode)).toBe('generated');
  await expect(page.locator('#jam-status')).toContainText('Bass, drums and harmony are ready');
  // Holding the encoder for a pad does not trigger the jam on release.
  await mpk.holdEncoder(() => mpk.pad(2));
  expect(await page.evaluate(() => AfterhoursJam.mode)).toBe('generated');
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(false);
});

test('octave buttons shift the keys; Tap Tempo sets the tempo; Loop toggles the song repeat', async ({page}) => {
  await connect(page);
  await mpk.press('oct+');
  await mpk.keyDown(60);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().map(n => n.note))).toHaveLength(1);
  const raised = (await page.evaluate(() => AfterhoursSynth.held()))[0].note;
  await mpk.keyUp(60);
  await mpk.press('oct-');
  await mpk.keyDown(60);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().map(n => n.note))).toHaveLength(1);
  expect(raised - (await page.evaluate(() => AfterhoursSynth.held()))[0].note).toBe(12);
  await mpk.keyUp(60);
  for (let i = 0; i < 4; i++) {
    await mpk.press('tap');
    await page.waitForTimeout(500);
  }
  await expect.poll(() => page.evaluate(() => Math.round(AfterhoursGrooveApp.S.data.bpm))).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() => Math.round(AfterhoursGrooveApp.S.data.bpm))).toBeLessThan(140);
  const loop = await page.evaluate(() => AfterhoursGrooveApp.S.data.continuous);
  await mpk.press('loop');
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.continuous)).toBe(!loop);
});

test('unplugging mid-song releases held notes; plugging back in restores the display', async ({page}) => {
  await connect(page);
  await mpk.keyDown(60);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().length)).toBe(1);
  await mpk.unplug();
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().length)).toBe(0);
  await expect(page.locator('#performance-midi-hardware')).toContainText('Waiting for MPK');
  await mpk.plugIn();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
  await mpk.expectScreen([await app.title(page), undefined, /^STOP /]);
});
