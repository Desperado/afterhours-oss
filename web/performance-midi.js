'use strict';
window.AfterhoursLiveMIDI = (() => {
  const P = AfterhoursPerformance,
    Core = P.core,
    voices = new Map(),
    pedals = new Set(),
    bends = new Map(),
    pressures = new Map(),
    pickup = new Map();
  let access = null,
    learning = null,
    selected = '*';
  const deviceName = input => [input.manufacturer, input.name].filter(Boolean).join(' ').slice(0, 160) || input.id;
  const notify = text => window.dispatchEvent(new CustomEvent('afterhours:midistatus', {detail: text}));
  const prefix = (device, channel) => `midi:${device}:${channel}:`;
  function releaseDevice(device) {
    for (const [id, v] of voices)
      if (!device || v.device === device) {
        AfterhoursSynth.off(id);
        voices.delete(id);
      }
    for (const key of pedals) if (!device || key.startsWith(`midi:${device}:`)) pedals.delete(key);
    for (const map of [bends, pressures])
      for (const key of map.keys()) if (!device || key.startsWith(`midi:${device}:`)) map.delete(key);
  }
  function receive(input, bytes) {
    if (window.AfterhoursPerformanceStudio?.replaying) return;
    if (selected !== '*' && input.id !== selected) return;
    const msg = Core.midi(bytes);
    if (!msg) return;
    const group = prefix(input.id, msg.channel),
      id = group + msg.note + ':';
    if (msg.type === 'on') {
      // Retrigger a sustained note before allocating the new press.
      if (voices.has(id)) AfterhoursSynth.off(id);
      const voice = {device: input.id, group, note: msg.note, released: false};
      voices.set(id, voice);
      AfterhoursSynth.midiOn(id, msg.note, msg.velocity).then(press => {
        if (press && voices.get(id) === voice)
          for (const [type, value] of [
            ['bend', bends.get(group) || 0],
            ['pressure', pressures.get(group) ?? 1],
          ]) {
            AfterhoursSynth.expression(id, type, value);
            P.event('expression', {prefix: id, note: press.note, type, value});
          }
      });
    } else if (msg.type === 'off') {
      if (pedals.has(group)) {
        const v = voices.get(id);
        if (v) v.released = true;
      } else {
        voices.delete(id);
        AfterhoursSynth.off(id);
      }
    } else if (msg.type === 'bend') {
      bends.set(group, msg.value);
      for (const [id, v] of voices) if (v.group === group) AfterhoursSynth.expression(id, 'bend', msg.value);
      P.event('expression', {prefix: group, type: 'bend', value: msg.value});
    } else if (msg.type === 'pressure') {
      if (msg.note === undefined) pressures.set(group, msg.value);
      for (const [id, v] of voices)
        if (v.group === group && (msg.note === undefined || v.note === msg.note))
          AfterhoursSynth.expression(id, 'pressure', msg.value);
      const played = msg.note === undefined ? undefined : AfterhoursSynth.held().find(n => n.id === id)?.note;
      if (msg.note === undefined || played !== undefined)
        P.event('expression', {
          prefix: msg.note === undefined ? group : id,
          note: played,
          type: 'pressure',
          value: msg.value,
        });
    } else if (msg.type === 'cc') {
      if (msg.cc === 64) {
        if (msg.value >= 64) pedals.add(group);
        else {
          pedals.delete(group);
          for (const [id, v] of voices)
            if (v.group === group && v.released) {
              AfterhoursSynth.off(id);
              voices.delete(id);
            }
        }
        return;
      }
      if ([120, 123].includes(msg.cc)) {
        for (const [id, v] of voices)
          if (v.group === group) {
            AfterhoursSynth.off(id);
            voices.delete(id);
          }
        pedals.delete(group);
        return;
      }
      if (msg.cc === 121) {
        pedals.delete(group);
        bends.set(group, 0);
        pressures.delete(group);
        P.event('expression', {prefix: group, type: 'bend', value: 0});
        P.event('expression', {prefix: group, type: 'pressure', value: 1});
        for (const [id, v] of voices)
          if (v.group === group) {
            if (v.released) {
              AfterhoursSynth.off(id);
              voices.delete(id);
            } else {
              AfterhoursSynth.expression(id, 'bend', 0);
              AfterhoursSynth.expression(id, 'pressure', 1);
            }
          }
        return;
      }
      const device = deviceName(input);
      if (learning) {
        const target = learning;
        learning = null;
        P.store.update(s => {
          s.mappings = s.mappings.filter(
            m => m.target !== target && !(m.device === device && m.channel === msg.channel && m.cc === msg.cc),
          );
          s.mappings.push({device, channel: msg.channel, cc: msg.cc, target});
        }, 'midi-learn');
        pickup.clear();
        notify(`Mapped ${P.targets.get(target)?.label || target} to CC ${msg.cc} · move through its current value`);
        return;
      }
      for (const m of P.snapshot().mappings)
        if ((m.device === device || m.device === '*') && m.channel === msg.channel && m.cc === msg.cc) {
          const target = P.targets.get(m.target);
          if (!target) continue;
          const key = input.id + ':' + msg.channel + ':' + msg.cc + ':' + m.target,
            value = msg.value / 127,
            current = (target.get() - target.min) / (target.max - target.min),
            old = pickup.get(key);
          // A software move re-arms pickup, even after the hardware previously owned it.
          const owned = old?.owned && Math.abs(current - old.applied) < 2 / 127;
          const ready = owned || Core.pickup(old?.value, value, current);
          if (ready) target.set(target.min + value * (target.max - target.min));
          pickup.set(key, {
            value,
            owned: ready,
            applied: ready ? (target.get() - target.min) / (target.max - target.min) : current,
          });
        }
    }
  }
  function refresh() {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = e => receive(input, e.data);
    const connected = new Set([...access.inputs.values()].filter(i => i.state === 'connected').map(i => i.id));
    for (const v of [...voices.values()]) if (!connected.has(v.device)) releaseDevice(v.device);
    window.dispatchEvent(new Event('afterhours:mididevices'));
  }
  async function connect() {
    if (!navigator.requestMIDIAccess) throw new Error('USB MIDI needs the desktop app or a browser with Web MIDI.');
    access = await navigator.requestMIDIAccess({sysex: false});
    access.onstatechange = refresh;
    refresh();
    notify('MIDI connected · keys play Synth; right-click a knob to Learn');
  }
  P.store.subscribe((_s, reason) => {
    if (['load', 'undo', 'redo', 'midi-learn', 'midi-clear', 'midi-preset'].includes(reason)) pickup.clear();
  });
  window.addEventListener('afterhours:midilearn', e => {
    learning = e.detail;
    notify(`Learning ${P.targets.get(learning)?.label || learning} · turn a hardware knob, or Cancel Learn`);
  });
  window.addEventListener('blur', () => releaseDevice());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseDevice();
  });
  return {
    connect,
    receive,
    release: releaseDevice,
    devices: () =>
      access
        ? [...access.inputs.values()].filter(i => i.state === 'connected').map(i => ({id: i.id, name: deviceName(i)}))
        : [],
    select: id => {
      releaseDevice();
      selected = id;
      pickup.clear();
    },
    cancel: () => {
      learning = null;
      notify('MIDI Learn cancelled');
    },
    get connected() {
      return !!access;
    },
  };
})();
