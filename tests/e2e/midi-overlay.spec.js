// @ts-check
const {test, expect} = require('@playwright/test');
const G = require('../../web/groove-core');
const key = 'afterhours-fm-project-v1';
test('Copilot: an exported melodic lane ten can be explicitly imported as melody', async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  const source = G.project().patterns[0];
  source.tracks.forEach(t => t.steps.forEach(s => (s.on = false)));
  Object.assign(source.tracks[9].steps[0], {on: true, locks: {note: 72}});
  await page
    .locator('#groove-midi-file')
    .setInputFiles({name: 'lane-ten.mid', mimeType: 'audio/midi', buffer: Buffer.from(G.midi(source, 120, 0, 1))});
  await expect(page.locator('#groove-midi-dialog')).toBeVisible();
  await page.locator('#groove-apply-midi').click();
  await expect(page.locator('#groove-midi-result')).toContainText('melodic');
  await page.getByRole('checkbox', {name: 'Treat channel 10 as melodic'}).check();
  await page.locator('#groove-apply-midi').click();
  await expect(page.locator('#groove-midi-dialog')).not.toBeVisible();
  const saved = G.validate(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key));
  expect(
    saved.patterns[0].tracks.some(t => t.name.startsWith('MIDI /') && t.steps.some(s => s.on && s.locks.note === 72)),
  ).toBe(true);
});
test('MIDI overlay fills lanes 13–16, preserves a twelve-lane project and survives reload', async ({page}) => {
  const project = G.project();
  project.patterns.forEach(p => {
    p.tracks = p.tracks.slice(0, 12);
    p.tracks.forEach(t => (t.steps[0].on = true));
  });
  const source = G.project().patterns[0];
  source.tracks.forEach(t => t.steps.forEach(s => (s.on = false)));
  source.tracks[5].steps[0].on = true;
  source.tracks[5].steps[1].on = true;
  await page.route('**/api/daw**', route => route.fulfill({json: {connected: false}}));
  await page.addInitScript(
    ({key, project}) => {
      localStorage.setItem('afterhours-workspace', 'groove');
      localStorage.setItem('afterhours-engine', 'groove');
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project));
    },
    {key, project},
  );
  await page.goto('/');
  await expect(page.locator('#groove-grid .seq-row')).toHaveCount(16);
  await page
    .locator('#groove-midi-file')
    .setInputFiles({name: 'chords.mid', mimeType: 'audio/midi', buffer: Buffer.from(G.midi(source, 120, 0, 1))});
  await expect(page.locator('#groove-midi-dialog')).toBeVisible();
  await page.locator('#groove-apply-midi').click();
  await expect(page.locator('#groove-midi-dialog')).not.toBeVisible();
  const saved = G.validate(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key));
  expect(saved.bpm).toBe(project.bpm);
  expect(saved.patterns[0].tracks.slice(0, 12)).toEqual(project.patterns[0].tracks);
  expect(saved.patterns[0].tracks.slice(12).map(t => t.steps.filter(s => s.on).length)).toEqual([2, 2, 2, 2]);
  await page.reload();
  await expect(page.locator('#groove-step-15-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Select track 16 Tone', exact: true}).click();
  await page.locator('#groove-step-15-3').click();
  await expect(page.locator('#groove-step-15-3')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Playing');
  await page.locator('#transport-stop').click();
});
