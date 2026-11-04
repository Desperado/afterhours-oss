'use strict';
// Scan every sample without transferring PCM or tying overloads to display frames.
class AfterhoursStereoMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peaks = [0, 0];
    this.frames = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input?.[0]) return true;
    for (let ch = 0; ch < 2; ch++) {
      const samples = input[ch] || input[0];
      for (let i = 0; i < samples.length; i++) this.peaks[ch] = Math.max(this.peaks[ch], Math.abs(samples[i]));
    }
    this.frames += input[0].length;
    if (this.frames >= sampleRate / 20) {
      if (this.peaks[0] || this.peaks[1]) this.port.postMessage(this.peaks);
      this.peaks = [0, 0];
      this.frames = 0;
    }
    // Outputs are left silent; the original monitor remains the speaker route.
    return true;
  }
}
registerProcessor('afterhours-stereo-meter', AfterhoursStereoMeter);
