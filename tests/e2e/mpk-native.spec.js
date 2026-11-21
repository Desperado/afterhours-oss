const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.addInitScript(() => {
    const port = (id, name) => ({id, name, manufacturer: 'Akai', state: 'connected'});
    const inputs = new Map([
      ['keys', port('keys', 'MPK mini Plus II MIDI Port')],
      ['daw', port('daw', 'MPK mini Plus II DAW Port')],
    ]);
    window.__respond = true;
    window.__mode = 0;
    window.__messages = [];
    window.__other = [];
    const daw = {
      ...port('daw-out', 'MPK mini Plus II DAW Port'),
      send(bytes) {
        __messages.push([...bytes]);
        if (!__respond) return;
        const reply =
          bytes[1] === 126
            ? [240, 126, 127, 6, 2, 71, 3, 0, 25, 0, 247]
            : bytes[4] === 45
              ? [240, 71, 0, 3, 45, 0, 1, __mode, 247]
              : null;
        if (reply) queueMicrotask(() => inputs.get('daw').onmidimessage?.({data: reply}));
      },
    };
    window.__midi = {
      inputs,
      outputs: new Map([
        ['daw', daw],
        [
          'other',
          {
            ...port('other', 'Other synth'),
            send(b) {
              __other.push([...b]);
            },
          },
        ],
      ]),
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async options => {
        if (options?.sysex && window.__denySysex) throw new DOMException('SysEx denied', 'SecurityError');
        window.__sysex = !!options?.sysex;
        return __midi;
      },
    });
    window.__send = (bytes, id = 'daw') => inputs.get(id).onmidimessage({data: bytes});
    window.__press = cc => {
      __send([176, cc, 127]);
      __send([176, cc, 0]);
    };
  });
  await page.goto('/');
  await page.locator('#performance-toggle').click();
});
async function enable(page) {
  await page.locator('#performance-midi-native').click();
  await expect(page.locator('#performance-midi-hardware')).toContainText('MPK connected');
}
test('native profile routes exact encoder, SHIFT, knobs and both pad banks; owns only verified DAW feedback', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  expect(await page.evaluate(() => __sysex)).toBe(true);
  const original = await page.evaluate(() => AfterhoursSynth.snapshot().id);
  await page.evaluate(() => __send([176, 14, 1]));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).not.toBe(original);
  await page.evaluate(() => __send([176, 14, 127]));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe(original);
  await page.evaluate(() => {
    AfterhoursPerformance.store.update(s => {
      s.macros[0] = 0.3;
    }, 'native-test');
    __send([176, 17, 127]);
    __press(73);
    __send([176, 17, 0]);
  });
  // SHIFT + UNDO is Redo, so it must not undo the macro change.
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBe(0.3);
  await page.evaluate(() => __press(73));
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBe(0);
  await page.evaluate(() => {
    __send([176, 17, 127]);
    __press(73);
    __send([176, 17, 0]);
    __press(81);
    __send([176, 24, 1]);
  });
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBeCloseTo(0.3 + 1 / 127);
  await page.evaluate(() =>
    AfterhoursPerformance.store.update(s => {
      s.midi.padMode = 'mute';
    }, 'midi-profile'),
  );
  await page.evaluate(() => {
    __send([153, 36, 100]);
    __send([137, 36, 0]);
    __press(83);
    __send([153, 44, 100]);
    __send([137, 44, 0]);
  });
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer.lanes.map(l => l.mute))).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  await page.evaluate(() => __press(76));
  await expect
    .poll(() => page.evaluate(() => __messages.some(b => b[0] === 150 && b[1] === 76 && b[2] === 127)))
    .toBe(true);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => __messages.some(b => b[4] === 16))).toBe(true);
  expect(await page.evaluate(() => __other)).toEqual([]);
  await page.evaluate(() => {
    AfterhoursPerformance.store.update(s => {
      s.midi.padMode = 'notes';
    }, 'midi-profile');
    __send([153, 48, 100]);
  });
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().some(n => n.id === 'mpk-pad:48'))).toBe(true);
  await page.evaluate(() => __send([137, 48, 0]));
  expect(await page.evaluate(() => AfterhoursSynth.held().some(n => n.id === 'mpk-pad:48'))).toBe(false);
  await page.evaluate(() => __send([153, 49, 100]));
  await page.locator('#performance-midi-native-off').click();
  expect(await page.evaluate(() => AfterhoursSynth.held().some(n => n.id.startsWith('mpk-pad:')))).toBe(false);
  expect(await page.evaluate(() => __messages.slice(-1)[0])).toEqual([240, 71, 0, 3, 28, 0, 1, 0, 247]);
  expect(await page.evaluate(() => __messages.some(b => b.join(',') === '240,71,0,3,46,0,1,0,247'))).toBe(true);
  expect(errors).toEqual([]);
});
test('held encoder + pads select all 16 tracks in every pad mode; SHIFT + pads stay with the MPK firmware', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  const before = await page.evaluate(() => ({
    project: JSON.stringify({...AfterhoursGrooveApp.S.data, performance: undefined}),
    patch: AfterhoursSynth.snapshot().id,
  }));
  for (const mode of ['drums', 'scenes', 'mute', 'notes']) {
    await page.evaluate(mode => {
      AfterhoursPerformance.store.update(s => {
        s.midi.padMode = mode;
      }, 'midi-profile');
      window.__auditions = 0;
      AfterhoursGrooveLive.audition = () => {
        __auditions++;
      };
      // SHIFT + pad opens MPK menus (pad modes, Prog, Chord Type); Afterhours must ignore it.
      const selected = AfterhoursGrooveApp.S.selected;
      __send([176, 17, 127]);
      __send([153, 36 + ((selected + 3) % 16), 100]);
      __send([137, 36 + ((selected + 3) % 16), 0]);
      __send([176, 17, 0]);
      if (AfterhoursGrooveApp.S.selected !== selected) throw new Error('SHIFT + pad changed the track');
      window.__jam = 0;
      if (!window.__jamListening)
        window.addEventListener('afterhours:midiaction', e => {
          if (e.detail.target.startsWith('action.jam')) __jam++;
        });
      window.__jamListening = true;
      __send([176, 13, 127]);
    }, mode);
    const state = await page.evaluate(() => JSON.stringify(AfterhoursPerformance.snapshot()));
    for (let lane = 0; lane < 16; lane++) {
      await page.evaluate(lane => {
        __send([153, 36 + lane, 100]);
        __send([137, 36 + lane, 0]);
      }, lane);
      expect(await page.evaluate(() => AfterhoursGrooveApp.S.selected)).toBe(lane);
      await expect(page.locator(`#perform-pad-${lane}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[aria-label^="Select track ${lane + 1} "]`)).toHaveAttribute('aria-pressed', 'true');
    }
    expect(await page.evaluate(() => JSON.stringify(AfterhoursPerformance.snapshot()))).toBe(state);
    expect(await page.evaluate(() => __auditions)).toBe(0);
    expect(await page.evaluate(() => AfterhoursSynth.held())).toEqual([]);
    await page.evaluate(() => __send([176, 13, 0]));
    expect(await page.evaluate(() => __jam)).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const message = __messages.filter(b => b[0] === 240 && b[4] === 16 && b[8] === 1).at(-1);
          return message && String.fromCharCode(...message.slice(9, -2));
        }),
      )
      .toMatch(/^T16 /);
  }
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe(before.patch);
  expect(
    await page.evaluate(
      before => JSON.stringify({...AfterhoursGrooveApp.S.data, performance: undefined}) === before,
      before.project,
    ),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => __messages.filter(b => b[1] === 51 && b.length === 3).at(-1)))
    .toEqual([150, 51, 13]);
  expect(await page.evaluate(() => __messages.filter(b => b[1] === 36 && b.length === 3).at(-1))).not.toEqual([
    150, 36, 13,
  ]);
  // A plain encoder click (no pad while held) still starts the jam, on release.
  await page.evaluate(() => {
    __jam = 0;
    __send([176, 13, 127]);
  });
  expect(await page.evaluate(() => __jam)).toBe(0);
  await page.evaluate(() => __send([176, 13, 0]));
  expect(await page.evaluate(() => __jam)).toBe(1);
  await page.evaluate(() => AfterhoursJam.cancel());
  await page.evaluate(() => __press(83));
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.selected)).toBe(15);
  expect(await page.evaluate(() => [-1, 16, 1.5, NaN].map(AfterhoursGrooveLive.selectLane))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  await page.evaluate(() => {
    __messages = [];
    __send([240, 71, 0, 3, 25, 0, 0, 247]);
  });
  await expect.poll(() => page.evaluate(() => __messages.filter(b => b[0] === 240 && b[4] === 20).length)).toBe(3);
  expect(await page.evaluate(() => __messages.filter(b => b[0] === 240 && b[4] === 16).every(b => b[7] === 2))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('device profile survives song replacement and restart; feedback waits for identity and DAW mode', async ({
  page,
}) => {
  await enable(page);
  await page.evaluate(() => AfterhoursPerformance.load({macros: [0.8]}));
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().midi.native)).toBe(true);
  await page.waitForTimeout(500);
  await page.locator('#performance-midi-native-off').click();
  await page.evaluate(() => AfterhoursPerformance.store.undo());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-midi-device-v1')).midi.native)).toBe(
    true,
  );
  await page.reload();
  await expect.poll(() => page.evaluate(() => AfterhoursMPK.status)).toContain('MPK connected');
  await page.evaluate(() => {
    __mode = 1;
    AfterhoursMPK.reconnect();
  });
  await expect.poll(() => page.evaluate(() => AfterhoursMPK.status)).toContain('Press PLUGIN/DAW');
  const before = await page.evaluate(() => __messages.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => __messages.length)).toBe(before);
  // Pressing PLUGIN/DAW on the MPK reports DAW mode again; Afterhours takes the screen back by itself.
  await page.evaluate(() => __send([240, 71, 0, 3, 45, 0, 1, 0, 247]));
  await expect.poll(() => page.evaluate(() => AfterhoursMPK.status)).toContain('MPK connected');
  await page.evaluate(() => __send([240, 71, 0, 3, 45, 0, 1, 1, 247]));
  await expect.poll(() => page.evaluate(() => AfterhoursMPK.status)).toContain('Press PLUGIN/DAW');
  await page.evaluate(() => {
    __respond = false;
    __messages = [];
    AfterhoursMPK.reconnect();
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => __messages)).toEqual([[240, 126, 127, 6, 1, 247]]);
});
test('visible song controls play, change own instrument and round-trip the full arrangement', async ({page}) => {
  await enable(page);
  await page.locator('#performance-toggle').click();
  await page.locator('#groove-load-preset').click();
  const song = await page.evaluate(() => JSON.stringify(AfterhoursGrooveApp.S.data.patterns));
  const patch = await page.evaluate(() => AfterhoursSynth.snapshot().id);
  await page.locator('#song-instrument-next').click();
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).not.toBe(patch);
  expect(await page.evaluate(() => JSON.stringify(AfterhoursGrooveApp.S.data.patterns))).toBe(song);
  await page.locator('#song-play').click();
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  await page.locator('#song-stop').click();
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  const download = page.waitForEvent('download');
  await page.locator('#song-save').click();
  const file = await download;
  const bytes = await fs.readFile(await file.path());
  const saved = JSON.parse(bytes.toString());
  expect(saved.arrangement.length).toBeGreaterThan(1);
  await page.locator('#groove-file').setInputFiles({name: 'my-song.json', mimeType: 'application/json', buffer: bytes});
  await expect(page.locator('#status-text')).toHaveText('Project imported');
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.songMode)).toBe(true);
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().midi.native)).toBe(true);
  for (const width of [390, 900, 1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('.track-deck').screenshot({path: '.context/mpk-song-workflow.png'});
});

