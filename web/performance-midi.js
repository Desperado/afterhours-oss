'use strict';
window.AfterhoursLiveMIDI = (() => {
  const P = AfterhoursPerformance,
    Core = P.core,
    voices = new Map(),
    pedals = new Set(),
    bends = new Map(),
    pressures = new Map(),
    pickup = new Map(),
    buttons = new Map();
  let access = null,
    physicalAccess = null,
    physicalSysex = false,
    emulatorAccess = null,
    physicalSelection = '*',
    learning = null,
    selected = '*',
    state = P.snapshot(),
    lastMessage = 'No MIDI messages yet';
  const actions = new Map(
    Object.entries({
      play: 'Groove · Play',
      stop: 'Groove · Stop',
      'play-stop': 'Groove · Play / Stop',
      rewind: 'Groove · Rewind',
      record: 'Performance · Record / Finish take',
      tap: 'Tap tempo',
      undo: 'Undo',
      redo: 'Redo',
      panic: 'Panic · release all notes',
      'pattern-prev': 'Previous pattern',
      'pattern-next': 'Next pattern',
      loop: 'Toggle continuous song',
      'knob-bank': 'MPK · Next knob bank',
      'knob-bank-prev': 'MPK · Previous knob bank',
      continue: 'Groove · Continue',
      metronome: 'Metronome · On / Off',
      quantize: 'Groove · Quantize selected lane',
      'jam-confirm': 'Jam · Start listening / Confirm phrase',
      'jam-listen': 'Jam · Listen again',
      'jam-cancel': 'Jam · Cancel phrase',
      'pad-mode': 'MPK · Next pad mode',
      'song-prev': 'Song library · Previous song',
      'song-next': 'Song library · Next song',
      'keys-record': 'Record keys into the selected track',
    }).map(([id, label]) => ['action.' + id, label]),
  );
  for (let i = 0; i < 8; i++) {
    actions.set('action.scene.' + i, 'Recall scene ' + (i + 1));
    actions.set('mpk.knob.' + i, 'MPK · Knob ' + (i + 1));
  }
  for (let i = 0; i < 16; i++) actions.set('mpk.pad.' + i, `MPK · Pad ${(i % 8) + 1} bank ${i < 8 ? 'A' : 'B'}`);
  actions.set('mpk.instrument', 'MPK · Central encoder · Synth instrument');
  const isButton = target => target.startsWith('action.') || target.startsWith('mpk.pad.');
  const label = target => actions.get(target) || P.targets.get(target)?.label || target;
  const messageType = msg => (['on', 'off'].includes(msg.type) ? 'note' : msg.type);
  const messageNumber = msg => msg.cc ?? msg.note ?? msg.number;
  const bindingKey = (input, msg) => `${input.id}:${msg.channel}:${messageType(msg)}:${messageNumber(msg)}`;
  function cancelLearning() {
    const previous = learning;
    learning = null;
    previous?.onProgress?.({cancelled: true});
  }
  function reportLearning() {
    learning?.onProgress?.({
      target: learning.targets[0],
      index: learning.total - learning.targets.length,
      total: learning.total,
    });
  }
  function advanceLearning() {
    if (!learning) return;
    learning.paused = false;
    learning.targets.shift();
    reportLearning();
    if (!learning.targets.length) learning = null;
  }
  function learn(targets, mode = 'absolute', onProgress, protectExisting = false) {
    cancelLearning();
    if (state.midi.native)
      P.store.update(s => {
        s.midi.native = false;
      }, 'midi-profile');
    releaseDevice();
    const valid = targets.filter(t => actions.has(t) || P.targets.has(t));
    learning = {targets: valid, total: valid.length, mode, seen: new Set(), onProgress, protectExisting};
    if (!learning.targets.length) {
      learning = null;
      return;
    }
    reportLearning();
    notify(
      `Learning ${label(learning.targets[0])} · ${isButton(learning.targets[0]) ? 'press a pad or button' : 'turn the knob'} · Cancel Learn to finish early`,
    );
  }
  function knobTarget(target) {
    if (!target.startsWith('mpk.knob.')) return target;
    const i = Number(target.split('.').at(-1));
    return AfterhoursMPKControls.targetId(state.midi.knobBank, i);
  }

  function route(input, msg) {
    const type = messageType(msg),
      number = messageNumber(msg),
      device = deviceName(input);
    if (!['note', 'cc', 'program'].includes(type)) return false;
    const key = bindingKey(input, msg);
    if (learning) {
      if (learning.paused) return true;
      const target = learning.targets[0];
      const eligible = isButton(target)
        ? msg.type === 'on' || msg.type === 'program' || (type === 'cc' && msg.value > 0)
        : type === 'cc';
      if (
        eligible &&
        learning.protectExisting &&
        state.mappings.some(
          m =>
            (m.device === device || m.device === '*') &&
            m.channel === msg.channel &&
            m.type === type &&
            (type === 'cc' ? m.cc : m.number) === number &&
            m.target !== target,
        )
      ) {
        notify('This button already has another assignment. If SHIFT doesn’t send a separate message, skip this step.');
        return true;
      }
      if (eligible && !learning.seen.has(key)) {
        learning.seen.add(key);
        const mode =
          target === 'mpk.instrument' && ['absolute', 'direct'].includes(learning.mode)
            ? msg.value === 65
              ? 'binary-offset'
              : msg.value === 1
                ? 'twos-complement'
                : 'absolute'
            : learning.mode;
        P.store.update(s => {
          s.mappings = s.mappings.filter(
            m =>
              m.target !== target &&
              !(
                (m.device === device || m.device === '*') &&
                m.channel === msg.channel &&
                m.type === type &&
                (type === 'cc' ? m.cc : m.number) === number
              ),
          );
          s.mappings.push({device, channel: msg.channel, type, cc: type === 'cc' ? number : 0, number, mode, target});
        }, 'midi-learn');
        if (target === 'mpk.instrument') pickup.set(key, {value: msg.value});
        // Consume the learn press until its release; the next press operates it.
        if (type === 'cc') buttons.set(key, true);
        advanceLearning();
        if (learning) notify(`Mapped ${label(target)} · now ${label(learning.targets[0])}`);
        else notify(`Mapped ${label(target)} · ready`);
      }
      return true;
    }
    let consumed = false;
    for (const m of state.mappings) {
      if (
        !(m.device === device || m.device === '*') ||
        m.channel !== msg.channel ||
        m.type !== type ||
        (type === 'cc' ? m.cc : m.number) !== number
      )
        continue;
      if (m.target.startsWith('mpk.') && state.midi.profile !== 'mpk-mini-plus-ii') continue;
      if (m.target.startsWith('mpk.pad.') && state.midi.padMode === 'notes') continue;
      consumed = true;
      if (m.target === 'mpk.instrument' && type === 'cc') {
        const previous = pickup.get(key)?.value;
        const direction = ['absolute', 'direct'].includes(m.mode)
          ? previous === undefined
            ? 0
            : Math.sign(msg.value - previous)
          : Math.sign(Core.relative(msg.value, m.mode));
        pickup.set(key, {value: msg.value});
        if (direction)
          window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: m.target, direction}}));
        continue;
      }
      if (isButton(m.target)) {
        const pressed = msg.type === 'on' || msg.type === 'program' || (type === 'cc' && msg.value > 0);
        const old = buttons.get(key);
        buttons.set(key, pressed);
        if (pressed && (type !== 'cc' || !old))
          window.dispatchEvent(
            new CustomEvent('afterhours:midiaction', {
              detail: {target: m.target, velocity: msg.velocity ?? (msg.type === 'cc' ? msg.value / 127 : 1)},
            }),
          );
        continue;
      }
      if (type !== 'cc') continue;
      const target = P.targets.get(knobTarget(m.target));
      if (!target || target.max <= target.min) continue;
      const controlKey =
          key +
          ':' +
          knobTarget(m.target) +
          ':' +
          AfterhoursGrooveApp.S.data.active +
          ':' +
          AfterhoursGrooveApp.S.selected,
        current = (target.get() - target.min) / (target.max - target.min);
      if (!['absolute', 'direct'].includes(m.mode)) {
        AfterhoursMPKControls.turn(target, Core.relative(msg.value, m.mode));
        continue;
      }
      const value = msg.value / 127,
        old = pickup.get(controlKey),
        owned = old?.owned && Math.abs(current - old.applied) < 2 / 127,
        ready = m.mode === 'direct' || owned || Core.pickup(old?.value, value, current);
      if (ready) target.set(target.min + value * (target.max - target.min));
      pickup.set(controlKey, {
        value,
        owned: ready,
        applied: ready ? (target.get() - target.min) / (target.max - target.min) : current,
      });
    }
    return consumed;
  }
  const deviceName = input => [input.manufacturer, input.name].filter(Boolean).join(' ').slice(0, 160) || input.id;
  const notify = text => window.dispatchEvent(new CustomEvent('afterhours:midistatus', {detail: text}));
  const prefix = (device, channel) => `midi:${device}:${channel}:`;
  function releaseDevice(device, keepButtons = false) {
    pickup.clear();
    for (const [id, v] of voices)
      if (!device || v.device === device) {
        AfterhoursSynth.off(id);
        voices.delete(id);
      }
    if (!keepButtons)
      for (const key of buttons.keys()) if (!device || key.startsWith(device + ':')) buttons.delete(key);
    for (const key of pedals) if (!device || key.startsWith(`midi:${device}:`)) pedals.delete(key);
    for (const map of [bends, pressures])
      for (const key of map.keys()) if (!device || key.startsWith(`midi:${device}:`)) map.delete(key);
  }
  function receive(input, bytes) {
    if (window.AfterhoursPerformanceStudio?.replaying) return;
    if (selected !== '*' && input.id !== selected) return;
    const mpk = emulatorAccess || state.midi.profile === 'mpk-mini-plus-ii';
    const name = deviceName(input);
    if (
      mpk &&
      selected === '*' &&
      (!/mpk[\s_-]*mini[\s_-]*plus[\s_-]*(ii|2)\b/i.test(name) || /plugin|\bdin\b/i.test(name))
    )
      return;
    if (bytes[0] === 0xf0) {
      window.AfterhoursMPK?.sysex(input, bytes);
      return;
    }
    const msg = Core.midi(bytes);
    if (!msg) return;
    lastMessage = `${name} · ch ${msg.channel + 1} · ${msg.type} ${msg.cc ?? msg.note ?? msg.number ?? ''} ${msg.value ?? msg.velocity ?? ''}`;
    if (!learning && window.AfterhoursMPK?.route(input, msg)) return;
    if (!(msg.type === 'cc' && [64, 120, 121, 123].includes(msg.cc)) && route(input, msg)) return;
    if (emulatorAccess && msg.type === 'cc' && msg.channel === 0 && msg.cc === 1) {
      const motion = P.targets.get('synth.motion');
      motion?.set(motion.min + (msg.value / 127) * (motion.max - motion.min));
      return;
    }
    // DAW controls are never piano notes, including before they have been learned.
    if (mpk && /\bdaw\b/i.test(name)) return;
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
    }
  }
  function refresh() {
    const inputs = [...(access?.inputs.values() || [])];
    for (const input of inputs) {
      input.onmidimessage = e => receive(input, e.data);
      if (input.state !== 'connected') releaseDevice(input.id);
    }
    const connected = new Set(inputs.filter(i => i.state === 'connected').map(i => i.id));
    for (const v of [...voices.values()]) if (!connected.has(v.device)) releaseDevice(v.device);
    if (selected !== '*' && !connected.has(selected)) selected = '*';
    window.dispatchEvent(new Event('afterhours:mididevices'));
  }
  function useAccess(next) {
    if (next !== access) {
      for (const input of access?.inputs.values() || []) input.onmidimessage = null;
      releaseDevice();
      cancelLearning();
      access = next;
    }
    refresh();
  }
  function useEmulator(next) {
    if (next === emulatorAccess) return;
    if (emulatorAccess) emulatorAccess.onstatechange = null;
    else physicalSelection = selected;
    emulatorAccess = next;
    if (next) next.onstatechange = refresh;
    selected = next ? '*' : physicalSelection;
    useAccess(next || physicalAccess);
  }
  async function connect() {
    if (emulatorAccess) return;
    if (!navigator.requestMIDIAccess) throw new Error('USB MIDI needs the desktop app or a browser with Web MIDI.');
    // SysEx is only needed for the MPK's display and lights; without that permission, plain MIDI still works.
    let next, sysex;
    try {
      next = await navigator.requestMIDIAccess({sysex: true});
      sysex = true;
    } catch {
      next = await navigator.requestMIDIAccess();
      sysex = false;
    }
    if (physicalAccess && physicalAccess !== next) physicalAccess.onstatechange = null;
    physicalAccess = next;
    physicalSysex = sysex;
    physicalAccess.onstatechange = refresh;
    useAccess(emulatorAccess || physicalAccess);
    notify(
      physicalSysex
        ? 'MIDI connected · keys play Synth; right-click a knob to Learn'
        : 'MIDI connected without SysEx permission · keys and Learn work; the MPK display and lights are unavailable',
    );
  }
  P.store.subscribe((next, reason) => {
    const previousProfile = state.midi.profile;
    const previousPads = state.midi.padMode;
    const changed = JSON.stringify(next.midi) !== JSON.stringify(state.midi);
    state = next;
    if (changed || ['load', 'undo', 'redo', 'midi-learn', 'midi-clear', 'midi-preset'].includes(reason)) pickup.clear();
    if (next.midi.profile !== previousProfile || reason === 'load') releaseDevice();
    else if (previousPads === 'notes' && next.midi.padMode !== 'notes') releaseDevice(undefined, true);
    if (changed || ['load', 'undo', 'redo', 'midi-clear', 'midi-preset'].includes(reason)) cancelLearning();
  });
  window.addEventListener('afterhours:midilearn', e => {
    learn([e.detail]);
  });
  window.addEventListener('blur', () => releaseDevice());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseDevice();
  });
  return {
    connect,
    useEmulator,
    get emulating() {
      return !!emulatorAccess;
    },
    get sysex() {
      return !!emulatorAccess || physicalSysex;
    },
    receive,
    learn,
    skip: advanceLearning,
    pause: () => {
      if (learning) learning.paused = true;
    },
    resume: () => {
      if (learning) learning.paused = false;
    },
    targets: () => [...actions].map(([id, label]) => [id, {label}]),
    get lastMessage() {
      return lastMessage;
    },
    outputs(activeOnly = false) {
      const ports = [...(access?.outputs.values() || [])];
      // Keep an existing hardware clock output available while playing the emulator.
      if (!activeOnly && emulatorAccess && physicalAccess) ports.push(...physicalAccess.outputs.values());
      return ports.filter(o => o.state === 'connected');
    },
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
    get selected() {
      return selected;
    },
    cancel: () => {
      cancelLearning();
      notify('MIDI Learn cancelled');
    },
    get connected() {
      return !!access;
    },
  };
})();
