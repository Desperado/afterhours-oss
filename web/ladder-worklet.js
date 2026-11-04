'use strict';
/* AudioWorklet processor for the Rust ladder filter in dsp/. Add ladder-wasm.js to the
   worklet first; every processor in this scope shares one WebAssembly instance. */
import {engine as ladderEngine} from './dsp-worklet.js';

class AfterhoursLadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name: 'cutoff', defaultValue: 1000, minValue: 10, maxValue: 24000, automationRate: 'a-rate'},
      {name: 'detune', defaultValue: 0, minValue: -9600, maxValue: 9600, automationRate: 'a-rate'},
      {name: 'resonance', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate'},
      {name: 'drive', defaultValue: 1.4, minValue: 0.1, maxValue: 8, automationRate: 'k-rate'},
    ];
  }

  constructor(options) {
    super();
    this.dsp = ladderEngine();
    this.voice = this.dsp.ladder_new(sampleRate);
    // Exports create every voice before rendering, so wait for the note's own start time.
    this.deadline = (options.processorOptions?.start ?? currentTime) + 1;
    this.heard = false;
    this.quiet = 0;
    this.attach();
  }

  // Views must be rebuilt whenever the WebAssembly memory grows.
  attach() {
    const {memory} = this.dsp,
      view = pointer => new Float32Array(memory.buffer, pointer, 128);
    this.memory = memory.buffer;
    this.input = view(this.dsp.ladder_input(this.voice));
    this.output = view(this.dsp.ladder_output(this.voice));
    this.cutoff = view(this.dsp.ladder_cutoff(this.voice));
    this.detune = view(this.dsp.ladder_detune(this.voice));
  }

  release() {
    this.dsp.ladder_free(this.voice);
    this.voice = 0;
    return false;
  }

  process(inputs, outputs, parameters) {
    if (!this.voice) return false;
    if (this.memory !== this.dsp.memory.buffer) this.attach();
    const source = inputs[0][0],
      out = outputs[0][0],
      frames = out.length;
    if (source) this.input.set(source);
    else this.input.fill(0);
    this.cutoff.set(parameters.cutoff);
    this.detune.set(parameters.detune);
    this.dsp.ladder_process(
      this.voice,
      frames,
      parameters.cutoff.length,
      parameters.detune.length,
      parameters.resonance[0],
      parameters.drive[0],
    );
    out.set(this.output.subarray(0, frames));
    // The input can be inactive until the scheduled note starts; a note cancelled before then
    // is freed shortly after its start time. Once a note has played and its input has gone
    // inactive, let the resonant tail ring out, then free the voice.
    if (source) {
      this.heard = true;
      this.quiet = 0;
      return true;
    }
    if (!this.heard) return currentTime < this.deadline || this.release();
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(out[i]));
    this.quiet = peak < 1e-5 ? this.quiet + frames : 0;
    return this.quiet < sampleRate * 0.05 || this.release();
  }
}

registerProcessor('afterhours-ladder', AfterhoursLadderProcessor);