test('all eight encoders edit selected sound, mixer, motion and rhythm banks and persist with the song', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  await page.locator('#performance-midi-track-sound').click();
  await expect(page.locator('#performance-midi-controls li')).toHaveCount(8);
  const result = await page.evaluate(() => {
    __send([176, 17, 127]);
    __send([153, 40, 100]);
    __send([137, 40, 0]);
    __send([176, 17, 0]);
    const initial = structuredClone(AfterhoursGrooveApp.track());
    for (let i = 0; i < 8; i++) __send([176, 24 + i, 1]);
    const edited = structuredClone(AfterhoursGrooveApp.track());
    __send([176, 17, 127]);
    __send([176, 24, 1]);
    __send([176, 17, 0]);
    const fine = AfterhoursGrooveApp.track().cutoff - edited.cutoff;
    return {initial, edited, fine};
  });
  for (const key of ['cutoff', 'shape', 'color', 'sweep', 'contour', 'decay', 'volume', 'pan'])
    expect(result.edited[key]).toBeGreaterThan(result.initial[key]);
  expect(result.fine).toBeCloseTo((result.edited.cutoff - result.initial.cutoff) / 4);
  await expect(page.locator('#performance-midi-control-context')).toContainText('Track 5');
  await page.evaluate(() => __press(81));
  await expect(page.locator('#performance-midi-bank')).toHaveValue('track-mix');
  const mixer = await page.evaluate(() => {
    const initial = structuredClone(AfterhoursPerformance.snapshot().mixer.lanes[4]);
    for (let i = 0; i < 8; i++) __send([176, 24 + i, 1]);
    return {
      initial,
      edited: AfterhoursPerformance.snapshot().mixer.lanes[4],
      other: AfterhoursPerformance.snapshot().mixer.lanes[5],
    };
  });
  for (const key of ['level', 'pan', 'low', 'mid', 'high', 'drive', 'delay', 'reverb'])
    expect(mixer.edited[key]).toBeGreaterThan(mixer.initial[key]);
  expect(mixer.other.drive).toBe(0);
  await expect(page.locator('#performance-midi-controls li').nth(2)).toContainText('dB');
  await page.evaluate(() => __press(81));
  await expect(page.locator('#performance-midi-bank')).toHaveValue('track-motion');
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) __send([176, 24 + i, 1]);
  });
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().algorithm)).toBe('serial');
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().lfo.target)).toBe('cutoff');
  await page.evaluate(() => __press(81));
  await expect(page.locator('#performance-midi-bank')).toHaveValue('track-rhythm');
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) __send([176, 24 + i, 1]);
  });
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().length)).toBe(33);
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().rate)).toBe(2);
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().solo)).toBe(true);
  await page.evaluate(() => {
    __send([176, 17, 127]);
    __send([153, 51, 100]);
    __send([137, 51, 0]);
    __send([176, 17, 0]);
    __send([176, 26, 1]);
  });
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().mute)).toBe(true);
  await page.locator('#performance-midi-bank').selectOption('track-sound');
  await page.evaluate(() => {
    AfterhoursGrooveApp.track().machine = 'Instrument';
    AfterhoursGrooveApp.track().instrument = 'growlybass';
  });
  await expect(page.locator('#performance-midi-controls li').nth(1)).toContainText('Release');
  await page.evaluate(() => __send([176, 25, 1]));
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().instrumentRelease)).toBeGreaterThan(0);
  const project = await page.evaluate(() => {
    AfterhoursGrooveLive.flush();
    return structuredClone(AfterhoursGrooveApp.S.data);
  });
  await page.reload();
  await page.locator('#performance-toggle').click();
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data)).toEqual(project);
  await expect(page.locator('#performance-midi-bank')).toHaveValue('track-sound');
  expect(errors).toEqual([]);
});

