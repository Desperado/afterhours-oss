const {test, expect, _electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

async function launch(dataDir) {
  const env = {};
  for (const name of ['HOME', 'PATH', 'TMPDIR', 'LANG']) if (process.env[name]) env[name] = process.env[name];
  const executablePath = process.env.AFTERHOURS_DESKTOP_APP || require('electron');
  const args = process.env.AFTERHOURS_DESKTOP_APP ? [] : [root];
  const desktop = await _electron.launch({executablePath, args: [...args, `--data-dir=${dataDir}`], env});
  try {
    await desktop.firstWindow();
    return desktop;
  } catch (error) {
    try {
      const state = await desktop.evaluate(({app, BrowserWindow}) => ({
        ready: app.isReady(),
        windows: BrowserWindow.getAllWindows().length,
        packaged: app.isPackaged,
      }));
      await test.info().attach('desktop-startup-state', {body: JSON.stringify(state), contentType: 'application/json'});
    } finally {
      await desktop.close();
    }
    throw error;
  }
}

function recording() {
  const rate = 22050,
    duration = 12,
    buffer = Buffer.alloc(44 + rate * duration * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let beat = 0.37; beat < duration - 0.1; beat += 0.5)
    for (let n = 0; n < 800; n++) {
      const value = Math.sin(n * 1.2345) * Math.exp(-n / 90) * 20000;
      buffer.writeInt16LE(Math.round(value), 44 + (Math.round(beat * rate) + n) * 2);
    }
  return buffer;
}

// @9l-assertion-helper
async function ready(page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        core: typeof AfterhoursGroove,
        audio: typeof FMGrooveAudio,
        midi: typeof AfterhoursMIDI,
        controller: typeof AfterhoursController === 'object' && typeof AfterhoursController.Session,
        timbres: typeof AfterhoursTimbres === 'object' && typeof AfterhoursTimbres.create,
        patches: typeof AfterhoursSynthAudio === 'function' ? AfterhoursSynthAudio.presets.length : 0,
        lanes: typeof AfterhoursGroove === 'object' ? AfterhoursGroove.trackCount : 0,
        songs:
          typeof AfterhoursPresets === 'object' &&
          ['shadow', 'overpass', 'relay', 'orchid', 'letters', 'glass', 'satellite'].every(id =>
            AfterhoursPresets.catalog.some(c => c.id === id),
          ),
        recording: typeof AfterhoursShell === 'object' && !!AfterhoursShell.getEngine('recording'),
        groove: typeof AfterhoursShell === 'object' && !!AfterhoursShell.getEngine('groove'),
      })),
    )
    .toEqual({
      core: 'object',
      audio: 'function',
      midi: 'object',
      controller: 'function',
      timbres: 'function',
      patches: 16,
      lanes: 16,
      songs: true,
      recording: true,
      groove: true,
    });
}

