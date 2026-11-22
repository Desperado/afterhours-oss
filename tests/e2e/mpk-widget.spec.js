'use strict';
const {test, expect} = require('@playwright/test');
const {MPK} = require('./helpers/mpk-emulator');

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

test('USB Play/Stop stops the track while the MPK widget owns the instrument input', async ({page}) => {
  const mpk = await MPK.install(page);
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.locator('#performance-midi-native').click();
  await mpk.press('play');
  await mpk.expectScreen([undefined, undefined, /^PLAY /]);
  await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter()?.peak)).toBeGreaterThan(-36);
  await page.locator('#perf-midi summary').click();
  await page.locator('#performance-midi-input').selectOption('mpk-midi');
  await page.getByRole('button', {name: 'Open MPK emulator'}).click();
  const widget = page.getByRole('region', {name: 'MPK mini Plus II emulator'});
  await expect(widget.locator('.screen')).toContainText('PLAY');
  await mpk.keyDown(60);
  expect(await heldNotes(page)).toEqual([]);
  await mpk.keyUp(60);

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    widget.getByRole('button', {name: 'Open in separate window'}).click(),
  ]);
  await mpk.press('play');
  await expect(popup.locator('.screen')).toContainText('STOP');
  await mpk.expectScreen([undefined, undefined, /^STOP /]);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  const peakAfterStop = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
    let peak = -120;
    for (let i = 0; i < 30; i++) {
      peak = Math.max(peak, AfterhoursAudio.meter().peak);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return peak;
  });
  expect(peakAfterStop).toBeLessThan(-80);
  await popup.close();
});

test('the emulator clock menu applies External and clears scheduled ticks on MIDI Stop', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'MPK emulator', exact: true}).click();
  const widget = page.getByRole('region', {name: 'MPK mini Plus II emulator'});
  const shift = widget.getByRole('button', {name: 'SHIFT', exact: true});
  const arp = widget.getByRole('button', {name: 'ARP', exact: true});
  const encoder = widget.getByRole('button', {name: 'Central encoder', exact: true});
  await shift.click();
  await arp.click();
  await expect(widget.locator('.screen')).toContainText('Clock: Internal');
  await encoder.press('ArrowUp');
  await expect(widget.locator('.screen')).toContainText('Clock: External');
  await encoder.click();
  await expect(widget.locator('.screen')).toContainText('STOP');
  await arp.click();
  await expect(widget.locator('.screen')).toContainText('Clock: External');

  const result = await page.evaluate(async () => {
    const mpk = createAfterhoursMPKEmulator();
    const input = mpk.access.inputs.get('mpk-midi');
    const out = mpk.access.outputs.get('mpk-midi-out');
    const notes = [];
    input.onmidimessage = ({data}) => notes.push([...data]);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    mpk.arpClock('external');
    mpk.button('arp');
    mpk.button('chords');
    mpk.keyDown(60);
    mpk.keyDown(67);
    mpk.keyUp(60);
    const pitches = mpk.state.arpNotes;
    for (let i = 0; i < 12; i++) out.send([0xf8]);
    await wait(50);
    const play = notes.splice(0);
    for (let i = 0; i < 12; i++) out.send([0xf8], performance.now() + 50);
    out.clear();
    await wait(100);
    const cleared = notes.splice(0);
    for (let i = 0; i < 12; i++) out.send([0xf8], performance.now() + 50);
    out.send([0xfc]);
    await wait(100);
    const stop = notes.splice(0);
    mpk.dispose();
    return {pitches, play, cleared, stop};
  });
  expect(result).toEqual({pitches: [67, 71, 74], play: [[0x90, 67, 100]], cleared: [], stop: [[0x80, 67, 0]]});
});

test('the emulator keeps extreme octave shifts playable and shared scale notes held', async ({page}) => {
  await page.goto('/');
  const messages = await page.evaluate(() => {
    const mpk = createAfterhoursMPKEmulator();
    const notes = [];
    mpk.access.inputs.get('mpk-midi').onmidimessage = ({data}) => notes.push([...data]);
    for (let i = 0; i < 4; i++) mpk.button('oct+');
    mpk.button('chords');
    mpk.keyDown(84);
    mpk.button('oct-');
    mpk.keyUp(84);
    for (let i = 0; i < 3; i++) mpk.button('oct-');
    mpk.button('chords');
    mpk.button('scales');
    mpk.keyDown(60);
    mpk.keyDown(61);
    mpk.keyUp(60);
    mpk.keyUp(61);
    mpk.dispose();
    return notes;
  });
  expect(messages).toEqual([
    [0x90, 120, 100],
    [0x90, 124, 100],
    [0x90, 127, 100],
    [0x80, 120, 0],
    [0x80, 124, 0],
    [0x80, 127, 0],
    [0x90, 60, 100],
    [0x80, 60, 0],
  ]);
});

test('keyboard and assistive MPK presses play even when audio preparation is slow', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'MPK emulator', exact: true}).click();
  const widget = page.getByRole('region', {name: 'MPK mini Plus II emulator'});
  await page.evaluate(() => {
    AfterhoursPerformance.store.update(state => {
      state.midi.padMode = 'notes';
    }, 'midi-profile');
    window.playedNotes = [];
    const event = AfterhoursPerformance.event;
    AfterhoursPerformance.event = (type, value) => {
      if (type === 'noteOn') window.playedNotes.push(value.note);
      event(type, value);
    };
  });
  const played = () => page.evaluate(() => window.playedNotes);
  const key = widget.getByRole('button', {name: 'C4', exact: true});
  const pad = widget.getByRole('button', {name: 'Pad A1', exact: true});
  for (const [pitch, activate] of [
    [60, () => key.press('Enter')],
    [36, () => pad.dispatchEvent('click', {detail: 0})],
  ]) {
    await page.evaluate(() => {
      const audio = AfterhoursAudio.context();
      const resume = audio.resume;
      const gate = new Promise(resolve => {
        window.finishAudioPreparation = () => {
          audio.resume = resume;
          resolve();
        };
      });
      audio.resume = () => gate.then(() => resume.call(audio));
    });
    await activate();
    await page.waitForTimeout(220);
    expect(await heldNotes(page)).toEqual([pitch]);
    expect(await played()).not.toContain(pitch);
    await page.evaluate(() => window.finishAudioPreparation());
    await expect.poll(played).toContain(pitch);
    await expect.poll(() => heldNotes(page)).toEqual([]);
  }
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

  await widget.getByRole('button', {name: 'Sustain', exact: true}).click();
  await widget.getByRole('button', {name: 'C4', exact: true}).press('Space');
  await expect.poll(() => heldNotes(page)).toHaveLength(1);
  const secondPopup = await detach();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await secondPopup.getByRole('button', {name: 'D4', exact: true}).press('Enter');
  await expect.poll(() => heldNotes(page)).toEqual([60, 62]);
  await secondPopup.close();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => heldNotes(page)).toEqual([]);
});
