'use strict';
/* Long, realistic MPK sessions that combine features the way a player does, to find bugs between them.
   Every session also fails on any page error or console error. */
const {test, expect} = require('@playwright/test');
const {MPK} = require('./helpers/mpk-emulator');

let mpk, problems;
test.beforeEach(async ({page}) => {
  problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && problems.push('console: ' + m.text()));
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  mpk = await MPK.install(page);
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.locator('#performance-midi-native').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
});
test.afterEach(() => expect(problems).toEqual([]));

const S = page => page.evaluate(() => AfterhoursGrooveApp.S);
const live = {
  running: page => page.evaluate(() => AfterhoursGrooveLive.clock().running),
  ready: page => page.evaluate(() => AfterhoursGrooveLive.clock().ready),
  title: page => page.evaluate(() => AfterhoursGrooveApp.S.data.title),
  selected: page => page.evaluate(() => AfterhoursGrooveApp.S.selected),
  pattern: page => page.evaluate(() => AfterhoursGrooveApp.S.data.active),
  steps: (page, lane, pattern) =>
    page.evaluate(
      ([lane, pattern]) =>
        AfterhoursGrooveApp.S.data.patterns[pattern ?? AfterhoursGrooveApp.S.data.active].tracks[lane].steps
          .map((s, i) => (s.on ? i : -1))
          .filter(i => i >= 0),
      [lane, pattern],
    ),
  held: page => page.evaluate(() => AfterhoursSynth.held().map(n => n.note)),
  synth: page => page.evaluate(() => AfterhoursSynth.snapshot()),
  recording: page => page.evaluate(() => AfterhoursPerformanceStudio.recording),
  midi: page => page.evaluate(() => AfterhoursPerformance.store.state.midi),
};
async function play(page) {
  await mpk.press('play');
  await expect.poll(() => live.running(page)).toBe(true);
  await expect.poll(() => live.ready(page)).toBe(true);
}
async function stop(page) {
  await mpk.press('play');
  await expect.poll(() => live.running(page)).toBe(false);
}
async function newSongInBeatMode(page) {
  await page.locator('#song-new').click();
  await expect.poll(() => live.title(page)).toBe('New song');
  if ((await live.midi(page)).padMode !== 'beat') await mpk.press('pad-bank', {shift: true});
  await expect.poll(async () => (await live.midi(page)).padMode).toBe('beat');
}

test('a whole song on the device: drums, bass, chords on two patterns, then replay and save', async ({page}) => {
  await newSongInBeatMode(page);
  await play(page);
  // Pattern A: four-on-the-floor kick and a snare backbeat, played over two loops.
  for (let i = 0; i < 8; i++) {
    await mpk.pad('A1', {velocity: 120});
    if (i % 2) await mpk.pad('A2', {velocity: 100});
    await page.waitForTimeout(140);
  }
  const kicks = (await live.steps(page, 0)).length;
  expect(kicks).toBeGreaterThan(2);
  // Bass on track 5 with the keys.
  await mpk.holdEncoder(() => mpk.pad(5));
  await mpk.press('record', {shift: true});
  for (const note of [40, 40, 43, 45]) await mpk.playKey(note, {ms: 180});
  await mpk.press('record', {shift: true}); // disarm
  const bass = await live.steps(page, 4);
  expect(bass.length).toBeGreaterThan(0);
  // SHIFT + encoder → pattern B; record a different bass there while playing.
  const a = await live.pattern(page);
  await mpk.holdShift(() => mpk.turnEncoder(1));
  await expect.poll(() => live.pattern(page)).not.toBe(a);
  const b = await live.pattern(page);
  // Pattern changes are queued to the next bar; wait for it to be heard, then record.
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.playing), {timeout: 8000}).toBe(b);
  await mpk.press('record', {shift: true});
  await mpk.playKey(47, {ms: 200});
  await mpk.press('record', {shift: true});
  expect((await live.steps(page, 4, b)).length).toBeGreaterThan(0);
  // Pattern A kept its own bass.
  expect(await live.steps(page, 4, a)).toEqual(bass);
  await stop(page);
  // Save downloads the project JSON with everything we played.
  const download = page.waitForEvent('download');
  await page.locator('#song-save').click();
  const saved = JSON.parse(await (await (await download).createReadStream()).toArray().then(c => Buffer.concat(c)));
  // Saved files store untouched steps as null; reloading the file must restore the same notes.
  expect(saved.patterns[a].tracks[0].steps.filter(s => s?.on).length).toBe(kicks);
  const reloaded = await page.evaluate(project => {
    const p = AfterhoursGroove.validate(project);
    return p.patterns.map(pattern => pattern.tracks[4].steps.filter(s => s.on).length);
  }, saved);
  expect(reloaded[a]).toBe(bass.length);
});