test('native Play/Stop and Record work with live matched sound edits and replayable track automation', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  await page.evaluate(() => {
    const follow = document.getElementById('synth-follow');
    AfterhoursGrooveApp.track().steps[0].locks.shape = 71;
    follow.checked = true;
    follow.dispatchEvent(new Event('change'));
  });
  await page.locator('#performance-midi-track-sound').click();
  await page.evaluate(() => __press(77));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(true);
  await page.evaluate(() => __send([144, 60, 100], 'keys'));
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().length)).toBe(1);
  await page.evaluate(() => __send([176, 24, 16]));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().track.cutoff)).toBeCloseTo(650 + (16 * 15900) / 127);
  expect(await page.evaluate(() => AfterhoursSynth.held().length)).toBe(1);
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().track.shape)).toBe(71);
  await page.locator('#performance-midi-bank').selectOption('track-mix');
  await page.evaluate(() => __send([176, 29, 16]));
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().performance.mixer.lanes[4].drive)).toBeCloseTo(16 / 127);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  await page.evaluate(() => __send([128, 60, 0], 'keys'));
  // Play/Stop ends the take as well as playback; a second Record press is not needed.
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.take.events.map(e => e.type))).toEqual(
    expect.arrayContaining(['trackControl', 'state', 'noteOn', 'noteOff', 'transport']),
  );
  const edited = await page.evaluate(() => AfterhoursGrooveApp.track().cutoff);
  await page.evaluate(() => {
    const take = AfterhoursPerformanceStudio.take;
    take.duration = 1.5;
    take.events = take.events.filter(e => e.type === 'trackControl').map(e => ({...e, time: 0.1}));
    take.events[0].value.value = 4500;
    const state = AfterhoursPerformance.snapshot();
    state.mixer.lanes[4].drive = 0.75;
    take.events.push({type: 'state', time: 0.2, value: state});
  });
  await page.getByText('Gesture replay & editing', {exact: true}).click();
  await page.locator('#performance-replay').click();
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.track().cutoff)).toBe(4500);
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.snapshot().performance.mixer.lanes[4].drive)).toBe(0.75);
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.replaying)).toBe(false);
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().cutoff)).toBe(edited);
  expect(errors).toEqual([]);
});

