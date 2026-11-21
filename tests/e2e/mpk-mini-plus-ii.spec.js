const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.addInitScript(() => {
    const input = (id, name) => ({id, name, manufacturer: 'Akai', state: 'connected'});
    const output = (id, name) => ({
      id,
      name,
      state: 'connected',
      messages: [],
      clears: 0,
      send(data, timestamp) {
        this.messages.push({data: [...data], timestamp});
      },
      clear() {
        this.clears++;
      },
    });
    const inputs = new Map([
      ['keys', input('keys', 'MPK mini Plus II MIDI')],
      ['daw', input('daw', 'MPK mini Plus II DAW')],
      ['plugin', input('plugin', 'MPK mini Plus II Plugin')],
    ]);
    window.midiAccess = {inputs, outputs: new Map([['clock', output('clock', 'MPK mini Plus II MIDI')]])};
    Object.defineProperty(navigator, 'requestMIDIAccess', {value: async () => midiAccess});
    window.sendMIDI = (bytes, port = 'keys') => inputs.get(port).onmidimessage({data: bytes});
  });
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.getByText('USB MIDI + MIDI Learn', {exact: true}).click();
  await page.locator('#performance-midi-connect').click();
  await page.locator('#performance-midi-profile').selectOption('mpk-mini-plus-ii');
});

test('MPK setup learns both banks, routes controls and persists without page overflow', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#performance-midi-mode').selectOption('twos-complement');
  await page.locator('#performance-midi-learn-knobs').click();
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) sendMIDI([0xb0, 20 + i, 1]);
  });
  await page.locator('#performance-midi-bank').selectOption('macros');
  await page.evaluate(() => sendMIDI([0xb0, 20, 1]));
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBeCloseTo(1 / 127);
  await page.locator('#performance-midi-learn-pads').click();
  for (let bank = 0; bank < 2; bank++) {
    await page.locator('#performance-midi-bank-ready').click();
    await page.evaluate(bank => {
      for (let i = bank * 8; i < bank * 8 + 8; i++) {
        sendMIDI([0x99, 36 + i, 100]);
        sendMIDI([0x89, 36 + i, 0]);
      }
    }, bank);
  }
  await page.locator('#performance-midi-pads').selectOption('mute');
  await page.evaluate(() => {
    sendMIDI([0x99, 51, 80]);
    sendMIDI([0x89, 51, 0]);
    sendMIDI([0x90, 60, 80], 'plugin');
    sendMIDI([0x90, 61, 80], 'daw');
    sendMIDI([0x90, 62, 80]);
  });
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().map(n => n.note))).toEqual([62]);
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer.lanes[15].mute)).toBe(true);
  await page.evaluate(() => sendMIDI([0x80, 62, 0]));
  for (const width of [390, 900, 1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('#performance-midi-mpk').screenshot({path: '.context/mpk-mini-plus-ii-setup.png'});
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))?.performance?.mappings.length),
    )
    .toBe(25);
  await page.reload();
  const restored = await page.evaluate(() => AfterhoursPerformance.snapshot());
  expect(restored.midi).toEqual({
    profile: 'mpk-mini-plus-ii',
    knobBank: 'macros',
    padMode: 'mute',
    pads: Array.from({length: 16}, (_, i) => i),
    native: false,
  });
  expect(restored.mappings).toHaveLength(25);
  expect(errors).toEqual([]);
});

