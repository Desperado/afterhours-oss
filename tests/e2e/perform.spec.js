// @ts-check
import {test, expect} from '@playwright/test';

test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.route('**/api/library', route => route.fulfill({json: {tracks: [], jobs: [], key_ready: false}}));
  await page.addInitScript(() => {
    localStorage.setItem('afterhours-workspace', 'groove');
    localStorage.setItem('afterhours-engine', 'groove');
  });
  await page.goto('/');
});

test('390 px Perform replaces the desktop grid with usable pads and controls', async ({page}) => {
  await expect(page.locator('#groove-grid')).toBeHidden();
  await expect(page.locator('#groove-sound-view')).toBeHidden();
  await expect(page.locator('#perform-pads button')).toHaveCount(16);
  await expect(page.locator('#perform-steps button')).toHaveCount(16);
  await expect(page.getByRole('slider', {name: 'Color', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Pattern A', exact: true})).toHaveAttribute('aria-pressed', 'true');
  for (const selector of [
    '#perform-pads button',
    '#perform-steps button',
    '#perform-patterns button',
    '#perform-pages button',
    '.strip .tbtn',
    '.rail button',
  ]) {
    const sizes = await page
      .locator(selector)
      .evaluateAll(nodes =>
        nodes.map(node => ({w: node.getBoundingClientRect().width, h: node.getBoundingClientRect().height})),
      );
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every(size => size.w >= 46 && size.h >= 46)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('pads select, audition and mute while steps and macros survive desktop resize', async ({page}) => {
  const pad = page.locator('#perform-pad-0');
  await pad.dblclick();
  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status-text')).toHaveText('Audition · Kick');
  const box = await pad.boundingBox();
  if (!box) throw new Error('Kick pad has no hit area');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(pad).toHaveClass(/muted/);
  await page.mouse.up();
  await expect(pad).toHaveClass(/muted/);
  const step = page.locator('#perform-step-1');
  const wasOn = await step.getAttribute('aria-pressed');
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', String(wasOn !== 'true'));
  const color = page.locator('#perform-color');
  await color.focus();
  await page.keyboard.press('End');
  await expect(color).toHaveAttribute('aria-valuenow', '100');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('afterhours-fm-project-v1') || '{}').patterns?.[0]?.tracks?.[0]?.color,
      ),
    )
    .toBe(100);
  await page.setViewportSize({width: 1280, height: 800});
  await expect(page.locator('#groove-perform')).toBeHidden();
  await expect(page.getByRole('slider', {name: 'Color', exact: true})).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('button', {name: 'Mute Kick', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#groove-step-0-1')).toHaveAttribute('aria-pressed', String(wasOn !== 'true'));
  await page.reload();
  await page.getByRole('button', {name: 'Select track 1 Kick'}).click();
  await expect(page.getByRole('slider', {name: 'Color', exact: true})).toHaveAttribute('aria-valuenow', '100');
});

test('phone pattern, page and transport controls share the sequencer state', async ({page}) => {
  await page.getByRole('button', {name: 'Pattern B', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Pattern B', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Page 2', exact: true}).click();
  await expect(page.locator('#perform-step-16')).toBeVisible();
  await expect(page.locator('#perform-steps')).toHaveAttribute('aria-label', 'Steps of Tone, page 2 of 4');
  await page.getByRole('button', {name: 'Page 1', exact: true}).click();
  await page.locator('#transport-play').click();
  await expect(page.locator('#perform-steps .playing')).toHaveCount(1);
  await page.locator('#transport-stop').click();
  await expect(page.locator('#perform-steps .playing')).toHaveCount(0);
  await expect(page.locator('#transport-play')).toHaveAttribute('aria-pressed', 'false');
});

test('regression: phone steps show their parameter lock marker', async ({page}) => {
  await expect(page.locator('#perform-step-0')).toHaveClass(/has-lock/);
  const marker = page.locator('#perform-step-0 .lock-mark');
  const size = await marker.boundingBox();
  expect(size?.width).toBeGreaterThan(0);
  expect(size?.height).toBeGreaterThan(0);
  await expect(marker).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
