'use strict';
/* An emulated Akai MPK mini Plus II for end-to-end tests.

   Tests press physical controls ("hold SHIFT, strike pad 7") and read what a player would see:
   the 3-line display, pad and button lights, and the controller mode. The emulator turns those
   presses into the MIDI the hardware sends and interprets what Afterhours sends back.

   Sources for the protocol: Bitwig's official akai/mpkmk4 driver (CC numbers, SysEx commands,
   display/owner handshake) and Akai's MPK mini IV user guide (SHIFT + pad menus, PLUGIN/DAW).
   Behaviour neither source states is marked ASSUMPTION; confirm it on the real controller and
   update this file when hardware disagrees. */

const {expect} = require('@playwright/test');
const {mpkView} = require('./mpk-view');

// Runs inside the page before any app script.
function emulator() {
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
    received: [],
    clock: 0,
    sysexAllowed: true,
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
  // What Afterhours sends to the DAW port: identity, mode queries, display and lights.
  function hostMessage(bytes) {
    state.received.push(bytes);
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
            if (state.arpClock === 'external')
              setTimeout(() => clockPulse(), Math.max(0, (at ?? 0) - performance.now()));
          } else if (bytes[0] === 0xfa) pulses = 0;
          else if (bytes[0] === 0xfc) arpStep(true);
        },
        clear() {},
      },
    ],
  ]);
  const access = {inputs, outputs, onstatechange: null};
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async options => {
      if (options?.sysex && !state.sysexAllowed) throw new DOMException('SysEx denied', 'SecurityError');
      return access;
    },
  });
  // Controls route by mode: DAW controls to the DAW port, Plugin mode to the Plugin port.
  // ASSUMPTION: a User Preset sends knobs as absolute CC 70–77 and pads as channel-10 notes on the MIDI port.
  const controlPort = () => (state.mode === 'daw' ? 'mpk-daw' : state.mode === 'plugin' ? 'mpk-plugin' : 'mpk-midi');
  const cc = (number, value) => emit(controlPort(), [0xb0, number, value]);
  const knobValues = Array(8).fill(0);
  const repeats = new Map();
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
  const held = new Map(); // physical key → notes it sounds
  function arpStep(stop = false) {
    if (sounding !== null) emit('mpk-midi', [0x80, sounding, 0]);
    sounding = null;
    if (stop || !state.arp || !state.arpNotes.length) return;
    const notes = [...state.arpNotes].sort((a, b) => a - b);
    sounding = notes[arpIndex++ % notes.length];
    emit('mpk-midi', [0x90, sounding, 100]);
  }
  function clockPulse() {
    if (++pulses % 12 === 0) arpStep(); // 1/8 at 24 PPQN
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
  function performanceButton(name, shift) {
    if (shift && CONFIG[name]) {
      // SHIFT + ARP / CHORDS / SCALES opens that configuration on the display.
      state.menu = state.menu === CONFIG[name] ? (closeMenu(), null) : CONFIG[name];
      return;
    }
    if (name === 'latch') {
      if (shift) state.freeze = !state.freeze;
      else {
        state.latch = !state.latch;
        if (!state.latch) state.arpNotes = [...held.keys()].map(n => n + state.octave * 12);
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
  window.__mpk = {
    state,
    button(name, {shift = false} = {}) {
      if (shift) this.shift(true);
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
        if (state.mode === 'preset') return this.release(shift);
        cc(CC[name], 127);
        cc(CC[name], 0);
      }
      this.release(shift);
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
      emit(state.mode === 'plugin' ? 'mpk-plugin' : state.mode === 'daw' ? 'mpk-daw' : 'mpk-midi', [0x89, note, 0]);
    },
    tapPad(pad, velocity = 100, shift = false) {
      if (shift) this.shift(true);
      this.padUp(this.padDown(pad, velocity));
      if (shift) this.shift(false);
    },
    snapshot() {
      return {...state, received: undefined, screen: this.screen()};
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
      if (state.menu) return;
      for (let i = 0; i < Math.abs(steps); i++) cc(CC.encoder, steps > 0 ? 1 : 127);
    },
    encoderPush(down) {
      state.encoderDown = down;
      if (state.menu) return;
      cc(CC.encoderPush, down ? 127 : 0);
    },
    keyDown(note, velocity = 100) {
      let played = note + state.octave * 12;
      if (state.scales) played = snap(played);
      const notes = state.chords ? [played, played + 4, played + 7] : [played];
      if (state.arp) {
        // With Latch, a new chord replaces the latched one once every key had been released.
        if (state.latch && !held.size) state.arpNotes = [];
        held.set(note, notes);
        state.arpNotes = [...new Set([...state.arpNotes, ...notes])];
        if (state.arpClock === 'internal' && !arpTimer) arpRun();
        return;
      }
      held.set(note, notes);
      for (const n of notes) emit('mpk-midi', [0x90, n, velocity]);
    },
    keyUp(note) {
      const notes = held.get(note) || [note + state.octave * 12];
      held.delete(note);
      if (state.arp) {
        if (!state.latch) state.arpNotes = state.arpNotes.filter(n => !notes.includes(n));
        return;
      }
      for (const n of notes) emit('mpk-midi', [0x80, n, 0]);
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
      state.arpClock = source;
      pulses = 0;
      arpRun();
    },
    // Only what the player can actually see on the device.
    screen() {
      if (!state.plugged) return ['', '', ''];
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
      }
      access.onstatechange?.({port: inputs.get('mpk-daw')});
    },
  };
}

const LIGHT = {undo: 73, loop: 74, play: 76, record: 77, quantize: 78, 'bank-': 80, 'bank+': 81, tap: 82};
const FIRMWARE_LIGHT = {arp: 'arp', latch: 'latch', chords: 'chords', scales: 'scales', 'note-repeat': 'repeat'};

// Test-side handle: every method is a physical action or an observation.
class MPK {
  constructor(page) {
    this.page = page;
  }
  // view: draw the controller on the page (also MPK_VIEW=1), to watch or record a scenario.
  static async install(page, {sysex = true, view = process.env.MPK_VIEW === '1'} = {}) {
    await page.addInitScript(emulator);
    if (view) await page.addInitScript(mpkView);
    if (!sysex) await page.addInitScript(() => (window.__mpk.state.sysexAllowed = false));
    return new MPK(page);
  }
  // Calls a method of the in-page emulator (the app's CSP forbids evaluating test source).
  run(method, ...args) {
    return this.page.evaluate(([method, args]) => window.__mpk[method](...args), [method, args]);
  }
  press(button, options = {}) {
    return this.run('button', button, options);
  }
  pad(pad, {velocity = 100, shift = false} = {}) {
    return this.run('tapPad', pad, velocity, shift);
  }
  // Hold SHIFT (or the central encoder) while the callback performs other presses.
  async holdShift(callback) {
    await this.run('shift', true);
    try {
      await callback();
    } finally {
      await this.run('shift', false);
    }
  }
  async holdEncoder(callback) {
    await this.run('encoderPush', true);
    try {
      await callback();
    } finally {
      await this.run('encoderPush', false);
    }
  }
  // Hold a pad for ms (Note Repeat retriggers it meanwhile).
  async holdPad(pad, ms, {velocity = 100} = {}) {
    const note = await this.run('padDown', pad, velocity);
    await this.page.waitForTimeout(ms);
    await this.run('padUp', note);
  }
  pitchWheel(value) {
    return this.run('pitchWheel', value);
  }
  modWheel(value) {
    return this.run('modWheel', value);
  }
  sustainPedal(down) {
    return this.run('sustainPedal', down);
  }
  setArpClock(source) {
    return this.run('arpClock', source);
  }
  pushEncoder() {
    return this.holdEncoder(async () => {});
  }
  turnEncoder(steps) {
    return this.run('encoder', steps);
  }
  turnKnob(knob, steps) {
    return this.run('knob', knob, steps);
  }
  keyDown(note, velocity = 100) {
    return this.run('keyDown', note, velocity);
  }
  keyUp(note) {
    return this.run('keyUp', note);
  }
  async playKey(note, {ms = 120, velocity = 100} = {}) {
    await this.keyDown(note, velocity);
    await this.page.waitForTimeout(ms);
    await this.keyUp(note);
  }
  unplug() {
    return this.run('plug', false);
  }
  plugIn() {
    return this.run('plug', true);
  }
  screen() {
    return this.run('screen');
  }
  state() {
    return this.run('snapshot');
  }
  // light('play'), light('A3'), light('B8')
  light(name) {
    // ARP, LATCH, CHORDS, SCALES and NOTE REPEAT are lit by the firmware itself.
    if (FIRMWARE_LIGHT[name])
      return this.state().then(s => ({
        color: s[FIRMWARE_LIGHT[name]] ? 127 : 0,
        animation: s[FIRMWARE_LIGHT[name]] ? 6 : 0,
      }));
    const id = /^[AB][1-8]$/.test(name) ? 36 + (name[0] === 'B' ? 8 : 0) + Number(name[1]) - 1 : LIGHT[name];
    return this.run('light', id);
  }
  // Assertions read like the screen: expectScreen(['Neon Afterimage', /Synth/, /^STOP/]).
  async expectScreen(lines) {
    for (const [i, line] of lines.entries()) {
      if (line === undefined) continue;
      await expect
        .poll(async () => (await this.screen())[i], {message: `MPK display line ${i + 1}`})
        [line instanceof RegExp ? 'toMatch' : 'toBe'](line);
    }
  }
}

module.exports = {MPK};
