'use strict';
window.AfterhoursAudio = (() => {
  let context,
    master,
    monitor,
    analyser,
    stereo,
    stereoLoading,
    stereoPeaks = [0, 0],
    worklet,
    arming,
    flushResolve,
    rolling = [],
    take = null,
    clipUntil = 0;
  let flushing = null;
  let volume = 1;
  try {
    const saved = localStorage.getItem('afterhours-output-volume');
    if (saved !== null && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved)));
  } catch {
    /* Keep the default when storage is unavailable. */
  }
  function setVolume(value) {
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(1, value));
    monitor?.gain.setTargetAtTime(volume, context.currentTime, 0.015);
    try {
      localStorage.setItem('afterhours-output-volume', String(volume));
    } catch {
      /* Listening still works. */
    }
    window.dispatchEvent(new Event('afterhours:volume'));
  }
  function getContext() {
    if (!context) {
      context = new AudioContext({latencyHint: 'interactive'});
      master = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      monitor = context.createGain();
      monitor.gain.value = volume;
      monitor.channelCount = 2;
      monitor.channelCountMode = 'explicit';
      master.connect(analyser).connect(monitor).connect(context.destination);
      // Scan every render quantum; drawing may be slow, throttled or paused.
      stereoLoading = (async () => {
        await context.audioWorklet.addModule('/stereo-meter-worklet.js');
        const node = new AudioWorkletNode(context, 'afterhours-stereo-meter', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = ({data}) => {
          for (let ch = 0; ch < 2; ch++) stereoPeaks[ch] = Math.max(stereoPeaks[ch], data[ch]);
        };
        // The processor emits silence: this tap adds no second speaker signal.
        monitor.connect(node).connect(context.destination);
        return true;
      })().catch(error => {
        console.warn('Continuous stereo metering unavailable; using analyser snapshots.', error);
        return false;
      });
    }
    return context;
  }
  function output(ctx) {
    return ctx === context ? master : ctx.destination;
  }
  async function arm() {
    const ctx = getContext();
    await ctx.resume();
    if (worklet) return;
    if (!arming)
      arming = (async () => {
        await ctx.audioWorklet.addModule('/performance-recorder.js');
        worklet = new AudioWorkletNode(ctx, 'afterhours-recorder', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        const silent = ctx.createGain();
        silent.gain.value = 0;
        master.connect(worklet).connect(silent).connect(ctx.destination);
        worklet.port.onmessage = e => {
          if (e.data.flushed) {
            flushResolve?.();
            flushResolve = null;
            return;
          }
          const chunk = e.data;
          rolling.push(chunk);
          const cutoff = chunk.start + chunk.left.length - ctx.sampleRate * 60;
          while (rolling.length && rolling[0].start + rolling[0].left.length <= cutoff) rolling.shift();
          if (take && chunk.start + chunk.left.length > take.start) {
            take.chunks.push(chunk);
            if (chunk.start - take.start >= ctx.sampleRate * 300 && !take.limited) {
              take.limited = true;
              window.dispatchEvent(new Event('afterhours:recordlimit'));
            }
          }
        };
      })().catch(e => {
        arming = null;
        throw e;
      });
    await arming;
  }
  async function flush() {
    if (!worklet) return;
    if (flushing) return flushing;
    flushing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        flushResolve = null;
        reject(new Error('Audio capture paused. Resume audio and retry.'));
      }, 2000);
      flushResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      worklet.port.postMessage('flush');
    });
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }
  async function start(signal) {
    await arm();
    signal?.throwIfAborted();
    if (take) throw new Error('A take is already recording');
    take = {start: Math.round(context.currentTime * context.sampleRate), chunks: [], signal};
    return take.start / context.sampleRate;
  }
  async function stop() {
    if (!take) return null;
    const end = Math.round(context.currentTime * context.sampleRate);
    await flush();
    const result = {...take, end, rate: context.sampleRate};
    take = null;
    return result;
  }
  function wav(chunks, start, end, rate) {
    const frames = Math.max(0, end - start),
      buffer = new ArrayBuffer(44 + frames * 4),
      v = new DataView(buffer);
    const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + frames * 4, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, frames * 4, true);
    for (const c of chunks)
      for (let f = Math.max(start, c.start); f < Math.min(end, c.start + c.left.length); f++) {
        for (let ch = 0; ch < 2; ch++) {
          const x = Math.max(-1, Math.min(1, (ch ? c.right : c.left)[f - c.start]));
          v.setInt16(44 + (f - start) * 4 + ch * 2, x * (x < 0 ? 32768 : 32767), true);
        }
      }
    return new Blob([buffer], {type: 'audio/wav'});
  }
  async function lastMinute() {
    if (!worklet || !rolling.length) throw new Error('Arm capture and play some audio first');
    await flush();
    const end = rolling.at(-1).start + rolling.at(-1).left.length,
      start = Math.max(rolling[0].start, end - context.sampleRate * 60);
    return wav(rolling, start, end, context.sampleRate);
  }
  const samples = new Float32Array(2048);
  function meter() {
    if (!analyser) return {peak: -120, rms: -120, clipping: false};
    analyser.getFloatTimeDomainData(samples);
    let peak = 0,
      sum = 0;
    for (const x of samples) {
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
    }
    if (peak >= 0.999) clipUntil = performance.now() + 1500;
    return {
      peak: 20 * Math.log10(Math.max(1e-6, peak)),
      rms: 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / samples.length))),
      clipping: performance.now() < clipUntil,
    };
  }
  // A monitor-only tap: no extra route to the speakers or the recording graph.
  function readStereo(left, right) {
    if (!context || context.state !== 'running') {
      left.fill(0);
      right.fill(0);
      stereoPeaks.fill(0);
      return;
    }
    if (!stereo) {
      const splitter = context.createChannelSplitter(2);
      stereo = [context.createAnalyser(), context.createAnalyser()];
      monitor.connect(splitter);
      stereo.forEach((node, channel) => {
        node.fftSize = 1024;
        splitter.connect(node, channel);
      });
    }
    stereo[0].getFloatTimeDomainData(left);
    stereo[1].getFloatTimeDomainData(right);
    const peaks = [...stereoPeaks];
    stereoPeaks.fill(0);
    return peaks;
  }
  return {
    context: getContext,
    output,
    setVolume,
    get volume() {
      return volume;
    },
    arm,
    start,
    stop,
    cancel(signal) {
      if (!signal || take?.signal === signal) take = null;
    },
    wav,
    lastMinute,
    meter,
    readStereo,
    get stereoReady() {
      return stereoLoading || Promise.resolve(false);
    },
    get armed() {
      return !!worklet;
    },
    get recording() {
      return !!take;
    },
  };
})();
