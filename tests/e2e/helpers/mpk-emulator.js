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
        send(bytes) {
          if (bytes[0] === 0xf8) state.clock++;
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
  function setMode(mode) {
    state.mode = mode;
    state.menu = null;
    if (mode !== 'daw') state.owner = 'firmware';
    // The firmware announces a mode change; Bitwig reacts to the same unsolicited 0x2D message.
    emit('mpk-daw', sysex(0x2d, [MODES[mode]]));
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
      if (name === 'plugin-daw') {
        // Akai guide: PLUGIN/DAW toggles Plugin/DAW; SHIFT + PLUGIN/DAW opens User Presets.
        setMode(shift ? 'preset' : state.mode === 'daw' ? 'plugin' : 'daw');
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
      emit(state.mode === 'plugin' ? 'mpk-plugin' : state.mode === 'daw' ? 'mpk-daw' : 'mpk-midi', [
        0x99,
        note,
        velocity,
      ]);
      return note;
    },
    padUp(note) {
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
        knobValues[index - 1] = Math.max(0, Math.min(127, knobValues[index - 1] + steps));
        emit('mpk-midi', [0xb0, 69 + index, knobValues[index - 1]]);
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
      if (state.menu) return;
      cc(CC.encoderPush, down ? 127 : 0);
    },
    keyDown(note, velocity = 100) {
      emit('mpk-midi', [0x90, note + state.octave * 12, velocity]);
    },
    keyUp(note) {
      emit('mpk-midi', [0x80, note + state.octave * 12, 0]);
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

// Test-side handle: every method is a physical action or an observation.
class MPK {
  constructor(page) {
    this.page = page;
  }
  static async install(page, {sysex = true} = {}) {
    await page.addInitScript(emulator);
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
