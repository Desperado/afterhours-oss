const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.route('**/api/daw**', r => r.fulfill({json: {connected: false}}));
  await page.goto('/');
  await page.locator('#ws-groove').click();
});

test('all six stereo faces use independent output channels and persist the selected face', async ({page}) => {
  const values = await page.evaluate(async () => {
    const ctx = AfterhoursAudio.context();
    await ctx.resume();
    AfterhoursAudio.setVolume(1);
    const merger = ctx.createChannelMerger(2),
      sources = [];
    for (const [channel, value] of [0.5, 0.125].entries()) {
      const source = ctx.createConstantSource();
      source.offset.value = value;
      source.connect(merger, 0, channel);
      source.start();
      sources.push(source);
    }
    merger.connect(AfterhoursAudio.output(ctx));
    window.__meterSources = sources;
    await new Promise(resolve => setTimeout(resolve, 150));
    const left = new Float32Array(1024),
      right = new Float32Array(1024);
    AfterhoursAudio.readStereo(left, right);
    return [left[512], right[512]];
  });
  expect(values[0]).toBeCloseTo(0.5, 4);
  expect(values[1]).toBeCloseTo(0.125, 4);
  const style = page.getByLabel('Stereo meter style');
  await expect(style.locator('option')).toHaveCount(6);
  for (const face of ['vu', 'led', 'digital', 'ppm', 'bars', 'scope']) {
    await style.selectOption(face);
    await expect(page.locator('#groove-meter-reading')).toHaveText('L -6.0 · R -18.1 dBFS');
    await page.waitForTimeout(80);
    // An actual nonempty face, not just a control changing its selected value.
    const colors = await page.locator('#groove-visual').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return colors.size;
    });
    expect(colors).toBeGreaterThan(8);
  }
  const quiet = await page.evaluate(async () => {
    AfterhoursAudio.setVolume(0.5);
    await new Promise(resolve => setTimeout(resolve, 200));
    const left = new Float32Array(1024),
      right = new Float32Array(1024);
    AfterhoursAudio.readStereo(left, right);
    __meterSources.forEach(source => source.stop());
    return [left[512], right[512]];
  });
  expect(quiet[0]).toBeCloseTo(0.25, 4);
  expect(quiet[1]).toBeCloseTo(0.0625, 4);
  await page.reload();
  await expect(style).toHaveValue('scope');
});

test('a mono output reaches both stereo channels', async ({page}) => {
  const values = await page.evaluate(async () => {
    const ctx = AfterhoursAudio.context();
    await ctx.resume();
    AfterhoursAudio.setVolume(1);
    const source = ctx.createConstantSource();
    source.offset.value = 0.2;
    source.connect(AfterhoursAudio.output(ctx));
    source.start();
    const left = new Float32Array(1024),
      right = new Float32Array(1024);
    AfterhoursAudio.readStereo(left, right);
    await new Promise(resolve => setTimeout(resolve, 150));
    AfterhoursAudio.readStereo(left, right);
    source.stop();
    return [left[512], right[512]];
  });
  expect(values[0]).toBeCloseTo(0.2, 4);
  expect(values[1]).toBeCloseTo(0.2, 4);
});

test('overload and peak hold stay independent, then clear after the signal stops', async ({page}) => {
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d'),
      text = [],
      fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (value, ...args) => {
      text.push(value);
      fillText(value, ...args);
    };
    const meter = new AfterhoursVisual({clientWidth: 600, clientHeight: 140, getContext: () => ctx});
    const read = AfterhoursAudio.readStereo;
    let signal = true,
      accumulated = [0, 0];
    AfterhoursAudio.readStereo = (l, r) => {
      l.fill(signal ? 1.1 : 0);
      r.fill(signal ? 0.1 : 0);
      return accumulated;
    };
    try {
      meter.paint(null, null, true, 1);
      const overload = text.filter(value => value.includes('CLIP'));
      signal = false;
      meter.paint(null, null, true, 1.5);
      const held = [...meter.holds];
      text.length = 0;
      meter.paint(null, null, true, 3);
      const decayed = [...meter.holds],
        expired = text.filter(value => value.includes('CLIP'));
      accumulated = [0.5, 0];
      meter.paint(null, null, true, 3.1);
      return {overload, held, decayed, expired, nextPeak: meter.holds[0]};
    } finally {
      AfterhoursAudio.readStereo = read;
    }
  });
  expect(result.overload).toEqual(['L CLIP']);
  expect(result.held[0]).toBeCloseTo(1.1, 4);
  expect(result.held[1]).toBeCloseTo(0.1, 4);
  expect(result.decayed[0]).toBeGreaterThan(result.decayed[1]);
  expect(result.decayed[0]).toBeLessThan(result.held[0]);
  expect(result.expired).toEqual([]);
  expect(result.nextPeak).toBeCloseTo(0.5, 4);
});

