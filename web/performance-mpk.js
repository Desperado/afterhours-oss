'use strict';
// Native DAW controls and feedback are separate from custom User Preset MIDI Learn.
window.AfterhoursMPK = (() => {
  const P = AfterhoursPerformance,
    M = AfterhoursLiveMIDI,
    Q = AfterhoursMPKProtocol;
  const cache = new Map(),
    pressed = new Set(),
    notes = new Set();
  let output = null,
    inputId = null,
    verified = false,
    active = false,
    shift = false,
    bpmHeld = false,
    // Held central encoder: a pad pressed meanwhile selects its track instead of confirming the jam.
    encoderHeld = null;
  let lastInquiry = 0,
    lastOwner = 0,
    attempts = 0,
    temporary = '',
    temporaryUntil = 0;
  let status = 'DAW-профіль вимкнено';
  const enabled = () => P.store.state.midi.profile === 'mpk-mini-plus-ii' && P.store.state.midi.native;
  const report = text => {
    if (status === text) return;
    status = text;
    window.dispatchEvent(new Event('afterhours:mpkstatus'));
  };
  const send = bytes => {
    if (output) output.send(bytes);
  };
  const once = (key, bytes) => {
    const value = bytes.join(',');
    if (cache.get(key) !== value) {
      send(bytes);
      cache.set(key, value);
    }
  };
  function releaseNotes() {
    for (const id of notes) AfterhoursSynth.off(id);
    notes.clear();
    pressed.clear();
    shift = bpmHeld = false;
    encoderHeld = null;
  }
  function release() {
    releaseNotes();
    if (active) {
      try {
        for (const id of [...Array.from({length: 16}, (_, i) => i + 36), 73, 74, 76, 77, 78, 80, 81, 82])
          send(Q.light(id, 0));
        send(Q.command(0x2e, [0]));
        send(Q.command(0x1c, [0]));
      } catch {
        /* The USB port may already have disappeared. */
      }
    }
    active = false;
    cache.clear();
  }
  function fail(error) {
    release();
    verified = false;
    attempts = 3;
    report('MIDI-помилка: ' + error.message + ' · натисни «Увімкнути» ще раз');
  }
  function claim() {
    send(Q.command(0x1c, [2]));
    lastOwner = performance.now();
    send(Q.command(0x49, [...Array.from(AfterhoursGrooveApp.S.data.bpm.toFixed(2), c => c.charCodeAt(0)), 0]));
    send(Q.command(0x2a, [1]));
    send(Q.command(0x2e, [1]));
    active = true;
    cache.clear();
    report('MPK підключено · дисплей, світло, SHIFT і крутилки готові');
    paint();
  }
  function refresh() {
    const next = enabled() && !document.hidden ? M.outputs().find(Q.daw) : null;
    const input = M.devices().find(Q.daw);
    if (!next || !input || next !== output || input.id !== inputId) {
      release();
      output = next || null;
      inputId = input?.id || null;
      verified = false;
      attempts = 0;
      lastInquiry = 0;
    }
    if (!enabled()) return report('DAW-профіль вимкнено');
    if (!output || !inputId) return report('Очікую MPK mini Plus II · підключи USB');
    if (!M.sysex)
      return report(
        'Немає дозволу SysEx · дисплей і світло MPK недоступні. Дозволь SysEx для MIDI й натисни «Увімкнути» ще раз.',
      );
    if (!verified && attempts === 0) inquire();
  }
  function inquire() {
    attempts++;
    lastInquiry = performance.now();
    report('Перевіряю MPK · увімкни DAW-режим на контролері');
    try {
      send(Q.inquiry);
    } catch (error) {
      fail(error);
    }
  }
  function sysex(input, bytes) {
    if (!enabled() || document.hidden || input.id !== inputId || !Q.daw(input)) return;
    try {
      if (Q.identity(bytes)) {
        verified = true;
        send(Q.command(0x2d));
        return;
      }
      if (!verified) return;
      const msg = Q.parse(bytes);
      if (msg?.id === 0x2d && msg.payload.length === 1) {
        if (msg.payload[0] === 0) {
          if (!active) claim();
        } else {
          release();
          report(
            'MPK у режимі Plugin або User Presets. Натисни на MPK кнопку PLUGIN/DAW (без SHIFT), щоб повернути DAW — Afterhours підключиться сам.',
          );
        }
      } else if (active && msg?.id === 0x19 && !msg.payload.length) {
        cache.clear();
        send(Q.command(0x1c, [2]));
        lastOwner = performance.now();
      }
    } catch (error) {
      fail(error);
    }
  }
  const action = (target, extra = {}) =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target, ...extra}}));
  function route(input, msg) {
    if (!enabled() || !Q.daw(input)) return false;
    // Consume DAW traffic even while waiting: it must never become a piano note.
    if (!active || input.id !== inputId || document.hidden) return true;
    if (msg.channel === 9 && ['on', 'off'].includes(msg.type) && msg.note >= 36 && msg.note <= 51) {
      const id = 'mpk-pad:' + msg.note;
      if (msg.type === 'off') {
        notes.delete(id);
        AfterhoursSynth.off(id);
      } else if (shift) {
        // SHIFT + pad belongs to the MPK firmware (pad modes, Prog, Chord Type), never to Afterhours.
        // A held encoder must not confirm the jam on release after this either.
        if (encoderHeld) encoderHeld.used = true;
        return true;
      } else if (encoderHeld) {
        encoderHeld.used = true;
        action('mpk.select-lane.' + (msg.note - 36));
      } else if (P.store.state.midi.padMode === 'notes') {
        notes.add(id);
        AfterhoursSynth.midiOn(id, msg.note, msg.velocity).catch(error => report(error.message));
      } else {
        const {padMode, pads} = P.store.state.midi;
        if (['drums', 'beat'].includes(padMode)) {
          const pad = msg.note - 36,
            S = AfterhoursGrooveApp.S,
            track = S.data.patterns[S.data.active].tracks[pads[pad]];
          temporary = `${pad < 8 ? 'A' : 'B'}${(pad % 8) + 1} ${track.name || track.machine}`;
          temporaryUntil = performance.now() + 1200;
        }
        action('mpk.pad.' + (msg.note - 36), {velocity: msg.velocity});
      }
      return true;
    }
    if (msg.type !== 'cc' || msg.channel !== 0) return true;
    const {cc, value} = msg;
    if (cc === 17) {
      shift = value > 0;
      return true;
    }
    if (cc === 13) {
      if (value > 0) {
        if (!encoderHeld) encoderHeld = {shift, used: false};
        temporary = 'Pad = select track';
        temporaryUntil = performance.now() + 1500;
      } else if (encoderHeld) {
        const held = encoderHeld;
        encoderHeld = null;
        if (temporary === 'Pad = select track') temporaryUntil = 0;
        if (!held.used) action('action.' + (held.shift ? 'jam-cancel' : 'jam-confirm'));
      }
      return true;
    }
    if (cc === 120) {
      bpmHeld = value > 0;
      return true;
    }
    if (cc === 14) {
      const direction = Math.sign(Q.relative(value));
      if (direction) {
        if (bpmHeld)
          AfterhoursShell.getEngine('groove')
            .tempo()
            .set(Math.max(40, Math.min(240, AfterhoursGrooveApp.S.data.bpm + direction)));
        else action(shift ? 'action.pattern-' + (direction > 0 ? 'next' : 'prev') : 'mpk.instrument', {direction});
      }
      return true;
    }
    if (cc >= 24 && cc <= 31) {
      const i = cc - 24,
        bank = P.store.state.midi.knobBank;
      const target = AfterhoursMPKControls.target(bank, i);
      if (target) {
        AfterhoursMPKControls.turn(target, Q.relative(value), shift);
        const label = target.label.replace(/^(Synth |Lane \d+ )/, '').slice(0, 9);
        temporary = `${i + 1} ${label} ${AfterhoursMPKControls.format(target)}`;
      } else temporary = `${i + 1} Unused for sound`;
      temporaryUntil = performance.now() + 1800;
      return true;
    }
    if (!value) {
      pressed.delete(cc);
      return true;
    }
    if (pressed.has(cc)) return true;
    pressed.add(cc);
    const binding = {
      73: shift ? 'redo' : 'undo',
      74: shift ? 'panic' : 'loop',
      76: shift ? 'continue' : 'play-stop',
      77: shift ? 'keys-record' : 'record',
      78: 'quantize',
      80: shift ? 'song-prev' : 'knob-bank-prev',
      81: shift ? 'song-next' : 'knob-bank',
      82: shift ? 'metronome' : 'tap',
      83: shift ? 'pad-mode' : null,
    }[cc];
    if (binding) action('action.' + binding);
    return true;
  }
  function paint() {
    if (!active) return;
    const state = P.store.state,
      S = AfterhoursGrooveApp.S,
      clock = AfterhoursGrooveLive.clock();
    const recording = AfterhoursPerformanceStudio.recording;
    const selectedTrack = S.data.patterns[S.data.active].tracks[S.selected];
    const trackLabel = `T${String(S.selected + 1).padStart(2, '0')} ${selectedTrack.name || selectedTrack.machine}`;
    const light = (id, color, animation = 6) => once('light' + id, Q.light(id, color, animation));
    for (let i = 0; i < 3; i++) once('row' + i, Q.row(i));
    // A song chosen with SHIFT + BANK waits on screen until Play/Stop loads it.
    const nextSong = window.AfterhoursSongWorkflow?.pending;
    once('text0', Q.text(0, nextSong ? '> ' + nextSong : S.data.title || 'AFTERHOURS'));
    once(
      'text1',
      Q.text(
        1,
        nextSong
          ? 'Play = load song'
          : performance.now() < temporaryUntil
            ? temporary
            : shift || state.midi.knobBank.startsWith('track-')
              ? trackLabel
              : AfterhoursSynth.snapshot().name,
      ),
    );
    once(
      'text2',
      Q.text(
        2,
        `${recording ? 'REC' : AfterhoursGrooveLive.keysArmed ? 'KEYS' : clock.running ? 'PLAY' : 'STOP'} ${Math.round(clock.bpm)} T${String(S.selected + 1).padStart(2, '0')} B${AfterhoursMPKControls.banks.findIndex(b => b[0] === state.midi.knobBank) + 1}`,
      ),
    );
    light(76, 127, clock.running ? 6 : 0);
    // Blinking: audio take. Steady: keys record into the selected track.
    light(77, recording || AfterhoursGrooveLive.keysArmed ? 127 : 0, recording ? 9 : 6);
    light(74, 127, S.data.continuous ? 6 : 0);
    light(73, 127, pressed.has(73) ? 6 : 0);
    light(78, 127, pressed.has(78) ? 6 : 0);
    light(80, 127, pressed.has(80) ? 6 : 0);
    light(81, 127, pressed.has(81) ? 6 : 0);
    light(82, 127, clock.running ? 9 : 0);
    const levels = AfterhoursGrooveLive.levels();
    for (let i = 0; i < 16; i++) {
      const scene = !shift && state.midi.padMode === 'scenes' && i < 8;
      const lane =
        !shift && state.midi.padMode === 'scenes' && i >= 8
          ? i - 8
          : !shift && ['drums', 'beat'].includes(state.midi.padMode)
            ? state.midi.pads[i]
            : i;
      const muted = state.mixer.lanes[lane]?.mute;
      const selected = !scene && lane === S.selected;
      const color = selected
        ? 13
        : scene
          ? state.scenes[i]
            ? 67
            : 2
          : muted
            ? 5
            : state.midi.padMode === 'notes'
              ? 67
              : state.midi.padMode === 'beat' && clock.running
                ? 5
                : lane < 4
                  ? 9
                  : 21;
      light(36 + i, color, selected || (!shift && !scene && !muted && levels[lane] > 0.02) ? 6 : 1);
    }
  }
  window.addEventListener('afterhours:groove-selection', () => {
    const S = AfterhoursGrooveApp.S,
      track = S.data.patterns[S.data.active].tracks[S.selected];
    temporary = `T${String(S.selected + 1).padStart(2, '0')} ${track.name || track.machine}`;
    temporaryUntil = performance.now() + 2000;
    paint();
  });
  window.addEventListener('afterhours:mididevices', refresh);
  let knobBank = P.store.state.midi.knobBank;
  P.store.subscribe((s, reason) => {
    if (s.midi.knobBank !== knobBank) {
      knobBank = s.midi.knobBank;
      temporary = AfterhoursMPKControls.banks.find(b => b[0] === knobBank)[1];
      temporaryUntil = performance.now() + 2000;
    }
    if (!enabled()) {
      release();
      report('DAW-профіль вимкнено');
    } else if (['midi-profile', 'load', 'undo', 'redo'].includes(reason)) refresh();
    if (s.midi.padMode !== 'notes') {
      for (const id of notes) AfterhoursSynth.off(id);
      notes.clear();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
    else {
      verified = false;
      attempts = 0;
      refresh();
    }
  });
  window.addEventListener('blur', releaseNotes);
  window.addEventListener('pagehide', release);
  setInterval(() => {
    try {
      if (!enabled() || document.hidden) return;
      if (!verified && output && attempts < 3 && performance.now() - lastInquiry > 2000) inquire();
      if (!verified && attempts === 3 && performance.now() - lastInquiry > 2000)
        report('MPK не відповів · перевір DAW-режим і натисни «Увімкнути»');
      if (active && performance.now() - lastOwner > 5800) {
        send(Q.command(0x1c, [2]));
        lastOwner = performance.now();
      }
      paint();
    } catch (error) {
      fail(error);
    }
  }, 100);
  if (enabled()) M.connect().catch(fail);
  return {
    sysex,
    route,
    release,
    reconnect: () => {
      release();
      verified = false;
      attempts = 0;
      refresh();
    },
    get status() {
      return status;
    },
  };
})();