test('performing over a loaded song: take with knob moves, pattern change and a song switch', async ({page}) => {
  await play(page);
  await mpk.press('record');
  await expect.poll(() => live.recording(page)).toBe(true);
  // Shape the live synth and play a phrase over the song.
  await mpk.turnKnob(1, 20);
  for (const note of [60, 63, 67]) await mpk.playKey(note, {ms: 150});
  await mpk.holdShift(() => mpk.turnEncoder(1));
  await page.waitForTimeout(300);
  // Choose the next song while recording, then Play/Stop: it must stop, save the take and load the song.
  const before = await live.title(page);
  await mpk.press('bank+', {shift: true});
  await mpk.press('play');
  await expect.poll(() => live.recording(page)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  await expect.poll(() => live.title(page)).not.toBe(before);
  await expect.poll(() => live.running(page)).toBe(true);
  const take = await page.evaluate(() => AfterhoursPerformanceStudio.take);
  expect(take.events.map(e => e.type)).toEqual(expect.arrayContaining(['noteOn', 'pattern']));
  await stop(page);
});

test('switching to Plugin mode with keys held and a take recording, then back', async ({page}) => {
  await play(page);
  await mpk.press('record');
  await expect.poll(() => live.recording(page)).toBe(true);
  await mpk.keyDown(60);
  await mpk.keyDown(64);
  await expect.poll(() => live.held(page)).toHaveLength(2);
  await mpk.press('plugin-daw');
  await expect(page.locator('#performance-midi-hardware')).toContainText('PLUGIN/DAW');
  // Keys still play through the MIDI port in Plugin mode; releasing them must release the notes.
  await mpk.keyUp(60);
  await mpk.keyUp(64);
  await expect.poll(() => live.held(page)).toEqual([]);
  // DAW-port buttons are gone in Plugin mode; the take keeps recording until we come back.
  expect(await live.recording(page)).toBe(true);
  await mpk.press('plugin-daw');
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
  await mpk.expectScreen([undefined, undefined, /^REC /]);
  await mpk.press('record');
  await expect.poll(() => live.recording(page)).toBe(false);
  await stop(page);
});

test('unplugging the MPK while recording keys with a held note keeps the note length played', async ({page}) => {
  await newSongInBeatMode(page);
  await play(page);
  await mpk.holdEncoder(() => mpk.pad(5));
  await mpk.press('record', {shift: true});
  await mpk.keyDown(48);
  await expect.poll(async () => (await live.steps(page, 4)).length).toBe(1);
  await page.waitForTimeout(500);
  await mpk.unplug();
  await expect.poll(() => live.held(page)).toEqual([]);
  const gate = await page.evaluate(() => {
    const steps = AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[4].steps;
    return steps.find(s => s.on).gate;
  });
  // ~0.5 s at 93 BPM is about three 1/16 steps; the provisional 0.7 would mean the release was lost.
  expect(gate).toBeGreaterThan(1.5);
  await mpk.plugIn();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
});

test('octave change while a key is held releases the note that was actually played', async ({page}) => {
  await mpk.keyDown(60);
  await expect.poll(() => live.held(page)).toHaveLength(1);
  await mpk.press('oct+');
  await mpk.keyUp(60);
  await expect.poll(() => live.held(page)).toEqual([]);
});

test('every pad mode in turn from SHIFT + PAD BANK does what the pads say', async ({page}) => {
  const modes = [];
  for (let i = 0; i < 5; i++) {
    modes.push((await live.midi(page)).padMode);
    await mpk.press('pad-bank', {shift: true});
  }
  expect(modes).toEqual(['drums', 'beat', 'scenes', 'mute', 'notes']);
  expect((await live.midi(page)).padMode).toBe('drums');
  // Notes mode: pads play Synth notes, and leaving the mode releases them.
  for (let i = 0; i < 4; i++) await mpk.press('pad-bank', {shift: true});
  expect((await live.midi(page)).padMode).toBe('notes');
  const note = await page.evaluate(() => window.__mpk.padDown(1, 90));
  await expect.poll(() => live.held(page)).toHaveLength(1);
  await mpk.press('pad-bank', {shift: true});
  await expect.poll(() => live.held(page)).toEqual([]);
  await page.evaluate(note => window.__mpk.padUp(note), note);
  // Mute mode: pad 3 mutes and unmutes track 3, and the pad light shows it.
  await mpk.press('pad-bank', {shift: true});
  await mpk.press('pad-bank', {shift: true});
  await mpk.press('pad-bank', {shift: true});
  expect((await live.midi(page)).padMode).toBe('mute');
  await mpk.pad(3);
  await expect.poll(() => page.evaluate(() => AfterhoursPerformance.store.state.mixer.lanes[2].mute)).toBe(true);
  await expect.poll(async () => (await mpk.light('A3')).color).toBe(5);
  await mpk.pad(3);
  await expect.poll(() => page.evaluate(() => AfterhoursPerformance.store.state.mixer.lanes[2].mute)).toBe(false);
});

test('jam, then add drums on the generated band with beat pads, undo them and restore the old project', async ({
  page,
}) => {
  const original = await live.title(page);
  await mpk.pushEncoder();
  for (const note of [57, 60, 64, 62]) await mpk.playKey(note, {ms: 160});
  await mpk.pushEncoder();
  await expect.poll(() => page.evaluate(() => AfterhoursJam.mode)).toBe('generated');
  await expect.poll(() => live.running(page)).toBe(true);
  await expect.poll(() => live.ready(page)).toBe(true);
  if ((await live.midi(page)).padMode !== 'beat') await mpk.press('pad-bank', {shift: true});
  const before = await live.steps(page, 3);
  for (let i = 0; i < 4; i++) {
    await mpk.pad('A4', {velocity: 90});
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await live.steps(page, 3)).length).toBeGreaterThan(before.length);
  await mpk.press('undo');
  await expect.poll(() => live.steps(page, 3)).toEqual(before);
  await stop(page);
  await page.locator('#jam-restore').click();
  await expect.poll(() => live.title(page)).toBe(original);
});

