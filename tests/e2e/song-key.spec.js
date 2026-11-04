// @ts-check
const {test, expect} = require('@playwright/test');
const P = require('../../web/groove-presets');
const pack = {
  version: 1,
  presets: [{id: 'register-test', title: 'Register test', project: require('../fixtures/song.cjs')()}],
};
P.register(pack);

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.route('**/content-packs.js', r =>
    r.fulfill({contentType: 'text/javascript', body: `AfterhoursPresets.register(${JSON.stringify(pack)});`}),
  );
  await page.goto('/');
  await page.locator('#ws-groove').click();
});
async function loadFixture(page) {
  await page.locator('#groove-preset').selectOption('register-test');
  await page.locator('#groove-load-preset').click();
}

test('loading a song applies its mix and restoring brings back the previous mute state', async ({page}) => {
  await page.evaluate(() =>
    AfterhoursPerformance.store.update(p => {
      p.mixer.lanes[4].mute = true;
      p.mixer.lanes[2].solo = true;
    }),
  );
  await loadFixture(page);
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer)).toEqual(
    P.create('register-test').performance.mixer,
  );
  await page.reload();
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer)).toEqual(
    P.create('register-test').performance.mixer,
  );
  await page.locator('#groove-restore').click();
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer.lanes[4].mute)).toBe(true);
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mixer.lanes[2].solo)).toBe(true);
});

test('song matching follows the selected part, plays snapped notes and allows manual overrides', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await loadFixture(page);
  await page.getByRole('button', {name: 'Select track 5 Analog', exact: true}).click();
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  await expect(page.locator('#synth-root')).toHaveValue('7');
  await expect(page.locator('#synth-scale')).toHaveValue('minorLeading');
  await expect(page.locator('#synth-octave')).toHaveText('C1–C3');
  await expect(page.locator('#synth-follow')).toBeChecked();
  await page.locator('#synth-match').blur();
  await page.keyboard.down('w'); // C#1 maps down to C1 in G minor.
  await expect(page.locator('#synth-notes')).toHaveText('C1');
  await page.keyboard.up('w');
  await expect(page.locator('#synth-notes')).toHaveText('Ready');
  await page.locator('#ws-groove').click();
  await page.getByRole('button', {name: 'Select track 10 Analog', exact: true}).click();
  await page.locator('#ws-synth').click();
  await expect(page.locator('#synth-octave')).toHaveText('C4–C6');
  for (const width of [390, 900, 1440]) {
    await page.setViewportSize({width, height: 1100});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('.synth-instrument').scrollIntoViewIfNeeded();
  await page.screenshot({path: '.context/keyboard-song-match.png'});
  await page.locator('#synth-octave-up').click();
  await expect(page.locator('#synth-follow')).not.toBeChecked();
  await page.reload();
  await page.locator('#ws-synth').click();
  await expect(page.locator('#synth-octave')).toHaveText('C5–C7');
  await expect(page.locator('#synth-root')).toHaveValue('7');
  expect(errors).toEqual([]);
});

test('matched USB MIDI keeps note-off, sustain and recorded expression tied to the played note', async ({page}) => {
  await loadFixture(page);
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  await page.evaluate(() => {
    window.__gestures = [];
    window.addEventListener('afterhours:gesture', e => __gestures.push(e.detail));
    window.__input = {id: 'match-test', name: 'Test keyboard'};
    AfterhoursLiveMIDI.receive(__input, [0x90, 68, 100]); // G#4 -> G1.
  });
  await expect.poll(() => page.evaluate(() => AfterhoursSynth.held().map(p => p.note))).toEqual([31]);
  await expect.poll(() => page.evaluate(() => __gestures.filter(e => e.type === 'noteOn').length)).toBe(1);
  await page.evaluate(() => {
    AfterhoursLiveMIDI.receive(__input, [0xa0, 68, 80]);
    AfterhoursLiveMIDI.receive(__input, [0xb0, 64, 127]);
    AfterhoursLiveMIDI.receive(__input, [0x80, 68, 0]);
  });
  expect(await page.evaluate(() => AfterhoursSynth.held().map(p => p.note))).toEqual([31]);
  expect(await page.evaluate(() => __gestures.find(e => e.type === 'noteOn').value.note)).toBe(31);
  expect(
    await page.evaluate(
      () => __gestures.filter(e => e.type === 'expression' && e.value.type === 'pressure').at(-1).value.note,
    ),
  ).toBe(31);
  await page.evaluate(() => AfterhoursLiveMIDI.receive(__input, [0xb0, 64, 0]));
  expect(await page.evaluate(() => AfterhoursSynth.held())).toEqual([]);
  // Replay must not apply the live octave mapping for a second time.
  await page.evaluate(() => AfterhoursSynth.on('replayed', 31, 0.8));
  expect(await page.evaluate(() => AfterhoursSynth.held().map(p => p.note))).toEqual([31]);
});