test('Stop ends a take from MPK or the top transport, and the jam explains how to stop recording', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  await page.evaluate(() => __press(77));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(true);
  await page.locator('#jam-listen').click();
  await expect(page.locator('#jam-status')).toContainText('Recording in progress. Press Stop');
  // Play/Stop starts the song under the take, then stops both.
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(true);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  // The jam's warning clears once the take has ended.
  await expect(page.locator('#jam-status')).toContainText('Ready to listen');
  await page.evaluate(() => __press(77));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(true);
  await page.locator('#transport-stop').click();
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  await page.locator('#jam-listen').click();
  await expect.poll(() => page.evaluate(() => AfterhoursJam.mode)).toBe('listening');
  expect(errors).toEqual([]);
});

test('macro panel switches the eight MPK knobs to the visible macros', async ({page}) => {
  await enable(page);
  await expect(page.locator('#performance-midi-macros-status')).toContainText('Live Synth');
  await page.evaluate(() => __send([176, 24, 10]));
  expect(await page.evaluate(() => AfterhoursPerformance.store.state.macros[0])).toBe(0);
  await page.locator('#performance-midi-macros').click();
  await expect(page.locator('#performance-midi-macros')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#performance-midi-macros-status')).toContainText('control these macros');
  await page.evaluate(() => __send([176, 24, 10]));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformance.store.state.macros[0])).toBeGreaterThan(0);
  await expect(page.locator('#performance-macros')).not.toContainText('Weight0%');
});

