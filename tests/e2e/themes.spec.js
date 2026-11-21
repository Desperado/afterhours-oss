// @ts-check
const {test, expect} = require('@playwright/test');

const THEMES = ['night', 'sampler', 'redkeys', 'red', 'clips', 'blackbox', 'pads', 'deepblue'];

test('the theme picker lists every theme, applies it at once and remembers it', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#theme-select option')).toHaveCount(THEMES.length);
  expect(await page.evaluate(() => Object.keys(AfterhoursTheme.themes))).toEqual(THEMES);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  const night = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.locator('#theme-select').selectOption('sampler');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sampler');
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(night);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sampler');
  await expect(page.locator('#theme-select')).toHaveValue('sampler');

  await page.locator('#theme-select').selectOption('night');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(night);
});

test('every theme keeps text readable and the interface inside the viewport', async ({page}) => {
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  for (const theme of THEMES) {
    await page.evaluate(id => AfterhoursTheme.set(id), theme);
    await page.waitForTimeout(300); // buttons fade between colours over 140 ms
    // WCAG contrast of primary, secondary and hint text on a panel, and of ink on the main action colour.
    const ratios = await page.evaluate(() => {
      const probe = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
      const rgb = value => {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const luminance = value => {
        const [r, g, b] = rgb(value).map(c =>
          c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const button = getComputedStyle(document.querySelector('#groove-load-preset'));
      return {
        text: contrast(token('--ah-text'), token('--ah-surface')),
        secondary: contrast(token('--ah-text-2'), token('--ah-surface')),
        hint: contrast(token('--ah-text-3'), token('--ah-surface')),
        action: contrast(button.color, button.backgroundColor),
      };
    });
    expect(ratios.text, `${theme} text`).toBeGreaterThanOrEqual(10);
    expect(ratios.secondary, `${theme} secondary text`).toBeGreaterThanOrEqual(7);
    expect(ratios.hint, `${theme} hint text`).toBeGreaterThanOrEqual(4.5);
    expect(ratios.action, `${theme} main action`).toBeGreaterThanOrEqual(4.5);
    for (const width of [390, 1280, 1440]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${theme} at ${width}`).toBe(width);
      await expect(page.locator('#theme-select')).toBeInViewport();
      await expect(page.locator('#help-open')).toBeInViewport();
    }
  }
});
