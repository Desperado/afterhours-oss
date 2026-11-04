// @ts-check
const {test, expect} = require('@playwright/test');
const {silentWav, fixtureTrack, routeAudio} = require('./fixtures');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', route =>
    route.fulfill({json: {connected: false, message: 'Ardour is not part of this test.'}}),
  );
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      sessionStorage.setItem('seeded', '1');
    }
  });
});

test('workspaces switch without changing the active engine', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#engine-groove')).toHaveAttribute('aria-checked', 'true');
  for (const [rail, panel] of [
    ['ws-ardour', 'Ardour session'],
    ['ws-listen', 'Listening room'],
    ['ws-ai', 'AI listening'],
    ['ws-groove', 'Night machines groovebox'],
  ]) {
    await page.locator('#' + rail).click();
    await expect(page.locator('#' + rail)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', {name: panel})).toBeVisible();
    await expect(page.locator('#engine-groove')).toHaveAttribute('aria-checked', 'true');
  }
  // The chosen workspace survives a reload.
  await page.locator('#ws-ai').click();
  await page.reload();
  await expect(page.locator('#ws-ai')).toHaveAttribute('aria-current', 'page');
});

test('the strip drives only the active engine and Space plays it', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#transport-position-label')).toHaveText('Groove · bar.step');
  await page.keyboard.press('Space');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await expect(page.locator('#transport-position')).not.toHaveText('1.01', {timeout: 3000});
  await page.keyboard.press('Space');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  // Ardour is offline, so choosing it disables the transport rather than driving Groove.
  await page.locator('#engine-ardour').click();
  await expect(page.locator('#engine-ardour')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#transport-play')).toBeDisabled();
  await expect(page.locator('#transport-position')).toHaveText('--:--.-');
  await expect(page.locator('#transport-tempo')).toHaveAttribute('readonly', '');
});

test('groove tempo is editable from the strip', async ({page}) => {
  await page.goto('/');
  const tempo = page.locator('#transport-tempo');
  const slider = page.getByRole('slider', {name: 'Groove tempo', exact: true});
  await expect(slider).toBeVisible();
  await tempo.fill('120');
  await tempo.press('Enter');
  await tempo.blur();
  await expect(tempo).toHaveValue('120');
  await expect(slider).toHaveValue('120');
  await slider.focus();
  await slider.press('End');
  await expect(tempo).toHaveValue('240');
  await slider.press('Home');
  await expect(tempo).toHaveValue('40');
  await slider.press('ArrowRight');
  await expect(tempo).toHaveValue('41');
  await page.reload();
  await expect(page.locator('#transport-tempo')).toHaveValue('41');
  await expect(slider).toHaveValue('41');
  for (const width of [900, 760, 390]) {
    await page.setViewportSize({width, height: 844});
    await expect(slider).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('#engine-recording').click();
  await expect(slider).toBeHidden();
  await page.locator('#engine-ardour').click();
  await expect(slider).toBeHidden();
});

test('two engines playing at once show the separate-clock chip', async ({page}) => {
  const track = fixtureTrack();
  await page.route('**/api/library', r => r.fulfill({json: {tracks: [track], jobs: [], key_ready: false}}));
  await page.route('**/api/tracks/fixture', r => r.fulfill({json: track}));
  await routeAudio(page, 'fixture', silentWav(60));
  await page.goto('/');
  await page.locator('#ws-listen').click();
  await expect(page.locator('#play')).toBeVisible({timeout: 10000});
  await page.locator('#transport-play').click();
  await expect(page.locator('#chip-separate-clock')).toBeHidden();
  await page.locator('#play').click();
  await expect(page.locator('#engine-recording')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#engine-recording .engine-state')).toHaveText('Playing');
  await expect(page.locator('#chip-separate-clock')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#chip-separate-clock')).toBeHidden();
});

test('help sheet opens with ? and closes', async ({page}) => {
  await page.goto('/');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', {name: 'Help'})).toBeVisible();
  await page.getByRole('button', {name: 'Close help'}).click();
  await expect(page.getByRole('dialog', {name: 'Help'})).toBeHidden();
});
