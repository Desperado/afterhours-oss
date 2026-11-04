// @ts-check
const {test, expect} = require('@playwright/test');
const {silentWav, routeAudio} = require('./fixtures');

const track = {
  id: 'fixture',
  title: 'Sync test',
  format: 'WAV',
  duration: 60,
  sample_rate: 8000,
  channels: 1,
  waveform: Array(360).fill(0.5),
  rms_dbfs: -18,
  peak_dbfs: -3,
  sessions: [],
  summary: null,
};
const grid = {bpm: 120, beats: Array.from({length: 118}, (_, i) => 0.37 + i * 0.5), method: 'local_beat_tracking'};

async function openFixture(page, respond = route => route.fulfill({json: grid})) {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.route('**/api/library', r => r.fulfill({json: {tracks: [track], jobs: [], key_ready: false}}));
  await page.route('**/api/tracks/fixture', r => r.fulfill({json: track}));
  await page.route('**/api/tracks/fixture/sync', respond);
  await routeAudio(page, 'fixture', silentWav(60));
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
  });
  await page.goto('/');
  await expect(page.locator('#groove-sync')).toBeEnabled();
  await expect.poll(() => page.locator('#audio').evaluate(a => a.readyState)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    window.__syncHits = [];
    window.__seeks = 0;
    document.querySelector('#audio').addEventListener('seeked', () => window.__seeks++);
    const hit = FMGrooveAudio.prototype.hit;
    FMGrooveAudio.prototype.hit = function (event, when) {
      const media = document.querySelector('#audio');
      window.__syncHits.push({
        beat: event.beat,
        position: media.currentTime + (when - this.context.currentTime) * media.playbackRate,
      });
      return hit.call(this, event, when);
    };
  });
}
async function link(page) {
  await page.locator('#groove-sync').click();
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'true');
}

for (const early of [false, true])
  for (const action of ['seek', 'ratechange'])
    test(`synced ${action} resumes overlapping ${early ? 'early ' : ''}samples once and skips expired slices`, async ({
      page,
    }) => {
      await openFixture(page, r => r.fulfill({json: {bpm: 120, beats: Array.from({length: 120}, (_, i) => i * 0.5)}}));
      await page.evaluate(early => {
        // Explicit media events exercise the reset without a browser buffering event restarting transport.
        const media = (window.__sampleMedia = new EventTarget());
        Object.assign(media, {
          paused: true,
          seeking: false,
          ended: false,
          currentTime: early ? 0.08 : 0,
          playbackRate: 1,
        });
        const recording = AfterhoursShell.getEngine('recording');
        recording.source = () => ({id: 'fixture', title: 'Sync test', media});
        recording.play = async () => {
          media.paused = false;
        };
        recording.stop = () => {
          media.paused = true;
        };
        const {S, ui} = AfterhoursGrooveApp;
        S.data = AfterhoursGroove.project();
        S.data.swing = 0;
        for (const track of S.data.patterns[0].tracks) for (const step of track.steps) step.on = false;
        const track = S.data.patterns[0].tracks[12];
        Object.assign(track, {
          machine: 'Sample',
          rate: 0.5,
          length: 64,
          sample: {id: 'sync-test', offset: 0, bpm: 120},
        });
        Object.assign(track.steps[early ? 1 : 0], {on: true, gate: early ? 2 : 8, micro: early ? -0.4 : 0});
        ui.renderAll();
        const buffer = new AudioBuffer({numberOfChannels: 1, length: 80000, sampleRate: 8000});
        AfterhoursSamples.prepare = async () => {};
        AfterhoursSamples.get = () => buffer;
        window.__sampleHits = [];
        const hit = FMGrooveAudio.prototype.hit;
        FMGrooveAudio.prototype.hit = function (event, when) {
          if (event.settings.machine === 'Sample')
            __sampleHits.push({gate: event.gate, skip: event.sampleSkip, bpm: this.bpm});
          return hit.call(this, event, when);
        };
      }, early);
      await link(page);
      await page.locator('#transport-play').click();
      await expect.poll(() => page.evaluate(() => __sampleHits.length)).toBe(1);
      await page.evaluate(
        ({action, early}) => {
          __sampleHits = [];
          const media = __sampleMedia;
          if (action === 'seek') {
            media.seeking = true;
            media.dispatchEvent(new Event('seeking'));
            media.currentTime = early ? 0.15 : 1;
            media.seeking = false;
            media.dispatchEvent(new Event('seeked'));
          } else {
            media.currentTime = early ? 0.14 : 0.5;
            media.playbackRate = 1.25;
            media.dispatchEvent(new Event('ratechange'));
          }
        },
        {action, early},
      );
      await expect.poll(() => page.evaluate(() => __sampleHits.length)).toBe(1);
      const skip = early ? 0.075 : action === 'seek' ? 2.125 : 1.125;
      const hit = await page.evaluate(() => __sampleHits[0]);
      expect(hit.skip).toBeCloseTo(skip, 8);
      expect(hit.gate).toBeCloseTo((early ? 1 : 4) - skip, 8);
      expect(hit.bpm).toBe(action === 'seek' ? 120 : 150);
      // Advance past the next scheduling horizon without crossing another sample trigger.
      await page.evaluate(() => {
        __sampleMedia.currentTime += 0.25;
      });
      await expect
        .poll(() => page.evaluate(() => AfterhoursGrooveApp.S.syncTick - __sampleMedia.currentTime * 16))
        .toBeGreaterThan(1);
      expect(await page.evaluate(() => __sampleHits.length)).toBe(1);
      await page.evaluate(() => {
        __sampleHits = [];
        __sampleMedia.currentTime = 3;
        __sampleMedia.dispatchEvent(new Event('seeked'));
      });
      await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.syncTick)).toBeGreaterThan(48);
      expect(await page.evaluate(() => __sampleHits)).toEqual([]);
      expect(await page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(true);
    });

