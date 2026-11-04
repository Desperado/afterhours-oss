const {test, expect} = require('@playwright/test');
const {clock, advance} = require('./helpers/groove-clock');
const errors = new WeakMap();

test.beforeEach(async ({page}) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#ws-groove').click();
});

test.afterEach(async ({page}) => {
  expect(errors.get(page)).toEqual([]);
});

test('level sliders share controls and output volume preserves recording gain across workspaces and reloads', async ({
  page,
}) => {
  const output = page.getByRole('slider', {name: 'Studio output volume'});
  await output.fill('0.23');
  await expect(page.locator('#output-volume-value')).toHaveText('23%');
  expect(await page.evaluate(() => AfterhoursAudio.volume)).toBe(0.23);
  // Observe the real monitor graph without changing the audio implementation.
  expect(
    await page.evaluate(() => {
      const gains = [],
        create = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function (...args) {
        const node = create.apply(this, args);
        gains.push(node);
        return node;
      };
      AfterhoursAudio.context();
      AudioContext.prototype.createGain = create;
      window.__monitorGains = gains;
      return gains.map(n => n.gain.value);
    }),
  ).toEqual([1, expect.closeTo(0.23, 5)]);
  const level = page.locator('#groove-sound-view input.level-slider');
  await expect(level).toHaveCount(1);
  await level.press('Home');
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().volume)).toBe(0);
  await level.press('End');
  expect(await page.evaluate(() => AfterhoursGrooveApp.track().volume)).toBe(100);
  await page.locator('#ws-synth').click();
  await expect(page.locator('#synth-controls input.level-slider')).toHaveCount(1);
  await output.press('Home');
  await expect.poll(() => page.evaluate(() => __monitorGains[1].gain.value)).toBeLessThan(0.001);
  expect(await page.evaluate(() => __monitorGains[0].gain.value)).toBe(1);
  await output.fill('0.37');
  await page.reload();
  await expect(output).toHaveValue('0.37');
  for (const width of [1440, 900, 760, 390]) {
    await page.setViewportSize({width, height: 900});
    await expect(output).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test('follow tracks audible pages and sections, while manual browsing stays put', async ({page}) => {
  await page.evaluate(() => {
    const {S, ui} = AfterhoursGrooveApp;
    S.data = AfterhoursGroove.project();
    S.data.bpm = 120;
    S.data.patterns.forEach(p => {
      p.length = 64;
      p.tracks.forEach(t => {
        t.length = 64;
      });
    });
    S.data.arrangement = Array.from({length: 19}, (_, i) => ({
      name: `Part ${i + 1}`,
      pattern: 0,
      bars: 4,
      lanes: [0, 4],
    }));
    S.songMode = true;
    ui.renderAll();
  });
  await clock(page);
  await page.evaluate(() => AfterhoursGrooveLive.play());
  await advance(page, 2.4);
  await expect(page.locator('#groove-pages [data-page="1"]')).toHaveAttribute('aria-pressed', 'true');
  await advance(page, 4.4);
  await expect(page.locator('#groove-pages [data-page="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#groove-pages [data-page="0"]').click();
  await advance(page, 6.4);
  await expect(page.locator('#groove-pages [data-page="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#groove-follow')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#groove-follow').click();
  await expect(page.locator('#groove-pages [data-page="3"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#groove-overview button').nth(17).click();
  await advance(page, 8.5);
  await expect(page.locator('#groove-arrangement button').nth(17)).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.locator('#groove-arrangement').evaluate(host => {
      const h = host.getBoundingClientRect(),
        b = host.children[17].getBoundingClientRect();
      return b.left >= h.left && b.right <= h.right;
    }),
  ).toBe(true);
  for (const width of [1440, 760, 390]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.locator('#groove-overview').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('#groove-arrangement').dispatchEvent('wheel', {deltaX: -100});
  await expect(page.locator('#groove-follow')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => AfterhoursGrooveLive.stop());
});

test('public library hides the optional content tour', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#demo-toggle')).toBeHidden();
  await expect(page.locator('#demo-panel')).toBeHidden();
});

test('selected content pack enables the tour, loads its preset and preserves the previous session', async ({page}) => {
  const pack = {
    version: 1,
    presets: [{id: 'tour-test', title: 'Register test', project: require('../fixtures/song.cjs')()}],
    demo: {preset: 'tour-test', label: 'Fixture tour', startSection: 0},
  };
  await page.route('**/content-packs.js', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `AfterhoursPresets.register(${JSON.stringify(pack)});`,
    }),
  );
  await page.reload();
  const previous = await page.evaluate(() => AfterhoursGrooveApp.S.data.title);
  await expect(page.locator('#demo-toggle')).toBeVisible();
  await page.locator('#demo-toggle').click();
  await expect(page.locator('#demo-start')).toContainText('Fixture tour');
  await page.locator('#demo-start').click();
  await expect.poll(() => page.evaluate(() => AfterhoursGrooveApp.S.running)).toBe(true);
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe('Register test');
  await page.locator('#demo-end').click();
  await page.locator('#transport-stop').click();
  await page.locator('#groove-restore').click();
  expect(await page.evaluate(() => AfterhoursGrooveApp.S.data.title)).toBe(previous);
});