test('snapped MIDI notes retain independent expression and releases', async ({page}) => {
  await loadFixture(page);
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  const result = await page.evaluate(async () => {
    const input = {id: 'overlap', name: 'Overlap keys'},
      events = [];
    window.addEventListener('afterhours:gesture', e => events.push(e.detail));
    AfterhoursLiveMIDI.receive(input, [0x90, 67, 100]);
    AfterhoursLiveMIDI.receive(input, [0x90, 68, 100]);
    // Wait for audio startup and the note-on gestures, not just the held-key UI.
    for (let i = 0; i < 100 && events.filter(e => e.type === 'noteOn').length < 2; i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    AfterhoursLiveMIDI.receive(input, [0xa0, 68, 42]);
    const event = events.filter(e => e.type === 'expression').at(-1).value;
    const held = AfterhoursSynth.held();
    const replayTargets = held.filter(n => n.id.startsWith(event.prefix) && n.note === event.note);
    AfterhoursLiveMIDI.receive(input, [0x80, 68, 0]);
    return {
      notes: held.map(n => n.note),
      targets: replayTargets.map(n => n.id),
      event,
      remaining: AfterhoursSynth.held().map(n => n.id),
    };
  });
  expect(result.notes).toEqual([31, 31]);
  expect(result.targets).toEqual(['midi:overlap:0:68:']);
  expect(result.event).toMatchObject({note: 31, type: 'pressure', value: 42 / 127});
  expect(result.remaining).toEqual(['midi:overlap:0:67:']);
});

test('matching copies the selected instrument and effects, survives reload and portable take validation', async ({
  page,
}) => {
  await loadFixture(page);
  await page.getByRole('button', {name: 'Select track 5 Analog', exact: true}).click();
  await page.evaluate(() => {
    const g = AfterhoursGrooveApp;
    g.S.data.patterns[0].tracks[4].steps[0].locks.cutoff = 1740;
    AfterhoursPerformance.store.update(s => {
      Object.assign(s.mixer.lanes[4], {pan: 0.3, delay: 0.2, reverb: 0.15});
      s.macros[1] = 0.2;
    });
    g.flushSave();
  });
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  const patch = await page.evaluate(() => AfterhoursSynth.snapshot());
  expect(patch).toMatchObject({id: 'groove-part', family: 'groove', lane: 4, track: {machine: 'Analog', cutoff: 1740}});
  expect(patch.performance.mixer.lanes[4]).toMatchObject({pan: 0.3, delay: 0.2, reverb: 0.15});
  expect(patch.performance.macros[1]).toBe(0.2);
  await expect(page.locator('#synth-description')).toContainText('Warm bass');
  await expect(page.locator('#synth-shape-panel')).toBeHidden();
  await page.reload();
  expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toEqual(patch);
  const roundtrip = await page.evaluate(() => {
    const raw = {
      version: 1,
      kind: 'afterhours-performance',
      duration: 1,
      initial: {groove: {project: AfterhoursGrooveApp.S.data}, synth: AfterhoursSynth.snapshot()},
      events: [{time: 0, type: 'patch', value: AfterhoursSynth.snapshot()}],
    };
    return AfterhoursPerformanceCore.take(raw, AfterhoursGroove.validate, AfterhoursGrooveInstrument.validate);
  });
  expect(roundtrip.initial.synth.track).toEqual(patch.track);
  expect(roundtrip.events[0].value.performance).toEqual(patch.performance);
  await page.locator('#ws-synth').click();
  await page.locator('[data-patch="forest"]').click();
  await expect(page.locator('#synth-follow')).not.toBeChecked();
  await expect(page.locator('#synth-shape-panel')).toBeVisible();
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe('forest');
});

test('matched live notes use the same audible voice as Groove and release after key-up', async ({page}) => {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const {machine, gate} of ['Analog', 'Tone', 'WavePad', 'Saw'].flatMap(machine =>
      [0.5, 4].map(gate => ({machine, gate})),
    )) {
      const p = AfterhoursPresets.create('register-test'),
        track = {...p.patterns[0].tracks[4], machine, note: 55};
      const patch = AfterhoursGrooveInstrument.validate({
        track,
        lane: 4,
        performance: p.performance,
        mix: p.mix,
        gate,
      });
      const render = async live => {
        const ctx = new OfflineAudioContext(2, 144000, 24000);
        await AfterhoursVoice.prepare(ctx);
        if (live) {
          const synth = new AfterhoursGrooveInstrument(ctx, patch, p.bpm);
          synth.noteOn('test', 55, 0.8, 0.05);
          synth.noteOff('test', Math.max(1.5, (gate * 60) / p.bpm + 0.1));
        } else {
          const r = new FMGrooveAudio(ctx, p.bpm, undefined, patch.performance, 'synth');
          r.setMix(patch.mix);
          r.hit({lane: 4, settings: patch.track, gate, velocity: 0.8, beat: (0.05 * p.bpm) / 60}, 0.05);
        }
        return (await ctx.startRendering()).getChannelData(0);
      };
      const a = await render(false),
        b = await render(true);
      let diff = 0,
        energy = 0,
        tail = 0,
        sustain = 0;
      for (let i = 2400; i < 7200; i++) {
        diff += (a[i] - b[i]) ** 2;
        energy += a[i] ** 2;
      }
      for (let i = 28800; i < 33600; i++) sustain += b[i] ** 2;
      for (let i = b.length - 8000; i < b.length; i++) tail += b[i] ** 2;
      results.push({
        machine: `${machine} gate ${gate}`,
        relativeError: diff / energy,
        rms: Math.sqrt(energy / 4800),
        tail: Math.sqrt(tail / 8000),
        sustain: Math.sqrt(sustain / 4800),
      });
    }
    return results;
  });
  for (const r of results) {
    expect(r.rms, r.machine).toBeGreaterThan(0.0001);
    expect(r.relativeError, r.machine).toBeLessThan(0.000001);
    expect(r.tail, r.machine).toBeLessThan(0.002);
    expect(r.sustain, r.machine).toBeGreaterThan(0.000001);
  }
});

