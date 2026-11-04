'use strict';
/* Curated multi-sample playback shared by sequencer, live keys and offline exports.
   SFZ compilation happens at install time; this is deliberately not an SFZ interpreter. */
window.AfterhoursInstruments = (() => {
  const banks = new Map();
  let decodedBytes = 0;
  const budget = 1536 * 1024 * 1024;
  // Serialize callers; all missing banks share one bounded decode pool.
  let loading = Promise.resolve();
  function prepare(patterns) {
    const ids = [
      ...new Set(patterns.flatMap(p => p.tracks.filter(t => t.machine === 'Instrument').map(t => t.instrument))),
    ];
    // Live notes using decoded banks must not wait for an unrelated export's downloads.
    if (ids.every(id => banks.has(id))) return Promise.resolve();
    const job = loading
      .catch(() => {})
      .then(async () => {
        const entries = await Promise.all(
          ids
            .filter(id => !banks.has(id))
            .map(async id => {
              if (!AfterhoursInstrumentCatalog.some(item => item.id === id))
                throw new Error('Unknown sampled instrument');
              const response = await fetch(`/instruments/${id}/manifest.json`);
              if (!response.ok)
                throw new Error(`Instrument not installed: ${id} · use the local build with instrument assets`);
              const manifest = await response.json();
              if (
                manifest.version !== 1 ||
                manifest.id !== id ||
                !Array.isArray(manifest.regions) ||
                !manifest.regions.length ||
                manifest.regions.length > 1024
              )
                throw new Error(`Invalid instrument map: ${id}`);
              for (const r of manifest.regions) {
                if (
                  ![r.lo, r.hi, r.root, r.lovel, r.hivel, r.take, r.takes].every(Number.isInteger) ||
                  r.lo < 0 ||
                  r.hi > 127 ||
                  r.lo > r.hi ||
                  r.root < 0 ||
                  r.root > 127 ||
                  r.lovel < 0 ||
                  r.hivel > 127 ||
                  r.lovel > r.hivel ||
                  r.take < 0 ||
                  r.take >= r.takes ||
                  r.takes > 128 ||
                  ![r.attack, r.release, r.volume, r.veltrack].every(Number.isFinite) ||
                  r.attack < 0 ||
                  r.attack > 120 ||
                  r.release < 0 ||
                  r.release > 120 ||
                  Math.abs(r.volume) > 48 ||
                  r.veltrack < 0 ||
                  r.veltrack > 100 ||
                  (r.curve &&
                    (!Array.isArray(r.curve) ||
                      r.curve.length < 2 ||
                      r.curve[0][0] !== 0 ||
                      r.curve.at(-1)[0] !== 127 ||
                      r.curve.some(
                        (p, i) =>
                          !Array.isArray(p) ||
                          p.length !== 2 ||
                          !Number.isFinite(p[1]) ||
                          p[1] < 0 ||
                          p[1] > 1 ||
                          !Number.isInteger(p[0]) ||
                          (i && p[0] <= r.curve[i - 1][0]),
                      )))
                )
                  throw new Error(`Invalid instrument region: ${id}`);
              }
              const samples = [...new Set(manifest.regions.map(r => r.sample))];
              if (samples.some(sample => !/^[a-f0-9]{24}\.flac$/.test(sample)))
                throw new Error('Invalid instrument recording ID');
              return {id, manifest, samples, buffers: new Map(), decoder: new OfflineAudioContext(2, 1, 32000)};
            }),
        );
        const recordings = entries.flatMap(bank => bank.samples.map(sample => ({bank, sample})));
        let cursor = 0,
          bytes = 0,
          failure = null;
        async function worker() {
          while (!failure && cursor < recordings.length) {
            const {bank, sample} = recordings[cursor++];
            try {
              const result = await fetch(`/instruments/${bank.id}/${sample}`);
              if (!result.ok) throw new Error(`Missing instrument recording: ${bank.id}`);
              if (Number(result.headers.get('content-length')) > 32 * 1024 * 1024)
                throw new Error('Instrument recording too large');
              const data = await result.arrayBuffer();
              if (data.byteLength > 32 * 1024 * 1024) throw new Error('Instrument recording too large');
              const buffer = await bank.decoder.decodeAudioData(data);
              if (buffer.duration > 120 || buffer.numberOfChannels > 2)
                throw new Error('Instrument recording too long');
              const size = buffer.length * buffer.numberOfChannels * 4;
              if (decodedBytes + bytes + size > budget)
                throw new Error('Instrument memory limit · reload to clear unused instruments');
              bytes += size;
              bank.buffers.set(sample, buffer);
            } catch (error) {
              failure ||= error;
            }
          }
        }
        // Drain every worker before rejecting so a retry cannot overlap failed decodes.
        await Promise.all(Array.from({length: Math.min(16, recordings.length)}, worker));
        if (failure) throw failure;
        for (const {id, manifest, buffers} of entries) banks.set(id, {...manifest, buffers});
        decodedBytes += bytes;
      });
    loading = job;
    return job;
  }
  function regions(id, note, velocity, sequence) {
    const bank = banks.get(id);
    if (!bank) throw new Error(`Instrument not ready: ${id} · stop and press Play to load it`);
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const candidates = bank.regions.filter(r => note >= r.lo && note <= r.hi && vel >= r.lovel && vel <= r.hivel);
    // A single counter per instrument/note cycles every alternate, including repeated equal-velocity hits.
    const key = `${id}:${note}`,
      count = sequence.get(key) || 0;
    sequence.set(key, count + 1);
    return candidates.filter(r => count % r.takes === r.take).map(r => ({...r, buffer: bank.buffers.get(r.sample)}));
  }
  function velocityGain(r, velocity) {
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    let gain = (v / 127) ** 2;
    if (r.curve) {
      const high = r.curve.findIndex(p => p[0] >= v),
        [x1, y1] = r.curve[high],
        [x0, y0] = r.curve[Math.max(0, high - 1)];
      gain = x1 === x0 ? y1 : y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
    }
    return 1 - (r.veltrack / 100) * (1 - gain);
  }
  function tail(patterns, bpm) {
    let seconds = 0;
    for (const p of patterns)
      for (const track of p.tracks) {
        if (track.machine !== 'Instrument') continue;
        const bank = banks.get(track.instrument);
        if (!bank) throw new Error(`Instrument not ready: ${track.instrument}`);
        const gate = (Math.max(0, ...track.steps.filter(s => s.on).map(s => (s.gate * 0.25) / track.rate)) * 60) / bpm;
        for (const r of bank.regions) {
          const natural = bank.buffers.get(r.sample).duration / 2 ** ((r.lo - r.root) / 12);
          seconds = Math.max(seconds, r.oneShot ? natural : Math.min(natural, gate + r.release));
        }
      }
    return seconds + 2; // Leave room for the mixer effects after the recording ends.
  }
  function choke(renderer, at, trigger) {
    for (const voice of renderer.voices) if (voice.openHat) voice.choke(at, trigger);
  }
  function hit(renderer, event, when, live) {
    const ctx = renderer.context,
      s = AfterhoursPerformanceCore.shape(
        event.settings,
        renderer.performance.macros,
        renderer.performance.targets.includes(event.lane),
      );
    const selected = regions(s.instrument, s.note, event.velocity, renderer.instrumentSequence);
    if (!selected.length) return null; // Outside the recorded instrument's natural range.
    const time = Math.max(ctx.currentTime + 0.001, when),
      drums = s.instrument === 'virtuosity-drums';
    const amp = ctx.createGain(),
      pan = ctx.createStereoPanner(),
      filter = ctx.createBiquadFilter();
    const pressure = ctx.createGain(),
      bend = ctx.createConstantSource();
    amp.gain.value = (s.volume / 100) ** 1.5 * 0.45;
    pan.pan.value = s.pan / 100;
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(s.cutoff, ctx.sampleRate * 0.45);
    filter.Q.value = 0.7;
    filter.connect(pan).connect(pressure).connect(amp).connect(renderer.mixer.channel(event.lane, drums));
    bend.offset.value = 0;
    bend.start(time);
    const sources = [],
      envelopes = [],
      nodes = [amp, pan, filter, pressure, bend];
    let remaining = selected.length,
      end = time,
      tuning = null;
    const voice = {
      amp,
      sources,
      nodes,
      lane: event.lane,
      planTick: event.planTick,
      duckAt: null,
      bend,
      pressure,
      end,
      start: time,
      openHat: drums && s.note === 46,
      closedHat: drums && s.note === 42,
      recording: {
        id: s.instrument,
        note: s.note,
        velocity: event.velocity,
        regions: selected.map(r => ({root: r.root, take: r.take, takes: r.takes, channels: r.buffer.numberOfChannels})),
      },
    };
    function finish() {
      if (--remaining) return;
      bend.stop();
      tuning?.stop();
      nodes.forEach(n => n.disconnect());
      renderer.voices.delete(voice);
    }
    const release = at => {
      for (const {source, envelope, seconds, oneShot} of envelopes) {
        if (oneShot) continue;
        envelope.gain.cancelAndHoldAtTime(at);
        envelope.gain.linearRampToValueAtTime(0, at + seconds);
        source.stop(at + seconds + 0.005);
      }
    };
    voice.release = release;
    const chokes = new Map(),
      level = amp.gain.value;
    let chokedAt = Infinity;
    function updateChoke() {
      const at = Math.min(...chokes.values());
      // A close that has already sounded stays effective. Only pending chokes can be undone.
      if (voice.cancelled || at === chokedAt || chokedAt <= ctx.currentTime) return;
      chokedAt = at;
      amp.gain.cancelScheduledValues(ctx.currentTime);
      amp.gain.setValueAtTime(level, ctx.currentTime);
      if (Number.isFinite(at)) {
        amp.gain.setValueAtTime(level, at);
        amp.gain.linearRampToValueAtTime(0, at + 0.035);
      }
      // stop() replaces the previous scheduled stop while the source is still playing.
      sources.forEach(source => source.stop(Number.isFinite(at) ? at + 0.04 : end));
    }
    voice.choke = (at, trigger = at) => {
      // Lanes can queue hits out of timestamp order. An earlier close cannot choke a later open.
      if (at < time) return;
      chokes.set(trigger, at);
      updateChoke();
    };
    voice.cancelChoke = trigger => {
      if (chokes.delete(trigger)) updateChoke();
    };
    voice.cancel = () => {
      voice.cancelled = true;
      if (voice.closedHat) for (const queued of renderer.voices) if (queued.openHat) queued.cancelChoke(voice);
    };
    for (const r of selected) {
      const source = ctx.createBufferSource(),
        envelope = ctx.createGain();
      source.buffer = r.buffer;
      source.playbackRate.value = 2 ** ((s.note - r.root) / 12);
      bend.connect(source.detune);
      const gain = velocityGain(r, event.velocity) * 10 ** (r.volume / 20);
      const attack = Math.max(0.001, r.attack),
        seconds = Math.max(0.01, r.release);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(gain, time + attack);
      source.connect(envelope).connect(filter);
      sources.push(source);
      nodes.push(source, envelope);
      envelopes.push({source, envelope, seconds, oneShot: r.oneShot});
      end = Math.max(end, time + r.buffer.duration / source.playbackRate.value);
      source.onended = finish;
      source.start(time);
    }
    if (!drums) {
      tuning = renderer.controller.tune(
        s.note,
        sources,
        time,
        (s.performance?.drift || 0) * 18 * Math.sin((time - renderer.started) * 1.73 + event.lane * 2.4),
      );
      sources.push(tuning);
      nodes.push(tuning);
    }
    voice.end = end;
    renderer.voices.add(voice);
    // Cover both lane orders: a close can be queued before or after the open it chokes.
    if (voice.closedHat) choke(renderer, time, voice);
    if (voice.openHat)
      for (const queued of renderer.voices)
        if (queued.closedHat && !queued.cancelled) voice.choke(queued.start, queued);
    if (!live) release(time + Math.max(0.003, (event.gate * 60) / renderer.bpm));
    return voice;
  }
  return {
    prepare,
    hit,
    choke,
    regions,
    velocityGain,
    tail,
    get decodedBytes() {
      return decodedBytes;
    },
  };
})();
