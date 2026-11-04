'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('imported banks are reused without generating tables, at every supported table size', () => {
  const scope = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../web/ladder-wasm.js'), 'utf8'), scope);
  const module = new WebAssembly.Module(Buffer.from(scope.AfterhoursLadderWasm, 'base64'));
  for (const rate of [8000, 24000, 44100, 48000, 96000, 192000]) {
    // Each instance is cold. Sentinel values differ from generated waveforms, so this
    // fails if the first oscillator discards an import and performs an FFT instead.
    const dsp = new WebAssembly.Instance(module, {}).exports,
      length = dsp.wavetable_len(rate);
    for (let shape = 0; shape < 5; shape++) {
      const pointer = dsp.wavetable_alloc(rate);
      new Float32Array(dsp.memory.buffer, pointer, length).fill(shape + 1);
      dsp.wavetable_install(rate, shape, pointer);
      const cached = dsp.wavetable_data(rate, shape);
      assert.equal(cached, pointer);
      assert.ok(new Float32Array(dsp.memory.buffer, cached, length).every(x => x === shape + 1));
    }
    // Creating and configuring every voice family must keep using the imported banks.
    const voice = dsp.timbre_new(rate);
    for (let family = 0; family < 3; family++) {
      new Float32Array(dsp.memory.buffer, dsp.timbre_buffer(voice, 2), 16)[0] = family;
      dsp.timbre_configure(voice);
    }
    dsp.timbre_free(voice);
    for (let shape = 0; shape < 5; shape++)
      assert.ok(
        new Float32Array(dsp.memory.buffer, dsp.wavetable_data(rate, shape), length).every(x => x === shape + 1),
      );
  }
});