test('short matched gates preserve the attack ramp and hold sustain', async ({page}) => {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const machine of ['Tone', 'Chord']) {
      const envelopes = [];
      for (const live of [false, true]) {
        const ctx = new OfflineAudioContext(1, 48000, 48000);
        const renderer = new FMGrooveAudio(ctx, 100);
        const settings = {...AfterhoursGroove.project().patterns[0].tracks[4], machine, volume: 100, contour: 100};
        const voice = renderer.hit({lane: 4, settings, gate: 0.003125, velocity: 1, beat: 0}, 0.01, live);
        // Drive the production envelope with DC to measure its ramp independently of oscillator phase.
        voice.nodes[1].disconnect();
        voice.pressure?.disconnect();
        voice.amp.disconnect();
        voice.amp.connect(ctx.destination);
        const dc = ctx.createConstantSource();
        dc.connect(voice.amp);
        dc.start();
        envelopes.push((await ctx.startRendering()).getChannelData(0));
        renderer.dispose();
      }
      const [sequenced, live] = envelopes;
      const attack = machine === 'Chord' ? 0.012 : 0.003;
      const sustain = Math.round((0.01 + attack) * 48000);
      let error = 0;
      for (let i = 480; i <= sustain; i++) error = Math.max(error, Math.abs(sequenced[i] - live[i]));
      results.push({
        machine,
        error,
        midAttack: live[Math.round((0.01 + attack / 2) * 48000)],
        sustain: live[sustain],
        held: live[40000],
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.error, result.machine).toBeLessThan(0.000001);
    expect(result.midAttack, result.machine).toBeGreaterThan(0.05);
    expect(result.held, result.machine).toBeCloseTo(result.sustain, 6);
  }
});

test('a recorded matched instrument replays its sound and restores the previous keyboard preset', async ({page}) => {
  await loadFixture(page);
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  await page.locator('#performance-toggle').click();
  await expect.poll(() => page.locator('#performance-record').isEnabled()).toBe(true);
  await page.locator('#performance-record').click();
  await page.evaluate(() => AfterhoursSynth.on('recorded-match', 31, 0.8));
  await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
  await page.evaluate(() => AfterhoursSynth.off('recorded-match'));
  await page.locator('#performance-stop').click();
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  const take = await page.evaluate(() => AfterhoursPerformanceStudio.take);
  expect(take.initial.synth.id).toBe('groove-part');
  expect(take.events.some(e => e.type === 'noteOn')).toBe(true);
  await page.evaluate(() => {
    AfterhoursSynth.patch({id: 'forest'});
    const on = AfterhoursSynth.on;
    window.__replayedPatches = [];
    AfterhoursSynth.on = (...args) => {
      __replayedPatches.push(AfterhoursSynth.snapshot().id);
      return on(...args);
    };
  });
  await page.evaluate(() => AfterhoursPerformanceStudio.replay());
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.replaying)).toBe(false);
  expect(await page.evaluate(() => __replayedPatches)).toContain('groove-part');
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().id)).toBe('forest');
  expect(await page.evaluate(() => AfterhoursSynth.held())).toEqual([]);
});