test('turning the encoder while recording keys keeps hearing and recording the same track', async ({page}) => {
  await newSongInBeatMode(page);
  await play(page);
  await mpk.holdEncoder(() => mpk.pad(5));
  await mpk.press('record', {shift: true});
  const heard = await live.synth(page);
  expect([heard.family, heard.lane]).toEqual(['groove', 4]);
  // A player reaches for the encoder by habit: the sound must stay that of track 5, and the display says why.
  await mpk.turnEncoder(1);
  await mpk.expectScreen([undefined, 'Keys rec T05']);
  await mpk.playKey(50, {ms: 150});
  await expect.poll(async () => (await live.steps(page, 4)).length).toBe(1);
  const now = await live.synth(page);
  // What is heard while recording keys should be the track being recorded.
  expect([now.family, now.lane]).toEqual(['groove', 4]);
});

test('Ukrainian interface: the MPK display transliterates names and stays within 20 characters', async ({page}) => {
  await page.evaluate(() => localStorage.setItem('afterhours-lang', 'uk'));
  await page.reload();
  await page.locator('#performance-toggle').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK');
  await page.locator('#song-new').click();
  await expect.poll(async () => (await mpk.screen())[0]).toBe('Nova pisnya');
  for (const line of await mpk.screen()) {
    expect(line.length).toBeLessThanOrEqual(20);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
  }
});

test('tap tempo while playing updates the MPK display and the arp on external clock follows', async ({page}) => {
  await page.getByText('USB MIDI + MIDI Learn').click();
  await page.locator('#performance-midi-clock').selectOption({label: 'MPK mini Plus II MIDI Port'});
  await play(page);
  for (let i = 0; i < 5; i++) {
    await mpk.press('tap');
    await page.waitForTimeout(400);
  }
  // Taps 400 ms apart (plus a little test overhead) are about 150 BPM.
  await expect.poll(() => page.evaluate(() => Math.round(AfterhoursGrooveApp.S.data.bpm))).toBeGreaterThan(140);
  const bpm = await page.evaluate(() => Math.round(AfterhoursGrooveApp.S.data.bpm));
  await mpk.expectScreen([undefined, undefined, new RegExp(`^PLAY ${bpm} `)]);
  const pulses = (await mpk.state()).clock;
  await page.waitForTimeout(1000);
  // About 150 BPM = 2.5 beats/s = 60 pulses/s at 24 PPQN.
  expect((await mpk.state()).clock - pulses).toBeGreaterThan(45);
  await stop(page);
});

