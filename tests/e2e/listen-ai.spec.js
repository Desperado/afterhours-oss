// @ts-check
import {test, expect} from '@playwright/test';
import {silentWav, routeAudio} from './fixtures';

const features = {
  start_seconds: 30,
  duration_seconds: 60,
  estimated_bpm: 126,
  peak_dbfs: -2,
  rms_dbfs: -14,
  frequency_band_power_fractions: {sub_20_60: 0.1, bass_60_250: 0.2, mid_250_2000: 0.5, high_2000_20000: 0.2},
};
const paid = {
  id: 'paid',
  created: '2026-10-20T12:00:00Z',
  method: 'audio_model',
  status: 'complete',
  segments: [
    {
      model: 'test audio model',
      features,
      notes:
        'Observations\nBass: rounded and steady.\nUncertain assumptions\nThe upper layer may be a pad.\nCreative experiments\n1. Open the filter: try a slow rise.\n2. Leave space: remove one snare.',
    },
  ],
};
const local = {
  id: 'local',
  created: '2026-10-21T12:00:00Z',
  method: 'local_signal_features',
  status: 'complete',
  segments: [{features, notes: ''}],
};
const track = {
  id: 'fixture',
  title: 'Night test',
  format: 'WAV',
  duration: 240,
  sample_rate: 8000,
  channels: 1,
  waveform: Array.from({length: 360}, (_, i) => 0.1 + (i % 9) / 10),
  rms_dbfs: -18,
  peak_dbfs: -3,
  sessions: [],
  summary: null,
};

async function openFixture(page, {sessions = [], key = true} = {}) {
  const posts = [];
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.route('**/api/library', r => r.fulfill({json: {tracks: [track], jobs: [], key_ready: key}}));
  await page.route('**/api/tracks/fixture', r => r.fulfill({json: {...track, sessions}}));
  await routeAudio(page, 'fixture', silentWav(240));
  await page.route('**/api/jobs', r => {
    if (r.request().method() === 'POST') {
      posts.push(r.request().postDataJSON());
      return r.fulfill({json: {id: 'submitted', status: 'queued', track_id: 'fixture'}});
    }
    return r.fulfill({json: {jobs: []}});
  });
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'listen');
    localStorage.setItem('afterhours-engine', 'recording');
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('Night test');
  await expect.poll(() => page.locator('#audio').evaluate(a => a.readyState)).toBeGreaterThanOrEqual(1);
  return posts;
}

async function seekTo(page, seconds) {
  await page.locator('#seek').fill(String(seconds));
  await page.locator('#seek').dispatchEvent('input');
  await expect.poll(() => page.locator('#audio').evaluate(a => a.currentTime)).toBeCloseTo(seconds, 1);
}

