'use strict';
/* MPK setup uses the controller's actual messages, so custom User Presets work too. */
(() => {
  const P = AfterhoursPerformance,
    M = AfterhoursLiveMIDI,
    $ = id => document.getElementById('performance-midi-' + id),
    clock = new AfterhoursMIDIClock();
  const update = (key, value) =>
    P.store.update(s => {
      s.midi[key] = value;
    }, 'midi-profile');
  $('native').addEventListener('click', async () => {
    try {
      M.cancel();
      await M.connect();
      M.select('*');
      P.store.update(s => {
        s.midi.profile = 'mpk-mini-plus-ii';
        s.midi.native = true;
        if (!s.mappings.some(m => m.device === '*' && m.type === 'cc' && m.channel === 0 && m.cc === 1))
          s.mappings.push({device: '*', channel: 0, cc: 1, mode: 'direct', target: 'synth.motion'});
      }, 'midi-profile');
      window.AfterhoursMPK.reconnect();
    } catch (error) {
      $('hardware').textContent = error.message;
    }
  });
  $('native-off').addEventListener('click', () => update('native', false));
  const hardwareStatus = () => {
    $('hardware').textContent =
      window.AfterhoursMPK.status + (P.deviceSaved ? ' · Saved on this Mac' : ' · Could not save the profile');
  };
  window.addEventListener('afterhours:mpkstatus', hardwareStatus);
  hardwareStatus();
  const userMode = () => update('native', false);
  $('profile').addEventListener('change', () => {
    update('profile', $('profile').value);
    if ($('profile').value === 'mpk-mini-plus-ii') {
      P.store.update(s => {
        // Mod wheel is positional; it should respond immediately instead of pickup.
        if (!s.mappings.some(m => m.device === '*' && m.type === 'cc' && m.channel === 0 && m.cc === 1))
          s.mappings.push({device: '*', channel: 0, cc: 1, mode: 'direct', target: 'synth.motion'});
      }, 'midi-preset');
    }
  });
  const controls = AfterhoursMPKControls;
  $('bank').replaceChildren(
    ...controls.banks.map(([id, name], i) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${i + 1} · ${name}`;
      return option;
    }),
  );
  const knobLabels = Array.from({length: 8}, (_, i) => {
    const li = document.createElement('li'),
      label = document.createElement('span'),
      value = document.createElement('output');
    li.append(label, value);
    $('controls').append(li);
    return {li, label, value, i, title: null, formatted: null};
  });
  // Compare with what was written, not with the DOM: the translation layer may have replaced the text.
  let shownContext = null,
    shownMessage = null;
  function paintControls() {
    const bank = P.store.state.midi.knobBank,
      S = AfterhoursGrooveApp.S;
    const patch = AfterhoursSynth.snapshot(),
      track = AfterhoursGrooveApp.track();
    const selected =
      bank.startsWith('track-') || (bank === 'synth' && patch.family === 'groove' && patch.lane === S.selected);
    const context = selected
      ? `Track ${S.selected + 1} · ${track.name} · ${track.machine}`
      : bank.startsWith('synth')
        ? `Your instrument · ${patch.name || patch.track?.name || patch.id}`
        : controls.banks.find(b => b[0] === bank)[1];
    if (shownContext !== context) $('control-context').textContent = shownContext = context;
    for (const knob of knobLabels) {
      const {li, label, value, i} = knob;
      const t = controls.target(bank, i),
        title = `${i + 1} · ${t?.label || 'Unavailable for this sound'}`;
      const formatted = t ? controls.format(t) : '—';
      if (knob.title !== title) label.textContent = knob.title = title;
      if (knob.formatted !== formatted) value.textContent = knob.formatted = formatted;
      li.classList.toggle('unused', !t);
    }
  }
  $('bank').addEventListener('change', () => update('knobBank', $('bank').value));
  for (const [id, target] of [
    ['bank-prev', 'action.knob-bank-prev'],
    ['bank-next', 'action.knob-bank'],
  ])
    $(id).addEventListener('click', () =>
      window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target}})),
    );
  $('track-sound').addEventListener('click', () => update('knobBank', 'track-sound'));
  const padSelects = Array.from({length: 16}, (_, pad) => {
    const label = document.createElement('label'),
      select = document.createElement('select');
    label.textContent = `${pad < 8 ? 'A' : 'B'}${(pad % 8) + 1} `;
    select.setAttribute('aria-label', `Pad ${pad < 8 ? 'A' : 'B'}${(pad % 8) + 1} · track`);
    select.addEventListener('change', () =>
      P.store.update(s => {
        s.midi.pads[pad] = Number(select.value);
      }, 'midi-profile'),
    );
    label.append(select);
    $('pad-map').append(label);
    return select;
  });
  let trackNames = '';
  function paintPadMap(pads = P.store.state.midi.pads) {
    const S = AfterhoursGrooveApp.S,
      names = S.data.patterns[S.data.active].tracks.map((t, i) => `${i + 1} · ${t.name || t.machine}`);
    if (names.join('|') !== trackNames) {
      trackNames = names.join('|');
      for (const select of padSelects)
        select.replaceChildren(
          ...names.map((name, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = name;
            return option;
          }),
        );
    }
    padSelects.forEach((select, i) => {
      if (select.value !== String(pads[i])) select.value = String(pads[i]);
    });
  }
  $('beat').addEventListener('click', () => update('padMode', 'beat'));
  $('pads-reset').addEventListener('click', () =>
    P.store.update(s => {
      s.midi.pads = Array.from({length: 16}, (_, i) => i);
    }, 'midi-profile'),
  );
  // The macro panel is where people expect the knobs to act, so switch banks from there too.
  $('macros').addEventListener('click', () => update('knobBank', 'macros'));
  $('pads').addEventListener('change', () => update('padMode', $('pads').value));
  $('learn-knobs').addEventListener('click', () => {
    userMode();
    M.learn(
      Array.from({length: 8}, (_, i) => 'mpk.knob.' + i),
      $('mode').value,
    );
  });
  $('learn-pads').addEventListener('click', () => {
    userMode();
    confirmedBanks.clear();
    M.learn(
      Array.from({length: 16}, (_, i) => 'mpk.pad.' + i),
      'absolute',
      guide,
    );
  });
  const setupTargets = [
    ...Array.from({length: 8}, (_, i) => 'mpk.knob.' + i),
    ...Array.from({length: 16}, (_, i) => 'mpk.pad.' + i),
    'mpk.instrument',
    'action.play-stop',
    'action.record',
  ];
  const extraControls = {
    'action.jam-confirm': 'the central encoder (push) · start / confirm phrase',
    'action.knob-bank-prev': 'BANK − · previous knob bank',
    'action.knob-bank': 'BANK + · next knob bank',
    'action.undo': 'UNDO · undo',
    'action.redo': 'SHIFT + UNDO (Redo)',
    'action.loop': 'LOOP · loop the song',
    'action.panic': 'SHIFT + LOOP (Stop All) · stop all sound',
    'action.continue': 'SHIFT + Play/Stop (Continue)',
    'action.tap': 'TAP TEMPO · tap the tempo',
    'action.metronome': 'SHIFT + TAP TEMPO (Metronome)',
    'action.quantize': '+ (Quantize) · quantize the selected track',
    'action.keys-record': 'SHIFT + Record · record keys into the selected track',
    'action.song-prev': 'SHIFT + BANK − · previous song',
    'action.song-next': 'SHIFT + BANK + · next song',
  };
  $('extra').addEventListener('click', async () => {
    userMode();
    try {
      await M.connect();
      M.learn(Object.keys(extraControls), 'absolute', guide, true);
    } catch (error) {
      $('status').textContent = error.message;
    }
  });
  const confirmedBanks = new Set();
  let guiding = false,
    waitingBank = null,
    lastStep = null;
  function guide(step) {
    lastStep = step;
    const {target, index, total, cancelled} = step;
    waitingBank = null;
    $('bank-ready').hidden = $('skip-bank').hidden = true;
    $('guide').hidden = false;
    guiding = !!target && !cancelled;
    $('skip').hidden = $('finish').hidden = !guiding;
    if (!guiding) {
      $('instruction').textContent = cancelled ? 'Learning stopped' : 'Done! Try playing';
      $('explanation').textContent =
        'Learned assignments are saved on this Mac for all songs. Knobs control Synth, pads play Groove tracks. Run it again to relearn them.';
      if (!cancelled) $('progress').value = $('progress').max;
      return;
    }
    $('progress').max = total;
    $('progress').value = index;
    const prefix = `Step ${index + 1} of ${total} · `;
    if (target === 'mpk.instrument') {
      $('instruction').textContent = prefix + 'Turn the central encoder clockwise';
      $('explanation').textContent =
        'Don’t press it — turn it one step clockwise. After learning, clockwise selects the next Synth instrument, counter-clockwise the previous one.';
    } else if (target.startsWith('mpk.knob.')) {
      $('instruction').textContent = prefix + `Turn knob ${Number(target.split('.').at(-1)) + 1}`;
      $('explanation').textContent =
        'Turn only this knob. The prompt moves on automatically once it is assigned. Count knobs left to right, top row first, then the bottom row.';
    } else if (target.startsWith('mpk.pad.')) {
      const pad = Number(target.split('.').at(-1));
      const bank = pad < 8 ? 'A' : 'B';
      if (pad % 8 === 0 && !confirmedBanks.has(bank)) {
        M.pause();
        waitingBank = bank;
        $('instruction').textContent = `First select bank ${bank} on the MPK`;
        $('explanation').textContent =
          `Press the PAD BANK A/B button on the controller so the ${bank} indicator lights up. Then click “I’m in bank ${bank}” below. This only switches the bank — buttons and pads are not being learned right now.`;
        $('bank-ready').textContent = `I’m in bank ${bank}`;
        $('bank-ready').hidden = $('skip-bank').hidden = false;
        $('skip').hidden = true;
        return;
      }
      $('instruction').textContent = prefix + `Press pad ${(pad % 8) + 1} · bank ${pad < 8 ? 'A' : 'B'}`;
      $('explanation').textContent =
        `Bank ${bank} is already selected. Don’t press PAD BANK A/B now.` +
        ' Follow the pad numbers on the case. Press one pad at a time; leave the keys alone for now. If the bank is unavailable, skip these steps.';
    } else {
      const names = {'action.play-stop': 'Play/Stop ▶■', 'action.record': 'Record ●', ...extraControls};
      $('instruction').textContent = prefix + `Press ${names[target]}`;
      $('explanation').textContent =
        'Press the matching button on the MPK. For a SHIFT combination, hold SHIFT first, then press the button. If the command is unavailable or repeats the plain press, skip this step; the old assignment is kept. Learning does not start recording or playback.';
    }
  }
  $('auto').addEventListener('click', async () => {
    userMode();
    $('auto').disabled = true;
    M.cancel();
    confirmedBanks.clear();
    $('bank-ready').hidden = $('skip-bank').hidden = true;
    $('guide').hidden = false;
    $('skip').hidden = $('finish').hidden = true;
    $('progress').value = 0;
    $('instruction').textContent = 'Connecting MIDI…';
    $('explanation').textContent = 'The MPK must be connected over USB. If a MIDI access prompt appears, allow it.';
    try {
      await M.connect();
      if (
        !M.devices().some(
          d => /mpk[\s_-]*mini[\s_-]*plus[\s_-]*(ii|2)\b/i.test(d.name) && !/plugin|\bdin\b/i.test(d.name),
        )
      )
        throw new Error('MPK mini Plus II not found. Check USB, switch the controller on and try again.');
      M.select('*');
      $('input').value = '*';
      $('profile').value = 'mpk-mini-plus-ii';
      $('profile').dispatchEvent(new Event('change'));
      update('knobBank', 'synth');
      update('padMode', 'drums');
      M.learn(setupTargets, $('mode').value, guide);
    } catch (error) {
      $('instruction').textContent = 'Could not start learning';
      $('explanation').textContent = error.message;
    } finally {
      $('auto').disabled = false;
    }
  });
  $('bank-ready').addEventListener('click', () => {
    if (!waitingBank) return;
    confirmedBanks.add(waitingBank);
    M.resume();
    guide(lastStep);
  });
  $('skip-bank').addEventListener('click', () => {
    if (!waitingBank) return;
    for (let i = 0; i < 8; i++) M.skip();
  });
  $('skip').addEventListener('click', () => {
    if (guiding) M.skip();
  });
  $('finish').addEventListener('click', () => M.cancel());
  const paint = s => {
    $('profile').value = s.midi.profile;
    $('mpk').hidden = s.midi.profile !== 'mpk-mini-plus-ii';
    $('bank').value = s.midi.knobBank;
    const onMacros = s.midi.knobBank === 'macros';
    $('macros').setAttribute('aria-pressed', String(onMacros));
    $('macros-status').textContent = onMacros
      ? 'MPK knobs 1–8 control these macros.'
      : `MPK knobs are now on the “${AfterhoursMPKControls.banks.find(b => b[0] === s.midi.knobBank)[1]}” bank. Click the button or press BANK −/+ on the MPK until “Macros”.`;
    $('pads').value = s.midi.padMode;
    $('beat').setAttribute('aria-pressed', String(s.midi.padMode === 'beat'));
    paintPadMap(s.midi.pads);
    paintControls();
    const targets = [...setupTargets, ...Object.keys(extraControls)];
    const learned = targets.filter(t => s.mappings.some(m => m.target === t)).length;
    $('coverage').textContent = s.midi.native
      ? 'Ready DAW profile: 8 knobs, 16 pads, central encoder, transport, SHIFT, display and lights.'
      : `Learned ${learned} of ${targets.length} assignments. Unavailable buttons can be skipped.`;
  };
  P.store.subscribe(paint);
  paint(P.snapshot());
  // Also show edits made in Groove or Synth, with no DOM writes for unchanged values.
  setInterval(() => {
    if (!document.hidden && !$('controls').closest('[hidden]')) paintControls();
    if (!document.hidden) paintPadMap();
  }, 100);
  function clockError(error) {
    // Detach even if a disconnected port refuses clear()/Stop.
    clock.output = null;
    clock.running = false;
    $('clock').value = '';
    $('status').textContent = 'MIDI clock stopped · ' + error.message;
  }
  $('clock').addEventListener('change', () => {
    try {
      clock.select(M.outputs().find(o => o.id === $('clock').value) || null);
    } catch (error) {
      clockError(error);
    }
  });
  window.addEventListener('afterhours:mididevices', () => {
    const previous = $('clock').value;
    const outputs = M.outputs();
    $('clock').replaceChildren(
      ...[['', 'Off'], ...outputs.map(o => [o.id, o.name || o.id])].map(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        return option;
      }),
    );
    if (outputs.some(o => o.id === previous)) $('clock').value = previous;
    else
      try {
        clock.select(null);
      } catch (error) {
        clockError(error);
      }
  });
  setInterval(() => {
    if (shownMessage !== M.lastMessage) $('monitor').textContent = shownMessage = M.lastMessage;
    try {
      clock.tick(document.hidden ? {running: false} : AfterhoursGrooveLive.clock(), performance.now());
    } catch (error) {
      clockError(error);
    }
  }, 25);
  const stopClock = () => {
    try {
      clock.stop();
    } catch (error) {
      clockError(error);
    }
  };
  window.addEventListener('pagehide', stopClock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopClock();
  });
})();