test('SHIFT + BANK browses the song library on the MPK screen and Play/Stop loads and starts it', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  const before = await page.evaluate(() => AfterhoursGrooveApp.S.data.title);
  const catalog = await page.evaluate(() => AfterhoursPresets.catalog.map(c => c.title));
  expect(new Set(catalog).size).toBe(catalog.length);
  const shiftPress = cc =>
    page.evaluate(cc => {
      __send([176, 17, 127]);
      __press(cc);
      __send([176, 17, 0]);
    }, cc);
  await shiftPress(81);
  await shiftPress(81);
  const chosen = await page.evaluate(() => AfterhoursSongWorkflow.pending);
  expect(chosen).toBeTruthy();
  expect(chosen).not.toBe(before);
  // Browsing changes neither the loaded song nor the knob bank.
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe(before);
  expect(await page.evaluate(() => AfterhoursPerformance.store.state.midi.knobBank)).toBe('synth');
  await expect(page.locator('#song-status')).toContainText(chosen);
  await expect
    .poll(() => page.evaluate(() => __messages.some(m => String.fromCharCode(...m).includes('Play = load song'))))
    .toBe(true);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe(chosen);
  expect(await page.evaluate(() => AfterhoursSongWorkflow.pending)).toBeNull();
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  await shiftPress(80);
  expect(await page.evaluate(() => AfterhoursSongWorkflow.pending)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('beat pads play any assigned track and record hits into the playing pattern with undo', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await enable(page);
  await page.getByText('Pads → tracks · Beat mode').click();
  await page.locator('#performance-midi-beat').click();
  await expect(page.locator('#performance-midi-pads')).toHaveValue('beat');
  await page.getByLabel('Pad A1 · track').selectOption('5');
  expect(await page.evaluate(() => AfterhoursPerformance.store.state.midi.pads.slice(0, 3))).toEqual([5, 1, 2]);
  const lane5 = () =>
    page.evaluate(() => {
      const t = AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[5];
      t.steps.forEach(s => (s.on = false));
      return t.steps.filter(s => s.on).length;
    });
  expect(await lane5()).toBe(0);
  // Stopped: the pad only plays the sound.
  await page.evaluate(() => __send([153, 36, 100], 'daw'));
  const onSteps = () =>
    page.evaluate(() =>
      AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[5].steps
        .map((s, i) => (s.on ? [i, s.velocity] : null))
        .filter(Boolean),
    );
  expect(await onSteps()).toEqual([]);
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  await page.evaluate(() => __send([153, 36, 100], 'daw'));
  await expect.poll(async () => (await onSteps()).length).toBe(1);
  expect((await onSteps())[0][1]).toBe(100);
  await page.evaluate(() => __press(73));
  await expect.poll(async () => (await onSteps()).length).toBe(0);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  expect(errors).toEqual([]);
});

test('build a song from scratch: empty loop, beat pads, recorded keys with pitch and length, clear and undo', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await enable(page);
  await page.locator('#song-new').click();
  await expect(page.locator('#song-status')).toContainText('New song');
  const active = () =>
    page.evaluate(() =>
      AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks.map(
        t => t.steps.filter(s => s.on).length,
      ),
    );
  expect((await active()).every(n => n === 0)).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe('New song');
  expect(await page.evaluate(() => AfterhoursPerformance.store.state.midi.native)).toBe(true);
  await page.locator('#song-beat').click();
  await expect(page.locator('#song-beat')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#song-play').click();
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
  await page.evaluate(() => __send([153, 36, 110], 'daw'));
  await expect.poll(async () => (await active())[0]).toBe(1);
  // Held encoder + pad 5 selects the bass track, SHIFT + Record arms the keys.
  await page.evaluate(() => {
    __send([176, 13, 127]);
    __send([153, 40, 100], 'daw');
    __send([137, 40, 0], 'daw');
    __send([176, 13, 0]);
    __send([176, 17, 127]);
    __press(77);
    __send([176, 17, 0]);
  });
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.selected)).toBe(4);
  await expect(page.locator('#song-keys')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('synth-follow').checked)).toBe(true);
  await page.evaluate(() => __send([144, 43, 100], 'keys'));
  await expect.poll(async () => (await active())[4]).toBe(1);
  await page.waitForTimeout(400);
  await page.evaluate(() => __send([128, 43, 0], 'keys'));
  const bass = await page.evaluate(() =>
    AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[4].steps.find(s => s.on),
  );
  expect(bass.locks.note).toBeGreaterThanOrEqual(24);
  expect(bass.gate).toBeGreaterThan(1);
  await page.locator('#song-undo').click();
  await expect.poll(async () => (await active())[4]).toBe(0);
  expect((await active())[0]).toBe(1);
  await page.evaluate(() => AfterhoursGrooveLive.selectLane(0));
  await page.locator('#song-clear').click();
  expect((await active())[0]).toBe(0);
  await page.locator('#song-undo').click();
  expect((await active())[0]).toBe(1);
  expect(errors).toEqual([]);
});

