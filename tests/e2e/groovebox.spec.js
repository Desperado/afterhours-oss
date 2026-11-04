// @ts-check
const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', route =>
    route.fulfill({json: {connected: false, message: 'Ardour is not part of this test.'}}),
  );
  // Each test starts in the Groove workspace with Groove as the active engine.
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
  });
});

test('page loads without script errors', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
  await expect(page.locator('#groove-grid .step')).toHaveCount(256);
  await expect(page.getByRole('slider', {name: 'Color'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('knob turns are autosaved once, not on every movement', async ({page}) => {
  await page.addInitScript(() => {
    window.__writes = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('afterhours-fm')) window.__writes++;
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  const color = page.getByRole('slider', {name: 'Color'});
  const start = Number(await color.getAttribute('aria-valuenow'));
  await color.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => window.__writes)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__writes)).toBe(1);
  await page.reload();
  await expect(page.getByRole('slider', {name: 'Color'})).toHaveAttribute('aria-valuenow', String(start + 30));
});

test('a queued pattern appears when it becomes audible', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Pattern steps').fill('16');
  await page.getByLabel('Pattern steps').dispatchEvent('change');
  await page.locator('#transport-play').click();
  await expect(page.locator('#transport-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  const a = page.getByRole('button', {name: /^Pattern A/}),
    b = page.getByRole('button', {name: /^Pattern B/});
  await b.click();
  await expect(b).toHaveClass(/queued/);
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  // 16 steps at 93 BPM last about 2.6 seconds.
  await expect(b).toHaveAttribute('aria-pressed', 'true', {timeout: 6000});
  await expect(b).toHaveClass(/playing/);
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
});

test('TRIG LOCK overrides one step and clears', async ({page}) => {
  await page.goto('/');
  const step = page.locator('#groove-step-4-4');
  await step.click({button: 'right'});
  await page.locator('#groove-lock').click();
  await expect(page.locator('#groove-trig-title')).toHaveText('Step 5');
  const shape = page.getByRole('slider', {name: 'Shape'});
  await shape.focus();
  await page.keyboard.press('PageUp');
  await expect(shape).toHaveAttribute('aria-valuetext', /locked/);
  await expect(step).toHaveClass(/has-lock/);
  await expect(page.locator('#groove-lock-count')).toHaveText('◆ 1 locked');
  await page.locator('#groove-clear-locks').click();
  await expect(step).not.toHaveClass(/has-lock/);
  // Turning TRIG LOCK off returns the knobs to the track sound.
  await page.locator('#groove-lock').click();
  await expect(page.getByRole('slider', {name: 'Color'})).toBeVisible();
});

test('step grid is keyboard operable', async ({page}) => {
  await page.goto('/');
  const first = page.locator('#groove-step-4-0');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#groove-step-4-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#groove-step-4-1')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#groove-step-3-1')).toBeFocused();
});

test('MIDI export downloads a standard MIDI file', async ({page}) => {
  await page.goto('/');
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', {name: 'MIDI'}).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^afterhours-A-93bpm\.mid$/);
  const bytes = require('node:fs').readFileSync(await download.path());
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('MThd');
});

// Controlled audio clocks exercise the real transport without waiting for wall time.
async function transportClock(page, pending = false) {
  await page.evaluate(pending => {
    window.__clock = {pending: [], timers: new Map(), next: 90000, hits: [], stops: 0};
    const set = window.setInterval,
      clear = window.clearInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (ms !== 20) return set(fn, ms, ...args);
      const id = ++__clock.next;
      __clock.timers.set(id, fn);
      return id;
    };
    window.clearInterval = id => {
      if (!__clock.timers.delete(id)) clear(id);
    };
    window.AudioContext = class {
      constructor() {
        this.currentTime = 0;
        this.state = 'running';
      }
      resume() {
        return pending ? new Promise(resolve => __clock.pending.push(resolve)) : Promise.resolve();
      }
    };
    const context = new AudioContext();
    AfterhoursAudio.context = () => context;
    FMGrooveAudio = class {
      setPerformance() {}
      mixer = {levels: () => Array(16).fill(0)};
      constructor(context, bpm) {
        this.context = context;
        this.bpm = bpm;
        this.started = 0;
        __clock.engine = this;
      }
      hit(event, when) {
        __clock.hits.push(when);
      }
      stop() {
        __clock.stops++;
        __clock.hits = [];
      }
      dispose() {
        this.stop();
      }
    };
  }, pending);
}

test('Copilot: the first pattern request inside lookahead changes at the upcoming bar', async ({page}) => {
  await page.goto('/');
  await transportClock(page);
  await page.locator('#transport-tempo').fill('240');
  await page.locator('#transport-tempo').dispatchEvent('change');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.evaluate(() => {
    __clock.engine.context.currentTime = 0.1;
    for (const fn of __clock.timers.values()) fn();
  });
  await page.evaluate(() => {
    __clock.engine.context.currentTime = 1.2;
    for (const fn of __clock.timers.values()) fn();
  });
  await expect(page.locator('#groove-pattern-status')).toContainText('Playing');
  await page.getByRole('button', {name: /^Pattern B/}).click();
  await page.evaluate(() => {
    __clock.engine.context.currentTime = 1.26;
    for (const fn of __clock.timers.values()) fn();
  });
  await expect(page.getByRole('button', {name: /^Pattern B/})).toHaveAttribute('aria-pressed', 'true');
});

test('Copilot: unavailable backup storage does not abort Groove initialization or transport', async ({page}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'afterhours-fm-project-v1-before-preset')
        throw new DOMException('Storage unavailable', 'SecurityError');
      return get.call(this, key);
    };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
  expect(errors).toEqual([]);
  await expect(page.locator('#groove-restore')).toBeDisabled();
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.locator('#transport-stop').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  expect(errors).toEqual([]);
});

