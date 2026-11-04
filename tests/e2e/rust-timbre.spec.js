// @ts-check
const {test, expect} = require('@playwright/test');
const {compare} = require('./helpers/parity');

const machines = ['Ladder', 'DualVCO', 'Wavetable', 'WavePad'].flatMap(machine =>
  ['biquad', 'ladder'].flatMap(filter => [
    {name: `${machine} ${filter}`, lane: 7, gate: 1, settings: {machine, filter, note: 45, cutoff: 1800}},
    {
      name: `${machine} ${filter} bright, resonant, moving`,
      lane: 7,
      gate: 1,
      settings: {machine, filter, note: 57, cutoff: 5000, shape: 80, color: 70, sweep: 80, contour: 90},
    },
  ]),
);
machines.push(
  ...['shape', 'pitch', 'cutoff'].map(target => ({
    name: `Wavetable ${target} LFO`,
    lane: 7,
    gate: 1,
    settings: {machine: 'Wavetable', note: 45, lfo: {target, depth: 80, division: 0.5, shape: 'triangle'}},
  })),
);
const patches = ['grand-bass', 'grand-lead', 'ppg-pluck', 'ppg-lead', 'third-horizon', 'third-prism'].map(patch => ({
  name: `Synth ${patch}`,
  patch,
  seconds: 3,
}));
patches.push(
  ...['grand-lead', 'third-horizon'].map(patch => ({
    name: `Synth ${patch} with live control changes`,
    patch,
    seconds: 3,
    release: 1.8,
    // After the filter sweep: cancelling an unfinished Web Audio ramp jumped the old cutoff
    // back to the sweep peak, while Rust finishes the sweep and glides.
    change: {at: 1.2, values: {cutoff: 900, resonance: 4, position: 0.1, motion: 0.3}},
  })),
);

test('Rust Ladder, DualVCO and Wavetable voices match the Web Audio graph they replace', async ({page}) => {
  await page.goto('/');
  const results = await compare(
    page,
    [...machines, ...patches].map(c => ({...c, lags: 200})),
  );
  for (const r of results) {
    expect(r.usesWorklet[1], r.name).toBe(true);
    expect(r.nodes[1], r.name).toBeLessThan(r.nodes[0]);
    expect(r.finite, r.name).toBe(true);
    if (/ ladder/.test(r.name)) {
      // Ladder β: the same filter code, now fed by Rust oscillators.
      expect(r.lag, r.name).toBe(0);
      expect(r.correlation, r.name).toBeGreaterThan(0.9999);
      expect(Math.abs(r.levelDb), r.name).toBeLessThan(0.01);
      expect(r.contourError, r.name).toBeLessThan(0.1);
    } else {
      // Biquad: a different 2× oversampling filter around the same waveshaper. The old
      // WaveShaper delayed these voices by about 2 ms; Rust starts on time.
      expect(r.lag, r.name).toBeLessThan(-50);
      expect(r.correlation, r.name).toBeGreaterThan(0.999);
      expect(Math.abs(r.levelDb), r.name).toBeLessThan(0.1);
      expect(r.contourError, r.name).toBeLessThan(1);
    }
  }
});