const shiftPress = (page, cc) =>
  page.evaluate(cc => {
    __send([176, 17, 127]);
    __press(cc);
    __send([176, 17, 0]);
  }, cc);
const steps = (page, lane) =>
  page.evaluate(
    lane =>
      AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[lane].steps.map(s => ({...s})),
    lane,
  );
const onCount = async (page, lane) => (await steps(page, lane)).filter(s => s.on).length;
async function playingBlankSong(page) {
  page.on('dialog', d => d.accept());
  await enable(page);
  await page.locator('#song-new').click();
  await page.locator('#song-beat').click();
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().ready)).toBe(true);
}

test('project replacement is all-or-nothing and drops a song browsed over the old project', async ({page}) => {
  page.on('dialog', d => d.accept());
  await enable(page);
  await shiftPress(page, 81);
  expect(await page.evaluate(() => AfterhoursSongWorkflow.pending)).toBeTruthy();
  await page.locator('#song-new').click();
  // The browsed song belonged to the replaced project; Play must not load it over the new song.
  expect(await page.evaluate(() => AfterhoursSongWorkflow.pending)).toBeNull();
  const result = await page.evaluate(() => {
    const before = AfterhoursGrooveApp.S.data,
      setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      return {
        ok: AfterhoursGrooveLive.loadPreset(AfterhoursPresets.catalog[0].id),
        same: AfterhoursGrooveApp.S.data === before,
      };
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
  expect(result).toEqual({ok: false, same: true});
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe('New song');
  // The loaded preset is tracked by id, not by matching its title.
  const id = await page.evaluate(() => AfterhoursPresets.catalog[1].id);
  expect(await page.evaluate(id => AfterhoursGrooveLive.loadPreset(id), id)).toBe(true);
  await page.evaluate(() => (AfterhoursGrooveApp.S.data.title = 'Renamed'));
  expect(await page.evaluate(() => AfterhoursGrooveLive.loadedPreset)).toBe(id);
});

test('Play/Stop loads a song browsed during playback, stops while samples prepare, and activates Groove', async ({
  page,
}) => {
  await enable(page);
  await page.evaluate(() => AfterhoursShell.setActive('recording'));
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  await expect(page.locator('#transport')).toHaveAttribute('aria-label', 'Groove transport');
  await shiftPress(page, 81);
  const chosen = await page.evaluate(() => AfterhoursSongWorkflow.pending);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe(chosen);
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(true);
  await page.evaluate(() => __press(76));
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
  // While Play is still preparing, Play/Stop cancels it rather than starting a second time.
  await page.evaluate(() => {
    AfterhoursGrooveApp.S.starting = true;
    __press(76);
  });
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.starting)).toBe(false);
  expect(await page.evaluate(() => AfterhoursGrooveLive.clock().running)).toBe(false);
});