test('regression: fully locked project backups round trip and oversized files stay blocked', async ({page}) => {
  await page.goto('/');
  const project = await page.evaluate(() => {
    const p = AfterhoursGroove.project();
    p.bpm = 137;
    for (const pattern of p.patterns) {
      pattern.length = 64;
      for (const track of pattern.tracks) {
        track.length = 64;
        for (const step of track.steps)
          step.locks = Object.fromEntries(
            Object.entries(AfterhoursGroove.controls).map(([key, control]) => [key, control[2]]),
          );
      }
    }
    return p;
  });
  // Load through storage so the source backup is produced by the application's exporter.
  await page.addInitScript(p => localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(p)), project);
  await page.reload();
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-project').click()]);
  const bytes = require('node:fs').readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(600000);
  await page.locator('#transport-tempo').fill('93');
  await page.locator('#transport-tempo').dispatchEvent('change');
  await page.locator('#transport-tempo').press('Tab');
  await page.locator('#groove-file').setInputFiles({name: 'backup.json', mimeType: 'application/json', buffer: bytes});
  await expect(page.locator('#transport-tempo')).toHaveValue('137');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1')).bpm))
    .toBe(137);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('afterhours-fm-project-v1')));
  expect(saved).toEqual(project);
  await page.locator('#groove-file').setInputFiles({
    name: 'oversized.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32),
  });
  await expect(page.locator('#status-text')).toContainText('Import failed');
  await expect(page.locator('#transport-tempo')).toHaveValue('137');
});

test('regression: WAV modulation starts at the first musical beat', async ({page}) => {
  await page.goto('/');
  const project = await page.evaluate(() => {
    const p = AfterhoursGroove.project(),
      pattern = p.patterns[0];
    pattern.length = 1;
    pattern.tracks.forEach((t, i) => {
      t.mute = i !== 4;
      t.length = 1;
    });
    pattern.tracks[4].lfo = {target: 'pan', depth: 100, division: 0.5, shape: 'sine'};
    return p;
  });
  await page.addInitScript(p => localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(p)), project);
  await page.reload();
  await page.evaluate(() => {
    window.__waves = [];
    const create = OfflineAudioContext.prototype.createPeriodicWave;
    OfflineAudioContext.prototype.createPeriodicWave = function (real, imag, options) {
      __waves.push({real: real[1], imag: imag[1]});
      return create.call(this, real, imag, options);
    };
  });
  await page.locator('#groove-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#groove-wav').click()]);
  const bytes = require('node:fs').readFileSync(await download.path());
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  const waves = await page.evaluate(() => __waves);
  expect(waves.length).toBeGreaterThan(0);
  expect(waves[0].real).toBeCloseTo(0, 5);
  expect(waves[0].imag).toBeCloseTo(1, 5);
});

test('regression: pending Play is single and Stop cancels startup', async ({page}) => {
  await page.goto('/');
  await transportClock(page, true);
  await page.locator('#transport-play').click();
  await page.locator('#transport-play').click();
  expect.soft(await page.evaluate(() => __clock.pending.length)).toBe(1);
  await page.locator('#transport-stop').click();
  await page.evaluate(async () => {
    __clock.pending.splice(0).forEach(resolve => resolve());
    await Promise.resolve();
  });
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  expect(await page.evaluate(() => __clock.timers.size)).toBe(0);
  await page.locator('#transport-play').click();
  await page.evaluate(async () => {
    __clock.pending.splice(0).forEach(resolve => resolve());
    await Promise.resolve();
  });
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  expect(await page.evaluate(() => __clock.timers.size)).toBe(1);
  await page.locator('#transport-stop').click();
  expect(await page.evaluate(() => __clock.timers.size)).toBe(0);
});

test('regression: return to start clears scheduled voices and resets modulation origin', async ({page}) => {
  await page.goto('/');
  await transportClock(page);
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  const before = await page.evaluate(() => {
    __clock.engine.context.currentTime = 0.1;
    __clock.timers.forEach(fn => fn());
    return {stops: __clock.stops, hits: [...__clock.hits]};
  });
  expect(before.hits).toContain(0.25);
  await page.locator('#transport-start').click();
  const after = await page.evaluate(() => {
    __clock.timers.forEach(fn => fn());
    return {stops: __clock.stops, started: __clock.engine.started, hits: [...__clock.hits]};
  });
  expect.soft(after.stops).toBe(before.stops + 1);
  expect.soft(after.started).toBeCloseTo(0.15, 8);
  expect(after.hits).not.toContain(0.25);
  expect(after.hits).toContain(0.1 + 0.05);
});
