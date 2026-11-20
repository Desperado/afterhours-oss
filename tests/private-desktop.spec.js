const {test, expect, _electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const {createHash} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const {selection} = require('../desktop/content.cjs');
const Groove = require('../web/groove-core.js');
const root = path.resolve(__dirname, '..');

test('private desktop preserves every project, original order, tour and required audio', async () => {
  const {pack} = selection(['--private']);
  const expected = JSON.parse(await fs.readFile(path.join(pack, 'pack.json'), 'utf8'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours private '));
  let desktop;
  try {
    const env = {};
    for (const name of ['HOME', 'PATH', 'TMPDIR', 'LANG']) if (process.env[name]) env[name] = process.env[name];
    desktop = await _electron.launch({
      executablePath: process.env.AFTERHOURS_DESKTOP_APP || require('electron'),
      args: [...(process.env.AFTERHOURS_DESKTOP_APP ? [] : [root]), `--data-dir=${dataDir}`],
      env,
    });
    const page = await desktop.firstWindow();
    await expect
      .poll(() => page.evaluate(() => window.AfterhoursPresets?.catalog.map(p => p.id)), {timeout: 30000})
      .toContain(expected.presets[0].id);
    await page.locator('#performance-toggle').click();
    await expect(page.locator('#performance-midi-native')).toBeVisible();
    await expect(page.locator('#performance-midi-controls li')).toHaveCount(8);
    await page.locator('#performance-midi-track-sound').click();
    await expect(page.locator('#performance-midi-bank')).toHaveValue('track-sound');
    const cutoff = await page.evaluate(() => {
      const target = AfterhoursMPKControls.target('track-sound', 0);
      const before = target.get();
      AfterhoursMPKControls.turn(target, -1);
      return {before, after: target.get()};
    });
    expect(cutoff.after).toBeLessThan(cutoff.before);
    expect(await page.evaluate(() => typeof window.AfterhoursMPK?.reconnect)).toBe('function');
    expect(await page.evaluate(() => typeof window.AfterhoursMPKProtocol?.text)).toBe('function');
    expect(await page.evaluate(() => AfterhoursMPKProtocol.text(0, 'AFTERHOURS')[7])).toBe(2);
    expect(await page.evaluate(() => AfterhoursMPKProtocol.parse(AfterhoursMPKProtocol.row(2)).payload)).toEqual([
      2, 2, 0, 31, 63, 31, 0, 0, 0,
    ]);
    expect(await page.evaluate(() => AfterhoursGrooveLive.selectLane(8))).toBe(true);
    await expect(page.locator('#perform-pad-8')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => AfterhoursGrooveLive.selectLane(0));
    await expect(page.locator('#performance-midi-auto')).toBeVisible();
    await expect(page.locator('#performance-midi-extra')).toBeVisible();
    await expect(page.locator('#jam-listen')).toBeVisible();
    expect(
      await page.evaluate(() =>
        AfterhoursJamCore.compose([
          {note: 60, start: 0, duration: 0.2, velocity: 0.8},
        ]).project.patterns[0].tracks[4].steps.some(s => s.on),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => typeof AfterhoursSynth.stepPreset)).toBe('function');
    await page.getByText('USB MIDI + MIDI Learn', {exact: true}).click();
    await page.locator('#performance-midi-profile').selectOption('mpk-mini-plus-ii');
    await expect(page.locator('#performance-midi-mpk')).toBeVisible();
    expect(await page.evaluate(() => typeof window.AfterhoursMIDIClock)).toBe('function');
    expect(await page.evaluate(() => AfterhoursPerformance.snapshot().midi.profile)).toBe('mpk-mini-plus-ii');
    await page.locator('[aria-label="MPK mini Plus II setup"]').screenshot({path: '.context/mpk-live-controls.png'});
    await page.locator('#performance-toggle').click();
    await expect(page.locator('#song-play')).toBeVisible();
    await expect(page.locator('#song-instrument')).toBeVisible();
    const result = await page.evaluate(
      async ({ids, assets}) => {
        const hashes = [];
        for (const id of ids) {
          const bytes = new TextEncoder().encode(JSON.stringify(AfterhoursPresets.create(id)));
          const hash = await crypto.subtle.digest('SHA-256', bytes);
          hashes.push(Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join(''));
        }
        const failures = [];
        for (let start = 0; start < assets.length; start += 16) {
          await Promise.all(
            assets.slice(start, start + 16).map(async asset => {
              const response = await fetch('/' + asset, {headers: {Range: 'bytes=0-3'}});
              const signature = await response.text();
              if (response.status !== 206 || signature !== (asset.endsWith('.wav') ? 'RIFF' : 'fLaC'))
                failures.push(asset);
            }),
          );
        }
        return {
          hashes,
          failures,
          first: AfterhoursPresets.catalog.slice(0, ids.length).map(p => p.id),
          demo: AfterhoursPresets.demo,
        };
      },
      {ids: expected.presets.map(p => p.id), assets: expected.assets},
    );
    expect(result.hashes).toEqual(
      expected.presets.map(p => {
        const migrated = structuredClone(p.project);
        if (migrated.performance && !migrated.performance.midi)
          migrated.performance.midi = {profile: 'generic', knobBank: 'synth', padMode: 'drums', native: false};
        if (migrated.performance?.midi) migrated.performance.midi.native = migrated.performance.midi.native === true;
        for (const lane of migrated.performance?.mixer?.lanes || []) if (lane.drive === undefined) lane.drive = 0;
        const validated = Groove.validate(p.project);
        // Legacy projects gain default device fields and neutral lane drive; musical data stays identical.
        expect(validated).toEqual(migrated);
        return createHash('sha256').update(JSON.stringify(validated)).digest('hex');
      }),
    );
    expect(result.first).toEqual(expected.presets.map(p => p.id));
    expect(result.demo).toEqual(expected.demo);
    expect(result.failures).toEqual([]);
    const audio = await page.evaluate(async () => {
      const track = {
        ...AfterhoursGroove.project().patterns[0].tracks[4],
        machine: 'Instrument',
        instrument: 'growlybass',
        note: 48,
        volume: 80,
        cutoff: 16000,
      };
      await AfterhoursInstruments.prepare([{tracks: [track]}]);
      const context = new OfflineAudioContext(2, 24000, 48000);
      const renderer = new FMGrooveAudio(context, 120);
      renderer.hit({lane: 4, settings: track, velocity: 0.9, gate: 0.4}, 0.01);
      const buffer = await context.startRendering();
      return buffer.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    });
    expect(audio).toBeGreaterThan(0.001);
    await page.screenshot({path: '.context/private-desktop.png'});
  } finally {
    if (desktop) await desktop.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});
