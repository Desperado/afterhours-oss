const {test, expect} = require('@playwright/test');
const G = require('../../web/groove-core');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await expect(page.locator('#performance-record')).toBeEnabled();
});

async function importTake(page, events = []) {
  const json = await page.evaluate(
    events =>
      JSON.stringify({
        version: 1,
        kind: 'afterhours-performance',
        name: 'Regression take',
        duration: 1,
        initial: {groove: AfterhoursGrooveLive.snapshot(), synth: AfterhoursSynth.snapshot()},
        events,
      }),
    events,
  );
  await page
    .locator('#performance-file')
    .setInputFiles({name: 'take.json', mimeType: 'application/json', buffer: Buffer.from(json)});
  await expect(page.locator('#performance-status')).toContainText('loaded as a new take');
}

for (const phase of ['audio resume', 'capture completion', 'synth prepare', 'sample preparation'])
  for (const next of ['idle', 'record', 'replay']) {
    test(`cancel during ${phase} releases its capture without disturbing ${next}`, async ({page}) => {
      await importTake(page);
      await page.evaluate(async phase => {
        await AfterhoursAudio.arm();
        if (phase === 'synth prepare') {
          const prepare = AfterhoursSynth.prepare;
          AfterhoursSynth.prepare = async () => {
            AfterhoursSynth.prepare = prepare;
            await new Promise(resolve => {
              window.__releaseResume = resolve;
            });
            return prepare();
          };
        } else if (phase === 'sample preparation') {
          const prepare = AfterhoursInstruments.prepare;
          AfterhoursInstruments.prepare = async (...args) => {
            AfterhoursInstruments.prepare = prepare;
            await new Promise(resolve => {
              window.__releaseResume = resolve;
            });
            return prepare(...args);
          };
        } else {
          const start = AfterhoursAudio.start;
          AfterhoursAudio.start = async (...args) => {
            AfterhoursAudio.start = start;
            if (phase === 'capture completion') {
              const result = await start(...args);
              await new Promise(resolve => {
                window.__releaseResume = resolve;
              });
              return result;
            }
            const ctx = AfterhoursAudio.context(),
              resume = ctx.resume.bind(ctx);
            ctx.resume = async () => {
              ctx.resume = resume;
              await new Promise(resolve => {
                window.__releaseResume = resolve;
              });
              return resume();
            };
            return start(...args);
          };
        }
        window.__oldReplay = AfterhoursPerformanceStudio.replay(true).then(
          () => null,
          e => e.message,
        );
      }, phase);
      await expect.poll(() => page.evaluate(() => typeof window.__releaseResume)).toBe('function');
      // Visibility changes use the same cancellation path while start() is awaiting resume.
      await page.evaluate(() => AfterhoursPerformanceStudio.stopReplay());
      if (next === 'record') await page.evaluate(() => AfterhoursPerformanceStudio.record());
      if (next === 'replay') await page.evaluate(() => AfterhoursPerformanceStudio.replay(true));
      await page.evaluate(async () => {
        __releaseResume();
        await __oldReplay;
      });
      expect(
        await page.evaluate(() => ({
          capture: AfterhoursAudio.recording,
          recording: AfterhoursPerformanceStudio.recording,
          replaying: AfterhoursPerformanceStudio.replaying,
        })),
      ).toEqual({capture: next !== 'idle', recording: next === 'record', replaying: next === 'replay'});
      if (next === 'record') await page.evaluate(() => AfterhoursPerformanceStudio.stop());
      if (next === 'replay') await page.evaluate(() => AfterhoursPerformanceStudio.stopReplay());
      await page.locator('#performance-record').click();
      await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#performance-stop').click();
    });
  }