test('double-pressing Record quickly starts and then stops the take', async ({page}) => {
  await page.evaluate(() => {
    window.__mpk.button('record');
    window.__mpk.button('record');
  });
  await page.waitForTimeout(800);
  expect(await live.recording(page)).toBe(false);
  // The quick start/stop still saves a (short) take.
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
});

test('double-pressing Play/Stop quickly while samples load leaves Groove stopped', async ({page}) => {
  await page.evaluate(() => {
    window.__mpk.button('play');
    window.__mpk.button('play');
  });
  await page.waitForTimeout(1500);
  expect(await live.running(page)).toBe(false);
  await play(page);
  await stop(page);
});

test('UNDO removes only the latest playback pass of pads; earlier passes stay', async ({page}) => {
  await newSongInBeatMode(page);
  await play(page);
  await mpk.pad('A1');
  await expect.poll(async () => (await live.steps(page, 0)).length).toBe(1);
  const first = await live.steps(page, 0);
  await stop(page);
  await play(page);
  await page.waitForTimeout(500);
  await mpk.pad('A1');
  await expect.poll(async () => (await live.steps(page, 0)).length).toBe(2);
  await mpk.press('undo');
  await expect.poll(() => live.steps(page, 0)).toEqual(first);
  await mpk.press('undo');
  await expect.poll(() => live.steps(page, 0)).toEqual([]);
  // A third UNDO has no recording left; it must not throw or undo the new song itself.
  await mpk.press('undo');
  expect(await live.title(page)).toBe('New song');
  await stop(page);
});

test('track-sound knobs while recording keys change both the recorded track and what is heard', async ({page}) => {
  await newSongInBeatMode(page);
  await mpk.holdEncoder(() => mpk.pad(5));
  await mpk.press('record', {shift: true});
  await page.locator('#performance-midi-track-sound').click();
  await mpk.turnKnob(1, 15);
  const track = await page.evaluate(
    () => AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[4].cutoff,
  );
  await expect.poll(async () => (await live.synth(page)).track.cutoff).toBe(track);
  await mpk.expectScreen([undefined, /^1 /]);
});

test('scene pads with no saved scenes, and mixer level knobs, are safe and visible', async ({page}) => {
  // SHIFT + PAD BANK: drums → beat → scenes.
  await mpk.press('pad-bank', {shift: true});
  await mpk.press('pad-bank', {shift: true});
  expect((await live.midi(page)).padMode).toBe('scenes');
  for (let pad = 1; pad <= 8; pad++) await mpk.pad(pad);
  // Bank B in scenes mode mutes lanes 1–8.
  await mpk.pad('B2');
  await expect.poll(() => page.evaluate(() => AfterhoursPerformance.store.state.mixer.lanes[1].mute)).toBe(true);
  await mpk.pad('B2');
  // BANK + twice: Macros → Levels 1–8; knob 3 lowers lane 3.
  await mpk.press('bank+');
  await mpk.press('bank+');
  expect((await live.midi(page)).knobBank).toBe('mixer-a');
  const level = await page.evaluate(() => AfterhoursPerformance.store.state.mixer.lanes[2].level);
  await mpk.turnKnob(3, -10);
  await expect
    .poll(() => page.evaluate(() => AfterhoursPerformance.store.state.mixer.lanes[2].level))
    .toBeLessThan(level);
  await mpk.expectScreen([undefined, /^3 /]);
  // BANK − from the first bank wraps to the last one.
  await mpk.press('bank-');
  await mpk.press('bank-');
  await mpk.press('bank-');
  expect((await live.midi(page)).knobBank).toBe('synth-extra');
});

