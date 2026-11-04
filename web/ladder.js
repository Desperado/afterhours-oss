'use strict';
/* Loads the Rust/WebAssembly ladder filter into an audio context's worklet scope.
   Voices fall back to the Biquad filter until it is ready, or if it cannot load. */
(() => {
  const loading = new WeakMap(),
    ready = new WeakSet();
  window.AfterhoursLadder = {
    prepare(ctx) {
      if (!loading.has(ctx))
        loading.set(
          ctx,
          (async () => {
            try {
              if (!ctx.audioWorklet || typeof WebAssembly !== 'object') {
                window.AfterhoursLadder.failure = 'AudioWorklet or WebAssembly is not supported';
                return false;
              }
              await ctx.audioWorklet.addModule('/ladder-wasm.js');
              await ctx.audioWorklet.addModule('/ladder-worklet.js');
              ready.add(ctx);
              return true;
            } catch (error) {
              console.warn('Ladder filter unavailable', error);
              window.AfterhoursLadder.failure = `${error?.name || 'Error'}: ${error?.message || error}`;
              return false;
            }
          })(),
        );
      return loading.get(ctx);
    },
    ready: ctx => ready.has(ctx),
    // `start` is the note's scheduled time; the processor stays alive at least until then.
    create(ctx, start = ctx.currentTime) {
      const node = new AudioWorkletNode(ctx, 'afterhours-ladder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: {start},
      });
      const param = name => node.parameters.get(name);
      return {node, cutoff: param('cutoff'), detune: param('detune'), resonance: param('resonance')};
    },
  };
})();
