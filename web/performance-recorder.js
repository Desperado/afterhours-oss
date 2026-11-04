/* AudioWorklet: bounded PCM packets, independent of UI frame timing. */
'use strict';
class AfterhoursRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(4096);
    this.right = new Float32Array(4096);
    this.used = 0;
    this.start = 0;
    this.port.onmessage = e => {
      if (e.data === 'flush') {
        this.flush();
        this.port.postMessage({flushed: true});
      }
    };
  }
  flush() {
    if (!this.used) return;
    const left = this.left.slice(0, this.used),
      right = this.right.slice(0, this.used);
    this.port.postMessage({start: this.start, left, right}, [left.buffer, right.buffer]);
    this.used = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input?.[0]) return true;
    for (let i = 0; i < input[0].length; i++) {
      if (!this.used) this.start = currentFrame + i;
      this.left[this.used] = input[0][i];
      this.right[this.used] = (input[1] || input[0])[i];
      if (++this.used === 4096) this.flush();
    }
    return true;
  }
}
registerProcessor('afterhours-recorder', AfterhoursRecorder);