test('browsing many songs quickly and pressing Play loads exactly the one on the display', async ({page}) => {
  for (let i = 0; i < 7; i++) await mpk.press('bank+', {shift: true});
  await mpk.press('bank-', {shift: true});
  await expect.poll(async () => (await mpk.screen())[0]).toMatch(/^> /);
  const shown = (await mpk.screen())[0].replace(/^> /, '');
  await mpk.press('play');
  await expect.poll(() => live.running(page)).toBe(true);
  // The display transliterates and trims to 20 characters.
  expect((await live.title(page)).slice(0, 20).trim()).toBe(shown);
  await stop(page);
});

test('recording pads and keys over a loaded song in Song mode writes into the section being heard', async ({page}) => {
  if ((await live.midi(page)).padMode !== 'beat') await mpk.press('pad-bank', {shift: true});
  await play(page);
  await page.waitForTimeout(400);
  const heard = await page.evaluate(() => AfterhoursGrooveLive.clock().ready && AfterhoursGrooveApp.S.playing);
  const before = await live.steps(page, 2, heard);
  await mpk.pad('A3', {velocity: 127});
  await expect.poll(async () => (await live.steps(page, 2, heard)).length).toBeGreaterThanOrEqual(before.length);
  await mpk.press('undo');
  await expect.poll(() => live.steps(page, 2, heard)).toEqual(before);
  await stop(page);
});

test('the MPK survives a reload: the profile reconnects, and a held key is released', async ({page}) => {
  await mpk.keyDown(60);
  await expect.poll(() => live.held(page)).toHaveLength(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.AfterhoursMPK?.status)).toContain('MPK connected');
  await mpk.expectScreen([await live.title(page), undefined, /^STOP /]);
  await mpk.keyUp(60);
  expect(await live.held(page)).toEqual([]);
});

test('guided learning of my own User Preset, done entirely by touching the controls it asks for', async ({page}) => {
  // SHIFT + PLUGIN/DAW: the MPK leaves DAW mode for its User Presets.
  await mpk.press('plugin-daw', {shift: true});
  await expect(page.locator('#performance-midi-hardware')).toContainText('PLUGIN/DAW');
  await page.locator('#performance-midi-auto').click();
  const instruction = page.locator('#performance-midi-instruction');
  for (let knob = 1; knob <= 8; knob++) {
    await expect(instruction).toContainText(`Turn knob ${knob}`);
    await mpk.turnKnob(knob, 5);
  }
  for (const bank of ['A', 'B']) {
    await expect(instruction).toContainText(`First select bank ${bank}`);
    if ((await mpk.state()).padBank !== (bank === 'B' ? 1 : 0)) await mpk.press('pad-bank');
    await page.locator('#performance-midi-bank-ready').click();
    for (let pad = 1; pad <= 8; pad++) {
      await expect(instruction).toContainText(`Press pad ${pad} · bank ${bank}`);
      await mpk.pad(pad);
    }
  }
  await expect(instruction).toContainText('Turn the central encoder clockwise');
  await mpk.turnEncoder(1);
  // This User Preset's transport buttons send nothing the guide can learn: skip them.
  await expect(instruction).toContainText('Play/Stop');
  await page.locator('#performance-midi-skip').click();
  await expect(instruction).toContainText('Record');
  await page.locator('#performance-midi-skip').click();
  await expect(instruction).toContainText('Done!');
  const mappings = await page.evaluate(() => AfterhoursPerformance.store.state.mappings.map(m => m.target));
  for (const target of ['mpk.knob.0', 'mpk.knob.7', 'mpk.pad.0', 'mpk.pad.15', 'mpk.instrument'])
    expect(mappings).toContain(target);
  // The learned knob 1 now moves the Live Synth filter, and learned pad B8 plays track 16.
  // Absolute knobs use pickup: the filter follows once the knob passes its current value.
  const cutoff = (await live.synth(page)).cutoff;
  await mpk.turnKnob(1, 60);
  await expect.poll(async () => (await live.synth(page)).cutoff).not.toBe(cutoff);
  await page.evaluate(() => {
    window.__auditioned = [];
    const audition = AfterhoursGrooveLive.audition;
    AfterhoursGrooveLive.audition = (lane, velocity) => (__auditioned.push(lane), audition(lane, velocity));
  });
  await mpk.pad('B8');
  await expect.poll(() => page.evaluate(() => __auditioned)).toEqual([15]);
});
