'use strict';
/* An emulated Akai MPK mini Plus II.

   Tests press physical controls ("hold SHIFT, strike pad 7") and read what a player would see:
   the 3-line display, pad and button lights, and the controller mode. The emulator turns those
   presses into the MIDI the hardware sends and interprets what Afterhours sends back.

   Sources for the protocol: Bitwig's official akai/mpkmk4 driver (CC numbers, SysEx commands,
   display/owner handshake) and Akai's MPK mini IV user guide (SHIFT + pad menus, PLUGIN/DAW).
   Behaviour neither source states is marked ASSUMPTION; confirm it on the real controller and
   update this file when hardware disagrees. */

window.createAfterhoursMPKEmulator = () => {
  const CC = {
    shift: 17,
    encoder: 14,
    encoderPush: 13,
    undo: 73,
    loop: 74,
    play: 76,
    record: 77,
    quantize: 78,
    'bank-': 80,
    'bank+': 81,
    tap: 82,
    'pad-bank': 83,
  };
  const KNOB = 24; // knobs 1–8 send relative CC 24–31 in DAW mode
  const MENUS = [null, null, null, null, 'Prog Play', 'Prog Edit', 'Chord Type', 'Chord Inv'];
  const PAD_MODES = ['Mute & Solo', 'Mixer/PC', 'Clip/CC', 'Drum/Notes'];
  const MODES = {daw: 0, plugin: 1, preset: 2};
  const port = (id, name) => ({id, name, manufacturer: 'Akai', state: 'connected', onmidimessage: null});
  const inputs = new Map(
    [
      ['mpk-midi', 'MPK mini Plus II MIDI Port'],
      ['mpk-daw', 'MPK mini Plus II DAW Port'],
      ['mpk-plugin', 'MPK mini Plus II Plugin Port'],
    ].map(([id, name]) => [id, port(id, name)]),
  );
  const state = {
    plugged: true,
    mode: 'daw',
    shift: false,
    padBank: 0,
    octave: 0,
    menu: null,
    owner: 'firmware',
    padNotes: false,
    hostLines: ['', '', ''],
    lights: {},
    clock: 0,
    // The five performance buttons are local firmware functions; nothing is sent to the host for them.
    arp: false,
    latch: false,
    freeze: false,
    chords: false,
    scales: false,
    repeat: false,
    fullLevel: false,
    // ASSUMPTION: factory arp is Up, 1/8; internal clock 120 BPM; Arp Config can select an external clock.
    arpClock: 'internal',
    tempo: 120,
    arpNotes: [],
    sustain: false,
  };
  const emit = (id, bytes) => {
    if (!state.plugged) return;
    const input = inputs.get(id);
    input.onmidimessage?.({data: Uint8Array.from(bytes)});
  };
  // Firmware → host SysEx uses the 0x7F device byte, as the Bitwig driver expects.
  const sysex = (command, payload = []) => [
    0xf0,
    0x47,
    0x7f,
    3,
    command,
    payload.length >> 7,
    payload.length & 127,
    ...payload,
    0xf7,
  ];
  const ascii = bytes => String.fromCharCode(...bytes.filter(b => b >= 32 && b < 127));
  const clockTimers = new Set();
  function clearClock() {
    for (const timer of clockTimers) clearTimeout(timer);
    clockTimers.clear();
  }
  // What Afterhours sends to the DAW port: identity, mode queries, display and lights.
  function hostMessage(bytes) {
    if (bytes[0] === 0xf0 && bytes[1] === 0x7e) {
      // Universal identity request → MPK mini Plus II identity.
      queueMicrotask(() => emit('mpk-daw', [240, 126, 127, 6, 2, 71, 3, 0, 25, 0, 247]));
      return;
    }
    if (bytes[0] === 0xf0 && bytes[1] === 0x47) {
      const command = bytes[4],
        payload = bytes.slice(7, -1);
      if (command === 0x2d && !payload.length) queueMicrotask(() => emit('mpk-daw', sysex(0x2d, [MODES[state.mode]])));
      else if (command === 0x1c) state.owner = payload[0] === 2 ? 'host' : 'firmware';
      else if (command === 0x2e) state.padNotes = payload[0] === 1;
      else if (command === 0x10 && payload[1] < 3) state.hostLines[payload[1]] = ascii(payload.slice(2)).trim();
      return;
    }
    const status = bytes[0] & 0xf0;
    if (status === 0x90 && bytes.length === 3) state.lights[bytes[1]] = {color: bytes[2], animation: bytes[0] & 0x0f};
  }
  const outputs = new Map([
    ['mpk-daw-out', {...port('mpk-daw-out', 'MPK mini Plus II DAW Port'), send: hostMessage, clear() {}}],
    [
      'mpk-midi-out',
      {
        ...port('mpk-midi-out', 'MPK mini Plus II MIDI Port'),
        send(bytes, at) {
          // Afterhours' MIDI clock output: 24 pulses per beat, Start/Stop/Continue.
          if (bytes[0] === 0xf8) {
            state.clock++;
            if (state.plugged && state.arpClock === 'external') {
              const timer = setTimeout(
                () => {
                  clockTimers.delete(timer);
                  clockPulse();
                },
                Math.max(0, (at ?? 0) - performance.now()),
              );
              clockTimers.add(timer);
            }
          } else if (bytes[0] === 0xfa || bytes[0] === 0xfc) {
            clearClock();
            if (bytes[0] === 0xfa) pulses = 0;
            if (state.arpClock === 'external') arpStep(true);
          }
        },
        clear: clearClock,
      },
    ],
  ]);
  const access = {inputs, outputs, onstatechange: null};
  // Controls route by mode: DAW controls to the DAW port, Plugin mode to the Plugin port.
  // ASSUMPTION: a User Preset sends knobs as absolute CC 70–77 and pads as channel-10 notes on the MIDI port.
  const controlPort = () => (state.mode === 'daw' ? 'mpk-daw' : state.mode === 'plugin' ? 'mpk-plugin' : 'mpk-midi');
  const cc = (number, value) => emit(controlPort(), [0xb0, number, value]);
  const knobValues = Array(8).fill(0);
  const repeats = new Map();
  const pressedPads = new Map();
  const padFlashes = new Map();
  function setMode(mode) {
    state.mode = mode;
    state.menu = null;
    if (mode !== 'daw') state.owner = 'firmware';
    // The firmware announces a mode change; Bitwig reacts to the same unsolicited 0x2D message.
    emit('mpk-daw', sysex(0x2d, [MODES[mode]]));
  }
  // Arpeggiator: held (or latched) notes play one at a time, upwards, on the MIDI port.
  let pulses = 0,
    arpTimer = null,
    arpIndex = 0,
    sounding = null;
  const held = new Map(); // physical key → notes and playback mode at key-down
  const directHeld = note => [...held.values()].some(key => !key.arp && key.notes.includes(note));
  const heldArpNotes = () => [...new Set([...held.values()].filter(key => key.arp).flatMap(key => key.notes))];
  function arpStep(stop = false) {
    if (sounding !== null && !directHeld(sounding)) emit('mpk-midi', [0x80, sounding, 0]);
    sounding = null;
    if (stop || !state.arp || !state.arpNotes.length) return;
    const notes = [...state.arpNotes].sort((a, b) => a - b);
    sounding = notes[arpIndex++ % notes.length];
    if (!directHeld(sounding)) emit('mpk-midi', [0x90, sounding, 100]);
  }
  function clockPulse() {
    if (state.plugged && ++pulses % 12 === 0) arpStep(); // 1/8 at 24 PPQN
  }
  function arpRun() {
    clearInterval(arpTimer);
    arpTimer = null;
    if (state.arp && state.arpClock === 'internal') arpTimer = setInterval(arpStep, 30000 / state.tempo);
    if (!state.arp) {
      arpStep(true);
      state.arpNotes = [];
    }
  }
  // ASSUMPTION: Scales default to C major and snap down; Chords default to a major triad.
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const snap = note => {
    while (!MAJOR.includes(((note % 12) + 12) % 12)) note--;
    return note;
  };
  // SHIFT functions as printed on the Plus II panel (they differ from the mini IV guide):
  // ARP / CONFIG, LATCH / FREEZE, CHORDS / CONFIG, SCALES / CONFIG, NOTE REPEAT / FULL LEVEL.
  const CONFIG = {arp: 'Arp Config', chords: 'Chord Config', scales: 'Scale Config'};
  let clockChoice = state.arpClock;
  let encoderMenu = null;
  function performanceButton(name, shift) {
    if (shift && CONFIG[name]) {
      // SHIFT + ARP / CHORDS / SCALES opens that configuration on the display.
      state.menu = state.menu === CONFIG[name] ? (closeMenu(), null) : CONFIG[name];
      if (state.menu === CONFIG.arp) clockChoice = state.arpClock;
      return;
    }
    if (name === 'latch') {
      if (shift) state.freeze = !state.freeze;
      else {
        state.latch = !state.latch;
        if (!state.latch && state.arp) state.arpNotes = heldArpNotes();
      }
    } else if (name === 'note-repeat' && shift) state.fullLevel = !state.fullLevel;
    else if (name === 'note-repeat') state.repeat = !state.repeat;
    else {
      state[name] = !state[name];
      if (name === 'arp') arpRun();
    }
  }
  function closeMenu() {
    if (!state.menu) return;
    state.menu = null;
    // An empty 0x19 asks the host to take the screen back (Bitwig: handleScreenMessage).
    emit('mpk-daw', sysex(0x19));
  }
  return {
    access,
    state,
    held,
    pressedPads,
    padFlashes,
    dispose() {
      this.plug(false);
    },
    button(name, {shift = false} = {}) {
      const releaseShift = shift && !state.shift;
      if (releaseShift) this.shift(true);
      shift = state.shift;
      if (name === 'plugin-daw' && state.menu && !shift) {
        // Akai guide: PLUGIN/DAW exits a configuration menu.
        closeMenu();
      } else if (name === 'plugin-daw') {
        // Akai guide: PLUGIN/DAW toggles Plugin/DAW; SHIFT + PLUGIN/DAW opens User Presets.
        setMode(shift ? 'preset' : state.mode === 'daw' ? 'plugin' : 'daw');
      } else if (['arp', 'latch', 'chords', 'scales', 'note-repeat'].includes(name)) {
        performanceButton(name, shift);
      } else if (name === 'oct-' || name === 'oct+') {
        state.octave = Math.max(-4, Math.min(4, state.octave + (name === 'oct+' ? 1 : -1)));
      } else {
        if (name === 'pad-bank' && !shift) state.padBank = 1 - state.padBank;
        if (state.mode === 'preset') return this.release(releaseShift);
        cc(CC[name], 127);
        // These transport buttons send only a press on the physical DAW port.
        if (state.mode !== 'daw' || !['loop', 'play', 'record'].includes(name)) cc(CC[name], 0);
      }
      this.release(releaseShift);
    },
    release(shift) {
      if (shift) this.shift(false);
    },
    shift(down) {
      state.shift = down;
      if (state.mode !== 'preset') cc(CC.shift, down ? 127 : 0);
    },
    // pad: 1–8 on the current physical bank, or 'A1'…'B8' (switching the bank first, as a player would).
    padDown(pad, velocity = 100) {
      let index = pad;
      if (typeof pad === 'string') {
        const bank = pad[0].toUpperCase() === 'B' ? 1 : 0;
        if (bank !== state.padBank) this.button('pad-bank');
        index = Number(pad.slice(1));
      }
      const note = 36 + state.padBank * 8 + index - 1;
      if (state.shift && state.mode === 'daw') {
        // Akai guide: SHIFT + pads 1–4 choose pad modes; SHIFT + pads 5–8 open or close firmware menus.
        if (MENUS[index - 1]) state.menu = state.menu === MENUS[index - 1] ? (closeMenu(), null) : MENUS[index - 1];
        else state.padMode = PAD_MODES[index - 1];
      }
      // ASSUMPTION: the pad note still reaches the host with SHIFT held (the original menu bug relied on it).
      const padPort = state.mode === 'plugin' ? 'mpk-plugin' : state.mode === 'daw' ? 'mpk-daw' : 'mpk-midi';
      // Akai guide: Full Level sends every pad at 127.
      if (state.fullLevel) velocity = 127;
      pressedPads.set(note, padPort);
      emit(padPort, [0x99, note, velocity]);
      // Note Repeat retriggers a held pad at 1/16 of the firmware tempo.
      if (state.repeat && !state.shift) {
        clearInterval(repeats.get(note));
        repeats.set(
          note,
          setInterval(() => {
            emit(padPort, [0x89, note, 0]);
            emit(padPort, [0x99, note, velocity]);
          }, 15000 / state.tempo),
        );
      }
      return note;
    },
    padUp(note) {
      clearInterval(repeats.get(note));
      repeats.delete(note);
      const port = pressedPads.get(note);
      pressedPads.delete(note);
      padFlashes.set(note, performance.now() + 150);
      if (port) emit(port, [0x89, note, 0]);
    },
    tapPad(pad, velocity = 100, shift = false) {
      const releaseShift = shift && !state.shift;
      if (releaseShift) this.shift(true);
      this.padUp(this.padDown(pad, velocity));
      if (releaseShift) this.shift(false);
    },
    snapshot() {
      return {...state, screen: this.screen()};
    },
    light(id) {
      return state.lights[id] || {color: 0, animation: 0};
    },
    knob(index, steps) {
      if (state.mode === 'preset') {
        // A real knob sends every value it passes through, not just where it stops.
        for (let i = 0; i < Math.abs(steps); i++) {
          const next = Math.max(0, Math.min(127, knobValues[index - 1] + Math.sign(steps)));
          if (next === knobValues[index - 1]) break;
          knobValues[index - 1] = next;
          emit('mpk-midi', [0xb0, 69 + index, next]);
        }
        return;
      }
      const one = Math.sign(steps);
      for (let i = 0; i < Math.abs(steps); i++) cc(KNOB + index - 1, one > 0 ? 1 : 127);
    },
    encoder(steps) {
      // Akai guide: inside a firmware menu the encoder browses that menu.
      if (state.menu === CONFIG.arp && steps) clockChoice = steps > 0 ? 'external' : 'internal';
      if (state.menu) return;
      for (let i = 0; i < Math.abs(steps); i++) cc(CC.encoder, steps > 0 ? 1 : 127);
    },
    encoderPush(down) {
      if (!!state.encoderDown === down) return;
      state.encoderDown = down;
      if (down) encoderMenu = state.menu;
      if (!encoderMenu) cc(CC.encoderPush, down ? 127 : 0);
      else if (!down && encoderMenu === CONFIG.arp && state.menu === CONFIG.arp) {
        this.arpClock(clockChoice);
        closeMenu();
      }
    },
    keyDown(note, velocity = 100) {
      if (!state.plugged || held.has(note)) return;
      let played = note + state.octave * 12;
      if (state.scales) played = snap(played);
      const notes = (state.chords ? [played, played + 4, played + 7] : [played]).filter(n => n >= 0 && n <= 127);
      const arp = state.arp;
      // With Latch, a new chord replaces the latched one once every key had been released.
      if (arp && state.latch && !held.size) state.arpNotes = [];
      const attacks = arp ? [] : notes.filter(n => n !== sounding && !directHeld(n));
      held.set(note, {notes, arp});
      if (arp) {
        state.arpNotes = [...new Set([...state.arpNotes, ...notes])];
        if (state.arpClock === 'internal' && !arpTimer) arpRun();
        return;
      }
      for (const n of attacks) emit('mpk-midi', [0x90, n, velocity]);
    },
    keyUp(note) {
      const key = held.get(note);
      if (!key) return;
      held.delete(note);
      const {notes, arp} = key;
      if (arp) {
        if (!state.latch && state.arp) state.arpNotes = heldArpNotes();
        return;
      }
      for (const n of notes) if (n !== sounding && !directHeld(n)) emit('mpk-midi', [0x80, n, 0]);
    },
    // value −1…1
    pitchWheel(value) {
      const v = Math.max(0, Math.min(16383, Math.round(8192 + value * 8191)));
      emit('mpk-midi', [0xe0, v & 127, v >> 7]);
    },
    modWheel(value) {
      emit('mpk-midi', [0xb0, 1, value]);
    },
    sustainPedal(down) {
      state.sustain = down;
      emit('mpk-midi', [0xb0, 64, down ? 127 : 0]);
    },
    // Arp Config → Clock: Internal / External.
    arpClock(source) {
      clearClock();
      arpStep(true);
      state.arpClock = source;
      pulses = 0;
      arpRun();
    },
    // Only what the player can actually see on the device.
    screen() {
      if (!state.plugged) return ['', '', ''];
      if (state.menu === CONFIG.arp)
        return [state.menu, `Clock: ${clockChoice === 'external' ? 'External' : 'Internal'}`, 'Push to apply'];
      if (state.menu) return [state.menu, '', ''];
      if (state.mode !== 'daw' || state.owner !== 'host')
        return [`Preset:${state.mode === 'daw' ? 'DAW' : state.mode === 'plugin' ? 'Plugin' : 'User'}`, 'BPM:120', ''];
      return [...state.hostLines];
    },
    plug(connected) {
      state.plugged = connected;
      for (const p of [...inputs.values(), ...outputs.values()]) p.state = connected ? 'connected' : 'disconnected';
      if (!connected) {
        state.owner = 'firmware';
        state.lights = {};
        state.sustain = state.shift = state.encoderDown = false;
        state.arpNotes = [];
        held.clear();
        pressedPads.clear();
        for (const timer of repeats.values()) clearInterval(timer);
        repeats.clear();
        clearClock();
        pulses = 0;
        clearInterval(arpTimer);
        arpTimer = null;
        arpStep(true);
      } else if (state.arp) {
        arpRun();
      }
      access.onstatechange?.({port: inputs.get('mpk-daw')});
    },
  };
};
