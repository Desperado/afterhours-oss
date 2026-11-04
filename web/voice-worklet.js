'use strict';
import {engine} from './dsp-worklet.js';
const dsp = engine();
if (dsp.voice_abi_version?.() !== 1) throw new Error('Unsupported voice DSP ABI');
if (dsp.groove_abi_version?.() !== 1) throw new Error('Unsupported groove DSP ABI');
if (dsp.timbre_abi_version?.() !== 1) throw new Error('Unsupported timbre DSP ABI');

// Import worker-generated banks before prepare() marks this runtime ready. This node
// never renders sound; its acknowledgement also works in a suspended/offline context.
registerProcessor(
  'afterhours-wavetables',
  class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const tables = options.processorOptions.tables,
        length = dsp.wavetable_len(sampleRate);
      if (tables?.length !== 5 || tables.some(t => !(t instanceof Float32Array) || t.length !== length))
        throw new Error('Invalid wavetable banks');
      for (let shape = 0; shape < tables.length; shape++) {
        const pointer = dsp.wavetable_alloc(sampleRate);
        new Float32Array(dsp.memory.buffer, pointer, length).set(tables[shape]);
        dsp.wavetable_install(sampleRate, shape, pointer);
      }
      this.port.postMessage('ready');
    }
    process() {
      return false;
    }
  },
);

// Plane orders are the ABIs in dsp/README.md. Every AudioParam costs CPU in every render
// quantum, idle or not, so voices declare only the parameters they use:
// [name, default, min, max, plane].
const detune = ['detune', 0, -9600, 9600, 1],
  modulation = ['modulation', 0, -1e6, 1e6, 2];
const analog = {
  create: dsp.voice_new,
  buffer: dsp.voice_buffer,
  configure: dsp.voice_configure,
  process: dsp.voice_process,
  free: dsp.voice_free,
  configSize: 20,
  planes: 11,
  controls: [
    ['frequency', 220, 8, 20000, 0],
    ['detune', 0, -9600, 9600, 1],
    ['gate', 0, -1, 1, 2],
    ['cutoff', 1000, 20, 24000, 3],
    ['filterDetune', 0, -9600, 9600, 4],
    ['blend', 0.5, 0, 1, 5],
    ['motion', 0, 0, 1, 6],
    ['drive', 1.4, 0.1, 8, 7],
    ['resonance', 0, 0, 3.95, 8],
    ['pulseWidth', 0.5, 0.05, 0.95, 9],
    ['envelope', 0, -6, 6, 10],
  ],
};
const groove = {
  create: dsp.groove_new,
  buffer: dsp.groove_buffer,
  configure: dsp.groove_configure,
  process: dsp.groove_process,
  free: dsp.groove_free,
  configSize: 16,
  planes: 3,
};
const timbre = {
  create: dsp.timbre_new,
  buffer: dsp.timbre_buffer,
  configure: dsp.timbre_configure,
  update: dsp.timbre_update,
  process: dsp.timbre_process,
  free: dsp.timbre_free,
  configSize: 16,
  planes: 3,
};

