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
      window.AfterhoursMPK.status + (P.deviceSaved ? ' · Збережено на цьому Mac' : ' · Не вдалося зберегти профіль');
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
    return {li, label, value, i};
  });
  function paintControls() {
    const bank = P.store.state.midi.knobBank,
      S = AfterhoursGrooveApp.S;
    const patch = AfterhoursSynth.snapshot(),
      track = AfterhoursGrooveApp.track();
    const selected =
      bank.startsWith('track-') || (bank === 'synth' && patch.family === 'groove' && patch.lane === S.selected);
    const context = selected
      ? `Трек ${S.selected + 1} · ${track.name} · ${track.machine}`
      : bank.startsWith('synth')
        ? `Твій інструмент · ${patch.name || patch.track?.name || patch.id}`
        : controls.banks.find(b => b[0] === bank)[1];
    if ($('control-context').textContent !== context) $('control-context').textContent = context;
    for (const {li, label, value, i} of knobLabels) {
      const t = controls.target(bank, i),
        title = `${i + 1} · ${t?.label || 'Недоступно для цього звуку'}`;
      const formatted = t ? controls.format(t) : '—';
      if (label.textContent !== title) label.textContent = title;
      if (value.textContent !== formatted) value.textContent = formatted;
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
    select.setAttribute('aria-label', `Пед ${pad < 8 ? 'A' : 'B'}${(pad % 8) + 1} · трек`);
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
    'action.jam-confirm': 'центральну крутилку (натискання) · почати / підтвердити фразу',
    'action.knob-bank-prev': 'BANK − · попередній банк крутилок',
    'action.knob-bank': 'BANK + · наступний банк крутилок',
    'action.undo': 'UNDO · скасувати',
    'action.redo': 'SHIFT + UNDO (Redo)',
    'action.loop': 'LOOP · повторення пісні',
    'action.panic': 'SHIFT + LOOP (Stop All) · зупинити звук',
    'action.continue': 'SHIFT + Play/Stop (Continue)',
    'action.tap': 'TAP TEMPO · темп за натисканнями',
    'action.metronome': 'SHIFT + TAP TEMPO (Metronome)',
    'action.quantize': '+ (Quantize) · вирівняти вибрану доріжку',
    'action.keys-record': 'SHIFT + Record · запис клавіш у вибраний трек',
    'action.song-prev': 'SHIFT + BANK − · попередня пісня',
    'action.song-next': 'SHIFT + BANK + · наступна пісня',
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
      $('instruction').textContent = cancelled ? 'Навчання зупинено' : 'Готово! Спробуй пограти';
      $('explanation').textContent =
        'Вивчені призначення збережено на цьому Mac для всіх пісень. Крутилки керують Synth, педи — доріжками Groove. Повторний запуск дозволяє перевчити їх.';
      if (!cancelled) $('progress').value = $('progress').max;
      return;
    }
    $('progress').max = total;
    $('progress').value = index;
    const prefix = `Крок ${index + 1} з ${total} · `;
    if (target === 'mpk.instrument') {
      $('instruction').textContent = prefix + 'Поверни центральну крутилку вправо';
      $('explanation').textContent =
        'Не натискай її — саме поверни вправо на один крок. Після навчання вправо — наступний інструмент Synth, вліво — попередній.';
    } else if (target.startsWith('mpk.knob.')) {
      $('instruction').textContent = prefix + `Поверни крутилку ${Number(target.split('.').at(-1)) + 1}`;
      $('explanation').textContent =
        'Крути лише цю крутилку. Після призначення підказка зміниться автоматично. Рахуй крутилки зліва направо, верхній ряд, потім нижній.';
    } else if (target.startsWith('mpk.pad.')) {
      const pad = Number(target.split('.').at(-1));
      const bank = pad < 8 ? 'A' : 'B';
      if (pad % 8 === 0 && !confirmedBanks.has(bank)) {
        M.pause();
        waitingBank = bank;
        $('instruction').textContent = `Спочатку увімкни банк ${bank} на MPK`;
        $('explanation').textContent =
          `Натисни кнопку PAD BANK A/B на контролері, щоб засвітився індикатор ${bank}. Потім натисни «Я в банку ${bank}» нижче. Це лише перемикання банку — зараз кнопки й педи не навчаються.`;
        $('bank-ready').textContent = `Я в банку ${bank}`;
        $('bank-ready').hidden = $('skip-bank').hidden = false;
        $('skip').hidden = true;
        return;
      }
      $('instruction').textContent = prefix + `Натисни пед ${(pad % 8) + 1} · банк ${pad < 8 ? 'A' : 'B'}`;
      $('explanation').textContent =
        `Банк ${bank} вже вибраний. Кнопку PAD BANK A/B зараз не натискай.` +
        ' Орієнтуйся на номери педів на корпусі. Натискай по одному; клавіші зараз не чіпай. Якщо банк недоступний — пропускай ці кроки.';
    } else {
      const names = {'action.play-stop': 'Play/Stop ▶■', 'action.record': 'Record ●', ...extraControls};
      $('instruction').textContent = prefix + `Натисни ${names[target]}`;
      $('explanation').textContent =
        'Натисни відповідну кнопку на MPK. Для SHIFT-комбінації спочатку затисни SHIFT, тоді кнопку. Якщо команда недоступна або повторює звичайне натискання — пропусти цей крок; старе призначення збережеться. Навчання не запускає запис чи відтворення.';
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
    $('instruction').textContent = 'Підключаю MIDI…';
    $('explanation').textContent =
      'MPK має бути підключений через USB. Якщо з’явиться запит доступу до MIDI — дозволь його.';
    try {
      await M.connect();
      if (
        !M.devices().some(
          d => /mpk[\s_-]*mini[\s_-]*plus[\s_-]*(ii|2)\b/i.test(d.name) && !/plugin|\bdin\b/i.test(d.name),
        )
      )
        throw new Error('MPK mini Plus II не знайдено. Перевір USB, увімкни контролер і спробуй ще раз.');
      M.select('*');
      $('input').value = '*';
      $('profile').value = 'mpk-mini-plus-ii';
      $('profile').dispatchEvent(new Event('change'));
      update('knobBank', 'synth');
      update('padMode', 'drums');
      M.learn(setupTargets, $('mode').value, guide);
    } catch (error) {
      $('instruction').textContent = 'Не вдалося почати навчання';
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
      ? 'Крутилки 1–8 MPK керують цими макросами.'
      : `Зараз крутилки MPK у банку «${AfterhoursMPKControls.banks.find(b => b[0] === s.midi.knobBank)[1]}». Натисни кнопку або BANK −/+ на MPK до «Macros».`;
    $('pads').value = s.midi.padMode;
    $('beat').setAttribute('aria-pressed', String(s.midi.padMode === 'beat'));
    paintPadMap(s.midi.pads);
    paintControls();
    const targets = [...setupTargets, ...Object.keys(extraControls)];
    const learned = targets.filter(t => s.mappings.some(m => m.target === t)).length;
    $('coverage').textContent = s.midi.native
      ? 'Готовий DAW-профіль: 8 крутилок, 16 педів, центральний енкодер, транспорт, SHIFT, дисплей і світло.'
      : `Навчено ${learned} з ${targets.length} призначень. Недоступні кнопки можна пропускати.`;
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
    if ($('monitor').textContent !== M.lastMessage) $('monitor').textContent = M.lastMessage;
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