test('recorded undo groups merge per source, redo restores them, held keys and clears stay consistent', async ({
  page,
}) => {
  await playingBlankSong(page);
  const pad = () => page.evaluate(() => __send([153, 36, 100], 'daw'));
  await pad();
  await expect.poll(() => onCount(page, 0)).toBe(1);
  await page.evaluate(() => {
    AfterhoursGrooveLive.selectLane(4);
    AfterhoursGrooveLive.armKeys(true);
    __send([144, 43, 100], 'keys');
  });
  await expect.poll(() => onCount(page, 4)).toBe(1);
  await page.evaluate(() => __send([128, 43, 0], 'keys'));
  await page.waitForTimeout(300);
  await pad();
  await expect.poll(() => onCount(page, 0)).toBe(2);
  // Both pad hits form one group: UNDO removes them together and keeps the keys.
  await page.evaluate(() => __press(73));
  expect(await onCount(page, 0)).toBe(0);
  expect(await onCount(page, 4)).toBe(1);
  // SHIFT + UNDO redoes the recording rather than an unrelated mixer change.
  await shiftPress(page, 73);
  expect(await onCount(page, 0)).toBe(2);
  // Undo while a key is held: its release must not touch the restored step.
  await page.evaluate(() => __send([144, 45, 100], 'keys'));
  await expect.poll(() => onCount(page, 4)).toBeGreaterThan(0);
  await page.evaluate(() => AfterhoursGrooveLive.undoHits());
  const restored = await steps(page, 4);
  await page.waitForTimeout(200);
  await page.evaluate(() => __send([128, 45, 0], 'keys'));
  expect(await steps(page, 4)).toEqual(restored);
  // Disarming while a key is held keeps the length played so far.
  await page.evaluate(() => __send([144, 47, 100], 'keys'));
  await expect.poll(() => onCount(page, 4)).toBeGreaterThan(0);
  await page.waitForTimeout(450);
  await page.evaluate(() => AfterhoursGrooveLive.armKeys(false));
  expect(Math.max(...(await steps(page, 4)).filter(s => s.on).map(s => s.gate))).toBeGreaterThan(1);
  // Clearing resets every step field, so chance or conditions cannot silence new hits.
  await page.evaluate(() => {
    const step = AfterhoursGrooveApp.S.data.patterns[AfterhoursGrooveApp.S.data.active].tracks[0].steps[3];
    Object.assign(step, {
      chance: 0,
      condition: 'fill',
      repeat: 3,
      bend: [
        [0, 0],
        [1, 200],
      ],
    });
    AfterhoursGrooveLive.clearTrack(0);
  });
  const cleared = (await steps(page, 0))[3];
  expect(cleared).toEqual(await page.evaluate(() => AfterhoursGroove.step()));
});