test('matching preserves the shortest and longest sequencer gates through reload', async ({page}) => {
  for (const {rate, repeat, gate, expected} of [
    {rate: 0.5, repeat: 1, gate: 8, expected: 4},
    {rate: 2, repeat: 4, gate: 0.1, expected: 0.003125},
  ]) {
    await page.evaluate(
      ({rate, repeat, gate}) => {
        const {S, ui} = AfterhoursGrooveApp;
        S.selected = 4;
        S.selectedStep = 0;
        const track = S.data.patterns[S.data.active].tracks[4];
        track.machine = 'Tone';
        track.rate = rate;
        Object.assign(track.steps[0], {on: true, repeat, gate});
        ui.renderAll();
      },
      {rate, repeat, gate},
    );
    await page.locator('#ws-synth').click();
    await page.locator('#synth-match').click();
    expect(await page.evaluate(() => AfterhoursSynth.snapshot().gate)).toBe(expected);
    await page.reload();
    expect(await page.evaluate(() => AfterhoursSynth.snapshot().gate)).toBe(expected);
  }
});

test('MIDI Learn retains pulse width and glide mappings and controls them after reload', async ({page}) => {
  await page.locator('#ws-synth').click();
  await page.locator('[data-patch="clockwork-pulse"]').click();
  await page.evaluate(() => {
    const input = {id: 'test', name: 'Test keys', manufacturer: 'Local'};
    for (const [key, cc] of [
      ['pulseWidth', 21],
      ['glide', 22],
    ]) {
      window.dispatchEvent(new CustomEvent('afterhours:midilearn', {detail: `synth.${key}`}));
      AfterhoursLiveMIDI.receive(input, [0xb0, cc, 0]); // Learn.
      AfterhoursLiveMIDI.receive(input, [0xb0, cc, 0]); // Arm pickup.
      AfterhoursLiveMIDI.receive(input, [0xb0, cc, 127]); // Cross current value.
    }
    AfterhoursGrooveLive.flush();
  });
  expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toMatchObject({pulseWidth: 0.95, glide: 0.3});
  await page.reload();
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().mappings.map(m => m.target))).toEqual([
    'synth.pulseWidth',
    'synth.glide',
  ]);
  expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toMatchObject({pulseWidth: 0.95, glide: 0.3});
  await page.evaluate(() => {
    const input = {id: 'test', name: 'Test keys', manufacturer: 'Local'};
    for (const cc of [21, 22]) {
      AfterhoursLiveMIDI.receive(input, [0xb0, cc, 127]);
      AfterhoursLiveMIDI.receive(input, [0xb0, cc, 0]);
    }
  });
  expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toMatchObject({pulseWidth: 0.05, glide: 0});
});

test('Follow preserves a saved lead and octave on reload, then follows the next selected part', async ({page}) => {
  await loadFixture(page);
  await page.getByRole('button', {name: 'Select track 10 Analog', exact: true}).click();
  await page.locator('#ws-synth').click();
  await page.locator('#synth-match').click();
  const before = await page.evaluate(() => {
    AfterhoursGrooveLive.flush();
    return AfterhoursSynth.snapshot();
  });
  expect(before.lane).toBe(9);
  await expect(page.locator('#synth-octave')).toHaveText('C4–C6');
  await page.reload();
  await expect(page.locator('#synth-follow')).toBeChecked();
  expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toEqual(before);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-synth-v1')))).toEqual(before);
  await expect(page.locator('#synth-octave')).toHaveText('C4–C6');
  await page.locator('#ws-groove').click();
  await page.getByRole('button', {name: 'Select track 5 Analog', exact: true}).click();
  await page.locator('#ws-synth').click();
  expect(await page.evaluate(() => AfterhoursSynth.snapshot().lane)).toBe(4);
  await expect(page.locator('#synth-octave')).toHaveText('C1–C3');
});
