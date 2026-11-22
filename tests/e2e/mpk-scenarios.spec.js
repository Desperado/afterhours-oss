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

test('Record captures two takes, with Play/Stop saving the first and Record saving the second', async ({page}) => {
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

  await mpk.press('record');
  await expect.poll(() => app.recording(page)).toBe(true);
  await mpk.playKey(62, {ms: 200});
  await mpk.press('record');
  await expect.poll(() => app.recording(page)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
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
  await mpk.press('loop');
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.continuous)).toBe(loop);
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

// ── The five performance buttons, wheels and pedal: local firmware functions heard through the MIDI port.
async function listenNotes(page) {
  await page.evaluate(() => {
    window.__heard = [];
    window.addEventListener('afterhours:gesture', e => {
      if (e.detail.type === 'noteOn') __heard.push(e.detail.value.note);
      if (e.detail.type === 'expression' && e.detail.value.type === 'bend')
        __heard.push('bend:' + e.detail.value.value.toFixed(2));
    });
  });
}
const heard = page => page.evaluate(() => [...__heard]);
const heardNotes = async page => (await heard(page)).filter(n => typeof n === 'number');
const synthNotes = page =>
  page.evaluate(() =>
    AfterhoursSynth.held()
      .map(n => n.note)
      .sort((a, b) => a - b),
  );

test('CHORDS plays a triad from one key; SCALES snaps a wrong note into the scale', async ({page}) => {
  await connect(page);
  await mpk.press('chords');
  expect((await mpk.light('chords')).color).toBe(127);
  await mpk.keyDown(60);
  await expect.poll(() => synthNotes(page)).toHaveLength(3);
  const [root, third, fifth] = await synthNotes(page);
  expect([third - root, fifth - root]).toEqual([4, 7]);
  await mpk.keyUp(60);
  await expect.poll(() => synthNotes(page)).toEqual([]);
  await mpk.press('chords');
  await mpk.press('scales');
  await mpk.keyDown(61); // C♯ is outside C major
  await expect.poll(() => synthNotes(page)).toHaveLength(1);
  const snapped = (await synthNotes(page))[0];
  await mpk.keyUp(61);
  await mpk.press('scales');
  await mpk.keyDown(61);
  await expect.poll(() => synthNotes(page)).toHaveLength(1);
  expect((await synthNotes(page))[0] - snapped).toBe(1);
  await mpk.keyUp(61);
});

test('ARP plays held notes one by one; LATCH keeps it going after the keys are released', async ({page}) => {
  await connect(page);
  await listenNotes(page);
  await mpk.keyDown(60);
  await expect.poll(() => synthNotes(page)).toEqual([60]);
  await mpk.press('arp');
  await mpk.keyUp(60);
  await expect.poll(() => synthNotes(page)).toEqual([]);
  await mpk.press('latch');
  for (const note of [60, 64, 67]) await mpk.keyDown(note);
  for (const note of [60, 64, 67]) await mpk.keyUp(note);
  // Released, but latched: the arpeggio keeps cycling upwards through the chord.
  await page.evaluate(() => {
    window.__heard.length = 0;
  });
  await expect.poll(async () => (await heardNotes(page)).length, {timeout: 4000}).toBeGreaterThanOrEqual(6);
  const notes = (await heardNotes(page)).slice(0, 6);
  const chord = [60, 64, 67];
  const offset = chord.indexOf(notes[0]);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(notes).toEqual(notes.map((_, index) => chord[(offset + index) % chord.length]));
  // Turning ARP off stops it and releases the last note.
  await mpk.press('arp');
  await expect.poll(() => synthNotes(page)).toEqual([]);
  const count = (await heardNotes(page)).length;
  await page.waitForTimeout(600);
  expect((await heardNotes(page)).length).toBe(count);
});

test('ARP on external clock follows Afterhours’ MIDI clock: it runs only while Groove plays', async ({page}) => {
  await connect(page);
  await listenNotes(page);
  await page.getByText('USB MIDI + MIDI Learn').click();
  const clockOutput = page.locator('#performance-midi-clock');
  await clockOutput.selectOption({label: 'MPK mini Plus II MIDI Port'});
  await mpk.setArpClock('external');
  await mpk.press('arp');
  await mpk.press('latch');
  await mpk.keyDown(48);
  await mpk.keyDown(55);
  await mpk.keyUp(48);
  await mpk.keyUp(55);
  await page.waitForTimeout(700);
  expect(await heardNotes(page)).toEqual([]); // no clock, no steps
  await mpk.press('play');
  await expect.poll(async () => (await heardNotes(page)).length, {timeout: 5000}).toBeGreaterThanOrEqual(4);
  expect((await mpk.state()).clock).toBeGreaterThan(24);
  await mpk.press('play');
  await expect.poll(() => app.running(page)).toBe(false);
  await page.waitForTimeout(300);
  const count = (await heardNotes(page)).length;
  await page.waitForTimeout(800);
  expect((await heardNotes(page)).length).toBe(count);
});

test('NOTE REPEAT with FULL LEVEL records a held pad as a run of full-velocity steps', async ({page}) => {
  await connect(page);
  await page.locator('#song-new').click();
  await mpk.press('pad-bank', {shift: true}); // pads: beat
  await mpk.press('note-repeat');
  await mpk.press('note-repeat', {shift: true}); // Full Level
  expect((await mpk.state()).fullLevel).toBe(true);
  await playing(page);
  await mpk.holdPad('A3', 700, {velocity: 40});
  await expect.poll(() => app.steps(page, 2)).toBeGreaterThanOrEqual(4);
  const velocities = await page.evaluate(() =>
    AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[2].steps
      .filter(s => s.on)
      .map(s => s.velocity),
  );
  expect(new Set(velocities)).toEqual(new Set([127]));
  await mpk.press('play');
});

test('SHIFT + ARP opens Arp Config; PLUGIN/DAW closes it and stays in DAW mode', async ({page}) => {
  await connect(page);
  await mpk.press('arp', {shift: true});
  await mpk.expectScreen(['Arp Config']);
  expect((await mpk.state()).arp).toBe(false); // opening the config does not switch the arp on
  await mpk.press('plugin-daw');
  await mpk.expectScreen([await app.title(page), undefined, /^STOP /]);
  expect((await mpk.state()).mode).toBe('daw');
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
});

test('pitch wheel bends the playing note; the sustain pedal holds notes after the keys are released', async ({
  page,
}) => {
  await connect(page);
  await listenNotes(page);
  await mpk.keyDown(60);
  await mpk.pitchWheel(1);
  await mpk.pitchWheel(0);
  await expect.poll(() => heard(page)).toEqual(expect.arrayContaining(['bend:2.00', 'bend:0.00']));
  await mpk.keyUp(60);
  await expect.poll(() => synthNotes(page)).toEqual([]);
  await mpk.sustainPedal(true);
  await mpk.keyDown(62);
  await mpk.keyUp(62);
  await page.waitForTimeout(200);
  expect(await synthNotes(page)).toEqual([62]);
  await mpk.sustainPedal(false);
  await expect.poll(() => synthNotes(page)).toEqual([]);
});
