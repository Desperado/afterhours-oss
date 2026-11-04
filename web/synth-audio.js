'use strict';
/* A live polyphonic instrument. Scheduling and releases stay on the audio clock. */
class AfterhoursSynthAudio {
  static presets = [
    {
      id: 'forest',
      name: 'Forest chorus',
      era: 'Post-punk · The Cure inspired',
      description: 'Bright, wistful keys with drifting chorus and dotted echo. Try A minor → F → C → G.',
      wave: 'sawtooth',
      detune: 9,
      cutoff: 5800,
      resonance: 1.1,
      attack: 0.015,
      decay: 0.45,
      sustain: 0.55,
      release: 1.1,
      drive: 0.06,
      chorus: 0.75,
      delay: 0.28,
      reverb: 0.4,
      volume: 0.65,
    },
    {
      id: 'strings',
      name: 'Disco strings',
      era: '70s · shimmering ensemble',
      description: 'Wide string-machine chords. Hold minor sevenths over a four-on-the-floor groove.',
      wave: 'sawtooth',
      detune: 14,
      cutoff: 4200,
      resonance: 0.5,
      attack: 0.18,
      decay: 0.6,
      sustain: 0.8,
      release: 0.8,
      drive: 0.03,
      chorus: 0.65,
      delay: 0.1,
      reverb: 0.3,
      volume: 0.6,
    },
    {
      id: 'clav',
      name: 'Mirrorball clav',
      era: 'Disco · percussive funk',
      description: 'Short, wiry plucks with a resonant bite. Tap syncopated octaves and leave room between notes.',
      wave: 'square',
      detune: 3,
      cutoff: 2600,
      resonance: 3.5,
      attack: 0.003,
      decay: 0.16,
      sustain: 0.14,
      release: 0.12,
      drive: 0.22,
      chorus: 0.18,
      delay: 0.16,
      reverb: 0.12,
      volume: 0.6,
    },
    {
      id: 'organ',
      name: 'Warehouse organ',
      era: '90s · house organ',
      description: 'Sine drawbars and a snappy attack for house stabs, bass lines and soulful chords.',
      wave: 'organ',
      detune: 0,
      cutoff: 7200,
      resonance: 0.6,
      attack: 0.006,
      decay: 0.2,
      sustain: 0.65,
      release: 0.22,
      drive: 0.12,
      chorus: 0.12,
      delay: 0.18,
      reverb: 0.22,
      volume: 0.7,
    },
    {
      id: 'rave',
      name: '1992 afterglow',
      era: '90s · rave lead',
      description: 'Detuned saws, bright resonance and tempo echo. Open the filter for the chorus.',
      wave: 'sawtooth',
      detune: 22,
      cutoff: 4600,
      resonance: 2.5,
      attack: 0.006,
      decay: 0.25,
      sustain: 0.7,
      release: 0.3,
      drive: 0.32,
      chorus: 0.3,
      delay: 0.38,
      reverb: 0.25,
      volume: 0.55,
    },
    {
      id: 'pad',
      name: 'Midnight cinema',
      era: 'Ambient · slow pad',
      description: 'A soft, slowly blooming bed of chords. Long releases and a spacious stereo reverb.',
      wave: 'triangle',
      detune: 12,
      cutoff: 1900,
      resonance: 0.7,
      attack: 0.65,
      decay: 0.9,
      sustain: 0.8,
      release: 2.2,
      drive: 0.05,
      chorus: 0.6,
      delay: 0.22,
      reverb: 0.62,
      volume: 0.7,
    },
    {
      id: 'grand-bass',
      name: 'Grand dusk bass',
      era: 'Grandmother inspired · warm analog',
      description:
        'Rounded saw and square oscillators into a resonant four-pole lowpass approximation. Try low, short octave riffs; Wave blend changes the oscillator mix.',
      family: 'ladder',
      detune: 3,
      cutoff: 620,
      resonance: 2.3,
      envelope: 0.65,
      position: 0.4,
      attack: 0.006,
      decay: 0.24,
      sustain: 0.62,
      release: 0.18,
      drive: 0.16,
      chorus: 0.08,
      delay: 0.08,
      reverb: 0.14,
      volume: 0.67,
    },
    {
      id: 'grand-lead',
      name: 'Grand dusk lead',
      era: 'Grandmother inspired · singing lead',
      description:
        'A warm, rounded lead with an octave-up second oscillator and a blooming filter envelope. Play a slow melody over the groove.',
      family: 'ladder',
      osc2Ratio: 2,
      detune: 5,
      cutoff: 1800,
      resonance: 3.2,
      envelope: 0.42,
      position: 0.44,
      attack: 0.018,
      decay: 0.42,
      sustain: 0.68,
      release: 0.6,
      drive: 0.12,
      chorus: 0.15,
      delay: 0.23,
      reverb: 0.32,
      volume: 0.62,
    },
    {
      id: 'ppg-pluck',
      name: '1002 wire pluck',
      era: 'PPG 1002 Mk2 inspired · analog',
      description:
        'Mix triangle and saw waves over a square sub, with a sharp resonant envelope. PPG 1002 is analog; this is the wiry pluck side of the palette.',
      family: 'dual',
      detune: 2,
      cutoff: 1300,
      resonance: 4,
      envelope: 0.8,
      position: 0.73,
      attack: 0.003,
      decay: 0.15,
      sustain: 0.17,
      release: 0.18,
      drive: 0.08,
      chorus: 0.17,
      delay: 0.24,
      reverb: 0.18,
      volume: 0.7,
    },
    {
      id: 'ppg-lead',
      name: '1002 twin current',
      era: 'PPG 1002 Mk2 inspired · dual VCO',
      description:
        'Two triangle-to-saw oscillators, the second an octave above, with a square sub and a biting filter. Wave blend moves from soft to buzzy.',
      family: 'dual',
      osc2Ratio: 2,
      detune: 6,
      cutoff: 2800,
      resonance: 3,
      envelope: 0.35,
      position: 0.86,
      attack: 0.008,
      decay: 0.3,
      sustain: 0.6,
      release: 0.35,
      drive: 0.14,
      chorus: 0.2,
      delay: 0.2,
      reverb: 0.23,
      volume: 0.6,
    },
    {
      id: 'third-horizon',
      name: 'Third horizon',
      era: '3rd Wave inspired · evolving wavetable',
      description:
        'Three detuned oscillators crossfade original harmonic frames through a warm lowpass. Hold chords; Wave blend and Motion reveal the moving glassy overtones.',
      family: 'wave',
      detune: 12,
      cutoff: 3900,
      resonance: 1.3,
      envelope: 0.2,
      position: 0.52,
      motion: 0.8,
      attack: 0.38,
      decay: 0.8,
      sustain: 0.8,
      release: 1.8,
      drive: 0.05,
      chorus: 0.5,
      delay: 0.24,
      reverb: 0.58,
      volume: 0.66,
    },
    {
      id: 'third-prism',
      name: 'Third prism',
      era: '3rd Wave inspired · glass keys',
      description:
        'Bright, changing harmonic frames with a quick filter bloom. Use syncopated chords or an arpeggio, then turn Motion up for a liquid shimmer.',
      family: 'wave',
      detune: 7,
      cutoff: 6500,
      resonance: 2,
      envelope: 0.45,
      position: 0.7,
      motion: 0.45,
      attack: 0.006,
      decay: 0.3,
      sustain: 0.38,
      release: 0.55,
      drive: 0.08,
      chorus: 0.32,
      delay: 0.3,
      reverb: 0.36,
      volume: 0.65,
    },
    {
      id: 'circuit-bass',
      name: 'Circuit bass',
      era: '80s · Rust analog bass',
      description: 'A dry, rounded saw/pulse bass with a quick filter snap. Play short octave riffs below middle C.',
      family: 'analog',
      detune: 2,
      sub: 0.22,
      cutoff: 540,
      resonance: 2.3,
      envelope: 0.62,
      position: 0.38,
      pulseWidth: 0.46,
      motion: 0.08,
      attack: 0.004,
      decay: 0.19,
      sustain: 0.58,
      release: 0.16,
      drive: 0.14,
      chorus: 0.08,
      delay: 0.08,
      reverb: 0.12,
      volume: 0.72,
    },
    {
      id: 'neon-pluck',
      name: 'Neon pluck',
      era: '80s · Rust analog sequence',
      description: 'Bright, wiry plucks with a resonant envelope and a little echo. Try a repeating minor arpeggio.',
      family: 'analog',
      detune: 4,
      sub: 0.06,
      cutoff: 1700,
      resonance: 3.4,
      envelope: 0.75,
      position: 0.62,
      pulseWidth: 0.32,
      motion: 0.18,
      attack: 0.003,
      decay: 0.17,
      sustain: 0.18,
      release: 0.22,
      drive: 0.1,
      chorus: 0.14,
      delay: 0.28,
      reverb: 0.22,
      volume: 0.7,
    },
    {
      id: 'signal-lead',
      name: 'Signal lead',
      era: '80s · Rust analog lead',
      description:
        'A singing two-oscillator lead with gentle drift and pitch glide from the previous note. Leave space for the echo.',
      family: 'analog',
      detune: 6,
      sub: 0.08,
      drift: 3,
      glide: 0.06,
      cutoff: 2400,
      resonance: 2.4,
      envelope: 0.32,
      position: 0.45,
      motion: 0.25,
      attack: 0.012,
      decay: 0.32,
      sustain: 0.7,
      release: 0.48,
      drive: 0.13,
      chorus: 0.22,
      delay: 0.3,
      reverb: 0.28,
      volume: 0.65,
    },
    {
      id: 'clockwork-pulse',
      name: 'Clockwork pulse',
      era: '80s · Rust pulse motion',
      description:
        'Two pulse oscillators with slow pulse-width modulation. Hold a chord, then change Pulse width and Motion.',
      family: 'analog',
      oscA: 1,
      oscB: 1,
      detune: 7,
      sub: 0.06,
      cutoff: 3200,
      resonance: 1.5,
      envelope: 0.28,
      position: 0.5,
      pulseWidth: 0.35,
      motion: 0.8,
      pwmRate: 0.45,
      attack: 0.06,
      decay: 0.42,
      sustain: 0.72,
      release: 0.65,
      drive: 0.06,
      chorus: 0.38,
      delay: 0.16,
      reverb: 0.32,
      volume: 0.68,
    },
  ].map(p => ({position: 0.5, motion: 0, envelope: 0, pulseWidth: 0.5, glide: 0, ...p}));
  constructor(context) {
    this.context = context;
    this.muted = false;
    this.held = new Map();
    this.voices = new Set();
    const gain = v => {
      const g = context.createGain();
      g.gain.value = v;
      return g;
    };
    this.input = gain(1);
    this.filter = context.createBiquadFilter();
    this.drive = context.createWaveShaper();
    this.drive.oversample = '2x';
    this.output = gain(0.65);
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.input.connect(this.filter).connect(this.drive).connect(this.output);
    this.controller = new AfterhoursController.Session(context, undefined, 'synth');
    this.output.connect(this.limiter).connect(this.controller.input);
    this.chorus = context.createDelay(0.1);
    this.chorus.delayTime.value = 0.018;
    this.chorusWet = gain(0);
    this.drive.connect(this.chorus).connect(this.chorusWet).connect(this.output);
    this.lfo = context.createOscillator();
    this.lfo.frequency.value = 0.7;
    this.lfoDepth = gain(0.004);
    this.lfo.connect(this.lfoDepth).connect(this.chorus.delayTime);
    this.lfo.start();
    this.delay = context.createDelay(2);
    this.delayWet = gain(0);
    this.feedback = gain(0.32);
    this.delayFilter = context.createBiquadFilter();
    this.delayFilter.frequency.value = 3200;
    this.drive.connect(this.delay).connect(this.delayFilter);
    this.delayFilter.connect(this.feedback).connect(this.delay);
    this.delayFilter.connect(this.delayWet).connect(this.output);
    this.reverb = context.createConvolver();
    this.reverbWet = gain(0);
    const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 2), context.sampleRate);
    let seed = 2904;
    for (let c = 0; c < 2; c++) {
      const a = impulse.getChannelData(c);
      for (let i = 0; i < a.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        a[i] = (seed / 2147483648 - 1) * (1 - i / a.length) ** 3;
      }
    }
    this.impulse = impulse;
    this.reverb.buffer = impulse;
    this.drive.connect(this.reverb).connect(this.reverbWet).connect(this.output);
    this.setPatch(AfterhoursSynthAudio.presets[0]);
    this.setTempo(112);
  }
  setPatch(patch) {
    this.patch = {...patch};
    this.apply();
  }
  set(key, value) {
    if (Number.isFinite(value)) {
      this.patch[key] = value;
      this.apply();
    }
  }
  setTempo(bpm) {
    if (Number.isFinite(bpm) && bpm > 0) {
      this.delaySeconds = Math.min(1.8, (60 / bpm) * 0.75);
      this.delay.delayTime.setTargetAtTime(this.delaySeconds, this.context.currentTime, 0.03);
    }
  }
  apply() {
    const p = this.patch,
      now = this.context.currentTime;
    this.filter.frequency.setTargetAtTime(p.family ? this.context.sampleRate * 0.42 : p.cutoff, now, 0.015);
    this.filter.Q.setTargetAtTime(p.family ? 0.707 : p.resonance, now, 0.015);
    for (const v of this.voices) v.timbre?.set(p, now);
    this.chorusWet.gain.setTargetAtTime(p.chorus * 0.55, now, 0.02);
    this.delayWet.gain.setTargetAtTime(p.delay * 0.5, now, 0.02);
    this.reverbWet.gain.setTargetAtTime(p.reverb * 0.65, now, 0.02);
    if (!this.muted) this.output.gain.setTargetAtTime(p.volume, now, 0.02);
    const curve = new Float32Array(1024),
      amount = 1 + p.drive * 12;
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / (curve.length - 1) - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    this.drive.curve = curve;
  }
  noteOn(id, note, velocity = 0.8, when = this.context.currentTime) {
    if (this.patch.family === 'analog' && !AfterhoursVoice.ready(this.context))
      throw new Error('Prepare the Rust voice before starting a note');
    if (this.muted) {
      this.muted = false;
      this.output.gain.setTargetAtTime(this.patch.volume, when, 0.01);
    }
    this.noteOff(id, when);
    if (this.held.size >= 8) this.noteOff(this.held.keys().next().value, when);
    while (this.voices.size >= 16) this.kill(this.voices.values().next().value, when);
    const ctx = this.context,
      p = this.patch,
      time = Math.max(ctx.currentTime, when),
      amp = ctx.createGain();
    amp.gain.value = 0;
    const pressure = ctx.createGain();
    amp.connect(pressure).connect(this.input);
    const bend = ctx.createConstantSource();
    bend.offset.value = 0;
    bend.start(time);
    const peak = 0.12 * Math.max(0, Math.min(1, velocity));
    if (p.family === 'analog') amp.gain.setValueAtTime(peak, time);
    else {
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(peak, time + p.attack);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * p.sustain), time + p.attack + p.decay);
    }
    const hz = 440 * 2 ** ((note - 69) / 12),
      sources = [],
      nodes = [amp];
    let timbre;
    if (p.family) {
      timbre = AfterhoursTimbres.create(ctx, {...p, hz, time, fromHz: this.lastHz ?? hz}, amp);
      sources.push(...timbre.sources);
      nodes.push(...timbre.nodes);
      sources.forEach(o => o.start(time));
    }
    const layers = p.family
      ? []
      : p.wave === 'organ'
        ? [
            [1, 0, 0.65],
            [2, 0, 0.25],
            [3, 0, 0.16],
            [0.5, 0, 0.2],
          ]
        : [
            [1, -p.detune, 0.5],
            [1, p.detune, 0.5],
            [0.5, 0, 0.16],
          ];
    for (const [ratio, detune, level] of layers) {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = p.wave === 'organ' || ratio === 0.5 ? 'sine' : p.wave;
      o.frequency.value = hz * ratio;
      o.detune.value = detune;
      g.gain.value = level;
      o.connect(g).connect(amp);
      o.start(time);
      sources.push(o);
      nodes.push(o, g);
    }
    this.lastHz = hz;
    const tuning = this.controller.tune(note, timbre ? timbre.oscillators : sources, time);
    sources.push(tuning, bend);
    nodes.push(tuning, bend, pressure);
    (timbre ? timbre.oscillators : sources.filter(o => o.detune)).forEach(o => bend.connect(o.detune));
    const v = {id, note, amp, sources, nodes, timbre, pressure, bend, release: p.release};
    this.held.set(id, v);
    this.voices.add(v);
    sources[0].onended = () => {
      nodes.forEach(n => n.disconnect());
      this.voices.delete(v);
      if (this.held.get(id) === v) this.held.delete(id);
    };
  }
  expression(id, type, value) {
    const v = this.held.get(id);
    if (!v) return;
    const param = type === 'bend' ? v.bend.offset : v.pressure.gain;
    param.setTargetAtTime(type === 'bend' ? value * 100 : 0.4 + 0.6 * value, this.context.currentTime, 0.015);
  }
  noteOff(id, when = this.context.currentTime) {
    const v = this.held.get(id);
    if (!v) return;
    this.held.delete(id);
    const now = Math.max(this.context.currentTime, when);
    if (v.timbre?.rust) v.timbre.release(now);
    else {
      v.amp.gain.cancelAndHoldAtTime(now);
      v.amp.gain.setTargetAtTime(0, now, Math.max(0.008, v.release / 5));
    }
    for (const o of v.sources) o.stop(now + v.release + 0.05);
  }
  kill(v, when = this.context.currentTime) {
    v.amp.gain.cancelScheduledValues(when);
    v.amp.gain.setTargetAtTime(0, when, 0.003);
    for (const o of v.sources) {
      try {
        o.stop(when + 0.02);
      } catch {
        /* Already ended. */
      }
    }
    this.voices.delete(v);
    if (this.held.get(v.id) === v) this.held.delete(v.id);
  }
  panic() {
    this.controller.clearTail();
    const now = this.context.currentTime;
    for (const v of [...this.voices]) this.kill(v, now);
    // Empty time-based effects, so changing patches cannot bring an old echo back.
    this.drive.disconnect(this.chorus);
    this.lfoDepth.disconnect(this.chorus.delayTime);
    this.chorus.disconnect();
    this.chorus = this.context.createDelay(0.1);
    this.chorus.delayTime.value = 0.018;
    this.drive.connect(this.chorus).connect(this.chorusWet);
    this.lfoDepth.connect(this.chorus.delayTime);
    this.drive.disconnect(this.delay);
    this.delay.disconnect();
    this.feedback.disconnect();
    this.delay = this.context.createDelay(2);
    this.delay.delayTime.value = this.delaySeconds;
    this.drive.connect(this.delay).connect(this.delayFilter);
    this.feedback.connect(this.delay);
    this.drive.disconnect(this.reverb);
    this.reverb.disconnect();
    this.reverb = this.context.createConvolver();
    this.reverb.buffer = this.impulse;
    this.drive.connect(this.reverb).connect(this.reverbWet);
    this.muted = true;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(0, now, 0.003);
  }
  dispose() {
    this.panic();
    this.lfo.stop();
    this.controller.dispose();
    for (const n of [
      this.input,
      this.filter,
      this.drive,
      this.output,
      this.limiter,
      this.chorus,
      this.chorusWet,
      this.lfo,
      this.lfoDepth,
      this.delay,
      this.feedback,
      this.delayFilter,
      this.delayWet,
      this.reverb,
      this.reverbWet,
    ])
      n.disconnect();
  }
}
window.AfterhoursSynthAudio = AfterhoursSynthAudio;