async function seek(page, seconds) {
  await page.locator('#seek').fill(String(seconds));
  await page.locator('#seek').dispatchEvent('input');
  await expect.poll(() => page.locator('#audio').evaluate(a => a.seeking)).toBe(false);
}
// @9l-assertion-helper
async function aligned(page) {
  await expect.poll(() => page.evaluate(() => window.__syncHits.length)).toBeGreaterThan(4);
  const errors = await page.evaluate(() => window.__syncHits.map(h => Math.abs(h.position - (0.37 + h.beat * 0.5))));
  expect(Math.max(...errors)).toBeLessThan(0.03);
}

test('Auto sync aligns hits with the recording through seek and speed changes', async ({page}) => {
  await openFixture(page);
  await link(page);
  await expect(page.locator('#transport-tempo')).toHaveValue('120.0');
  expect(await page.locator('#audio').evaluate(a => a.paused)).toBe(true);
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-recording .engine-state')).toHaveText('Playing');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await expect(page.locator('#chip-separate-clock')).toBeHidden();
  await aligned(page);
  await page.locator('#ws-listen').click();
  await seek(page, 9.37);
  await page.locator('#speed').fill('1.25');
  await page.locator('#speed').dispatchEvent('input');
  await page.evaluate(() => {
    window.__syncHits = [];
  });
  await expect(page.locator('#transport-tempo')).toHaveValue('150.0');
  await aligned(page);
  expect(await page.evaluate(() => Math.min(...window.__syncHits.map(h => h.position)))).toBeGreaterThan(9.37);
  await page.locator('#transport-stop').click();
  await expect(page.locator('#engine-recording .engine-state')).toHaveText('Paused');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
});

test('linked engines follow Recording pause and A–B loops; manual BPM unlinks', async ({page}) => {
  await openFixture(page);
  await link(page);
  await page.locator('#ws-listen').click();
  await seek(page, 8.37);
  await page.locator('#loop-a').click();
  await seek(page, 9.37);
  await page.locator('#loop-b').click();
  await page.locator('#engine-recording').click();
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  const seeks = await page.evaluate(() => window.__seeks);
  await expect.poll(() => page.evaluate(() => window.__seeks), {timeout: 6000}).toBeGreaterThan(seeks);
  await aligned(page);
  await page.locator('#transport-stop').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.locator('#engine-groove').click();
  await page.getByRole('slider', {name: 'Groove tempo', exact: true}).fill('121');
  await page.getByRole('slider', {name: 'Groove tempo', exact: true}).dispatchEvent('input');
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#transport-tempo')).toHaveValue('121');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await expect(page.locator('#chip-separate-clock')).toBeVisible();
});

test('cancelled beat detection cannot enable sync; detection errors are recoverable', async ({page}) => {
  let release,
    started = false;
  const held = new Promise(resolve => {
    release = resolve;
  });
  await openFixture(page, async route => {
    started = true;
    await held;
    await route.fulfill({json: grid}).catch(() => {});
  });
  const initialTempo = await page.locator('#transport-tempo').inputValue();
  await page.locator('#groove-sync').click();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator('#groove-sync')).toHaveText('Cancel sync');
  await page.locator('#groove-sync').click();
  release();
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#transport-tempo')).toHaveValue(initialTempo);
  await page.route('**/api/tracks/fixture/sync', route =>
    route.fulfill({status: 400, json: {error: 'No clear beat found. Set BPM manually.'}}),
  );
  await page.locator('#groove-sync').click();
  await expect(page.locator('#groove-sync-status')).toHaveText('No clear beat found. Set BPM manually.');
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#audio').evaluate(a => a.paused)).toBe(true);
});

test('Auto sync preserves early microtiming on half-speed lanes', async ({page}) => {
  const project = require('../../web/groove-core.js').project();
  project.swing = 0;
  for (const pattern of project.patterns)
    for (const lane of pattern.tracks) for (const step of lane.steps) step.on = false;
  const lane = project.patterns[0].tracks[0];
  lane.rate = 0.5;
  lane.steps[1].on = true;
  lane.steps[1].micro = -0.4;
  await page.addInitScript(value => localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(value)), project);
  await openFixture(page, route =>
    route.fulfill({json: {bpm: 60, beats: Array.from({length: 59}, (_, i) => 0.37 + i)}}),
  );
  await link(page);
  await page.locator('#transport-play').click();
  await expect.poll(() => page.evaluate(() => window.__syncHits.length), {timeout: 3000}).toBeGreaterThan(0);
  const hit = await page.evaluate(() => window.__syncHits[0]);
  expect(hit.beat).toBeCloseTo(0.3, 6);
  expect(Math.abs(hit.position - 0.67)).toBeLessThan(0.03);
});

