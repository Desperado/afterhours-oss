// @ts-check
const {test, expect} = require('@playwright/test');

for (const [id, title, section] of [
  ['shadow', 'Shadow Circuit', 'Shadow circuit'],
  ['overpass', 'Midnight Overpass', 'Midnight run'],
  ['relay', 'Acid Rain Relay', 'Acid rain'],
  ['orchid', 'Iron Orchid', 'Iron bloom'],
  ['letters', 'Neon Letters', 'Letters in neon'],
  ['glass', 'Glass Platforms', 'Across the glass'],
  ['satellite', 'Satellite Hearts', 'Satellite hearts'],
]) {
  test(`${title} loads sixteen lanes, starts its main section and persists`, async ({page}) => {
    await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
    await page.addInitScript(() => {
      localStorage.setItem('afterhours-workspace', 'groove');
      localStorage.setItem('afterhours-engine', 'groove');
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.locator('#groove-preset').selectOption(id);
    await page.locator('#groove-load-preset').click();
    await expect(page.locator('#groove-track-title')).toHaveText(title);
    await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
    await page.getByRole('button', {name: section, exact: true}).click();
    await page.locator('#transport-play').click();
    await expect(page.locator('#groove-section')).toHaveText(`${section} · bar 1/16`);
    await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
    await page.locator('#transport-stop').click();
    await page.reload();
    await expect(page.locator('#groove-track-title')).toHaveText(title);
    await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
    expect(errors).toEqual([]);
  });
}
