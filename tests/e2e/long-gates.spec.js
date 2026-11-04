const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const fixture = require('../fixtures/song.cjs');

for (const song of [true, false])
  test(`Long note survives ${song ? 'song chunks' : 'pattern export'} at slow tempo`, async ({page}) => {
    const project = fixture();
    project.bpm = 40;
    project.patterns.forEach(p =>
      p.tracks.forEach(t =>
        t.steps.forEach(s => {
          s.on = false;
        }),
      ),
    );
    project.patterns[0].length = 16;
    const t = project.patterns[0].tracks[9];
    Object.assign(t, {length: 32, rate: 0.5, decay: 2, shape: 12, color: 8, contour: 40, cutoff: 2300, volume: 100});
    Object.assign(t.steps[31], {on: true, gate: 8, micro: 0, locks: {note: 57}});
    project.arrangement = [{name: 'Held ending', pattern: 0, bars: 4, lanes: [9]}];
    await page.addInitScript(project => {
      localStorage.setItem('afterhours-workspace', 'groove');
      localStorage.setItem('afterhours-fm-project-v1', JSON.stringify(project));
    }, project);
    await page.goto('/');
    await page.locator('#groove-export').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(song ? '#groove-song-wav' : '#groove-wav').click(),
    ]);
    const bytes = fs.readFileSync(await download.path());
    expect((bytes.length - 44) / 288000).toBeCloseTo(song ? 34 : 34.375, 3);
    const rms = (from, to) => {
      let energy = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++)
        energy += (bytes.readIntLE(44 + i * 6, 3) / 8388608) ** 2;
      return Math.sqrt(energy / ((to - from) * 48000));
    };
    expect(rms(28, 28.5), 'Held note beyond the previous four-second voice limit').toBeGreaterThan(0.002);
    expect(rms(33.5, 33.9), 'Voice and effect tail finish').toBeLessThan(0.001);
  });