test('learned transport records audible pad hits and clock follows Groove only on selected output', async ({page}) => {
  await page.locator('#performance-midi-target').selectOption('action.record');
  await page.locator('#performance-midi-learn').click();
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await page.locator('#performance-midi-learn-pads').click();
  await page.locator('#performance-midi-bank-ready').click();
  await page.evaluate(() => sendMIDI([0x99, 36, 100]));
  await page.locator('#performance-midi-cancel').click();
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'true');
  const livePeak = await page.evaluate(async () => {
    // Sample each animation frame: a kick may decay before expect.poll's next interval.
    sendMIDI([0x99, 36, 96]);
    const deadline = performance.now() + 5000;
    let peak = -120;
    while (peak <= -60 && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      peak = Math.max(peak, AfterhoursAudio.meter().peak);
    }
    return peak;
  });
  expect(livePeak).toBeGreaterThan(-60);
  // Keep the hit's decay in the take and leave time for replay scheduling.
  await page.evaluate(() => {
    window.__padPeakTime = AfterhoursAudio.context().currentTime;
  });
  await expect
    .poll(() => page.evaluate(() => AfterhoursAudio.context().currentTime - window.__padPeakTime))
    .toBeGreaterThan(0.6);
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  expect(
    await page.evaluate(() => AfterhoursPerformanceStudio.take.events.find(e => e.type === 'laneHit')?.value),
  ).toEqual({lane: 0, velocity: 96 / 127});
  const peak = await page.evaluate(async () => {
    const b = await AfterhoursPerformanceStudio.audio.arrayBuffer(),
      view = new DataView(b);
    let peak = 0;
    for (let i = 44; i < b.byteLength; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    return peak;
  });
  expect(peak).toBeGreaterThan(50);
  await page.getByText('Gesture replay & editing', {exact: true}).click();
  await page.locator('#performance-print').click();
  await expect(page.locator('#performance-status')).toContainText('Edited replay printed');
  expect(
    await page.evaluate(async () => {
      const bytes = await AfterhoursPerformanceStudio.audio.arrayBuffer(),
        view = new DataView(bytes);
      let peak = 0;
      for (let i = 44; i < bytes.byteLength; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
      return peak;
    }),
  ).toBeGreaterThan(50);
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  expect(await page.evaluate(() => midiAccess.outputs.get('clock').messages)).toEqual([]);
  await page.locator('#performance-midi-clock').selectOption('clock');
  await expect
    .poll(() => page.evaluate(() => midiAccess.outputs.get('clock').messages.filter(m => m.data[0] === 0xf8).length))
    .toBeGreaterThan(5);
  await page.evaluate(() => AfterhoursGrooveLive.stop());
  await expect.poll(() => page.evaluate(() => midiAccess.outputs.get('clock').messages.at(-1)?.data)).toEqual([0xfc]);
  expect(await page.evaluate(() => midiAccess.outputs.get('clock').clears)).toBeGreaterThan(0);
});

test('one-button guided setup learns controls, central encoder changes instruments and mappings survive restart', async ({
  page,
}) => {
  await page.locator('#performance-midi-profile').selectOption('generic');
  await page.locator('#performance-midi-auto').click();
  const instruction = page.locator('#performance-midi-instruction');
  await expect(instruction).toContainText('Turn knob 1');
  for (const width of [390, 900]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('.midi-setup').first().screenshot({path: '.context/mpk-auto-learn.png'});
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) sendMIDI([0xb0, 20 + i, 64]);
  });
  await expect(instruction).toContainText('First select bank A');
  await page.evaluate(() => sendMIDI([0x90, 80, 127], 'daw'));
  await page.locator('#performance-midi-bank-ready').click();
  await expect(instruction).toContainText('Press pad 1 · bank A');
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) sendMIDI([0x99, 36 + i, 100]);
  });
  await expect(instruction).toContainText('First select bank B');
  await page.evaluate(() => {
    sendMIDI([0x90, 80, 127], 'daw');
    sendMIDI([0x80, 80, 0], 'daw');
    sendMIDI([0xb0, 49, 127], 'daw');
    sendMIDI([0xc0, 12], 'daw');
  });
  await expect(instruction).toContainText('First select bank B');
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mappings.some(m => m.target === 'mpk.pad.8'))).toBe(
    false,
  );
  await page.locator('.midi-setup').first().screenshot({path: '.context/mpk-bank-confirmation.png'});
  await page.locator('#performance-midi-bank-ready').click();
  await expect(instruction).toContainText('Press pad 1 · bank B');
  await page.evaluate(() => {
    for (let i = 8; i < 16; i++) sendMIDI([0x99, 36 + i, 100]);
  });
  await expect(instruction).toContainText('central encoder clockwise');
  await page.evaluate(() => sendMIDI([0xb0, 16, 1], 'daw'));
  await expect(instruction).toContainText('Play');
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) sendMIDI([0x90, 110 + i, 127], 'daw');
  });
  await expect(instruction).toContainText('Done');
  await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  const original = await page.evaluate(() => AfterhoursSynth.snapshot().id);
  await page.evaluate(() => sendMIDI([0xb0, 16, 1], 'daw'));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).not.toBe(original);
  await page.evaluate(() => sendMIDI([0xb0, 16, 127], 'daw'));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe(original);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))?.performance?.mappings.length),
    )
    .toBe(28);
  await page.reload();
  expect(
    await page.evaluate(() => AfterhoursPerformance.snapshot().mappings.find(m => m.target === 'mpk.instrument')?.mode),
  ).toBe('twos-complement');
});

