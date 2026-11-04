'use strict';
// Expensive FFTs belong off the audio thread. Transfer the resulting tables to the host;
// it retains them for other audio contexts at this rate (offline exports included).
importScripts('/ladder-wasm.js');
self.onmessage = async ({data: rate}) => {
  try {
    const bytes = Uint8Array.from(atob(globalThis.AfterhoursLadderWasm), c => c.charCodeAt(0)),
      {instance} = await WebAssembly.instantiate(bytes, {}),
      dsp = instance.exports,
      length = dsp.wavetable_len(rate),
      tables = [];
    for (let shape = 0; shape < 5; shape++) {
      const pointer = dsp.wavetable_data(rate, shape);
      tables.push(new Float32Array(dsp.memory.buffer, pointer, length).slice());
    }
    self.postMessage(
      {tables},
      tables.map(t => t.buffer),
    );
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
