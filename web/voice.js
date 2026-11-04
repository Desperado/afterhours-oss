'use strict';
/* Rust voice adapters. Scheduled note times are fixed when a voice is created (AudioParams or
   processorOptions); only realtime changes such as key-up and panel edits are messages. */
(() => {
  const loading = new WeakMap(),
    ready = new WeakSet(),
    muted = new WeakMap(),
    tablesByRate = new Map();
  function wavetables(rate) {
    if (!tablesByRate.has(rate)) {
      const task = new Promise((resolve, reject) => {
        const worker = new Worker('/wavetable-worker.js');
        const finish = (error, tables) => {
          clearTimeout(timeout);
          worker.terminate();
          if (error) reject(new Error(`Wavetables · ${error}`));
          else resolve(tables);
        };
        const timeout = setTimeout(() => finish('worker timed out'), 15000);
        worker.onerror = event => finish(event.message || 'worker failed');
        worker.onmessage = ({data}) => finish(data.error, data.tables);
        worker.postMessage(rate);
      });
      tablesByRate.set(rate, task);
      task.catch(() => tablesByRate.delete(rate));
    }
    return tablesByRate.get(rate);
  }
  async function installWavetables(ctx, tables) {
    const node = new AudioWorkletNode(ctx, 'afterhours-wavetables', {processorOptions: {tables}});
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Wavetable import timed out')), 15000);
        const finish = error => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };
        node.onprocessorerror = () => finish(new Error('Wavetable import failed'));
        node.port.onmessage = ({data}) => {
          if (data === 'ready') finish();
        };
      });
    } finally {
      node.port.close();
      node.disconnect();
    }
  }
  // The most recent load failure, shown to the user instead of a bare "unavailable".
  let failure = '';
  // Groove machines rendered by dsp/src/groove.rs, in ABI order.
  const grooveMachines = ['Kick', 'Snare', 'Metal', 'Perc', 'Tone', 'Chord', 'Saw'];
  // `timing` ({start, stop} in seconds) selects note-timed voices, whose gate is not an
  // AudioParam: times go in processorOptions and later changes are messages. With a `pan`
  // (−1…1) the voice renders panned stereo itself. `destination` may be a list.
  function worklet(ctx, name, config, destination, timing = null) {
    if (!ready.has(ctx)) throw new Error('Rust voice unavailable · reload the app and try again');
    const node = new AudioWorkletNode(ctx, name, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [Number.isFinite(timing?.pan) ? 2 : 1],
      processorOptions: {config, ...timing},
    });
    const param = name => node.parameters.get(name);
    for (const d of [destination].flat()) node.connect(d);
    // A silent source supplies Web Audio's exact onended lifetime, including offline renders.
    // It must be pulled by the graph, through one muted gain shared by the context.
    const clock = ctx.createConstantSource();
    if (!muted.has(ctx)) {
      const mute = ctx.createGain();
      mute.gain.value = 0;
      mute.connect(ctx.destination);
      muted.set(ctx, mute);
    }
    clock.connect(muted.get(ctx));
    const times = {...timing};
    const source = {
      onended: null,
      start(time) {
        if (!timing) param('gate').setValueAtTime(1, time);
        else if (time !== times.start) node.port.postMessage({start: (times.start = time)});
        clock.start(time);
      },
      stop(time) {
        // A stop ends the voice; it also cancels a note not yet started.
        if (!timing) {
          param('gate').cancelScheduledValues(time);
          param('gate').setValueAtTime(-1, time);
        } else if (time !== times.stop) node.port.postMessage({stop: (times.stop = time)});
        clock.stop(time);
      },
    };
    clock.onended = () => {
      node.port.postMessage('dispose');
      source.onended?.();
    };
    // Silencing a voice whose output has no gain node after it: a 4 ms fade, then the stop.
    source.fade = at => node.port.postMessage({fade: at});
    const release = at => {
      if (timing) return node.port.postMessage({release: at});
      param('gate').cancelScheduledValues(at);
      param('gate').setValueAtTime(0, at);
    };
    return {node, param, nodes: [node, clock], source, release};
  }
  // A processor with only the parameters a voice uses: detune and/or modulation.
  const variant = (base, tuned, modulated) => `${base}-${tuned ? 'd' : ''}${modulated ? 'm' : ''}`;
  // Where a voice's single modulation input goes, from the track LFO target.
  const modulationTarget = (lfo, pitch) =>
    lfo === 'cutoff' ? 1 : lfo === 'shape' ? 2 : lfo === 'pitch' && pitch ? 3 : 0;
  window.AfterhoursVoice = {
    prepare(ctx) {
      if (!loading.has(ctx))
        loading.set(
          ctx,
          (async () => {
            try {
              if (!(await AfterhoursLadder.prepare(ctx))) {
                failure = `DSP runtime · ${AfterhoursLadder.failure || 'did not load'}`;
                return false;
              }
              const tables = await wavetables(ctx.sampleRate);
              await ctx.audioWorklet.addModule('/voice-worklet.js');
              await installWavetables(ctx, tables);
              ready.add(ctx);
              return true;
            } catch (error) {
              console.warn('Rust voice unavailable', error);
              failure = `voice worklet · ${error?.name || 'Error'}: ${error?.message || error}`;
              return false;
            }
          })(),
        );
      return loading.get(ctx);
    },
    ready: ctx => ready.has(ctx),
    unavailable: action => new Error(`Rust voice unavailable · ${action}${failure ? ` (${failure})` : ''}`),
    grooveMachines,
    create(ctx, p, destination) {
      const config = [
        p.oscA ?? 0,
        p.oscB ?? 1,
        p.osc2Ratio ?? 1,
        p.detune ?? 4,
        p.sub ?? 0.12,
        p.noise ?? 0,
        p.drift ?? 2,
        p.pwmRate ?? 0.3,
        p.attack ?? 0.005,
        p.decay ?? 0.2,
        p.sustain ?? 0.6,
        p.release ?? 0.3,
        p.filterAttack ?? 0.008,
        p.filterDecay ?? p.decay ?? 0.2,
        p.filterSustain ?? 0,
        p.filterRelease ?? p.release ?? 0.3,
        p.glide ?? 0,
        p.fromHz ?? p.hz,
        p.seed ?? 1979,
        0,
      ];
      const {param, nodes, source, release} = worklet(ctx, 'afterhours-voice', config, destination);
      param('frequency').value = p.hz;
      const set = (values, at = ctx.currentTime) => {
        const valuesByName = {
          cutoff: values.cutoff,
          resonance: Math.max(0, Math.min(3.95, (values.resonance - 0.5) * 0.62)),
          blend: values.position ?? 0.5,
          motion: values.motion ?? 0,
          drive: 1 + (values.drive ?? 0) * 5,
          pulseWidth: values.pulseWidth ?? 0.5,
          envelope: (values.envelope ?? 0) * 5,
        };
        for (const [name, value] of Object.entries(valuesByName))
          if (Number.isFinite(value)) {
            param(name).cancelScheduledValues(at);
            param(name).setValueAtTime(value, at);
          }
      };
      set(p, p.time);
      return {
        rust: true,
        nodes,
        sources: [source],
        oscillators: [{detune: param('detune')}],
        filters: [{detune: param('filterDetune')}],
        pre: {gain: param('drive')},
        set,
        release,
      };
    },
    // Ladder, DualVCO and Wavetable voices for Groove and Synth: oscillators, drive and
    // filter. The host keeps the amplitude envelope, so these voices have no release.
    timbre(ctx, p, destination) {
      // Live Synth controls arrive as messages for their render quantum; per-sample
      // AudioParams would cost CPU in every quantum of every voice.
      const controls = values => [
        Math.max(40, Math.min(ctx.sampleRate * 0.42, values.cutoff)),
        Math.max(0.1, Math.min(12, values.resonance)),
        Math.max(0, Math.min(1, values.position ?? 0.5)),
        Math.max(0, Math.min(1, values.motion || 0)),
      ];
      let previous = controls(p);
      const config = [
        ['ladder', 'dual', 'wave'].indexOf(p.family),
        p.filter === 'ladder' ? 1 : 0,
        p.hz,
        p.detune ?? 4,
        p.osc2Ratio || 1,
        p.envelope || 0,
        p.decay || 0.3,
        modulationTarget(p.lfo, false),
        ...previous,
        1 + (p.drive || 0) * 3,
        0,
        0,
        0,
      ];
      const modulated = config[7] !== 0;
      const {node, param, nodes, source} = worklet(
        ctx,
        variant('afterhours-timbre', true, modulated),
        config,
        destination,
        {
          start: p.time,
          stop: p.stop ?? null,
        },
      );
      const set = (values, at = ctx.currentTime) => {
        const next = controls(values);
        const changed = next.map((value, i) => [8 + i, value]).filter(([, value], i) => value !== previous[i]);
        if (changed.length && changed.every(([, value]) => Number.isFinite(value))) {
          node.port.postMessage({at, values: changed});
          previous = next;
        }
      };
      const modulation = modulated ? param('modulation') : null;
      return {
        nodes,
        sources: [source],
        oscillators: [{detune: param('detune')}],
        // The modulation input exists only for an LFO on the cutoff (filter detune) or shape (drive).
        filters: modulated ? [{detune: modulation}] : [],
        pre: modulated ? {gain: modulation} : null,
        set,
      };
    },
    // One Groove FM or Saw note. Rust derives its envelopes from the track settings.
    // Percussion is never tuned, so it has no detune parameter; a pitch LFO reaches it
    // through the modulation input instead. Inputs absent from the voice are null.
    groove(ctx, p, destination) {
      const percussion = ['Kick', 'Snare', 'Metal', 'Perc'].includes(p.machine);
      const config = [
        grooveMachines.indexOf(p.machine),
        p.hz,
        p.loudness,
        p.color,
        p.shape,
        p.sweep,
        p.contour,
        p.cutoff,
        p.algorithm === 'serial' ? 1 : 0,
        p.gate,
        p.decay,
        p.held ? 1 : 0,
        modulationTarget(p.lfo, percussion),
        0,
        0,
        0,
      ];
      const modulated = config[12] !== 0;
      const {param, nodes, source, release} = worklet(
        ctx,
        variant('afterhours-groove', !percussion, modulated),
        config,
        destination,
        {start: p.time, stop: p.stop ?? null, pan: p.pan},
      );
      const modulation = modulated ? param('modulation') : null;
      return {
        nodes,
        sources: [source],
        oscillators: [{detune: percussion ? modulation : param('detune')}],
        // The modulation input is the filter detune or the shape, by the LFO target. Rust
        // scales a shape amount (LFO × depth) to FM deviation or Saw drive.
        filters: [{detune: modulation}],
        shape: modulation,
        release,
      };
    },
  };
})();
