'use strict';
document.getElementById('run').onclick = async () => {
  const output = document.getElementById('result'),
    checks = [],
    G = AfterhoursGroove;
  const assert = (ok, text) => {
    if (!ok) throw new Error(text);
  };
  const rms = (a, from = 0, to = a.length) => Math.sqrt(a.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  async function render(lane, overrides = {}, stop = false) {
    const ctx = new OfflineAudioContext(2, 48000 * 2, 48000);
    assert(await AfterhoursLadder.prepare(ctx), 'Ladder worklet did not load');
    assert(await AfterhoursVoice.prepare(ctx), 'Rust voice did not load');
    const audio = new FMGrooveAudio(ctx, 120);
    const settings = {...G.project().patterns[0].tracks[lane], ...overrides};
    audio.hit({lane, settings, velocity: 0.8, gate: 0.5}, 0.05);
    if (stop)
      ctx.suspend(0.1).then(() => {
        audio.stopLane(lane);
        return ctx.resume();
      });
    const buffer = await ctx.startRendering();
    return {buffer, left: buffer.getChannelData(0), right: buffer.getChannelData(1)};
  }
  async function test(name, fn) {
    await fn();
    checks.push(name);
    output.textContent = checks.map(x => 'PASS ' + x).join('\n');
  }
  document.getElementById('run').disabled = true;
  try {
    await test('Six machines produce finite, non-silent stereo audio with decaying tails', async () => {
      for (let lane = 0; lane < 6; lane++) {
        const {left, right} = await render(lane);
        assert(
          left.every(Number.isFinite) && right.every(Number.isFinite),
          G.machines[lane] + ' produced non-finite audio',
        );
        assert(rms(left) > 0.00001, G.machines[lane] + ' is silent');
        assert(rms(left, 90000) < rms(left, 5000, 15000) * 0.05, G.machines[lane] + ' did not decay');
      }
    });
    await test('Shape, Color, Sweep, Contour, algorithm and filter change rendered samples', async () => {
      const a = await render(4);
      for (const settings of [
        {shape: 80},
        {color: 80},
        {sweep: 50},
        {contour: 100},
        {shape: 80, algorithm: 'serial'},
        {cutoff: 100},
      ]) {
        const b = await render(4, settings),
          delta = a.left.map((v, i) => v - b.left[i]);
        assert(rms(delta) > 0.0001, 'No audible change: ' + JSON.stringify(settings));
      }
    });
    await test('Per-track LFO changes FM, pitch, pan and filter in audio', async () => {
      const a = await render(4, {shape: 65, cutoff: 700});
      for (const target of ['shape', 'pitch', 'pan', 'cutoff']) {
        const b = await render(4, {shape: 65, cutoff: 700, lfo: {target, depth: 80, division: 0.5, shape: 'triangle'}});
        assert(rms(a.left.map((v, i) => v - b.left[i])) > 0.0001, target + ' LFO had no effect');
      }
    });
    await test('Bass stays in a low register around E1', async () => {
      const {left} = await render(4),
        from = 8000,
        to = 16000;
      let best = [0, 0];
      for (let hz = 25; hz <= 500; hz++) {
        let re = 0,
          im = 0;
        for (let i = from; i < to; i++) {
          re += left[i] * Math.cos((2 * Math.PI * hz * i) / 48000);
          im += left[i] * Math.sin((2 * Math.PI * hz * i) / 48000);
        }
        const power = re * re + im * im;
        if (power > best[1]) best = [hz, power];
      }
      assert(best[0] >= 38 && best[0] <= 45, 'Bass peak was ' + best[0] + ' Hz');
    });
    await test('Stop/mute silences a ringing lane', async () => {
      const ringing = await render(5),
        stopped = await render(5, {}, true);
      assert(rms(ringing.left, 12000, 30000) > 0.0001, 'Reference is silent');
      assert(rms(stopped.left, 12000, 30000) < 0.000001, 'Stopped voice kept ringing');
    });
    await test('Ladder β filter renders, follows cutoff and resonance, and matches the Biquad level', async () => {
      const ladder = {machine: 'Ladder', filter: 'ladder', note: 45, shape: 20, cutoff: 1800, sweep: 0};
      // A first difference weights the spectrum towards high frequencies.
      const bright = a =>
        rms(
          a.map((v, i) => v - (a[i - 1] || 0)),
          4000,
          30000,
        ) / rms(a, 4000, 30000);
      const open = await render(4, ladder),
        closed = await render(4, {...ladder, cutoff: 300}),
        biquad = await render(4, {...ladder, filter: 'biquad'}),
        resonant = await render(4, {...ladder, shape: 100});
      assert(
        open.left.every(Number.isFinite) && resonant.left.every(Number.isFinite),
        'Ladder produced non-finite audio',
      );
      assert(rms(open.left) > 0.001, 'Ladder is silent');
      assert(rms(open.left, 90000) < rms(open.left, 5000, 15000) * 0.05, 'Ladder did not decay');
      assert(bright(closed.left) < 0.6 * bright(open.left), 'Lower cutoff did not darken the ladder');
      const level = 20 * Math.log10(rms(open.left, 4000, 30000) / rms(biquad.left, 4000, 30000));
      assert(Math.abs(level) < 6, 'Ladder level differs from Biquad by ' + level.toFixed(1) + ' dB');
      assert(
        open.left.some((v, i) => Math.abs(v - biquad.left[i]) > 0.001),
        'Ladder sounded identical to Biquad',
      );
      assert(bright(resonant.left) > bright(open.left), 'Resonance did not emphasise the cutoff');
      // Exports create every voice before rendering, so a late note must survive until its start.
      const ctx = new OfflineAudioContext(2, 48000 * 14, 48000);
      await AfterhoursLadder.prepare(ctx);
      const late = new FMGrooveAudio(ctx, 120);
      late.hit({lane: 4, settings: {...G.project().patterns[0].tracks[4], ...ladder}, velocity: 0.8, gate: 0.5}, 12);
      const tail = (await ctx.startRendering()).getChannelData(0);
      assert(rms(tail, 12 * 48000, 13 * 48000) > 0.001, 'Ladder note scheduled at 12 s was silent');
    });
    await test('Pan and 48 kHz 24-bit PCM WAV export preserve audio', async () => {
      const {buffer, left, right} = await render(4, {pan: -100});
      assert(rms(left) > 0.001 && rms(right) < 0.000001, 'Pan failed');
      const wav = FMGrooveAudio.wav(buffer),
        view = new DataView(wav);
      const sample = (frame, channel) => {
        const at = 44 + (frame * 2 + channel) * 3;
        return (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)) / 8388607;
      };
      assert(String.fromCharCode(...new Uint8Array(wav, 0, 4)) === 'RIFF', 'Missing WAV header');
      assert(view.getUint32(24, true) === 48000 && view.getUint16(22, true) === 2, 'Wrong WAV format');
      assert(view.getUint16(34, true) === 24 && view.getUint16(32, true) === 6, 'Not 24-bit PCM');
      assert(wav.byteLength === 44 + buffer.length * 6, 'Truncated WAV');
      assert(Math.abs(sample(10000, 0) - left[10000]) < 2.5 / 8388607, 'WAV samples changed');
      // A -110 dBFS tone is below one 16-bit step; dithered 24-bit keeps it.
      const quiet = new AudioBuffer({numberOfChannels: 2, length: 48000, sampleRate: 48000});
      quiet
        .getChannelData(0)
        .forEach((_, i, a) => (a[i] = 10 ** (-110 / 20) * Math.sin((2 * Math.PI * 1000 * i) / 48000)));
      const tone = new DataView(FMGrooveAudio.wav(quiet));
      let correlation = 0;
      for (let i = 0; i < 48000; i++) {
        const at = 44 + i * 6,
          value = (tone.getUint8(at) | (tone.getUint8(at + 1) << 8) | (tone.getInt8(at + 2) << 16)) / 8388607;
        correlation += value * Math.sin((2 * Math.PI * 1000 * i) / 48000);
      }
      assert(Math.abs(correlation / 24000 - 10 ** (-110 / 20)) < 0.2 * 10 ** (-110 / 20), 'Quiet tone lost');
      assert(
        new Uint8Array(FMGrooveAudio.wav(quiet)).every((byte, i) => byte === new Uint8Array(tone.buffer)[i]),
        'Dither is not repeatable',
      );
    });
    output.textContent += '\n\n' + checks.length + ' checks passed';
  } catch (e) {
    output.textContent += '\nFAIL ' + e.message;
  } finally {
    document.getElementById('run').disabled = false;
  }
};