// Groove and timbre voices take their gate from note times instead of an AudioParam: start
// and stop in processorOptions, later changes ({start}, {stop}, {release}) as messages. The
// processor writes the gate plane itself. A gate parameter below −0.5 stops an Analog voice.
function processor({create, buffer, configure, update, process, free, configSize, planes, controls}) {
  const timed = !controls.some(c => c[0] === 'gate');
  return class extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return controls.map(([name, defaultValue, minValue, maxValue]) => ({
        name,
        defaultValue,
        minValue,
        maxValue,
        automationRate: 'a-rate',
      }));
    }
    constructor(options) {
      super();
      const o = options.processorOptions || {};
      this.voice = create(sampleRate);
      this.attach();
      if (o.config?.length === configSize) this.config.set(o.config);
      configure(this.voice);
      // Note times in frames, as AudioParam events apply: from the first frame at or after.
      const frame = time => (Number.isFinite(time) ? Math.ceil(time * sampleRate) : Infinity);
      this.start = frame(o.start);
      this.stop = frame(o.stop);
      this.off = Infinity;
      // Optional stereo output: StereoPanner's equal-power law for a mono source.
      if (Number.isFinite(o.pan)) {
        const x = ((Math.max(-1, Math.min(1, o.pan)) + 1) / 2) * (Math.PI / 2);
        this.gains = [Math.cos(x), Math.sin(x)];
      }
      // A fade (silencing a stolen or muted voice) falls like setTargetAtTime(0, at, 4 ms).
      this.fade = Infinity;
      this.level = 1;
      this.gateValue = NaN;
      // Configuration changes that wait for their render quantum: {at, values: [[index, value]]}.
      this.changes = [];
      this.port.onmessage = ({data}) => {
        if (data === 'dispose') this.release();
        else if (update && Array.isArray(data?.values)) this.changes.push(data);
        else if (Number.isFinite(data?.start)) this.start = frame(data.start);
        else if (Number.isFinite(data?.stop)) this.stop = frame(data.stop);
        else if (Number.isFinite(data?.release)) this.off = frame(data.release);
        else if (Number.isFinite(data?.fade)) this.fade = Math.min(this.fade, frame(data.fade));
      };
    }
    attach() {
      this.memory = dsp.memory.buffer;
      const view = (kind, length) => new Float32Array(this.memory, buffer(this.voice, kind), length);
      const parameters = view(0, planes * 128);
      this.planes = controls.map(c => parameters.subarray(c[4] * 128, (c[4] + 1) * 128));
      this.gatePlane = parameters.subarray(0, 128);
      // The constant each plane was last filled with; refill only when it changes.
      this.constant = controls.map(() => NaN);
      this.gateValue = NaN;
      this.output = view(1, 128);
      this.config = view(2, configSize);
    }
    release() {
      if (this.voice) free(this.voice);
      this.voice = 0;
      return false;
    }
    /// Frames to render this quantum, or −1 while the note has not started.
    timing(length) {
      // A pending note silenced before onset must never open its gate. Already sounding
      // notes keep their normal fade until stop; Infinity means no fade was requested.
      if (Number.isFinite(this.fade) && this.fade <= this.start) return 0;
      const begin = currentFrame,
        frames = Math.max(0, Math.min(length, this.stop - begin));
      if (frames && begin + frames <= this.start) return -1;
      // The gate is 1 from the start until a release, 0 otherwise.
      const on = Math.max(0, Math.min(length, this.start - begin)),
        off = Math.max(on, Math.min(length, this.off - begin));
      if (on === 0 && off === length) {
        if (this.gateValue !== 1) this.gatePlane.fill(1);
        this.gateValue = 1;
      } else if (on === off) {
        if (this.gateValue !== 0) this.gatePlane.fill(0);
        this.gateValue = 0;
      } else {
        this.gatePlane.fill(0);
        this.gatePlane.fill(1, on, off);
        this.gateValue = NaN;
      }
      return frames;
    }
    process(inputs, outputs, parameters) {
      if (!this.voice) return false;
      if (this.memory !== dsp.memory.buffer) this.attach();
      const out = outputs[0][0];
      if (this.changes.length) {
        const end = currentFrame + out.length;
        this.changes = this.changes.filter(change => {
          if (change.at * sampleRate >= end) return true;
          for (const [index, value] of change.values) this.config[index] = value;
          update(this.voice);
          return false;
        });
      }
      let frames = out.length;
      if (timed) {
        frames = this.timing(out.length);
        // Until the note starts the voice is idle and silent: skip the copies and the DSP.
        if (frames < 0) return true;
      } else {
        const values = parameters.gate;
        if (values.length === 1) {
          if (values[0] < -0.5) frames = 0;
        } else
          for (let i = 0; i < frames; i++)
            if (values[i] < -0.5) {
              frames = i;
              break;
            }
        if (!this.started) {
          if (frames === out.length && (values.length === 1 ? values[0] <= 0.5 : !values.some(v => v > 0.5)))
            return true;
          this.started = true;
        }
      }
      for (let i = 0; i < controls.length; i++) {
        const values = parameters[controls[i][0]];
        if (values.length > 1) {
          this.planes[i].set(values);
          this.constant[i] = NaN;
        } else if (values[0] !== this.constant[i]) {
          this.planes[i].fill(values[0]);
          this.constant[i] = values[0];
        }
      }
      process(this.voice, frames);
      if (frames === out.length) out.set(this.output);
      else {
        out.set(this.output.subarray(0, frames));
        out.fill(0, frames);
      }
      if (this.fade < currentFrame + frames) {
        const decay = Math.exp(-1 / (0.004 * sampleRate));
        for (let i = Math.max(0, this.fade - currentFrame); i < frames; i++) out[i] *= this.level *= decay;
      }
      if (this.gains) {
        const right = outputs[0][1];
        for (let i = 0; i < out.length; i++) {
          right[i] = out[i] * this.gains[1];
          out[i] *= this.gains[0];
        }
      }
      return frames === out.length || this.release();
    }
  };
}
registerProcessor('afterhours-voice', processor({...analog}));
// One processor per parameter set: '' none, 'd' detune, 'm' modulation, 'dm' both.
for (const [suffix, controls] of Object.entries({'': [], d: [detune], m: [modulation], dm: [detune, modulation]})) {
  registerProcessor(`afterhours-groove-${suffix}`, processor({...groove, controls}));
  registerProcessor(`afterhours-timbre-${suffix}`, processor({...timbre, controls}));
}
