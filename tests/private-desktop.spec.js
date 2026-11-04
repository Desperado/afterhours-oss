const {test, expect, _electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const {createHash} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const {selection} = require('../desktop/content.cjs');
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
      expected.presets.map(p => createHash('sha256').update(JSON.stringify(p.project)).digest('hex')),
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