test('desktop prepares cold Rust wavetable voices through the app protocol', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours wavetables '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    const page = await desktop.firstWindow();
    await ready(page);
    expect(
      await page.evaluate(async () => {
        const ctx = new OfflineAudioContext(1, 4800, 48000);
        const prepared = await AfterhoursVoice.prepare(ctx);
        return {prepared, failure: prepared ? '' : AfterhoursVoice.failure};
      }),
    ).toEqual({prepared: true, failure: ''});
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('desktop loads packaged sampled instruments and renders actual recordings', async () => {
  const manifest = require('../web/instruments/growlybass/manifest.json');
  test.skip(
    !require('node:fs').existsSync(path.join(root, 'web/instruments/growlybass', manifest.regions[0].sample)),
    'Install instrument recordings first',
  );
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours instruments '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    const page = await desktop.firstWindow();
    await ready(page);
    const result = await page.evaluate(async () => {
      const track = {
        ...AfterhoursGroove.project().patterns[0].tracks[4],
        machine: 'Instrument',
        instrument: 'growlybass',
        note: 48,
        volume: 80,
        cutoff: 16000,
      };
      await AfterhoursInstruments.prepare([{tracks: [track]}]);
      const ctx = new OfflineAudioContext(2, 24000, 48000),
        renderer = new FMGrooveAudio(ctx, 120);
      renderer.hit({lane: 4, settings: track, velocity: 0.9, gate: 0.5}, 0.01);
      const buffer = await ctx.startRendering();
      return {
        peak: buffer.getChannelData(0).reduce((p, x) => Math.max(p, Math.abs(x)), 0),
        cached: AfterhoursInstruments.decodedBytes,
      };
    });
    expect(result.peak).toBeGreaterThan(0.001);
    expect(result.cached).toBeGreaterThan(100 * 1024 * 1024);
    await page.evaluate(() => {
      Object.assign(AfterhoursGrooveApp.S.data.patterns[0].tracks[4], {
        machine: 'Instrument',
        instrument: 'growlybass',
      });
    });
    await page.evaluate(() => {
      AfterhoursGrooveApp.S.selected = 4;
    });
    await page.locator('#ws-synth').click();
    await page.locator('#synth-match').click();
    expect(await page.evaluate(() => AfterhoursSynth.snapshot().track.instrument)).toBe('growlybass');
    await page.evaluate(() => AfterhoursSynth.on('sampled-desktop-key', 48, 0.9));
    await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
    await page.evaluate(() => AfterhoursSynth.off('sampled-desktop-key'));
    await page.screenshot({path: '.context/sampled-instruments-desktop.png'});
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('desktop imports and syncs a recording, plays both engines and keeps projects across restarts', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours desktop '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    let page = await desktop.firstWindow();
    await ready(page);
    await expect(page.locator('#ws-groove')).toBeVisible();
    await page.locator('#controller-toggle').click();
    await expect(page.locator('#controller-panel')).toBeVisible();
    await page.locator('#controller-preset').selectOption('glass');
    await expect(page.locator('#controller-temperament')).toHaveValue('19edo');
    await page.locator('#controller-reset').click();
    await page.locator('#controller-close').click();
    await page.locator('#ws-listen').click();
    await page.locator('#file').setInputFiles({name: 'Desktop groove.wav', mimeType: 'audio/wav', buffer: recording()});
    await expect(page.locator('#title')).toHaveText('Desktop groove');
    await expect.poll(() => page.locator('#audio').evaluate(a => a.readyState)).toBeGreaterThanOrEqual(1);
    await page.locator('#ws-groove').click();
    await page.locator('#groove-sync').click();
    await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'true', {timeout: 60000});
    const bpm = Number(await page.locator('#transport-tempo').inputValue());
    expect(bpm).toBeGreaterThan(110);
    expect(bpm).toBeLessThan(130);
    await page.locator('#transport-play').click();
    await expect(page.locator('#engine-recording .engine-state')).toHaveText('Playing');
    await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
    await expect.poll(() => page.locator('#audio').evaluate(a => a.currentTime)).toBeGreaterThan(0.1);
    await page.locator('#transport-stop').click();
    await expect(page.locator('#engine-recording .engine-state')).toHaveText('Paused');
    await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
    await page.locator('#transport-tempo-slider').fill('117');
    await page.locator('#transport-tempo-slider').dispatchEvent('input');
    await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
    const exported = path.join(dataDir, 'exported-project.json');
    await desktop.evaluate(
      ({session}, file) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(file)),
      exported,
    );
    await page.locator('#groove-export').click();
    await page.locator('#groove-project').click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await fs.readFile(exported, 'utf8')).bpm;
        } catch {
          return null;
        }
      })
      .toBe(117);
    await desktop.close();
    desktop = await launch(dataDir);
    page = await desktop.firstWindow();
    await ready(page);
    await expect(page.locator('#transport-tempo')).toHaveValue('117');
    await expect(page.locator('#groove-sync')).toBeEnabled();
    await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#ws-listen').click();
    await expect(page.locator('#title')).toHaveText('Desktop groove');
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('desktop renderer is sandboxed and blocks external navigation and requests', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours isolation '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    const page = await desktop.firstWindow();
    await ready(page);
    await expect(page.locator('#ws-groove')).toBeVisible();
    expect(page.url()).toBe('afterhours://app/');
    expect(await page.evaluate(() => [typeof require, typeof process])).toEqual(['undefined', 'undefined']);
    const preferences = await desktop.evaluate(({BrowserWindow}) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        sandbox: p.sandbox,
        nodeIntegration: p.nodeIntegration,
        contextIsolation: p.contextIsolation,
        webSecurity: p.webSecurity,
      };
    });
    expect(preferences).toEqual({sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true});
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('https://example.com/');
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await desktop.evaluate(({BrowserWindow}) => {
      global.__navigationBlocked = null;
      BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', event => {
        global.__navigationBlocked = event.defaultPrevented;
      });
    });
    await page.evaluate(() => {
      window.open('https://example.com/');
      window.location.href = 'https://example.com/';
    });
    await expect.poll(() => desktop.evaluate(() => global.__navigationBlocked)).toBe(true);
    expect(await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe(
      'afterhours://app/',
    );
    expect((await desktop.windows()).length).toBe(1);
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('desktop connects MIDI without SysEx and records audible audio through its private origin', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours performance '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    const page = await desktop.firstWindow();
    await ready(page);
    const permissions = await page.evaluate(async () => ({
      notes: (await navigator.permissions.query({name: 'midi', sysex: false})).state,
      sysexEnabled: (await navigator.requestMIDIAccess({sysex: false})).sysexEnabled,
      microphone: (await navigator.permissions.query({name: 'microphone'})).state,
    }));
    expect(permissions).toEqual({notes: 'granted', sysexEnabled: false, microphone: 'denied'});
    await page.locator('#performance-toggle').click();
    await page.getByText('USB MIDI + MIDI Learn', {exact: true}).click();
    await page.locator('#performance-midi-connect').click();
    await expect(page.locator('#performance-midi-status')).toContainText('MIDI connected');
    await page.evaluate(() =>
      AfterhoursSynth.patch(AfterhoursSynthAudio.presets.find(p => p.id === 'clockwork-pulse')),
    );
    await page.getByLabel('Next take name', {exact: true}).fill('First desktop take');
    await page.locator('#performance-record').click();
    await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(async () => {
      window.__desktopStart = AfterhoursAudio.context().currentTime;
      await AfterhoursSynth.on('desktop-key', 60, 0.8);
    });
    await expect
      .poll(() => page.evaluate(() => AfterhoursAudio.context().currentTime - window.__desktopStart))
      .toBeGreaterThan(1);
    await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
    await page.evaluate(() => AfterhoursSynth.off('desktop-key'));
    await page.locator('#performance-stop').click();
    await expect(page.locator('#performance-status')).toContainText('Take saved locally');
    expect(await page.evaluate(() => AfterhoursPerformanceStudio.audio.size)).toBeGreaterThan(44);
    await page.getByText('Name or edit parts', {exact: true}).click();
    await page.getByLabel('Part name', {exact: true}).fill('Desktop intro');
    await page.getByLabel('Part start (seconds)', {exact: true}).fill('0.1');
    await page.getByLabel('Part end (seconds)', {exact: true}).fill('0.5');
    await page.getByRole('button', {name: 'Save part', exact: true}).click();
    await expect(page.getByLabel('Playback part', {exact: true}).locator('option')).toHaveCount(2);
    await page.getByLabel('Next take name', {exact: true}).fill('Second desktop take');
    await page.locator('#performance-record').click();
    await page.evaluate(async () => {
      window.__desktopStart = AfterhoursAudio.context().currentTime;
      await AfterhoursSynth.on('desktop-second', 64, 0.8);
    });
    await expect
      .poll(() => page.evaluate(() => AfterhoursAudio.context().currentTime - window.__desktopStart))
      .toBeGreaterThan(1);
    await page.evaluate(() => AfterhoursSynth.off('desktop-second'));
    await page.locator('#performance-stop').click();
    await expect(page.getByLabel('Saved performances', {exact: true}).locator('option')).toHaveCount(2);
    await page.locator('#performance-panel').evaluate(panel => {
      panel.scrollTop = 0;
    });
    await page.screenshot({path: '.context/performance-studio-desktop.png'});
    await desktop.close();
    desktop = await launch(dataDir);
    const reopened = await desktop.firstWindow();
    await ready(reopened);
    await reopened.locator('#performance-toggle').click();
    await expect(reopened.locator('#performance-status')).toContainText('Last performance restored');
    await expect(reopened.getByLabel('Saved performances', {exact: true}).locator('option')).toHaveCount(2);
    await expect(reopened.getByLabel('Take name', {exact: true})).toHaveValue('Second desktop take');
    const first = await reopened
      .getByLabel('Saved performances', {exact: true})
      .locator('option')
      .filter({hasText: 'First desktop take'})
      .getAttribute('value');
    await reopened.getByLabel('Saved performances', {exact: true}).selectOption(first);
    const intro = await reopened
      .getByLabel('Playback part', {exact: true})
      .locator('option')
      .filter({hasText: 'Desktop intro'})
      .getAttribute('value');
    await reopened.getByLabel('Playback part', {exact: true}).selectOption(intro);
    await reopened.getByRole('button', {name: 'Play selected part', exact: true}).click();
    await expect
      .poll(() =>
        reopened.locator('#performance-player').evaluate(p => p.paused && Math.abs(p.currentTime - 0.5) < 0.02),
      )
      .toBe(true);
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('packaged Rust voices render and release through the app protocol', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours rust '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    const page = await desktop.firstWindow();
    await ready(page);
    const result = await page.evaluate(async () => {
      const ctx = new OfflineAudioContext(2, 48000 * 3, 48000);
      if (!(await AfterhoursVoice.prepare(ctx))) throw new Error('Packaged Rust voice did not load');
      const synth = new AfterhoursSynthAudio(ctx);
      synth.setPatch(AfterhoursSynthAudio.presets.find(p => p.id === 'clockwork-pulse'));
      synth.noteOn('packaged', 60, 0.8, 0.05);
      synth.noteOff('packaged', 0.6);
      const data = (await ctx.startRendering()).getChannelData(0);
      const result = {
        energy: data.reduce((sum, x) => sum + x * x, 0),
        finite: data.every(Number.isFinite),
        voices: synth.voices.size,
      };
      synth.dispose();
      return result;
    });
    expect(result.energy).toBeGreaterThan(1);
    expect(result.finite).toBe(true);
    expect(result.voices).toBe(0);
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('packaged keyboard matches a Groove instrument and plays it after restarting', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours matched keyboard '));
  let desktop;
  try {
    desktop = await launch(dataDir);
    let page = await desktop.firstWindow();
    await ready(page);
    await page.evaluate(project => {
      AfterhoursGrooveApp.S.data = project;
      AfterhoursGrooveApp.ui.renderAll();
    }, require('./fixtures/song.cjs')());
    await page.getByRole('button', {name: 'Select track 5 Analog', exact: true}).click();
    await page.locator('#ws-synth').click();
    await page.locator('#synth-match').click();
    const matched = await page.evaluate(() => AfterhoursSynth.snapshot());
    expect(matched.id).toBe('groove-part');
    expect(matched.track.machine).toBe('Analog');
    expect(matched.track.cutoff).toBe(620);
    await desktop.close();
    desktop = await launch(dataDir);
    page = await desktop.firstWindow();
    await ready(page);
    expect(await page.evaluate(() => AfterhoursSynth.snapshot())).toEqual(matched);
    await page.evaluate(() => AfterhoursSynth.on('matched-key', 31, 0.8));
    await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
    await page.evaluate(() => AfterhoursSynth.off('matched-key'));
    await expect.poll(() => page.evaluate(() => AfterhoursSynth.held())).toEqual([]);
    await expect.poll(() => page.evaluate(() => AfterhoursAudio.meter().peak)).toBeLessThan(-60);
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});