test('guided setup can skip, finish early, restart and report missing hardware', async ({page}) => {
  await page.locator('#performance-midi-auto').click();
  await page.locator('#performance-midi-skip').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('Turn knob 2');
  await page.evaluate(() => sendMIDI([0xb0, 21, 64]));
  await page.locator('#performance-midi-finish').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('Learning stopped');
  expect(
    await page.evaluate(() => AfterhoursPerformance.snapshot().mappings.some(m => m.target === 'mpk.knob.1')),
  ).toBe(true);
  await page.locator('#performance-midi-auto').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('Turn knob 1');
  await page.locator('#performance-midi-finish').click();
  await page.evaluate(() => midiAccess.inputs.clear());
  await page.locator('#performance-midi-auto').click();
  await expect(page.locator('#performance-midi-explanation')).toContainText('not found');
  await expect(page.locator('#performance-midi-auto')).toBeEnabled();
});

test('bank confirmation can skip a whole bank and relearning repairs an earlier bank-button assignment', async ({
  page,
}) => {
  await page.evaluate(() => {
    AfterhoursPerformance.store.update(s => {
      s.mappings.push({device: 'Akai MPK mini Plus II DAW', channel: 0, type: 'note', number: 80, target: 'mpk.pad.8'});
    });
  });
  await page.locator('#performance-midi-learn-pads').click();
  await page.locator('#performance-midi-skip-bank').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('First select bank B');
  await page.evaluate(() => sendMIDI([0x90, 80, 127], 'daw'));
  await page.locator('#performance-midi-bank-ready').click();
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) sendMIDI([0x99, 44 + i, 100]);
  });
  await expect(page.locator('#performance-midi-instruction')).toContainText('Done');
  const mappings = await page.evaluate(() => AfterhoursPerformance.snapshot().mappings);
  expect(mappings.find(m => m.target === 'mpk.pad.8')).toMatchObject({type: 'note', number: 44, channel: 9});
  expect(mappings.some(m => m.type === 'note' && m.number === 80)).toBe(false);
  await page.locator('#performance-midi-learn-pads').click();
  await page.locator('#performance-midi-finish').click();
  await expect(page.locator('#performance-midi-bank-ready')).toBeHidden();
});

