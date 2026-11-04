// Run in a browser with /effects.js loaded. OfflineAudioContext renders the
// production graph to samples without playing sound or needing a recording.
'use strict';
async function checkEffects() {
  const rate = 24000;
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  function rms(samples, from = 0, to = samples.length) {
    let power = 0;
    for (let i = from; i < to; i++) power += samples[i] ** 2;
    return Math.sqrt(power / (to - from));
  }
  async function render(
    parameters = {},
    {bypass = false, paused = false, impulse = false, reset = false, resetAt = null} = {},
  ) {
    const context = new OfflineAudioContext(1, rate, rate);
    const buffer = context.createBuffer(1, rate, rate);
    const samples = buffer.getChannelData(0);
    if (impulse) samples[100] = 0.1;
    else for (let i = 0; i < samples.length; i++) samples[i] = 0.1 * Math.sin((2 * Math.PI * 3000 * i) / rate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const effects = new LiveEffects({paused, ended: false, addEventListener() {}});
    for (const [key, value] of Object.entries(parameters)) effects.set(key, value);
    effects.bypassed = bypass;
    effects.connect(context, source);
    if (reset) {
      effects.reset();
      effects.apply(true);
    }
    if (resetAt !== null)
      context.suspend(resetAt).then(() => {
        effects.reset();
        effects.apply(true);
        return context.resume();
      });
    source.start();
    return {samples: (await context.startRendering()).getChannelData(0), input: samples, effects};
  }
  const checks = [];
  async function test(name, run) {
    await run();
    checks.push(name);
  }
  await test('Bypass reproduces the original samples despite extreme effects', async () => {
    const {samples, input} = await render({drive: 100, cutoff: 0, echo: 65, bass: 12}, {bypass: true});
    assert(
      samples.every((value, i) => Math.abs(value - input[i]) < 1e-6),
      'Bypass changed the original signal',
    );
  });
  await test('Dragging the filter changes rendered audio', async () => {
    const open = await render();
    const closed = await render({cutoff: 10});
    assert(rms(open.samples, 5000) > 0.05, 'Open filter produced no signal');
    assert(rms(closed.samples, 5000) < rms(open.samples, 5000) * 0.02, 'Low-pass filter did not reject the 3 kHz tone');
  });
  await test('Distortion audibly changes samples', async () => {
    const clean = await render();
    const dirty = await render({drive: 100});
    assert(rms(dirty.samples, 5000) > rms(clean.samples, 5000) * 2, 'Distortion had no effect');
  });
  await test('Echo generates decaying repeats after the dry impulse', async () => {
    const dry = await render({}, {impulse: true});
    const wet = await render({echo: 65, delay: 100}, {impulse: true});
    assert(rms(wet.samples, 2000, 8000) > 0.0001, 'Echo produced no delayed signal');
    assert(rms(dry.samples, 2000, 8000) < 0.000001, 'Dry impulse unexpectedly repeated');
    assert(rms(wet.samples, 16000) < rms(wet.samples, 2000, 8000), 'Echo feedback did not decay');
  });
  await test('Pause and reset prevent stale echo', async () => {
    const paused = await render({echo: 65, delay: 100}, {impulse: true, paused: true});
    const reset = await render({echo: 65, delay: 100, drive: 100}, {impulse: true, reset: true});
    assert(rms(paused.samples, 5000) < 0.000001, 'Paused player continued echoing');
    assert(rms(reset.samples, 5000) < 0.000001, 'Reset left echo playing');
    assert(reset.effects.values.drive === 0 && reset.effects.values.echo === 0, 'Reset did not restore controls');
  });
  await test('Reset removes repeats already in the delay memory', async () => {
    const result = await render({echo: 65, delay: 100}, {impulse: true, resetAt: 0.2});
    assert(rms(result.samples, 2500, 4500) > 0.0001, 'Test did not create an echo before reset');
    assert(rms(result.samples, 8000) < 0.000001, 'Old echo leaked after reset');
  });
  await test('Parameter limits reject NaN and bound echo feedback settings', async () => {
    const effects = new LiveEffects({addEventListener() {}});
    effects.set('echo', 10000);
    effects.set('cutoff', -500);
    effects.set('drive', NaN);
    assert(
      effects.values.echo === 65 && effects.values.cutoff === 0 && effects.values.drive === 0,
      'Invalid controls were accepted',
    );
    const snapshot = effects.snapshot();
    snapshot.parameters.echo = 0;
    assert(effects.values.echo === 65, 'Export changed live parameters');
  });
  return checks;
}
checkEffects()
  .then(checks => {
    document.getElementById('result').textContent = `${checks.length} checks passed\n\n${checks.join('\n')}`;
    document.title = 'PASS · AFTERHOURS audio tests';
  })
  .catch(error => {
    document.getElementById('result').textContent = `FAIL: ${error.message}`;
    document.title = 'FAIL · AFTERHOURS audio tests';
  });
