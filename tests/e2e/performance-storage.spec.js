const {test, expect} = require('@playwright/test');

test('a failed save keeps the new audio exportable, protects earlier takes and can be retried', async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  for (const name of ['Saved first', 'Recover me']) {
    await page.getByLabel('Next take name', {exact: true}).fill(name);
    await page.locator('#performance-record').click();
    await page.evaluate(async () => {
      await AfterhoursSynth.on('storage-note', 60, 0.8);
      window.__start = AfterhoursAudio.context().currentTime;
    });
    await expect
      .poll(() => page.evaluate(() => AfterhoursAudio.context().currentTime - window.__start))
      .toBeGreaterThan(0.6);
    await page.evaluate(() => AfterhoursSynth.off('storage-note'));
    if (name === 'Recover me')
      await page.evaluate(() => {
        window.__save = AfterhoursTakeLibrary.save;
        AfterhoursTakeLibrary.save = async () => {
          throw new Error('Simulated quota limit');
        };
      });
    await page.locator('#performance-stop').click();
    await expect(page.locator('#performance-status')).toContainText(
      name === 'Saved first' ? 'Take saved locally' : 'Simulated quota limit',
    );
  }
  await expect(page.getByLabel('Saved performances', {exact: true}).locator('option')).toHaveCount(1);
  await expect(page.locator('#performance-audio-hint')).toContainText('Not saved');
  await expect(page.locator('#performance-audio')).toBeEnabled();
  await expect(page.locator('#performance-record')).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const e = new Event('beforeunload', {cancelable: true});
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(true);
  await page.evaluate(() => {
    AfterhoursTakeLibrary.save = window.__save;
  });
  await page.getByRole('button', {name: 'Save name', exact: true}).click();
  await expect(page.getByLabel('Saved performances', {exact: true}).locator('option')).toHaveCount(2);
  await expect(page.getByLabel('Take name', {exact: true})).toHaveValue('Recover me');
  await page.getByText('Name or edit parts', {exact: true}).click();
  await page.getByLabel('Part name', {exact: true}).fill('Invalid range');
  await page.getByLabel('Part end (seconds)', {exact: true}).fill('999');
  await page.getByRole('button', {name: 'Save part', exact: true}).click();
  await expect(page.locator('#performance-status')).toContainText('within the take');
  await expect(page.getByLabel('Playback part', {exact: true}).locator('option')).toHaveCount(1);
  const old = await page
    .getByLabel('Saved performances', {exact: true})
    .locator('option')
    .filter({hasText: 'Saved first'})
    .getAttribute('value');
  await page.getByLabel('Saved performances', {exact: true}).selectOption(old);
  await expect(page.getByLabel('Take name', {exact: true})).toHaveValue('Saved first');
  expect(await page.evaluate(() => AfterhoursPerformanceStudio.audio.size)).toBeGreaterThan(44);
});