test('extended button learning protects Undo and the encoder starts a phrase then generates editable, audible tracks', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#performance-midi-extra').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('the central encoder (push)');
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await page.locator('#performance-midi-skip').click();
  await page.locator('#performance-midi-skip').click();
  await expect(page.locator('#performance-midi-instruction')).toContainText('UNDO');
  await page.evaluate(() => sendMIDI([0x90, 113, 127], 'daw'));
  await page.evaluate(() => sendMIDI([0x90, 113, 127], 'daw'));
  await expect(page.locator('#performance-midi-instruction')).toContainText('SHIFT + UNDO');
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mappings.find(m => m.number === 113).target)).toBe(
    'action.undo',
  );
  await page.locator('#performance-midi-finish').click();
  const before = await page.evaluate(() => AfterhoursGrooveLive.snapshot().project);
  await page.locator('#jam-bpm').fill('120');
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await expect(page.locator('#jam-listen')).toHaveAttribute('aria-pressed', 'true');
  for (const note of [60, 64, 67]) {
    await page.evaluate(note => sendMIDI([0x90, note, 96]), note);
    await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().length)).toBe(1);
    await page.evaluate(async note => {
      const until = AfterhoursAudio.context().currentTime + 0.15;
      while (AfterhoursAudio.context().currentTime < until) await new Promise(requestAnimationFrame);
      sendMIDI([0x80, note, 0]);
    }, note);
  }
  await page.evaluate(() => sendMIDI([0x90, 110, 127], 'daw'));
  await expect(page.locator('#jam-status')).toContainText('3 note(s)');
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  const project = await page.evaluate(() => AfterhoursGrooveLive.snapshot().project);
  const lead = project.patterns[0].tracks.slice(8).flatMap(t => t.steps.filter(s => s.on).map(s => s.locks.note));
  expect(lead.sort((a, b) => a - b)).toEqual([60, 64, 67]);
  expect(project.patterns[0].tracks.slice(0, 8).every(t => t.steps.some(s => s.on))).toBe(false); // sparse percussion is deliberate
  expect(project.patterns[0].tracks[4].steps.some(s => s.on)).toBe(true);
  expect(project.performance.mappings.some(m => m.target === 'action.jam-confirm')).toBe(true);
  const peak = await page.evaluate(async () => {
    const p = AfterhoursGrooveApp.S.data,
      ctx = new OfflineAudioContext(2, 32000, 16000);
    const renderer = new FMGrooveAudio(ctx, p.bpm);
    for (let tick = 0; tick < 32; tick++)
      for (const e of AfterhoursGroove.events(p.patterns[0], tick)) renderer.hit(e, 0.02 + (e.beat * 60) / p.bpm);
    const audio = await ctx.startRendering();
    renderer.dispose();
    return Math.max(...audio.getChannelData(0).map(Math.abs));
  });
  expect(peak).toBeGreaterThan(0.001);
  await page.locator('.jam-setup').screenshot({path: '.context/experimental-jam.png'});
  await page.reload();
  await page.locator('#performance-toggle').click();
  await expect(page.locator('#jam-restore')).toBeEnabled();
  await page.locator('#jam-restore').click();
  await expect(page.locator('#jam-status')).toContainText('Previous project restored');
  expect(await page.evaluate(() => AfterhoursGrooveLive.snapshot().project)).toEqual(before);
  expect(errors).toEqual([]);
});

test('empty phrase keeps the project and quantize supports hardware Undo / Redo', async ({page}) => {
  const before = await page.evaluate(() => AfterhoursGrooveLive.snapshot().project);
  await page.locator('#jam-listen').click();
  await page.locator('#jam-confirm').click();
  await expect(page.locator('#jam-status')).toContainText('Play a few notes first');
  expect(await page.evaluate(() => AfterhoursGrooveLive.snapshot().project)).toEqual(before);
  await expect(page.locator('#jam-cancel')).toBeDisabled();
  await page.evaluate(() => {
    AfterhoursGrooveApp.track().steps[0].on = true;
    AfterhoursGrooveApp.track().steps[0].micro = 0.3;
  });
  await page.locator('#jam-quantize').click();
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().steps[0].micro)).toBe(0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.undo'}})),
  );
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().steps[0].micro)).toBe(0.3);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.redo'}})),
  );
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().steps[0].micro)).toBe(0);
});