test('Listen seeks, loops and applies live effect presets without submitting analysis', async ({page}) => {
  const posts = await openFixture(page);
  await seekTo(page, 30);
  await page.locator('#loop-a').click();
  await seekTo(page, 90);
  await page.locator('#loop-b').click();
  await expect(page.locator('#loop')).toHaveText('Loop 0:30–1:30');
  await expect(page.locator('#loop')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#current-time')).toHaveText('0:30');
  await page.locator('#speed').fill('1.25');
  await page.locator('#speed').dispatchEvent('input');
  await expect(page.locator('#speed-value')).toHaveText('1.25×');
  expect(await page.locator('#audio').evaluate(a => a.playbackRate)).toBe(1.25);
  await page.getByRole('button', {name: 'Dub echo', exact: true}).click();
  await expect(page.getByRole('slider', {name: 'Echo mix', exact: true})).toHaveAttribute('aria-valuenow', '45');
  await page.getByRole('button', {name: 'Original', exact: true}).click();
  await expect(page.locator('#fx-bypass')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Dark room', exact: true}).click();
  await expect(page.locator('#fx-bypass')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', {name: 'Echo mix', exact: true})).toHaveAttribute('aria-valuenow', '12');
  await page.locator('#ws-ai').click();
  await expect(page.locator('#request-count')).toHaveText('3 × ≤120 s');
  expect(posts).toEqual([]);
  await page.getByRole('radio', {name: /Selected excerpt/}).click();
  await page.locator('#use-loop').click();
  await expect(page.locator('#start')).toHaveValue('30');
  await expect(page.locator('#length')).toHaveValue('60');
  await expect(page.locator('#analyze')).toHaveText('$ Send 1 paid request');
  expect(posts).toEqual([]);
  await page.locator('#analyze').click();
  await expect.poll(() => posts).toEqual([{track_id: 'fixture', mode: 'excerpt', start: 30, duration: 60}]);
});

test('local scans retain the selectable excerpt and submit its range without a key', async ({page}) => {
  const posts = await openFixture(page, {key: false});
  await page.locator('#ws-ai').click();
  await page.getByRole('radio', {name: /Selected excerpt/}).click();
  await page.locator('#start').fill('30');
  await page.locator('#length').fill('45');
  await page.getByRole('radio', {name: /Local scan/}).click();
  await expect(page.locator('#range-fields')).toBeVisible();
  await expect(page.locator('#start')).toHaveValue('30');
  await expect(page.locator('#length')).toHaveValue('45');
  await expect(page.locator('#destination')).toHaveText('This Mac only');
  await expect(page.locator('#request-count')).toHaveText('0 · free');
  await page.locator('#analyze').click();
  await expect.poll(() => posts).toEqual([{track_id: 'fixture', mode: 'local', start: 30, duration: 45}]);
});

test('saved reports show actual measurements, costs, safe notes and persistent experiments', async ({page}) => {
  const unsafePaid = {
    ...paid,
    segments: [
      {
        ...paid.segments[0],
        notes: paid.segments[0].notes.replace(
          'rounded and steady.',
          '<img src=x onerror=alert(1)> rounded and steady.',
        ),
      },
    ],
  };
  const posts = await openFixture(page, {sessions: [unsafePaid, local], key: false});
  await page.locator('#ws-ai').click();
  await expect(page.locator('#ai-used')).toHaveText('Free · local scan');
  await expect(page.locator('#experiments')).toHaveText('Local scans have no suggestions.');
  await expect(page.locator('#metrics')).toContainText('RMS · full track');
  await expect(page.locator('#metrics')).toContainText('-18.0');
  await page.locator('#saved button').filter({hasText: 'Excerpt'}).click();
  await expect(page.locator('#ai-used')).toHaveText('$ 1 request used');
  await expect(page.locator('#notes')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#notes img')).toHaveCount(0);
  await expect(page.locator('#notes')).toContainText('Open questions');
  await expect(page.getByRole('img', {name: 'Sub 10%, Bass 20%, Mid 50%, High 20%'})).toBeVisible();
  const idea = page.getByRole('checkbox', {name: /Open the filter/});
  await idea.check();
  await expect(page.locator('#try-count')).toHaveText('1 of 2 done');
  await page.locator('#notes button').click();
  await expect(page.locator('#ws-listen')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#current-time')).toHaveText('0:30');
  await page.reload();
  await page.locator('#ws-ai').click();
  await page.locator('#saved button').filter({hasText: 'Excerpt'}).click();
  await expect(page.getByRole('checkbox', {name: /Open the filter/})).toBeChecked();
  await page.locator('#ai-new').click();
  await page.getByRole('radio', {name: /Whole track/}).click();
  await expect(page.locator('#analyze')).toBeDisabled();
  expect(posts).toEqual([]);
});

test('regression: experiment progress keeps segment keys and newer flat keys', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('afterhours:fixture:paid:0:0', 'done');
    localStorage.setItem('afterhours:fixture:paid:1:0', 'done');
    localStorage.setItem('afterhours:fixture:paid:1', 'done');
  });
  const second = {
    ...paid.segments[0],
    notes: paid.segments[0].notes.replace('Open the filter', 'Reduce decay').replace('Leave space', 'Change rhythm'),
  };
  await openFixture(page, {sessions: [{...paid, segments: [...paid.segments, second]}]});
  await page.locator('#ws-ai').click();
  await expect.soft(page.getByRole('checkbox', {name: /Open the filter/})).toBeChecked();
  await expect.soft(page.getByRole('checkbox', {name: /Reduce decay/})).toBeChecked();
  const flat = page.getByRole('checkbox', {name: /Leave space/});
  await expect(flat).toBeChecked();
  await flat.uncheck();
  // Reopen the same report without re-running the storage seed.
  await page.locator('#ai-new').click();
  await page.locator('#saved button').click();
  await expect(page.getByRole('checkbox', {name: /Leave space/})).not.toBeChecked();
});

test('regression: reopening a recording clears the preset highlight with its effects', async ({page}) => {
  await openFixture(page);
  const dub = page.getByRole('button', {name: 'Dub echo', exact: true});
  await dub.click();
  await expect(dub).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#library button').filter({hasText: 'Night test'}).click();
  await expect(page.getByRole('slider', {name: 'Echo mix', exact: true})).toHaveAttribute('aria-valuenow', '0');
  await expect(dub).toHaveAttribute('aria-pressed', 'false');
});

test('regression: quiet meter decibels update within one bar bucket and return to silence', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {
    effects.level = () => 0.004;
  });
  await expect(page.locator('#fx-meter-db')).toHaveText('-48.0');
  await page.evaluate(() => {
    effects.level = () => 0.003;
  });
  await expect(page.locator('#fx-meter-db')).toHaveText('-50.5');
  await page.evaluate(() => {
    effects.level = () => 0;
  });
  await expect(page.locator('#fx-meter-db')).toHaveText('−∞');
});