test('arming keys on an empty track plays that track; macros refresh the matched sound', async ({page}) => {
  await playingBlankSong(page);
  await page.evaluate(() => {
    AfterhoursGrooveLive.selectLane(5);
    AfterhoursGrooveLive.armKeys(true);
  });
  expect(await page.evaluate(() => [AfterhoursSynth.snapshot().family, AfterhoursSynth.snapshot().lane])).toEqual([
    'groove',
    5,
  ]);
  await page.evaluate(() =>
    AfterhoursPerformance.store.update(s => {
      s.macros[2] = 0.6;
    }, 'macro-2'),
  );
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().performance.macros[2])).toBe(0.6);
});

test('a performance take records and replays the pad overdub it captured', async ({page}) => {
  await playingBlankSong(page);
  await page.evaluate(() => __press(77));
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(true);
  await page.evaluate(() => __send([153, 36, 100], 'daw'));
  await expect.poll(() => onCount(page, 0)).toBe(1);
  await page.waitForTimeout(300);
  await page.evaluate(() => __press(76));
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.take.events.some(e => e.type === 'stepWrite'))).toBe(
    true,
  );
  // The take's starting project had no hit; replay must write it again.
  await page.evaluate(() => AfterhoursGrooveLive.clearTrack(0));
  expect(await onCount(page, 0)).toBe(0);
  // Replay restores the project afterwards, so observe the step write itself as it happens.
  await page.evaluate(() => {
    window.__replayed = [];
    const write = AfterhoursGrooveLive.writeStep;
    AfterhoursGrooveLive.writeStep = value => {
      const ok = write(value);
      const lane = AfterhoursGrooveApp.S.data.patterns[value.pattern].tracks[value.lane];
      __replayed.push({ok, lane: value.lane, on: lane.steps.filter(s => s.on).length});
      return ok;
    };
  });
  await page.getByText('Gesture replay & editing', {exact: true}).click();
  await page.locator('#performance-replay').click();
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.replaying)).toBe(false);
  expect(await page.evaluate(() => __replayed)).toContainEqual({ok: true, lane: 0, on: 1});
});

test('SHIFT wins over a held encoder; Stop finishes a starting take from MPK, song Stop or the top bar', async ({
  page,
}) => {
  await enable(page);
  const selected = await page.evaluate(() => AfterhoursGrooveApp.S.selected);
  await page.evaluate(() => {
    window.__jam = 0;
    window.addEventListener('afterhours:midiaction', e => {
      if (e.detail.target.startsWith('action.jam')) __jam++;
    });
    __send([176, 13, 127]);
    __send([176, 17, 127]);
    __send([153, 42, 100], 'daw');
    __send([137, 42, 0], 'daw');
    __send([176, 17, 0]);
    __send([176, 13, 0]);
  });
  expect(await page.evaluate(() => [AfterhoursGrooveApp.S.selected, __jam])).toEqual([selected, 0]);
  // Stop pressed while the take is still starting finishes it instead of being lost.
  await page.evaluate(() => {
    AfterhoursPerformanceStudio.record();
    window.__stopped = AfterhoursPerformanceStudio.stopTake();
  });
  await page.evaluate(() => __stopped);
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  // The top Stop stays usable for a take even when the selected engine cannot stop.
  await page.evaluate(() => AfterhoursShell.setActive('recording'));
  await page.evaluate(() => AfterhoursPerformanceStudio.record());
  await expect(page.locator('#transport-stop')).toBeEnabled();
  await page.locator('#transport-stop').click();
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
  // The song panel's Stop also finishes a take.
  await page.evaluate(() => AfterhoursPerformanceStudio.record());
  await page.locator('#song-stop').click();
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.recording)).toBe(false);
});

test('without SysEx permission plain MIDI still connects and the MPK explains what is missing', async ({page}) => {
  await page.evaluate(() => (window.__denySysex = true));
  await page.locator('#performance-midi-native').click();
  await expect.poll(() => page.evaluate(() => AfterhoursLiveMIDI.sysex)).toBe(false);
  await expect.poll(() => page.evaluate(() => AfterhoursMPK.status)).toContain('SysEx');
  await page.evaluate(() => __send([144, 60, 100], 'keys'));
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().length)).toBe(1);
});

test('Ukrainian status names a loaded song without guessing its grammatical gender', async ({page}) => {
  page.on('dialog', d => d.accept());
  await page.evaluate(() => localStorage.setItem('afterhours-lang', 'uk'));
  await page.reload();
  await page.locator('#performance-toggle').click();
  await page.locator('#song-new').click();
  await expect(page.locator('#status-text')).toContainText('Завантажено «Нова пісня»');
});