for (const navigation of ['rewind', 'section', 'project', 'preset', 'backup', 'midi']) {
  test(`${navigation} replaces a pending replay cursor before the next Play`, async ({page}) => {
    const project = navigation === 'midi' ? G.project() : await page.evaluate(() => AfterhoursPresets.create('shadow'));
    await page.evaluate(project => {
      AfterhoursGrooveLive.restore({
        project,
        songMode: true,
        songStart: 0,
        offsetTicks: 128,
        loopOrigin: 64,
        songOffset: 0,
      });
    }, project);
    if (navigation === 'rewind') await page.locator('#transport-start').click();
    if (navigation === 'section') await page.evaluate(() => AfterhoursGrooveLive.section(0));
    if (navigation === 'project')
      await page.locator('#groove-file').setInputFiles({
        name: 'project.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(project)),
      });
    if (navigation === 'preset') await page.locator('#groove-load-preset').click();
    if (navigation === 'backup') {
      await page.evaluate(project => {
        localStorage.setItem('afterhours-fm-project-v1-before-preset', JSON.stringify(project));
        AfterhoursGrooveApp.ui.renderAll();
      }, project);
      await page.locator('#groove-restore').click();
    }
    if (navigation === 'midi') {
      const source = G.project().patterns[0];
      source.tracks.forEach(t => t.steps.forEach(s => (s.on = false)));
      source.tracks[5].steps[0].on = true;
      await page
        .locator('#groove-midi-file')
        .setInputFiles({name: 'notes.mid', mimeType: 'audio/midi', buffer: Buffer.from(G.midi(source, 120, 0, 1))});
      await page.locator('#groove-apply-midi').click();
      await expect(page.locator('#groove-midi-dialog')).not.toBeVisible();
    }
    await page.locator('#transport-play').click();
    await expect
      .poll(() => page.evaluate(() => AfterhoursGrooveApp.S.shownFrame?.absolute ?? -1))
      .toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => AfterhoursGrooveApp.S.shownFrame.absolute)).toBeLessThan(16);
    await page.locator('#transport-stop').click();
  });
}

test('Return to start is recorded, validated and applied by replay and rendering', async ({page}) => {
  await page.locator('#performance-record').click();
  await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transport-start').click();
  await page.locator('#performance-stop').click();
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.take.events)).toEqual(
    expect.arrayContaining([expect.objectContaining({type: 'transport', value: 'rewind'})]),
  );
  await page.evaluate(() => {
    const engine = AfterhoursShell.getEngine('groove'),
      start = engine.start;
    window.__rewinds = 0;
    engine.start = () => {
      __rewinds++;
      start();
    };
  });
  await page.getByText('Gesture replay & editing', {exact: true}).click();
  await page.locator('#performance-replay').click();
  await expect.poll(() => page.evaluate(() => __rewinds)).toBe(1);
  await expect.poll(() => page.evaluate(() => AfterhoursPerformanceStudio.replaying)).toBe(false);
  await page.locator('#performance-print').click();
  await expect(page.locator('#performance-status')).toContainText('printed as a new take');
  expect(await page.evaluate(() => __rewinds)).toBe(2);
});

test('keyboard Hold survives focusing and dragging a knob, then returns on document keyup', async ({page}) => {
  await page.locator('#performance-hold').focus();
  await page.keyboard.down('Space');
  const knob = page.getByRole('slider', {name: 'Macro Weight', exact: true});
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 65);
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBeGreaterThan(0.3);
  expect(await page.evaluate(() => AfterhoursPerformance.project().macros[0])).toBe(0);
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => AfterhoursPerformance.snapshot().macros[0])).toBe(0);
  await expect(page.locator('#performance-hold')).toHaveAttribute('aria-pressed', 'false');
});

test('replay ends a held experiment before snapshotting the project and undo history', async ({page}) => {
  await importTake(page);
  const history = await page.evaluate(() => {
    AfterhoursController.change({cutoff: 70});
    AfterhoursPerformance.store.beginHold();
    AfterhoursController.change({cutoff: 25});
    return AfterhoursPerformance.store.past;
  });
  await page.evaluate(() => AfterhoursPerformanceStudio.replay());
  await page.evaluate(() => AfterhoursPerformanceStudio.stopReplay());
  expect(
    await page.evaluate(() => ({
      cutoff: AfterhoursController.snapshot().cutoff,
      hold: AfterhoursPerformance.store.hold,
      history: AfterhoursPerformance.store.past,
    })),
  ).toEqual({cutoff: 70, hold: null, history});
  await page.evaluate(() => AfterhoursGrooveLive.flush());
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('afterhours-fm-project-v1')).performance.controller.cutoff,
    ),
  ).toBe(70);
});

test('Panic after note release is preserved as a gesture for cutting effect tails', async ({page}) => {
  await page.locator('#performance-record').click();
  await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    await AfterhoursSynth.on('tail', 60, 0.8);
    AfterhoursSynth.off('tail');
  });
  expect(await page.evaluate(() => AfterhoursSynth.held())).toEqual([]);
  await page.evaluate(() => AfterhoursSynth.panic());
  await page.locator('#performance-stop').click();
  await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.take.events.map(e => e.type))).toEqual([
    'noteOn',
    'noteOff',
    'panic',
  ]);
});