test('Live Effects controls stay in place as the output meter changes width', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => document.fonts.ready);
  const geometry = () =>
    page.locator('.fx-body').evaluate(body =>
      [...body.querySelectorAll('.knob, .fx-pad, .fx-meter')].map(el => {
        const {x, y, width, height} = el.getBoundingClientRect();
        return {x, y, width, height};
      }),
    );
  for (const width of [1440, 1200, 390]) {
    await page.setViewportSize({width, height: 1000});
    await page.evaluate(() => {
      effects.level = () => 0;
    });
    await expect(page.locator('#fx-meter-db')).toHaveText('−∞');
    const before = await geometry();
    expect(before.length).toBeGreaterThanOrEqual(9);
    for (const [level, text] of [
      [0.8, '-1.9'],
      [0.1, '-20.0'],
      [0.00011, '-79.2'],
      [0, '−∞'],
    ]) {
      await page.evaluate(level => {
        effects.level = () => level;
      }, level);
      await expect(page.locator('#fx-meter-db')).toHaveText(text);
      expect(await geometry()).toEqual(before);
    }
  }
});

test('regression: keyboard waveform seek has a visible focus indicator', async ({page}) => {
  await openFixture(page);
  await page.locator('#seek').focus();
  await expect(page.locator('#seek')).toBeFocused();
  await expect(page.locator('.wave-wrap')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.wave-wrap')).toHaveCSS('outline-width', '2px');
});

test('regression: Recording startup is canceled by Stop and a later Play still works', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {
    window.__recordingStarts = [];
    effects.start = () => new Promise(resolve => __recordingStarts.push(resolve));
  });
  await page.locator('#transport-play').click();
  await page.locator('#transport-play').click();
  expect.soft(await page.evaluate(() => __recordingStarts.length)).toBe(1);
  await page.locator('#transport-stop').click();
  await page.evaluate(async () => {
    __recordingStarts.splice(0).forEach(resolve => resolve());
    await Promise.resolve();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('#audio').evaluate(a => a.paused)).toBe(true);
  await page.locator('#transport-play').click();
  await page.evaluate(() => {
    __recordingStarts.splice(0).forEach(resolve => resolve());
  });
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
});

test('regression: Recording ignores an old startup after a new Play or a recording reload', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {
    window.__recordingStarts = [];
    effects.start = () => new Promise(resolve => __recordingStarts.push(resolve));
  });
  await page.locator('#transport-play').click();
  await page.locator('#transport-stop').click();
  await page.locator('#transport-play').click();
  await page.evaluate(() => {
    __recordingStarts[0]();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('#audio').evaluate(a => a.paused)).toBe(true);
  await page.evaluate(() => {
    __recordingStarts[1]();
  });
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transport-stop').click();
  await page.locator('#transport-play').click();
  await page.locator('#library button').filter({hasText: 'Night test'}).click();
  await page.evaluate(() => {
    __recordingStarts[2]();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('#audio').evaluate(a => a.paused)).toBe(true);
});

test('regression: partial whole-track reports warn until their analysis is complete', async ({page}) => {
  const report = {...paid, method: 'audio_model_sections', status: 'in_progress'};
  await openFixture(page, {sessions: [report]});
  await page.locator('#ws-ai').click();
  await expect(page.locator('#report-meta')).toContainText('Incomplete report');
  await expect(page.locator('#report-meta')).toContainText('saved excerpts only');
  report.status = 'complete';
  await page.reload();
  await expect(page.locator('#report-meta')).not.toContainText('Incomplete report');
  await expect(page.locator('#report-meta')).toContainText('test audio model');
});
