'use strict';
const {readFileSync} = require('node:fs');
const {expect} = require('@playwright/test');

const emulatorSource = readFileSync(require.resolve('../../../web/mpk-emulator.js'), 'utf8');
const viewSource = readFileSync(require.resolve('../../../web/mpk-view.js'), 'utf8');

const LIGHT = {undo: 73, loop: 74, play: 76, record: 77, quantize: 78, 'bank-': 80, 'bank+': 81, tap: 82};
const FIRMWARE_LIGHT = {arp: 'arp', latch: 'latch', chords: 'chords', scales: 'scales', 'note-repeat': 'repeat'};

// Test-side handle: every method is a physical action or an observation.
class MPK {
  constructor(page) {
    this.page = page;
    // MPK_PACE: pause after each physical action, so a person can watch (npm run demo:mpk).
    this.pace = Number(process.env.MPK_PACE) || 0;
  }
  // view: draw the controller on the page (also MPK_VIEW=1), to watch or record a scenario.
  static async install(page, {sysex = true, view = process.env.MPK_VIEW === '1'} = {}) {
    await page.addInitScript({
      content: `${emulatorSource}
        ${view ? viewSource : ''}
        window.__mpk = window.createAfterhoursMPKEmulator();
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          configurable: true,
          value: async options => {
            if (options?.sysex && !${sysex}) throw new DOMException('SysEx denied', 'SecurityError');
            return window.__mpk.access;
          },
        });
        ${view ? "document.addEventListener('DOMContentLoaded', () => window.mountAfterhoursMPKView(window.__mpk), {once: true});" : ''}
      `,
    });
    return new MPK(page);
  }
  // Calls a method of the in-page emulator (the app's CSP forbids evaluating test source).
  async run(method, ...args) {
    const result = await this.page.evaluate(([method, args]) => window.__mpk[method](...args), [method, args]);
    if (this.pace && !['screen', 'snapshot', 'light'].includes(method)) await this.page.waitForTimeout(this.pace);
    return result;
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
