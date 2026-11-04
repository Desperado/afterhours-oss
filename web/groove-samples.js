'use strict';
// Local reference audio. Projects store IDs and offsets, never external URLs or audio payloads.
window.AfterhoursSamples = (() => {
  const buffers = new Map();
  const pending = new Map();
  async function prepare(patterns) {
    const ids = [...new Set(patterns.flatMap(p => p.tracks.filter(t => t.machine === 'Sample').map(t => t.sample.id)))];
    if (ids.length > 16) throw new Error('A project can use at most 16 audio assets');
    // Decode serially to avoid simultaneous full-file copies on large song banks.
    for (const id of ids) {
      if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid local audio ID');
      if (buffers.has(id)) continue;
      if (buffers.size >= 16) throw new Error('Audio cache full · reload before opening more assets');
      if (!pending.has(id))
        pending.set(
          id,
          (async () => {
            const response = await fetch(`/samples/${id}.wav`);
            if (!response.ok) throw new Error(`Missing audio: ${id} · use the local build with reference assets`);
            if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024)
              throw new Error('Audio asset exceeds 64 MiB');
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('Audio asset exceeds 64 MiB');
            const ctx = new OfflineAudioContext(2, 1, 32000);
            const buffer = await ctx.decodeAudioData(bytes);
            if (buffer.duration > 360) throw new Error('Audio asset exceeds 6 minutes');
            buffers.set(id, buffer);
          })().finally(() => pending.delete(id)),
        );
      await pending.get(id);
    }
  }
  function get(id) {
    const buffer = buffers.get(id);
    if (!buffer) throw new Error(`Audio not loaded: ${id}`);
    return buffer;
  }
  return {prepare, get};
})();