test('report refresh preserves pending sync; choosing a recording unlinks it', async ({page}) => {
  let finishGrid, finishRefresh;
  const gridReady = new Promise(resolve => {
    finishGrid = resolve;
  });
  const refreshReady = new Promise(resolve => {
    finishRefresh = resolve;
  });
  await openFixture(page, async route => {
    await gridReady;
    await route.fulfill({json: grid});
  });
  await page.locator('#groove-sync').click();
  await expect(page.locator('#groove-sync')).toHaveText('Cancel sync');
  await page.route('**/api/tracks/fixture', async route => {
    await refreshReady;
    await route.fulfill({json: track});
  });
  await page.evaluate(() => {
    void loadTrack('fixture', true);
  });
  await expect.poll(() => page.evaluate(() => state.loading)).toBe(true);
  finishGrid();
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#groove-sync')).toBeEnabled();
  finishRefresh();
  await expect.poll(() => page.evaluate(() => state.loading)).toBe(false);
  await page.locator('#ws-listen').click();
  await page.locator('#library button').filter({hasText: 'Sync test'}).click();
  await expect(page.locator('#groove-sync')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
});

test('section jumps stay disabled throughout recording sync and recover when unlinked', async ({page}) => {
  await openFixture(page);
  await page.locator('#groove-load-preset').click();
  const first = page.locator('#groove-arrangement button').first();
  await expect(first).toBeEnabled();
  await link(page);
  await expect(first).toBeDisabled();
  await page.locator('#groove-sync').click();
  await expect(first).toBeEnabled();
});

test('Copilot: manual unlink preserves the audible pattern position and recording playback', async ({page}) => {
  await openFixture(page);
  await link(page);
  await page.locator('#ws-listen').click();
  await seek(page, 20.37);
  await page.locator('#engine-groove').click();
  await page.locator('#transport-play').click();
  await expect.poll(() => page.evaluate(() => window.__syncHits.some(h => h.beat >= 40))).toBe(true);
  const result = await page.evaluate(() => {
    const media = document.querySelector('#audio');
    window.__unlinkPosition = media.currentTime;
    __syncHits = [];
    AfterhoursShell.getEngine('groove').tempo().set(121);
    return {paused: media.paused, beat: (media.currentTime - 0.37) * 2};
  });
  expect(result.paused).toBe(false);
  await expect.poll(() => page.evaluate(() => __syncHits.length)).toBeGreaterThan(0);
  const beat = await page.evaluate(() => __syncHits[0].beat);
  expect(beat).toBeGreaterThanOrEqual(Math.floor(result.beat * 8) / 8);
  expect(beat).toBeLessThan(result.beat + 1);
});

test('Copilot: linked playback speed updates the Space echo tempo', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {
    const hit = FMGrooveAudio.prototype.hit;
    FMGrooveAudio.prototype.hit = function (...args) {
      window.__syncAudio = this;
      return hit.apply(this, args);
    };
  });
  await link(page);
  await page.locator('#transport-play').click();
  await expect.poll(() => page.evaluate(() => window.__syncAudio?.bpm)).toBeCloseTo(120, 2);
  await page.locator('#ws-listen').click();
  await page.locator('#speed').fill('1.25');
  await page.locator('#speed').dispatchEvent('input');
  await expect.poll(() => page.evaluate(() => __syncAudio.bpm)).toBeCloseTo(150, 2);
  await expect.poll(() => page.evaluate(() => __syncAudio.delay.delayTime.value)).toBeCloseTo(0.3, 3);
});

test('unlinking restores independent Groove tempo and echo after a recording speed change', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {
    const hit = FMGrooveAudio.prototype.hit;
    FMGrooveAudio.prototype.hit = function (...args) {
      window.__syncAudio = this;
      return hit.apply(this, args);
    };
  });
  await link(page);
  await page.locator('#transport-play').click();
  await page.locator('#ws-listen').click();
  await page.locator('#speed').fill('1.25');
  await page.locator('#speed').dispatchEvent('input');
  await expect.poll(() => page.evaluate(() => window.__syncAudio?.bpm)).toBeCloseTo(150, 2);
  await page.locator('#ws-groove').click();
  await page.locator('#groove-sync').click();
  await expect(page.locator('#transport-tempo')).toHaveValue('120');
  await expect.poll(() => page.evaluate(() => __syncAudio.bpm)).toBeCloseTo(120, 2);
  await expect.poll(() => page.evaluate(() => __syncAudio.delay.delayTime.value)).toBeCloseTo(0.375, 3);
});