for (const face of ['vu', 'scope']) {
  test(`${face} displays both held peaks after the instantaneous signal disappears`, async ({page}) => {
    const result = await page.evaluate(face => {
      const ctx = document.createElement('canvas').getContext('2d'),
        text = [];
      ctx.fillText = value => text.push(value);
      const meter = new AfterhoursVisual({clientWidth: 600, clientHeight: 140, getContext: () => ctx});
      meter.style = face;
      const read = AfterhoursAudio.readStereo;
      let signal = true;
      AfterhoursAudio.readStereo = (left, right) => {
        left.fill(signal ? 0.5 : 0);
        right.fill(signal ? 0.125 : 0);
      };
      try {
        meter.paint(null, null, false, 1);
        signal = false;
        text.length = 0;
        meter.paint(null, null, false, 1.5);
        return text;
      } finally {
        AfterhoursAudio.readStereo = read;
      }
    }, face);
    expect(result).toContain('L HOLD -6.0 dBFS');
    expect(result).toContain('R HOLD -18.1 dBFS');
  });
}

test('a brief stereo transient between reduced-motion draws reaches HOLD and CLIP', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  // Keep the app's canvas from consuming the test meter's accumulated peaks.
  await page.locator('#ws-synth').click();
  const result = await page.evaluate(async () => {
    const ctx = AfterhoursAudio.context();
    await ctx.resume();
    AfterhoursAudio.setVolume(1);
    if (!(await AfterhoursAudio.stereoReady)) throw new Error('Continuous meter did not initialize');
    const draw = document.createElement('canvas').getContext('2d'),
      text = [];
    draw.fillText = value => text.push(value);
    const meter = new AfterhoursVisual({clientWidth: 600, clientHeight: 140, getContext: () => draw});
    meter.style = 'scope';
    meter.paint(null, null, false, performance.now() / 1000);
    const pulse = ctx.createBuffer(2, Math.round(ctx.sampleRate * 0.002), ctx.sampleRate);
    pulse.getChannelData(0).fill(1.1);
    pulse.getChannelData(1).fill(0.3);
    const source = ctx.createBufferSource();
    source.buffer = pulse;
    source.connect(AfterhoursAudio.output(ctx));
    source.start(ctx.currentTime + 0.06);
    // The 2 ms pulse has left the 1024-frame analyser window before this draw.
    await new Promise(resolve => setTimeout(resolve, 400));
    text.length = 0;
    meter.paint(null, null, false, performance.now() / 1000);
    source.disconnect();
    return {
      reduced: meter.reduced.matches,
      instantaneous: meter.samples.map(samples => Math.max(...samples.map(Math.abs))),
      held: meter.holds,
      text,
    };
  });
  expect(result.reduced).toBe(true);
  expect(result.instantaneous).toEqual([0, 0]);
  expect(result.held[0]).toBeCloseTo(1.1, 4);
  expect(result.held[1]).toBeCloseTo(0.3, 4);
  expect(result.text).toContain('L HOLD 0.8 dBFS');
  expect(result.text).toContain('R HOLD -10.5 dBFS');
  expect(result.text.filter(value => value.includes('CLIP'))).toEqual(['L CLIP']);
});

test('the continuous meter tap produces no extra speaker signal', async ({page}) => {
  const peak = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(2, 4800, 48000);
    await ctx.audioWorklet.addModule('/stereo-meter-worklet.js');
    const meter = new AudioWorkletNode(ctx, 'afterhours-stereo-meter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const source = ctx.createConstantSource();
    source.offset.value = 0.5;
    source.connect(meter).connect(ctx.destination);
    source.start();
    const rendered = await ctx.startRendering();
    return Math.max(...rendered.getChannelData(0).map(Math.abs), ...rendered.getChannelData(1).map(Math.abs));
  });
  expect(peak).toBe(0);
});

test('silent meters stop painting and hidden meters do not sample audio', async ({page}) => {
  await page.evaluate(() => {
    window.__meterReads = 0;
    window.__meterPaints = 0;
    const read = AfterhoursAudio.readStereo;
    AfterhoursAudio.readStereo = (...args) => {
      __meterReads++;
      return read(...args);
    };
    const ctx = document.getElementById('groove-visual').getContext('2d'),
      clear = ctx.clearRect;
    ctx.clearRect = function (...args) {
      __meterPaints++;
      return clear.apply(this, args);
    };
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    __meterPaints = 0;
  });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => __meterPaints)).toBe(0);
  await page.locator('#ws-synth').click();
  await page.evaluate(() => {
    __meterReads = 0;
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => __meterReads)).toBe(0);
});
