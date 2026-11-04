'use strict';
/* Native Web Audio FM and subtractive voices, envelopes on the audio clock. */
class FMGrooveAudio {
  constructor(context, bpm = 93, controllerState, performanceState, target = 'groove') {
    this.context = context;
    this.bpm = bpm;
    this.voices = new Set();
    this.instrumentSequence = new Map();
    this.started = context.currentTime;
    this.master = context.createGain();
    this.master.gain.value = 0.9;
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 5;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.controller = new AfterhoursController.Session(context, controllerState, target);
    this.master.connect(this.limiter).connect(this.controller.input);
    this.music = context.createGain();
    this.music.connect(this.master);
    this.drums = context.createGain();
    this.drums.connect(this.master);
    this.musicLevel = context.createGain();
    this.musicLevel.connect(this.music);
    this.mixer = new AfterhoursMixer(context, this.drums, this.musicLevel, bpm);
    this.setPerformance(
      performanceState || window.AfterhoursPerformance?.snapshot() || AfterhoursPerformanceCore.validate(),
      true,
    );
    this.delay = context.createDelay(2);
    this.delayFilter = context.createBiquadFilter();
    this.delayFilter.frequency.value = 2700;
    this.feedback = context.createGain();
    this.feedback.gain.value = 0.34;
    this.wet = context.createGain();
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.feedback).connect(this.delay);
    this.delayFilter.connect(this.wet).connect(this.musicLevel);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.limiter.connect(this.analyser);
    this.samples = new Float32Array(1024);
    this.saturation = Float32Array.from({length: 2049}, (_, i) => Math.tanh((i / 1024 - 1) * 2));
    // A repeatable noise source gives the FM snare and hats a broad, crisp transient.
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    let seed = 1979;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = seed / 2147483648 - 1;
    }
    this.setMix();
  }
  setPerformance(state, immediate = false) {
    this.performance = state;
    this.mixer.apply(state, this.bpm);
    for (const [param, value] of [
      [this.drums.gain, state.mixer.drums],
      [this.musicLevel.gain, state.mixer.music],
    ]) {
      if (immediate) param.setValueAtTime(value, this.context.currentTime);
      else param.setTargetAtTime(value, this.context.currentTime, 0.02);
    }
  }
  setMix(mix = {}) {
    this.mix = {space: Math.max(0, Math.min(1, mix.space || 0)), pump: Math.max(0, Math.min(1, mix.pump || 0))};
    this.wet.gain.setTargetAtTime(this.mix.space * 0.55, this.context.currentTime, 0.025);
    this.delay.delayTime.setTargetAtTime(Math.min(1.8, (60 / this.bpm) * 0.75), this.context.currentTime, 0.025);
    this.mixer.apply(this.performance, this.bpm);
    if (!this.mix.pump) this.cancelPump(this.context.currentTime);
  }
  level() {
    this.analyser.getFloatTimeDomainData(this.samples);
    return Math.max(...this.samples.map(Math.abs));
  }
  hit(e, when, live = false, schedulePump = true) {
    if (e.settings.machine === 'Analog' && !AfterhoursVoice.ready(this.context))
      throw new Error('Rust voice unavailable · reload the app and try again');
    // Bound realtime work; offline graphs are checked before rendering.
    if (this.context instanceof AudioContext && this.voices.size >= 32) {
      const oldest = this.voices.values().next().value;
      this.silence(oldest);
      this.voices.delete(oldest);
    }
    if (e.settings.machine === 'Sample') return this.sampleHit(e, when);
    if (e.settings.machine === 'Instrument') {
      const voice = AfterhoursInstruments.hit(this, e, when, live);
      if (voice && e.settings.instrument === 'virtuosity-drums' && e.settings.note === 36) {
        voice.duckAt = Math.max(this.context.currentTime + 0.001, when);
        if (schedulePump) this.duck(voice.duckAt);
      }
      return voice;
    }
    const ctx = this.context,
      s = AfterhoursPerformanceCore.shape(
        e.settings,
        this.performance.macros,
        this.performance.targets.includes(e.lane),
      ),
      time = Math.max(ctx.currentTime + 0.001, when);
    const secondsPerBeat = 60 / this.bpm,
      gate = e.gate * secondsPerBeat;
    const timbral = ['Ladder', 'DualVCO', 'Wavetable', 'WavePad', 'Analog'].includes(s.machine),
      chord = ['Chord', 'WavePad'].includes(s.machine);
    const percussion = ['Kick', 'Snare', 'Metal', 'Perc'].includes(s.machine);
    const length = percussion ? s.decay : Math.min(8, gate + s.decay);
    const end = time + length + 0.04;
    // Rust renders the FM machines and Saw, including their filter and envelopes. The Web
    // Audio graph below remains the fallback when the worklet cannot load.
    const rust = !timbral && AfterhoursVoice.ready(ctx);
    const filter = rust ? null : ctx.createBiquadFilter();
    if (filter) {
      filter.type = timbral ? 'allpass' : 'lowpass';
      filter.frequency.value = Math.min(s.cutoff, ctx.sampleRate * 0.42);
      filter.Q.value = 0.65;
    }

    // A scheduled Rust note pans itself and goes straight to its mixer channel: no panner or
    // gain node per hit. Live keys (pressure) and pan LFOs keep the Web Audio chain.
    const direct = rust && !live && !(s.lfo.depth > 0 && s.lfo.target === 'pan');
    const pan = direct ? null : ctx.createStereoPanner();
    if (pan) pan.pan.value = s.pan / 100;
    const amp = direct ? null : ctx.createGain();
    if (amp) amp.gain.value = 0;
    const pulse = s.performance?.pulse || 0;
    const loudness =
      (s.volume / 100) ** 1.5 *
      e.velocity *
      (1 - pulse * 0.35 * (1 - Math.cos(e.beat * Math.PI * 2 || 0))) *
      (chord ? 0.22 : timbral || s.machine === 'Saw' ? 0.27 : 0.45);
    const attack = chord ? 0.012 + (100 - s.contour) * 0.0005 : 0.003;
    // Rust notes shape their own level; the Web Audio voices use this gain as their envelope.
    if (amp && rust) amp.gain.value = 1;
    else if (amp && s.machine === 'Analog') amp.gain.setValueAtTime(loudness, time);
    else if (amp) {
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(loudness, time + Math.min(attack, length / 3));
      if (!percussion) amp.gain.setValueAtTime(loudness * 0.72, time + Math.max(attack, gate));
      amp.gain.exponentialRampToValueAtTime(0.00001, end);
    }
    // Where the hit's sound goes: its mixer channel, plus the echo send for some machines.
    const outputs = [this.mixer.channel(e.lane, percussion)];
    if (chord || s.machine === 'Perc' || ((timbral || s.machine === 'Saw') && s.note >= 52))
      outputs.push(this.mixer.legacy(e.lane, this.delay));
    if (!direct) {
      filter?.connect(pan);
      pan.connect(amp);
      for (const output of outputs) amp.connect(output);
    }
    if (schedulePump && s.machine === 'Kick') this.duck(time);
    const nodes = [filter, pan, amp].filter(Boolean),
      sources = [],
      releases = [],
      fades = [];
    // Live keys share the sequencer voice and filter. Only the gate is held until key-up.
    const bend = live ? ctx.createConstantSource() : null;
    const pressure = live ? ctx.createGain() : null;
    if (live) {
      bend.offset.value = 0;
      bend.start(time);
      sources.push(bend);
      nodes.push(bend, pressure);
      pan.disconnect(amp);
      pan.connect(pressure).connect(amp);
      if (!percussion && s.machine !== 'Analog' && !rust) amp.gain.cancelScheduledValues(end);
    }
    let input = filter;
    if (s.machine === 'Metal' && !rust) {
      input = ctx.createBiquadFilter();
      input.type = 'highpass';
      input.frequency.value = 1500 + s.color * 35;
      input.Q.value = 0.65;
      input.connect(filter);
      nodes.push(input);
    }
    const oscillator = (frequency, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = frequency;
      nodes.push(o);
      sources.push(o);
      return o;
    };
    const gain = v => {
      const g = ctx.createGain();
      g.gain.value = v;
      nodes.push(g);
      return g;
    };
    if ((s.machine === 'Snare' || s.machine === 'Metal') && !rust) {
      const noise = ctx.createBufferSource(),
        air = ctx.createBiquadFilter();
      noise.buffer = this.noise;
      noise.loop = true;
      air.type = 'highpass';
      air.frequency.value = s.machine === 'Snare' ? 1100 : 6000;
      nodes.push(noise, air);
      sources.push(noise);
      noise
        .connect(air)
        .connect(gain(s.machine === 'Snare' ? 0.9 : 0.65))
        .connect(input);
    }
    let lfo = null;
    if (s.lfo.depth > 0) {
      lfo = oscillator(this.bpm / (60 * s.lfo.division), s.lfo.shape);
      // The phase follows the transport rather than restarting for every hit.
      const phase = 2 * Math.PI * (time - this.started) * lfo.frequency.value;
      const real = new Float32Array(33),
        imag = new Float32Array(33);
      for (let k = 1; k <= 32; k++) {
        let a = k === 1 ? 1 : 0;
        if (s.lfo.shape === 'square') a = k % 2 ? 4 / (Math.PI * k) : 0;
        if (s.lfo.shape === 'sawtooth') a = (2 * (k % 2 ? 1 : -1)) / (Math.PI * k);
        if (s.lfo.shape === 'triangle') a = k % 2 ? (8 * (k % 4 === 1 ? 1 : -1)) / (Math.PI * Math.PI * k * k) : 0;
        real[k] = a * Math.sin(k * phase);
        imag[k] = a * Math.cos(k * phase);
      }
      lfo.setPeriodicWave(ctx.createPeriodicWave(real, imag, {disableNormalization: true}));
      if (s.lfo.target === 'cutoff' && filter) lfo.connect(gain(s.lfo.depth * 24)).connect(filter.detune);
      if (s.lfo.target === 'pan') lfo.connect(gain(s.lfo.depth / 100)).connect(pan.pan);
    }
    const pitches = AfterhoursGroove.notes(s);
    const tune = (note, oscillators) => {
      if (percussion) return;
      if (bend) for (const o of oscillators) bend.connect(o.detune);
      const source = this.controller.tune(
        note,
        oscillators,
        time,
        (s.performance?.drift || 0) * 18 * Math.sin((time - this.started) * 1.73 + e.lane * 2.4),
      );
      sources.push(source);
      nodes.push(source);
    };
    for (const note of pitches) {
      const hz = Math.min(7000, 440 * 2 ** ((note - 69) / 12));
      if (rust) {
        const voice = AfterhoursVoice.groove(
          ctx,
          {
            machine: s.machine,
            hz,
            loudness,
            color: s.color,
            shape: s.shape,
            sweep: s.sweep,
            contour: s.contour,
            cutoff: s.cutoff,
            algorithm: s.algorithm,
            gate,
            decay: s.decay,
            held: live && !percussion,
            lfo: lfo ? s.lfo.target : null,
            time,
            stop: !live || percussion ? end : null,
            pan: direct ? s.pan / 100 : undefined,
          },
          direct ? outputs : pan,
        );
        if (direct) fades.push(voice.sources[0].fade);
        nodes.push(...voice.nodes);
        sources.push(...voice.sources);
        if (live && !percussion) releases.push(voice.release);
        tune(note, voice.oscillators);
        if (lfo && s.lfo.target === 'pitch') lfo.connect(gain(s.lfo.depth * 2)).connect(voice.oscillators[0].detune);
        if (lfo && s.lfo.target === 'cutoff') lfo.connect(gain(s.lfo.depth * 24)).connect(voice.filters[0].detune);
        if (lfo && s.lfo.target === 'shape') lfo.connect(gain(s.lfo.depth / 100)).connect(voice.shape);
        continue;
      }
      if (timbral) {
        const voice = AfterhoursTimbres.create(
          ctx,
          {
            family:
              s.machine === 'Analog'
                ? 'analog'
                : s.machine === 'Ladder'
                  ? 'ladder'
                  : s.machine === 'DualVCO'
                    ? 'dual'
                    : 'wave',
            hz,
            time,
            cutoff: s.cutoff,
            resonance: 0.5 + s.shape / 16,
            position: s.color / 100,
            motion: s.sweep / 100,
            envelope: s.sweep / 100,
            decay: 0.03 + length * (0.12 + s.contour / 160),
            drive: s.machine === 'Ladder' ? 0.2 : 0.08,
            detune: s.machine === 'WavePad' ? 11 : 3,
            filter: s.filter,
            attack: 0.003,
            sustain: 0.72,
            release: Math.min(s.decay, Math.max(0.005, end - time - gate - 0.01)),
            seed: 1979 + note * 31 + (e.lane || 0),
            lfo: lfo ? s.lfo.target : null,
            stop: live ? null : end,
          },
          input,
        );
        if (voice.rust) {
          if (live) releases.push(voice.release);
          else voice.release(time + Math.min(gate, length));
        }
        nodes.push(...voice.nodes);
        sources.push(...voice.sources);
        tune(note, voice.oscillators);
        if (lfo && s.lfo.target === 'pitch')
          for (const o of voice.oscillators) lfo.connect(gain(s.lfo.depth * 2)).connect(o.detune);
        if (lfo && s.lfo.target === 'cutoff')
          for (const f of voice.filters) lfo.connect(gain(s.lfo.depth * 24)).connect(f.detune);
        if (lfo && s.lfo.target === 'shape') lfo.connect(gain((s.lfo.depth / 100) * 0.5)).connect(voice.pre.gain);
        continue;
      }
      if (s.machine === 'Saw') {
        const drive = gain(1 + s.shape / 14),
          saturator = ctx.createWaveShaper(),
          dc = ctx.createBiquadFilter();
        saturator.curve = this.saturation;
        saturator.oversample = '2x';
        dc.type = 'highpass';
        dc.frequency.value = 25;
        dc.Q.value = 0.5;
        nodes.push(saturator, dc);
        drive.connect(saturator).connect(dc).connect(input);
        const saws = [oscillator(hz, 'sawtooth'), oscillator(hz, 'sawtooth')],
          sub = oscillator(hz / 2, 'triangle');
        saws.forEach((o, i) => {
          o.detune.value = (i ? 1 : -1) * (2 + s.color * 0.2);
          o.connect(gain(0.36)).connect(drive);
        });
        sub.connect(gain(0.2)).connect(drive);
        tune(note, [...saws, sub]);
        filter.frequency.setValueAtTime(Math.min(ctx.sampleRate * 0.42, s.cutoff * (1 + s.sweep / 18)), time);
        filter.frequency.exponentialRampToValueAtTime(
          Math.min(s.cutoff, ctx.sampleRate * 0.42),
          time + Math.max(0.02, length * (0.12 + s.contour / 160)),
        );
        if (lfo && s.lfo.target === 'pitch')
          for (const o of [...saws, sub]) lfo.connect(gain(s.lfo.depth * 2)).connect(o.detune);
        if (lfo && s.lfo.target === 'shape')
          lfo.connect(gain((((s.lfo.depth / 100) * s.shape) / 14) * 0.7)).connect(drive.gain);
        continue;
      }
      const ratio =
        s.machine === 'Metal'
          ? 1.414 + s.color / 18
          : [0.5, 1, 1.5, 2, 3, 4, 7, 9][Math.min(7, Math.floor(s.color * 0.0799))];
      const carrier = oscillator(hz),
        mod = oscillator(Math.min(11000, hz * ratio));
      const second = oscillator(Math.min(11000, hz * (s.machine === 'Metal' ? 2.756 : 1.003)));
      const mod2 = oscillator(Math.min(14000, hz * (s.machine === 'Snare' ? 6.73 : ratio * 2.01)));
      const depth = gain(0),
        depth2 = gain(0);
      const index = 0.04 + (s.shape / 100) ** 2 * (s.machine === 'Kick' ? 3 : 12);
      depth.gain.setValueAtTime(hz * index, time);
      depth.gain.exponentialRampToValueAtTime(
        Math.max(0.01, hz * index * 0.08),
        time + Math.max(0.02, length * (0.1 + s.contour / 120)),
      );
      depth2.gain.value = hz * index * 0.4;
      mod.connect(depth).connect(carrier.frequency);
      mod2.connect(depth2).connect(s.algorithm === 'serial' ? mod.frequency : second.frequency);
      carrier.connect(gain(0.65)).connect(input);
      second.connect(gain(s.machine === 'Kick' ? 0.12 : 0.35)).connect(input);
      if (s.sweep > 0) {
        carrier.frequency.setValueAtTime(hz * (1 + s.sweep / (percussion ? 14 : 150)), time);
        carrier.frequency.exponentialRampToValueAtTime(hz, time + Math.min(0.12, length * 0.45));
      }
      if (s.machine === 'Snare') {
        // Inharmonic FM pairs make a wire-like transient without a sample library.
        second.frequency.value = hz * 1.871;
        mod.frequency.value = hz * 7.13;
      }
      if (lfo && s.lfo.target === 'pitch')
        for (const o of [carrier, second, mod, mod2]) lfo.connect(gain(s.lfo.depth * 2)).connect(o.detune);
      if (lfo && s.lfo.target === 'shape') {
        const amount = gain(((hz * index * s.lfo.depth) / 100) * 0.8);
        lfo.connect(amount).connect(depth.gain);
      }
      tune(note, [carrier, second, mod, mod2]);
    }
    const voice = {
      amp,
      fade: direct ? at => fades.forEach(fade => fade(at)) : null,
      sources,
      nodes,
      end,
      lane: e.lane,
      planTick: e.planTick,
      bend,
      pressure,
      release: live
        ? at => {
            if (percussion) return;
            if (releases.length) releases.forEach(release => release(at));
            else {
              amp.gain.cancelAndHoldAtTime(at);
              amp.gain.exponentialRampToValueAtTime(0.00001, at + s.decay + 0.04);
            }
            for (const o of sources) o.stop(at + s.decay + 0.05);
          }
        : null,
      duckAt: s.machine === 'Kick' && this.mix.pump > 0 ? time : null,
    };
    this.voices.add(voice);
    sources[0].onended = () => {
      for (const n of nodes) n.disconnect();
      this.voices.delete(voice);
    };
    for (const o of sources) {
      // Tuning's constant sources start when attached; oscillators/noise start here.
      if (!(o instanceof ConstantSourceNode)) o.start(time);
      if (!live || percussion) o.stop(end);
    }
    return voice;
  }
  // Offline only: creates each voice shortly before it sounds, then renders. Idle AudioWorklet
  // voices cost CPU in every render quantum until their note starts, so scheduling a whole
  // export up front renders slowly. Hits are scheduled in time order.
  async render(hits, step = 0.05) {
    const ctx = this.context,
      queue = [...hits].sort((a, b) => a.time - b.time),
      last = queue.at(-1)?.time ?? 0;
    let next = 0,
      error = null;
    // A later kick cancels the previous recovery endpoint. Do that before any of the
    // ramp renders, just as scheduling all hits up front did; only voices are windowed.
    for (const {event, time, chokeOnly} of queue)
      if (
        !chokeOnly &&
        (event.settings.machine === 'Kick' ||
          (event.settings.machine === 'Instrument' &&
            event.settings.instrument === 'virtuosity-drums' &&
            event.settings.note === 36))
      )
        this.duck(Math.max(ctx.currentTime + 0.001, time));
    const schedule = until => {
      for (; next < queue.length && queue[next].time < until; next++) {
        const {event, time, chokeOnly} = queue[next];
        if (chokeOnly) AfterhoursInstruments.choke(this, time);
        else this.hit(event, time, false, false);
      }
    };
    schedule(2 * step);
    for (let t = step; t <= last && t < ctx.length / ctx.sampleRate; t += step)
      ctx.suspend(t).then(() => {
        try {
          if (!error) schedule(t + 2 * step);
        } catch (e) {
          error = e;
        }
        return ctx.resume();
      });
    const result = await ctx.startRendering();
    if (error) throw error;
    return result;
  }
  sampleHit(e, when) {
    const ctx = this.context,
      s = e.settings;
    const source = ctx.createBufferSource();
    source.buffer = AfterhoursSamples.get(s.sample.id);
    const speed = this.bpm / s.sample.bpm;
    const offset = s.sample.offset + ((((e.index || 0) * 0.25) / s.rate + (e.sampleSkip || 0)) * 60) / s.sample.bpm;
    if (offset >= source.buffer.duration) return null;
    const duration = Math.min((e.gate * 60) / s.sample.bpm, source.buffer.duration - offset);
    const time = Math.max(ctx.currentTime, when);
    source.playbackRate.value = speed;
    const amp = ctx.createGain(),
      pan = ctx.createStereoPanner();
    amp.gain.value = (s.volume / 100) ** 1.5 * e.velocity;
    pan.pan.value = s.pan / 100;
    source
      .connect(pan)
      .connect(amp)
      .connect(this.mixer.channel(e.lane, s.sample.id.endsWith('-drums')));
    const voice = {
      amp,
      sources: [source],
      nodes: [source, pan, amp],
      end: time + duration / speed,
      lane: e.lane,
      planTick: e.planTick,
      duckAt: null,
    };
    this.voices.add(voice);
    source.onended = () => {
      voice.nodes.forEach(node => node.disconnect());
      this.voices.delete(voice);
    };
    source.start(time, offset, duration);
    return voice;
  }
  stopLane(lane) {
    this.cancelVoices(v => v.lane === lane);
  }
  silence(v) {
    const now = this.context.currentTime;
    v.cancel?.();
    if (v.amp) {
      v.amp.gain.cancelScheduledValues(now);
      v.amp.gain.setTargetAtTime(0, now, 0.004);
    } else v.fade?.(now);
    for (const s of v.sources) {
      try {
        s.stop(now + 0.025);
      } catch {
        /* Already ended. */
      }
    }
  }
  duck(time) {
    if (!this.mix.pump) return;
    const g = this.music.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(1, time);
    g.linearRampToValueAtTime(1 - this.mix.pump * 0.82, time + 0.006);
    g.exponentialRampToValueAtTime(1, time + Math.min(0.28, (60 / this.bpm) * 0.65));
  }
  cancelPump(time) {
    this.music.gain.cancelScheduledValues(time);
    this.music.gain.setTargetAtTime(1, time, 0.025);
  }
  cancelVoices(matches) {
    let duckAt = Infinity;
    for (const v of this.voices)
      if (matches(v)) {
        this.silence(v);
        if (v.duckAt !== null && v.duckAt >= this.context.currentTime) duckAt = Math.min(duckAt, v.duckAt);
        v.duckAt = null;
      }
    if (Number.isFinite(duckAt)) this.cancelPump(duckAt);
  }
  cancelFromTick(tick) {
    this.cancelVoices(v => v.planTick >= tick);
  }
  stop() {
    this.controller.clearTail();
    this.mixer.clearTail();
    for (const v of this.voices) this.silence(v);
    // Replacing the delay clears its buffer without interrupting pattern changes.
    this.delay.disconnect();
    this.feedback.disconnect();
    this.delay = this.context.createDelay(2);
    this.delay.delayTime.value = Math.min(1.8, (60 / this.bpm) * 0.75);
    this.delay.connect(this.delayFilter);
    this.feedback.connect(this.delay);
    this.music.gain.cancelScheduledValues(this.context.currentTime);
    this.music.gain.value = 1;
  }
  dispose() {
    this.stop();
    this.controller.dispose();
    this.mixer.dispose();
    for (const n of [
      this.master,
      this.music,
      this.drums,
      this.musicLevel,
      this.delay,
      this.delayFilter,
      this.feedback,
      this.wet,
      this.limiter,
      this.analyser,
    ])
      n.disconnect();
  }
  // 24-bit PCM with TPDF dither: quiet tails and fades keep their detail instead of
  // truncating to 16-bit steps. The seeded noise makes repeated exports identical.
  static wav(buffer) {
    const channels = buffer.numberOfChannels,
      frames = buffer.length,
      bytes = 3,
      data = new ArrayBuffer(44 + frames * channels * bytes),
      view = new DataView(data),
      out = new Uint8Array(data);
    const word = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    word(0, 'RIFF');
    view.setUint32(4, data.byteLength - 8, true);
    word(8, 'WAVE');
    word(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * bytes, true);
    view.setUint16(32, channels * bytes, true);
    view.setUint16(34, bytes * 8, true);
    word(36, 'data');
    view.setUint32(40, data.byteLength - 44, true);
    const samples = Array.from({length: channels}, (_, i) => buffer.getChannelData(i));
    let seed = 1979;
    const uniform = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0, offset = 44; i < frames; i++)
      for (let c = 0; c < channels; c++, offset += bytes) {
        const dither = uniform() - uniform();
        const value = Math.max(-8388608, Math.min(8388607, Math.round(samples[c][i] * 8388607 + dither)));
        out[offset] = value & 255;
        out[offset + 1] = (value >> 8) & 255;
        out[offset + 2] = (value >> 16) & 255;
      }
    return data;
  }
}
window.FMGrooveAudio = FMGrooveAudio;
