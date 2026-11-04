const {test, expect} = require('@playwright/test');
const fs = require('node:fs');

for (const machine of ['Sample', 'Instrument'])
  for (const kind of ['stem', 'mix', 'song'])
    test(`${kind} WAV ignores missing ${machine} recordings excluded from its render plan`, async ({
      page,
    }, testInfo) => {
      const requests = [];
      await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
      await page.route('**/samples/*.wav', r => {
        requests.push(r.request().url());
        return r.fulfill({status: 404, body: ''});
      });
      await page.route('**/instruments/*/manifest.json', r => {
        requests.push(r.request().url());
        return r.fulfill({status: 404, body: ''});
      });
      await page.goto('/');
      await page.locator('#ws-groove').click();
      await page.evaluate(
        ({kind, machine}) => {
          const {S, ui} = AfterhoursGrooveApp;
          S.data = AfterhoursGroove.project();
          for (const pattern of S.data.patterns)
            for (const track of pattern.tracks) for (const step of track.steps) step.on = false;
          const pattern = S.data.patterns[0];
          pattern.length = 16;
          pattern.tracks[4].steps[0].on = true;
          const sample = pattern.tracks[12];
          Object.assign(sample, {machine, instrument: 'growlybass', sample: {id: 'unavailable', bpm: 120, offset: 0}});
          sample.steps[0].on = true;
          sample.mute = kind === 'mix';
          // Song lane selection must exclude the sample even though the pattern itself does not mute it.
          S.data.arrangement = [{name: 'Synth only', pattern: 0, bars: 1, lanes: [4]}];
          S.selected = 4;
          ui.renderAll();
        },
        {kind, machine},
      );
      await page.locator('#groove-export').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(`#groove-${kind === 'song' ? 'song-wav' : kind === 'mix' ? 'wav' : 'stem'}`).click(),
      ]);
      const file = testInfo.outputPath(`${kind}.wav`);
      await download.saveAs(file);
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      let peak = 0;
      for (let i = 44; i < bytes.length; i += 3) peak = Math.max(peak, Math.abs(bytes.readIntLE(i, 3)) / 8388608);
      expect(peak).toBeGreaterThan(0.001);
      expect(requests).toEqual([]);

      // A sample that actually participates must still report a missing asset, not export silence.
      await page.evaluate(() => {
        const {S, ui} = AfterhoursGrooveApp;
        S.selected = 12;
        S.data.patterns[0].tracks[12].mute = false;
        S.data.arrangement[0].lanes = [12];
        ui.renderAll();
      });
      await page.locator('#groove-export').click();
      await page.locator(`#groove-${kind === 'song' ? 'song-wav' : kind === 'mix' ? 'wav' : 'stem'}`).click();
      await expect(page.locator('#status-text')).toContainText(
        machine === 'Sample' ? 'Missing audio: unavailable' : 'Instrument not installed: growlybass',
      );
      expect(requests).toHaveLength(1);
    });
