'use strict';

// One streaming graph for the player. No decoding of the entire recording,
// uploads, or audio-model calls are needed for live controls.
class LiveEffects {
  static controls = {
    cutoff: {label: 'Filter cutoff', min: 0, max: 100, step: 1, initial: 100},
    resonance: {label: 'Resonance', min: 0.7, max: 6, step: 0.1, initial: 0.7},
    bass: {label: 'Bass', min: -12, max: 12, step: 0.5, initial: 0},
    treble: {label: 'Treble', min: -12, max: 12, step: 0.5, initial: 0},
    drive: {label: 'Distortion', min: 0, max: 100, step: 1, initial: 0},
    echo: {label: 'Echo mix', min: 0, max: 65, step: 1, initial: 0},
    delay: {label: 'Echo time', min: 80, max: 800, step: 5, initial: 360},
  };

  constructor(media, onChange = () => {}) {
    this.media = media;
    this.onChange = onChange;
    this.values = Object.fromEntries(
      Object.entries(LiveEffects.controls).map(([key, control]) => [key, control.initial]),
    );
    this.bypassed = false;
    for (const event of ['play', 'pause', 'ended']) media.addEventListener(event, () => this.apply());
  }

  async start() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Live effects need a browser with Web Audio support.');
      const ctx = AfterhoursAudio.context();
      this.connect(ctx, ctx.createMediaElementSource(this.media));
    }
    await this.context.resume();
  }

  connect(ctx, source) {
    this.context = ctx;
    this.source = source;
    this.original = ctx.createGain();
    this.processed = ctx.createGain();
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 180;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 3200;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.cleanDrive = ctx.createGain();
    this.dirtyDrive = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.shaper.curve = Float32Array.from({length: 4097}, (_, i) => Math.tanh(5 * (i / 2048 - 1)) / Math.tanh(5));
    this.bus = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -3;
    this.compressor.knee.value = 3;
    this.compressor.ratio.value = 20;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.15;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    // Keep the original path outside the EQ, distortion and compressor.
    source.connect(this.original).connect(this.analyser);
    source.connect(this.bass).connect(this.treble).connect(this.filter);
    this.filter.connect(this.cleanDrive).connect(this.bus);
    this.filter.connect(this.shaper).connect(this.dirtyDrive).connect(this.bus);
    this.bus.connect(this.compressor);
    this.compressor.connect(this.processed).connect(this.analyser);
    this.controller = new AfterhoursController.Session(ctx, undefined, 'listen');
    this.analyser.connect(this.controller.input);
    this.clearDelay();
    this.apply(true);
  }

  smooth(param, value, immediate = false) {
    if (immediate) {
      param.cancelScheduledValues(this.context.currentTime);
      param.value = value;
    } else param.setTargetAtTime(value, this.context.currentTime, 0.015);
  }

  clearDelay() {
    if (!this.context) return;
    if (this.send) {
      this.bus.disconnect(this.send);
      for (const node of [this.send, this.delayNode, this.feedback, this.wet]) node.disconnect();
    }
    const ctx = this.context;
    this.send = ctx.createGain();
    this.delayNode = ctx.createDelay(1);
    this.feedback = ctx.createGain();
    this.wet = ctx.createGain();
    this.bus.connect(this.send).connect(this.delayNode).connect(this.wet).connect(this.compressor);
    this.delayNode.connect(this.feedback).connect(this.delayNode);
  }

  apply(immediate = false) {
    if (this.context) {
      const v = this.values;
      const active = !this.bypassed;
      const playing = active && !this.media.paused && !this.media.ended;
      this.smooth(this.original.gain, active ? 0 : 1, immediate);
      this.smooth(this.processed.gain, active ? 1 : 0, immediate);
      this.smooth(this.bass.gain, v.bass, immediate);
      this.smooth(this.treble.gain, v.treble, immediate);
      this.smooth(
        this.filter.frequency,
        Math.min(LiveEffects.frequency(v.cutoff), this.context.sampleRate * 0.45),
        immediate,
      );
      this.smooth(this.filter.Q, v.resonance, immediate);
      this.smooth(this.cleanDrive.gain, 1 - v.drive / 100, immediate);
      this.smooth(this.dirtyDrive.gain, v.drive / 100, immediate);
      this.smooth(this.send.gain, playing ? 1 : 0, immediate);
      this.smooth(this.feedback.gain, playing && v.echo > 0 ? 0.38 : 0, immediate);
      this.smooth(this.wet.gain, playing ? v.echo / 100 : 0, immediate);
      this.smooth(this.delayNode.delayTime, v.delay / 1000, immediate);
    }
    this.onChange();
  }

  static frequency(value) {
    return 40 * Math.pow(500, value / 100);
  }

  set(key, value) {
    const control = LiveEffects.controls[key];
    if (!control || !Number.isFinite(Number(value))) return;
    const bounded = Math.min(control.max, Math.max(control.min, Number(value)));
    this.values[key] = Number(
      (control.min + Math.round((bounded - control.min) / control.step) * control.step).toFixed(4),
    );
    this.apply();
  }

  reset() {
    for (const [key, control] of Object.entries(LiveEffects.controls)) this.values[key] = control.initial;
    this.bypassed = false;
    this.clearDelay();
    this.apply();
  }

  level() {
    if (!this.analyser || this.context.state !== 'running') return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return Math.max(...this.samples.map(Math.abs));
  }

  snapshot() {
    return {bypassed: this.bypassed, parameters: {...this.values}};
  }
}
window.LiveEffects = LiveEffects;
