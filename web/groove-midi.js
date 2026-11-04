/* Bounded Standard MIDI File reader and non-destructive four-bar overlay. */
'use strict';
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./groove-core') : root.AfterhoursGroove;
  function read(input) {
    const bytes = new Uint8Array(input);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('MIDI limit is 2 MiB');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0,
      limit = bytes.length,
      count = 0;
    const need = n => {
      if (pos + n > limit) throw new Error('Truncated MIDI file');
    };
    const byte = () => {
      need(1);
      return bytes[pos++];
    };
    const u16 = () => {
      need(2);
      const n = view.getUint16(pos);
      pos += 2;
      return n;
    };
    const u32 = () => {
      need(4);
      const n = view.getUint32(pos);
      pos += 4;
      return n;
    };
    const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
    const vlq = () => {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const b = byte();
        n = n * 128 + (b & 127);
        if (!(b & 128)) return n;
      }
      throw new Error('Invalid MIDI delta');
    };
    if (tag() !== 'MThd') throw new Error('Choose a .mid file');
    const header = u32();
    if (header < 6) throw new Error('Invalid MIDI header');
    const format = u16(),
      tracks = u16(),
      ppq = u16();
    if (format > 1 || !ppq || ppq & 0x8000) throw new Error('Use MIDI format 0 or 1 with musical beat timing');
    if (!tracks || tracks > 128) throw new Error('MIDI limit is 128 tracks');
    need(header - 6);
    pos += header - 6;
    const parts = [],
      tempos = [];
    for (let track = 0; track < tracks; track++) {
      limit = bytes.length;
      if (tag() !== 'MTrk') throw new Error('Missing MIDI track');
      const size = u32();
      need(size);
      limit = pos + size;
      let tick = 0,
        running = 0,
        name = `Track ${track + 1}`;
      const channels = new Map(),
        held = new Map();
      while (pos < limit) {
        if (++count > 200000) throw new Error('MIDI event limit exceeded');
        tick += vlq();
        let status = byte();
        if (status < 128) {
          if (!running) throw new Error('Invalid MIDI running status');
          pos--;
          status = running;
        }
        if (status === 255) {
          running = 0;
          const type = byte(),
            length = vlq();
          need(length);
          if (type === 3) name = new TextDecoder().decode(bytes.subarray(pos, pos + Math.min(80, length)));
          if (type === 81 && length === 3) {
            const us = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
            if (us) tempos.push({tick, bpm: 60000000 / us});
          }
          pos += length;
          if (type === 47) {
            pos = limit;
            break;
          }
          continue;
        }
        if (status === 240 || status === 247) {
          running = 0;
          const length = vlq();
          need(length);
          pos += length;
          continue;
        }
        if (status < 128 || status >= 240) throw new Error('Unsupported MIDI event');
        running = status;
        const kind = status >> 4,
          channel = status & 15,
          a = byte(),
          b = kind === 12 || kind === 13 ? 0 : byte();
        if (a > 127 || b > 127) throw new Error('Invalid MIDI event data');
        const key = channel * 128 + a;
        if (kind === 9 && b > 0) {
          if (!channels.has(channel)) channels.set(channel, []);
          const n = {note: a, velocity: b, beat: tick / ppq, duration: 0.25};
          channels.get(channel).push(n);
          if (!held.has(key)) held.set(key, []);
          held.get(key).push(n);
        } else if (kind === 8 || kind === 9) {
          const n = held.get(key)?.shift();
          if (n) n.duration = Math.max(1 / ppq, tick / ppq - n.beat);
        }
      }
      for (const queue of held.values()) for (const n of queue) n.duration = Math.max(1 / ppq, tick / ppq - n.beat);
      for (const [channel, notes] of channels)
        parts.push({name: `${name} · ch ${channel + 1}${channel === 9 ? ' · drums' : ''}`, channel, notes});
    }
    if (!parts.length) throw new Error('MIDI has no notes');
    tempos.sort((a, b) => a.tick - b.tick);
    return {parts, bpm: tempos[0]?.bpm || 120};
  }
  function overlay(project, part, startBar = 1, transpose = 0, melodicChannel10 = false) {
    if (
      !Number.isInteger(startBar) ||
      startBar < 1 ||
      startBar > 10000 ||
      !Number.isInteger(transpose) ||
      Math.abs(transpose) > 48
    )
      throw new Error('Invalid MIDI clip settings');
    if (part.channel === 9 && !melodicChannel10)
      throw new Error('Channel 10 normally contains drums. For a melodic part, enable Treat channel 10 as melodic.');
    const start = (startBar - 1) * 4;
    const notes = part.notes
      .filter(n => n.beat >= start && n.beat < start + 16)
      .map(n => ({...n, note: n.note + transpose, step: Math.min(63, Math.round((n.beat - start) * 4))}));
    if (!notes.length) throw new Error('No notes in these four bars; choose a different start bar');
    if (notes.some(n => n.note < 24 || n.note > 96)) throw new Error('Notes outside C1–C7; adjust transpose');
    const out = G.clone(project),
      pattern = out.patterns[out.active];
    // Also preserve hidden steps beyond a short lane's loop and muted material.
    const free = pattern.tracks.map((t, i) => (t.steps.every(s => !s.on) ? i : -1)).filter(i => i >= 0);
    const used = [],
      occupied = new Map();
    let shortened = 0;
    for (const n of notes) {
      const slot = free.find(i => !occupied.has(`${i}:${n.step}`));
      if (slot === undefined)
        throw new Error('Not enough empty lanes for this part; choose a simpler part or free some lanes');
      occupied.set(`${slot}:${n.step}`, true);
      if (!used.includes(slot)) {
        used.push(slot);
        Object.assign(pattern.tracks[slot], {
          machine: 'Tone',
          name: `MIDI / ${part.name}`.slice(0, 40),
          length: 64,
          rate: 1,
          mute: false,
          solo: false,
          note: 60,
          shape: 22,
          color: 25,
          sweep: 0,
          contour: 55,
          decay: 0.18,
          cutoff: 4800,
          volume: 42,
          pan: (used.length % 2 ? -1 : 1) * 14,
          lfo: {target: 'shape', depth: 0, division: 4, shape: 'sine'},
        });
      }
      if (n.duration > 0.5) shortened++;
      Object.assign(pattern.tracks[slot].steps[n.step], {
        on: true,
        velocity: n.velocity,
        chance: 100,
        micro: 0,
        repeat: 1,
        gate: Math.max(0.1, Math.min(2, n.duration * 4)),
        condition: 'always',
        locks: {note: n.note},
      });
    }
    pattern.length = 64;
    // Keep existing lane loop lengths and include the overlay wherever this pattern plays.
    for (const section of out.arrangement || [])
      if (section.pattern === out.active) section.lanes = [...new Set([...section.lanes, ...used])];
    return {project: G.validate(out), lanes: used, count: notes.length, shortened};
  }
  const api = {read, overlay};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursMIDI = api;
})(typeof window === 'undefined' ? globalThis : window);