test('failed backup cannot replace the project and regeneration retains the first backup', async ({page}) => {
  const before = await page.evaluate(() => AfterhoursGrooveLive.snapshot().project);
  await page.locator('#jam-listen').click();
  await page.evaluate(() => {
    AfterhoursPerformance.event('noteOn', {id: 'test', note: 60, velocity: 0.8});
    AfterhoursPerformance.event('noteOff', {id: 'test'});
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'afterhours-jam-backup-v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  });
  await page.locator('#jam-confirm').click();
  await expect(page.locator('#jam-status')).toContainText('Storage full');
  expect(await page.evaluate(() => AfterhoursGrooveLive.snapshot().project)).toEqual(before);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  await page.evaluate(() => (Storage.prototype.setItem = originalSetItem));
  await page.locator('#jam-confirm').click();
  await expect(page.locator('#jam-status')).toContainText('1 note(s)');
  const backup = await page.evaluate(() => localStorage.getItem('afterhours-jam-backup-v1'));
  await page.locator('#jam-style').selectOption('pulse');
  await page.locator('#jam-confirm').click();
  await expect(page.locator('#jam-confirm')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('afterhours-jam-backup-v1'))).toBe(backup);
  await page.locator('#jam-restore').click();
  expect(await page.evaluate(() => AfterhoursGrooveLive.snapshot().project)).toEqual(before);
});

test('quantize Undo rolls back a failed save and ignores stale history after other project edits', async ({page}) => {
  await page.evaluate(() => {
    Object.assign(AfterhoursGrooveApp.track().steps[0], {on: true, micro: 0.3});
  });
  await page.locator('#jam-quantize').click();
  const result = await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'afterhours-fm-project-v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    try {
      AfterhoursJam.undoEdit();
      return {
        micro: AfterhoursGrooveApp.track().steps[0].micro,
        status: document.getElementById('jam-status').textContent,
      };
    } finally {
      Storage.prototype.setItem = original;
    }
  });
  expect(result.micro).toBe(0);
  expect(result.status).toContain('no storage space');
  expect(await page.evaluate(() => AfterhoursJam.undoEdit())).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().steps[0].micro)).toBe(0.3);
  await page.locator('#jam-quantize').click();
  await page.evaluate(() => (AfterhoursGrooveApp.S.data.bpm = 143));
  expect(await page.evaluate(() => AfterhoursJam.undoEdit())).toBe(false);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.bpm)).toBe(143);
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().steps[0].micro)).toBe(0);
});

test('Continue resumes after Stop while Play starts from the beginning', async ({page}) => {
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().beat)).toBeGreaterThan(1);
  const position = await page.evaluate(() => {
    const beat = AfterhoursGrooveLive.clock().beat;
    AfterhoursGrooveLive.stop();
    return beat;
  });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.continue'}})),
  );
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().beat)).toBeGreaterThanOrEqual(position - 0.01);
  await page.evaluate(async () => {
    AfterhoursGrooveLive.stop();
    await AfterhoursGrooveLive.play();
  });
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().beat)).toBeLessThan(1);
});

test('bank buttons cycle both ways and metronome produces audio only while enabled', async ({page}) => {
  await page.evaluate(() => {
    for (const target of ['action.knob-bank-prev', 'action.knob-bank'])
      window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target}}));
  });
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().midi.knobBank)).toBe('synth');
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.knob-bank-prev'}})),
  );
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().midi.knobBank)).toBe('synth-extra');
  await page.locator('#jam-metronome').click();
  await page.locator('#jam-listen').click();
  const peak = await page.evaluate(async () => {
    const until = performance.now() + 2000;
    let peak = -120;
    while (performance.now() < until && peak < -60) {
      await new Promise(requestAnimationFrame);
      peak = Math.max(peak, AfterhoursAudio.meter().peak);
    }
    return peak;
  });
  expect(peak).toBeGreaterThan(-60);
  await page.locator('#jam-metronome').click();
  await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeLessThan(-90);
  await expect(page.locator('#jam-metronome')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#jam-cancel').click();
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
});
