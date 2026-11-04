'use strict';
/* Performance UI, scene clock, gesture timeline and local take storage. */
(() => {
  const P = AfterhoursPerformance,
    Core = P.core,
    C = AfterhoursController,
    A = AfterhoursAudio,
    S = AfterhoursShell,
    M = AfterhoursLiveMIDI;
  const $ = id => document.getElementById('performance-' + id),
    store = P.store,
    clone = Core.clone;
  const message = (text, error = false) => {
    $('status').textContent = text;
    S.status(text, error ? 'err' : 'ok');
  };
  const button = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  const option = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const attempt = fn => async () => {
    try {
      await fn();
    } catch (e) {
      message(e.message, true);
    }
  };
  const open = value => {
    $('panel').hidden = !value;
    $('toggle').setAttribute('aria-expanded', String(value));
  };
  $('toggle').addEventListener('click', () => open($('panel').hidden));
  $('close').addEventListener('click', () => {
    open(false);
    $('toggle').focus();
  });
  $('undo').addEventListener('click', () => store.undo());
  $('redo').addEventListener('click', () => store.redo());
  document.addEventListener('keydown', e => {
    if (
      !(e.metaKey || e.ctrlKey) ||
      e.key.toLowerCase() !== 'z' ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ||
      e.target.isContentEditable
    )
      return;
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  });
  let holdKey = null;
  const hold = $('hold'),
    begin = () => {
      store.beginHold();
      hold.setAttribute('aria-pressed', 'true');
      message('Experiment held · release to return to your saved sound');
    },
    end = () => {
      holdKey = null;
      store.endHold();
      hold.setAttribute('aria-pressed', 'false');
    };
  hold.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    hold.setPointerCapture(e.pointerId);
    begin();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(event, end);
  hold.addEventListener('keydown', e => {
    if (['Enter', 'Space'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) {
        holdKey = e.code;
        begin();
      }
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === holdKey) {
      e.preventDefault();
      end();
    }
  });
  window.addEventListener('blur', end);
  $('target').addEventListener('change', () =>
    store.update(s => {
      s.controllerTarget = $('target').value;
    }, 'controller-target'),
  );
  $('save-setup').addEventListener('click', () => {
    const name = $('setup-name').value.trim();
    if (!name) {
      message('Name your controller setup first', true);
      return;
    }
    const s = P.snapshot();
    if (s.setups.length >= 24 && !s.setups.some(p => p.name === name)) {
      message('24 setups saved · delete one to make room', true);
      return;
    }
    store.update(v => {
      const i = v.setups.findIndex(p => p.name === name),
        next = {name, controller: C.snapshot()};
      if (i < 0) v.setups.push(next);
      else v.setups[i] = next;
    }, 'save-setup');
    message('Controller setup saved with this project');
  });
  $('recall-setup').addEventListener('click', () => {
    const setup = P.snapshot().setups[Number($('setups').value)];
    if (setup) C.change({...setup.controller, bend: 0});
  });
  $('delete-setup').addEventListener('click', () =>
    store.update(s => {
      s.setups.splice(Number($('setups').value), 1);
    }, 'delete-setup'),
  );
  const macroKnobs = [];
  Core.macroNames.forEach((name, i) => {
    const k = S.knob({
      performanceId: 'macro.' + i,
      label: 'Macro ' + name,
      name,
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      format: v => Math.round(v * 100) + '%',
      onInput: v =>
        store.update(s => {
          s.macros[i] = v;
        }, 'macro-' + i),
      onReset: () =>
        store.update(s => {
          s.macros[i] = 0;
        }, 'macro-' + i),
    });
    macroKnobs.push(k);
    $('macros').append(k.el);
  });
  const laneButtons = [];
  for (let i = 0; i < 16; i++) {
    const b = button(String(i + 1), () =>
      store.update(s => {
        s.targets = s.targets.includes(i) ? s.targets.filter(n => n !== i) : [...s.targets, i];
      }, 'target-lane'),
    );
    b.setAttribute('aria-label', 'Macro target lane ' + (i + 1));
    laneButtons.push(b);
    $('lanes').append(b);
  }
  for (const [id, group] of [
    ['target-all', 'all'],
    ['target-drums', 'drums'],
    ['target-music', 'music'],
  ])
    $(id).addEventListener('click', () => {
      const project = AfterhoursGrooveLive.snapshot().project,
        tracks = project.patterns[project.active].tracks;
      store.update(s => {
        s.targets = tracks.flatMap((t, i) => {
          const drum = ['Kick', 'Snare', 'Metal', 'Perc'].includes(t.machine);
          return group === 'all' || (group === 'drums') === drum ? [i] : [];
        });
      }, 'macro-targets');
    });
  $('macros-reset').addEventListener('click', () =>
    store.update(s => {
      s.macros = Array(8).fill(0);
    }, 'reset-macros'),
  );
  let transition = null,
    replaying = false;
  const sceneInputs = [];
  for (let i = 0; i < 8; i++) {
    const host = document.createElement('div');
    host.className = 'performance-scene';
    const name = document.createElement('input');
    name.maxLength = 40;
    name.setAttribute('aria-label', 'Scene ' + (i + 1) + ' name');
    name.addEventListener('change', () =>
      store.update(s => {
        s.scenes[i].name = name.value;
      }, 'scene-name-' + i),
    );
    const recall = button('Recall', () => {
      const s = P.snapshot(),
        clock = AfterhoursGrooveLive.clock();
      A.context()
        .resume()
        .catch(e => message(e.message, true));
      transition = {
        from: s,
        to: clone(s.scenes[i]),
        start: clock.running ? Math.ceil((clock.beat + 0.001) / 4) * 4 : beat(),
        duration: s.morphBars * 4,
        index: i,
        running: clock.running,
      };
      $('scene-status').textContent = clock.running
        ? `${s.scenes[i].name} · queued for next bar`
        : `Morphing to ${s.scenes[i].name}`;
    });
    recall.setAttribute('aria-label', 'Recall scene ' + (i + 1));
    const capture = button('Capture', () =>
      store.update(s => {
        s.scenes[i] = {
          name: name.value,
          controller: C.snapshot(),
          macros: s.macros.slice(),
          targets: s.targets.slice(),
        };
      }, 'capture-scene-' + i),
    );
    capture.setAttribute('aria-label', 'Capture scene ' + (i + 1));
    host.append(name, recall, capture);
    sceneInputs.push(name);
    $('scenes').append(host);
  }
  $('bars').addEventListener('change', () =>
    store.update(s => {
      s.morphBars = Number($('bars').value);
    }, 'morph-bars'),
  );
  $('cancel-scene').addEventListener('click', () => {
    transition = null;
    $('scene-status').textContent = 'Transition cancelled · current sound kept';
  });
  // Mixer targets exist for all lanes, independent of the lane currently shown.
  const mixControls = {
    level: ['Level', 0, 1.5, 0.01],
    pan: ['Pan', -1, 1, 0.01],
    low: ['Low EQ', -18, 18, 0.5],
    mid: ['Mid EQ', -18, 18, 0.5],
    high: ['High EQ', -18, 18, 0.5],
    delay: ['Delay send', 0, 1, 0.01],
    reverb: ['Reverb send', 0, 1, 0.01],
  };
  let mixerLane = 0;
  const mixerKnobs = new Map();
  for (let i = 0; i < 16; i++) {
    $('mixer-lane').append(option(i, 'Lane ' + (i + 1)));
    for (const [key, [name, min, max]] of Object.entries(mixControls))
      P.register(`mixer.${i}.${key}`, {
        label: `Lane ${i + 1} ${name}`,
        min,
        max,
        get: () => P.snapshot().mixer.lanes[i][key],
        set: value =>
          store.update(s => {
            s.mixer.lanes[i][key] = value;
          }, `mixer-${i}-${key}`),
      });
  }
  for (const [key, [name, min, max, step]] of Object.entries(mixControls)) {
    const k = (key === 'level' ? S.fader : S.knob)({
      label: 'Mixer ' + name,
      name,
      min,
      max,
      step,
      value: P.snapshot().mixer.lanes[0][key],
      format: v => (['low', 'mid', 'high'].includes(key) ? v.toFixed(1) + ' dB' : Math.round(v * 100) + '%'),
      onInput: v => P.targets.get(`mixer.${mixerLane}.${key}`).set(v),
    });
    k.ring.addEventListener('contextmenu', e => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('afterhours:midilearn', {detail: `mixer.${mixerLane}.${key}`}));
    });
    mixerKnobs.set(key, k);
    $('mixer').append(k.el);
  }
  $('mixer-lane').addEventListener('change', () => {
    mixerLane = Number($('mixer-lane').value);
    paint(P.snapshot());
  });
  for (const key of ['mute', 'solo'])
    $('mixer-' + key).addEventListener('click', () =>
      store.update(s => {
        s.mixer.lanes[mixerLane][key] = !s.mixer.lanes[mixerLane][key];
      }, 'mixer-' + key),
    );
  for (const [id, key] of [
    ['drum-level', 'drums'],
    ['music-level', 'music'],
  ])
    $(id).addEventListener('input', () =>
      store.update(s => {
        s.mixer[key] = Number($(id).value) / 100;
      }, 'group-' + key),
    );
  const meters = [];
  for (let i = 0; i < 16; i++) {
    const label = document.createElement('label');
    label.textContent = String(i + 1);
    const meter = document.createElement('meter');
    meter.min = 0;
    meter.max = 1;
    meter.high = 0.9;
    meter.optimum = 0.4;
    meter.setAttribute('aria-label', 'Lane ' + (i + 1) + ' peak');
    label.append(meter);
    meters.push(meter);
    $('lane-meters').append(label);
  }
  const modInputs = [];
  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'performance-mod';
    const fields = {};
    for (const [key, values] of [
      ['source', ['sine', 'triangle', 'random', 'envelope', 'amplitude']],
      ['target', ['cutoff', 'motion', 'space', 'drive', 'cents']],
      ['beats', [0.25, 0.5, 1, 2, 4, 8, 16, 32]],
      ['lane', Array.from({length: 16}, (_, n) => n)],
    ]) {
      const label = document.createElement('label');
      label.textContent = key === 'beats' ? 'Period (beats)' : key === 'lane' ? 'Source lane' : key;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Mod ${i + 1} ${key}`);
      for (const v of values) select.append(option(v, key === 'lane' ? String(v + 1) : String(v)));
      label.append(select);
      row.append(label);
      fields[key] = select;
      select.addEventListener('change', () =>
        updateMod(i, key, ['beats', 'lane'].includes(key) ? Number(select.value) : select.value),
      );
    }
    const label = document.createElement('label');
    label.textContent = 'Depth';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = 0;
    input.max = 100;
    input.value = 0;
    input.setAttribute('aria-label', `Mod ${i + 1} depth`);
    label.append(input);
    row.append(label);
    fields.depth = input;
    input.addEventListener('input', () => updateMod(i, 'depth', Number(input.value) / 100));
    modInputs.push(fields);
    $('mods').append(row);
  }
  function updateMod(i, key, value) {
    store.update(
      s => {
        while (s.mods.length <= i)
          s.mods.push({source: 'sine', target: 'cutoff', depth: 0, beats: 4, lane: 0, enabled: true});
        s.mods[i][key] = value;
      },
      'mod-' + i + '-' + key,
    );
  }
  let midiOptions = '';
  function refreshTargets() {
    const signature = [...P.targets.keys()].join('|');
    if (signature === midiOptions) return;
    midiOptions = signature;
    const old = $('midi-target').value;
    $('midi-target').replaceChildren(...[...P.targets].map(([id, t]) => option(id, t.label)));
    if (P.targets.has(old)) $('midi-target').value = old;
  }
  window.addEventListener('afterhours:midilearn', e => {
    open(true);
    $('midi-connect').closest('details').open = true;
    refreshTargets();
    if (P.targets.has(e.detail)) $('midi-target').value = e.detail;
  });
  $('midi-connect').addEventListener(
    'click',
    attempt(() => M.connect()),
  );
  $('midi-learn').addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('afterhours:midilearn', {detail: $('midi-target').value})),
  );
  $('midi-cancel').addEventListener('click', () => M.cancel());
  $('midi-input').addEventListener('change', () => M.select($('midi-input').value));
  $('midi-clear').addEventListener('click', () =>
    store.update(s => {
      s.mappings = [];
    }, 'midi-clear'),
  );
  $('midi-preset').addEventListener('click', () =>
    store.update(s => {
      s.mappings = Array.from({length: 8}, (_, i) => ({device: '*', channel: 0, cc: 20 + i, target: 'macro.' + i}));
    }, 'midi-preset'),
  );
  window.addEventListener('afterhours:midistatus', e => {
    $('midi-status').textContent = e.detail;
  });
  window.addEventListener('afterhours:mididevices', () => {
    const old = $('midi-input').value;
    $('midi-input').replaceChildren(option('*', 'All MIDI inputs'), ...M.devices().map(d => option(d.id, d.name)));
    if (M.devices().some(d => d.id === old)) $('midi-input').value = old;
    else M.select('*');
  });
  let setupSignature = '',
    mappingSignature = '';
  function paint(s) {
    $('undo').disabled = !store.past.length || !!store.hold;
    $('redo').disabled = !store.future.length || !!store.hold;
    $('target').value = s.controllerTarget;
    macroKnobs.forEach((k, i) => k.set(s.macros[i]));
    laneButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(s.targets.includes(i))));
    const setups = JSON.stringify(s.setups);
    if (setups !== setupSignature) {
      setupSignature = setups;
      const old = $('setups').value;
      $('setups').replaceChildren(...s.setups.map((p, i) => option(i, p.name)));
      if (s.setups[Number(old)]) $('setups').value = old;
    }
    $('recall-setup').disabled = $('delete-setup').disabled = !s.setups.length;
    sceneInputs.forEach((input, i) => {
      if (document.activeElement !== input) input.value = s.scenes[i].name;
    });
    $('bars').value = s.morphBars;
    const channel = s.mixer.lanes[mixerLane];
    for (const [key, k] of mixerKnobs) k.set(channel[key]);
    for (const key of ['mute', 'solo']) $('mixer-' + key).setAttribute('aria-pressed', String(channel[key]));
    $('drum-level').value = s.mixer.drums * 100;
    $('music-level').value = s.mixer.music * 100;
    modInputs.forEach((fields, i) => {
      const m = s.mods[i] || {source: 'sine', target: 'cutoff', depth: 0, beats: 4, lane: 0};
      for (const [k, input] of Object.entries(fields)) input.value = k === 'depth' ? m.depth * 100 : m[k];
    });
    const mappings = JSON.stringify(s.mappings);
    if (mappings !== mappingSignature) {
      mappingSignature = mappings;
      $('midi-mappings').replaceChildren(
        ...s.mappings.map(m => {
          const item = document.createElement('li');
          item.textContent = `${m.device} · ch ${m.channel + 1} CC ${m.cc} → ${P.targets.get(m.target)?.label || m.target}`;
          return item;
        }),
      );
    }
  }
  // Audio clock drives modulation and scene interpolation; UI updates are throttled.
  function beat() {
    const g = AfterhoursGrooveLive.clock();
    return g.running ? g.beat : (A.context().currentTime * g.bpm) / 60;
  }
  function updateMotion() {
    let s = store.state;
    const hasMotion = s.mods.some(m => m.enabled && m.depth > 0);
    if (!transition && !hasMotion) {
      C.overlay({});
      return;
    }
    const clock = AfterhoursGrooveLive.clock();
    if (transition && clock.running !== transition.running) {
      transition = null;
      $('scene-status').textContent = 'Transition cancelled · transport changed';
    }
    const position = beat();
    if (transition && !replaying && position >= transition.start) {
      const t = transition,
        p = Math.min(1, (position - t.start) / t.duration);
      store.update(v => {
        for (const key of Object.keys(C.controls))
          v.controller[key] = t.from.controller[key] + (t.to.controller[key] - t.from.controller[key]) * p;
        for (const key of ['scale', 'temperament', 'root', 'enabled']) v.controller[key] = t.to.controller[key];
        v.targets = t.to.targets.slice();
        v.macros = t.from.macros.map((n, i) => n + (t.to.macros[i] - n) * p);
      }, 'scene-morph');
      if (p === 1) {
        $('scene-status').textContent = `${t.to.name} · ready`;
        transition = null;
      }
      s = P.snapshot();
    }
    const levels = hasMotion ? AfterhoursGrooveLive.levels() : [],
      overlay = {};
    for (const m of s.mods)
      if (m.enabled && m.depth > 0) {
        const phase = position / m.beats,
          part = phase - Math.floor(phase);
        let value;
        if (m.source === 'sine') value = Math.sin(phase * Math.PI * 2);
        if (m.source === 'triangle') value = 1 - 4 * Math.abs(part - 0.5);
        if (m.source === 'envelope') value = Math.exp(-part * 7);
        if (m.source === 'random') {
          const seed = Math.sin(Math.floor(phase) * 127.1 + m.lane * 311.7 + 7) * 43758.5453;
          value = (seed - Math.floor(seed)) * 2 - 1;
        }
        if (m.source === 'amplitude') value = Math.min(1, (levels[m.lane] || 0) * 4);
        const range = m.target === 'cutoff' ? 45 : m.target === 'cents' ? 40 : 1,
          control = C.controls[m.target];
        overlay[m.target] = Math.max(
          control.min,
          Math.min(control.max, (overlay[m.target] ?? s.controller[m.target]) + value * m.depth * range),
        );
      }
    C.overlay(overlay);
  }
  const library = AfterhoursTakeLibrary;
  let entry = null,
    entries = [],
    libraryReady = false,
    unsaved = false;
  let take = null,
    audioBlob = null,
    audioURL = null,
    recording = null,
    busy = false,
    replay = null;
  function setAudio(blob) {
    audioBlob = blob;
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = blob ? URL.createObjectURL(blob) : null;
    if (audioURL) $('player').src = audioURL;
    else {
      $('player').removeAttribute('src');
      $('player').load();
    }
  }
  const timeLabel = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  async function refreshLibrary() {
    entries = await library.list();
    $('takes').replaceChildren(
      ...(entries.length
        ? entries.map(r => option(r.id, `${r.name} · ${timeLabel(r.duration)}${r.hasAudio ? '' : ' · gestures only'}`))
        : [option('', 'No saved performances yet')]),
    );
    if (entry) $('takes').value = entry.id;
  }
  function selectEntry(record) {
    $('player').pause();
    entry = record;
    take = record ? validateTake(record.take) : null;
    unsaved = false;
    setAudio(record?.audio instanceof Blob ? record.audio : null);
    $('take-name').value = take?.name || '';
    $('takes').value = entry?.id || '';
    $('loop-part').setAttribute('aria-pressed', 'false');
    renderParts();
    renderEvents();
    paintTake();
  }
  async function persist(value) {
    const record = {...entry, ...value};
    await library.save(record);
    entry = record;
    unsaved = false;
    await refreshLibrary();
  }
  async function addTake(value, audio, extra = {}) {
    const record = library.create(value, audio, extra);
    try {
      await library.save(record);
    } catch (e) {
      selectEntry(record);
      unsaved = true;
      paintTake();
      throw e;
    }
    selectEntry(record);
    await refreshLibrary();
  }
  async function editTake(next) {
    const value = validateTake(next);
    await persist({take: value, audio: audioBlob});
    take = value;
    $('take-name').value = take.name;
    renderEvents();
    paintTake();
  }
  $('takes').addEventListener(
    'change',
    attempt(async () => {
      if (busy || recording || replaying || unsaved) return;
      const id = $('takes').value;
      busy = true;
      paintTake();
      try {
        const record = await library.load(id);
        if (!record) throw new Error('This take is no longer in the library');
        validateTake(record.take);
        await library.select(id);
        selectEntry(record);
        message(`${take.name} · ready to play`);
      } finally {
        busy = false;
        $('takes').value = entry?.id || '';
        paintTake();
      }
    }),
  );
  $('rename-take').addEventListener(
    'click',
    attempt(async () => {
      if (!take || busy || recording || replaying) return;
      const name = $('take-name').value.trim();
      if (!name) throw new Error('Give this take a name first');
      busy = true;
      paintTake();
      try {
        await editTake({...take, name});
        message('Take name saved');
      } finally {
        busy = false;
        paintTake();
      }
    }),
  );
  function selectedPart() {
    return take?.parts.find(p => p.id === $('parts').value);
  }
  function renderParts(selected = '') {
    $('parts').replaceChildren(
      option('', 'Whole take'),
      ...(take?.parts || []).map(p => option(p.id, `${p.name} · ${p.start.toFixed(2)}–${p.end.toFixed(2)}s`)),
    );
    $('parts').value = selected;
    showPart();
  }
  function showPart() {
    const p = selectedPart();
    $('part-name').value = p?.name || '';
    $('part-start').value = p?.start ?? 0;
    $('part-end').value = p?.end ?? (take ? Math.floor(take.duration * 100) / 100 : 0);
    $('play-part').textContent = p ? 'Play selected part' : 'Play take';
    paintPart();
  }
  function paintPart() {
    const active = busy || !!recording || replaying;
    for (const id of ['parts', 'part-name', 'part-start', 'part-end', 'save-part', 'new-part'])
      $(id).disabled = active || !take;
    $('delete-part').disabled = active || !selectedPart();
    for (const id of ['play-part', 'loop-part', 'mark-start', 'mark-end']) $(id).disabled = active || !audioBlob;
    $('stop-player').disabled = $('player').paused;
    $('audio-hint').textContent = unsaved
      ? 'Not saved: export this take, or use Save name to retry.'
      : !take
        ? 'Your recording will appear here.'
        : audioBlob
          ? 'Play the whole take, or select a named part below.'
          : 'Gestures only · open Gesture replay & editing and render to create playable audio.';
  }
  $('parts').addEventListener('change', () => {
    $('player').pause();
    showPart();
  });
  $('new-part').addEventListener('click', () => {
    $('player').pause();
    $('parts').value = '';
    showPart();
    $('part-name').focus();
  });
  for (const edge of ['start', 'end'])
    $('mark-' + edge).addEventListener('click', () => {
      $('part-' + edge).value = String(Math.floor($('player').currentTime * 100) / 100);
    });
  $('save-part').addEventListener(
    'click',
    attempt(async () => {
      if (!take || busy || recording || replaying) return;
      const name = $('part-name').value.trim();
      if (!name) throw new Error('Name this part, for example Intro or Chorus');
      const id = selectedPart()?.id || crypto.randomUUID(),
        next = clone(take);
      next.parts = next.parts.filter(p => p.id !== id);
      next.parts.push({id, name, start: $('part-start').valueAsNumber, end: $('part-end').valueAsNumber});
      busy = true;
      paintTake();
      try {
        await editTake(next);
        renderParts(id);
        message(`${name} saved · select Play selected part to listen`);
      } finally {
        busy = false;
        paintTake();
      }
    }),
  );
  $('delete-part').addEventListener(
    'click',
    attempt(async () => {
      const part = selectedPart();
      if (!part || busy || recording || replaying) return;
      busy = true;
      paintTake();
      try {
        $('player').pause();
        await editTake({...take, parts: take.parts.filter(p => p.id !== part.id)});
        renderParts();
        message('Part removed · recorded audio kept');
      } finally {
        busy = false;
        paintTake();
      }
    }),
  );
  const player = $('player');
  let playbackFrame;
  function playbackBounds() {
    const p = selectedPart();
    return {
      start: p?.start || 0,
      end: Math.min(p?.end ?? take?.duration ?? 0, Number.isFinite(player.duration) ? player.duration : Infinity),
    };
  }
  function looping() {
    return $('loop-part').getAttribute('aria-pressed') === 'true';
  }
  function checkPlayback() {
    if (player.paused) return;
    const {start, end} = playbackBounds();
    if (end > start && player.currentTime >= end) {
      if (looping()) {
        player.currentTime = start;
        if (player.ended) player.play().catch(e => message(e.message, true));
      } else {
        player.pause();
        player.currentTime = end;
      }
    }
  }
  function followPlayback() {
    checkPlayback();
    if (!player.paused) playbackFrame = requestAnimationFrame(followPlayback);
  }
  player.addEventListener('play', () => {
    if (recording || replaying || busy) {
      player.pause();
      return;
    }
    // Audition the saved take on its own, rather than doubling live engines.
    AfterhoursGrooveLive.stop();
    AfterhoursSynth.panic();
    document.getElementById('audio').pause();
    const {start, end} = playbackBounds();
    if (player.currentTime < start || player.currentTime >= end) player.currentTime = start;
    cancelAnimationFrame(playbackFrame);
    followPlayback();
    paintPart();
  });
  player.addEventListener('pause', () => {
    cancelAnimationFrame(playbackFrame);
    paintPart();
  });
  player.addEventListener('timeupdate', checkPlayback);
  player.addEventListener('ended', () => {
    if (looping() && !recording && !replaying && !busy) {
      player.currentTime = playbackBounds().start;
      player.play().catch(e => message(e.message, true));
    }
  });
  $('play-part').addEventListener(
    'click',
    attempt(async () => {
      if (!audioBlob || busy || recording || replaying) return;
      player.currentTime = playbackBounds().start;
      await player.play();
    }),
  );
  $('stop-player').addEventListener('click', () => {
    player.pause();
    player.currentTime = playbackBounds().start;
  });
  $('loop-part').addEventListener('click', () => {
    $('loop-part').setAttribute('aria-pressed', String(!looping()));
  });
  const stateKeys = ['controller', 'macros', 'targets', 'controllerTarget', 'mixer', 'mods'];
  let previous = P.snapshot();
  store.subscribe((s, reason) => {
    if (transition && reason !== 'scene-morph') transition = null;
    if (recording && !replaying) {
      const delta = {};
      for (const k of stateKeys) if (JSON.stringify(previous[k]) !== JSON.stringify(s[k])) delta[k] = s[k];
      if (Object.keys(delta).length) capture('state', delta);
    }
    previous = s;
    paint(s);
  });
  window.addEventListener('afterhours:gesture', e => {
    if (!replaying) capture(e.detail.type, e.detail.value);
  });
  function capture(type, value) {
    if (!recording) return;
    const time = Math.max(0, A.context().currentTime - recording.start);
    if (time > 300 || recording.events.length >= 20000) {
      finishRecording().catch(e => message(e.message, true));
      return;
    }
    const event = {time, type, value: clone(value)},
      bytes = new TextEncoder().encode(JSON.stringify(event)).length;
    if (recording.bytes + bytes > 12 * 1024 * 1024) {
      finishRecording().catch(e => message(e.message, true));
      return;
    }
    recording.bytes += bytes;
    recording.events.push(event);
  }
  function snapshot() {
    const groove = AfterhoursGrooveLive.snapshot();
    groove.project.performance = P.snapshot();
    return {groove, synth: AfterhoursSynth.snapshot(), held: AfterhoursSynth.held(), bend: C.snapshot().bend};
  }
  function validateTake(raw) {
    const value = Core.take(raw, AfterhoursGroove.validate, AfterhoursGrooveInstrument.validate),
      ids = new Set(['groove-part', ...AfterhoursSynthAudio.presets.map(p => p.id)]);
    if (!ids.has(value.initial.synth.id) || value.events.some(e => e.type === 'patch' && !ids.has(e.value.id)))
      throw new Error('This take contains an unknown synth patch');
    return value;
  }
  async function startRecording() {
    if (busy || recording || replaying || !libraryReady || unsaved) return;
    busy = true;
    paintTake();
    $('player').pause();
    try {
      await A.arm();
      const initial = snapshot(),
        start = await A.start();
      recording = {
        version: 1,
        kind: 'afterhours-performance',
        name: $('record-name').value.trim() || `Take ${new Date().toLocaleString()}`,
        initial,
        start,
        events: [],
        parts: [],
        bytes: 0,
      };
      message('Recording audio + gestures · play keys, shape sounds and change sections');
    } finally {
      busy = false;
      paintTake();
    }
  }
  async function finishRecording() {
    if (!recording || busy) return;
    busy = true;
    try {
      const result = await A.stop();
      const completed = recording;
      recording = null;
      completed.duration = Math.min(300, (result.end - result.start) / result.rate);
      delete completed.start;
      delete completed.bytes;
      completed.events = completed.events.filter(e => e.time <= completed.duration);
      await addTake(validateTake(completed), A.wav(result.chunks, result.start, result.end, result.rate));
      $('record-name').value = '';
      message('Take saved locally · select any recording in Saved performances');
    } finally {
      busy = false;
      paintTake();
    }
  }
  $('arm').addEventListener(
    'click',
    attempt(async () => {
      await A.arm();
      message('Rolling capture armed · Save last 60 seconds keeps the audio you just played');
      paintTake();
    }),
  );
  $('record').addEventListener('click', attempt(startRecording));
  $('stop').addEventListener(
    'click',
    attempt(async () => {
      if (recording) await finishRecording();
      if (replaying) await stopReplay();
      $('player').pause();
    }),
  );
  window.addEventListener('afterhours:recordlimit', () => finishRecording().catch(e => message(e.message, true)));
  const takeFilename = () =>
    (take?.name || 'afterhours-performance')
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 80) || 'afterhours-performance';
  $('audio').addEventListener('click', () => {
    if (audioBlob) download(audioBlob, takeFilename() + '.wav');
  });
  $('last').addEventListener(
    'click',
    attempt(async () => {
      const blob = await A.lastMinute();
      download(blob, 'afterhours-last-60-seconds.wav');
      message('Recent audio saved · up to 60 seconds since capture was armed');
    }),
  );
  $('export').addEventListener('click', () => {
    if (take) download(new Blob([JSON.stringify(take)], {type: 'application/json'}), takeFilename() + '.json');
  });
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener(
    'change',
    attempt(async () => {
      const file = $('file').files[0];
      if (!file) return;
      if (busy || recording || replaying || unsaved) {
        $('file').value = '';
        return;
      }
      busy = true;
      paintTake();
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error('Performance file limit is 16 MiB');
        const imported = validateTake(JSON.parse(await file.text()));
        await addTake(imported, null);
        message('Performance gestures loaded as a new take · render replay to create audio');
      } finally {
        busy = false;
        $('file').value = '';
        paintTake();
      }
    }),
  );
  $('delete-take').addEventListener(
    'click',
    attempt(async () => {
      if (
        !entry ||
        busy ||
        recording ||
        replaying ||
        !window.confirm(
          `Delete “${take.name}” and its parts? This cannot be undone. Other takes will stay in your library.`,
        )
      )
        return;
      busy = true;
      paintTake();
      player.pause();
      try {
        await library.remove(entry.id);
        selectEntry(null);
        await refreshLibrary();
        if (entries.length) {
          const next = await library.load(entries[0].id);
          await library.select(next.id);
          selectEntry(next);
        }
        message('Take deleted · other recordings kept');
      } finally {
        busy = false;
        paintTake();
      }
    }),
  );
  function renderEvents() {
    const selected = $('events').value;
    $('events').replaceChildren(
      ...(take?.events || []).map((e, i) =>
        option(
          i,
          `${e.time.toFixed(2)}s · ${e.type}${e.type === 'state' ? ' · ' + Object.keys(e.value).join(', ') : ''}`,
        ),
      ),
    );
    if (take?.events[Number(selected)]) $('events').value = selected;
    showEvent();
  }
  function showEvent() {
    const e = take?.events[Number($('events').value)];
    $('event-time').value = e ? e.time.toFixed(2) : '';
    $('event-move').disabled = $('event-delete').disabled = !e || busy || replaying || !!recording;
  }
  $('events').addEventListener('change', showEvent);
  async function editEvent(remove) {
    if (!take || busy || recording || replaying) return;
    const i = Number($('events').value),
      next = clone(take),
      event = next.events[i];
    if (!event) return;
    if (remove) next.events.splice(i, 1);
    else {
      const time = $('event-time').valueAsNumber;
      if (!Number.isFinite(time) || time < 0 || time > take.duration) throw new Error('Choose a time within this take');
      event.time = time;
      next.events.sort((a, b) => a.time - b.time);
    }
    busy = true;
    paintTake();
    try {
      await editTake(next);
      message('Gesture edit saved · replay to hear the change');
    } finally {
      busy = false;
      paintTake();
    }
  }
  $('event-move').addEventListener(
    'click',
    attempt(() => editEvent(false)),
  );
  $('event-delete').addEventListener(
    'click',
    attempt(() => editEvent(true)),
  );
  async function applyEvent(e, r) {
    if (replay !== r) return;
    const v = e.value;
    switch (e.type) {
      case 'state':
        store.update(s => Object.assign(s, v), 'replay');
        break;
      case 'noteOn':
        await AfterhoursSynth.on(v.id, v.note, v.velocity);
        if (replay === r) r.notes.add(v.id);
        break;
      case 'noteOff':
        AfterhoursSynth.off(v.id);
        r.notes.delete(v.id);
        break;
      case 'bend':
        C.change({bend: v});
        break;
      case 'tempo':
        S.getEngine('groove').tempo().set(v);
        break;
      case 'transport':
        if (v === 'play') await AfterhoursGrooveLive.play();
        else if (v === 'rewind') S.getEngine('groove').start();
        else AfterhoursGrooveLive.stop();
        break;
      case 'pattern':
        AfterhoursGrooveLive.pattern(v);
        break;
      case 'continuous':
        AfterhoursGrooveLive.continuous(v);
        break;
      case 'section':
        AfterhoursGrooveLive.section(v);
        break;
      case 'patch':
        AfterhoursSynth.patch(v);
        break;
      case 'synthControl':
        AfterhoursSynth.control(v.key, v.value);
        break;
      case 'expression':
        for (const n of AfterhoursSynth.held())
          if (n.id.startsWith(v.prefix) && (v.note === undefined || n.note === v.note))
            AfterhoursSynth.expression(n.id, v.type, v.value);
        break;
      case 'panic':
        AfterhoursSynth.panic();
        break;
    }
  }
  async function startReplay(print = false) {
    if (!take || recording || replaying || busy) return;
    busy = true;
    paintTake();
    $('player').pause();
    transition = null;
    let r;
    try {
      take = validateTake(take);
      end();
      AfterhoursGrooveLive.flush();
      const media = document.getElementById('audio');
      r = {
        before: snapshot(),
        history: {past: clone(store.past), future: clone(store.future)},
        listen: {paused: media.paused, time: media.currentTime},
        start: A.context().currentTime,
        index: 0,
        notes: new Set(),
        processing: false,
        ready: false,
        print,
        printStarted: false,
        capture: new AbortController(),
      };
      replay = r;
      replaying = true;
      await AfterhoursSynth.prepare();
      // Loading must finish before capture and the replay clock, including later patch changes.
      const patches = [take.initial.synth, ...take.events.filter(e => e.type === 'patch').map(e => e.value)];
      await AfterhoursInstruments.prepare([
        {tracks: patches.map(p => p.track).filter(t => t?.machine === 'Instrument')},
      ]);
      if (replay !== r) return;
      media.pause();
      M.release();
      AfterhoursSynth.panic();
      AfterhoursGrooveLive.restore(take.initial.groove);
      AfterhoursSynth.patch(take.initial.synth);
      C.change({bend: take.initial.bend});
      if (print) {
        await A.arm();
        if (replay !== r) return;
        await A.start(r.capture.signal);
        if (replay !== r) {
          A.cancel(r.capture.signal);
          return;
        }
        r.printStarted = true;
      }
      if (take.initial.groove.running) await AfterhoursGrooveLive.play();
      if (replay !== r) return;
      r.start = A.context().currentTime + (take.initial.groove.running ? 0.25 : 0);
      for (const n of take.initial.held) {
        await AfterhoursSynth.on(n.id, n.note, n.velocity, r.start);
        if (replay !== r) return;
        AfterhoursSynth.expression(n.id, 'bend', n.bend);
        AfterhoursSynth.expression(n.id, 'pressure', n.pressure);
        r.notes.add(n.id);
      }
      r.ready = true;
      message('Replaying Groove + Synth gestures · original WAV also includes Listen audio');
    } catch (e) {
      const canceled = r?.capture.signal.aborted;
      if (replay === r && r) await stopReplay();
      if (!canceled) throw e;
    } finally {
      if (!r || replay === r) busy = false;
      paintTake();
    }
  }
  async function stopReplay(completed = false) {
    const old = replay;
    if (!old) return;
    replay = null;
    busy = true;
    old.capture.abort();
    try {
      let rendered;
      try {
        if (old.printStarted) rendered = await A.stop();
      } finally {
        A.cancel(old.capture.signal);
        try {
          AfterhoursSynth.panic();
          AfterhoursGrooveLive.stop();
          AfterhoursGrooveLive.restore(old.before.groove);
          AfterhoursSynth.patch(old.before.synth);
          C.change({bend: 0});
          store.past = old.history.past;
          store.future = old.history.future;
          store.last = null;
          const media = document.getElementById('audio');
          if (Number.isFinite(old.listen.time)) media.currentTime = old.listen.time;
          if (!old.listen.paused && !document.hidden)
            media.play().catch(e => message('Listen paused · ' + e.message, true));
        } finally {
          replaying = false;
          paint(P.snapshot());
        }
      }
      if (rendered && completed) {
        const start = Math.round(old.start * rendered.rate),
          end = Math.max(start, Math.min(rendered.end, start + Math.round(take.duration * rendered.rate)));
        const sourceId = entry.id,
          renderedTake = validateTake({...take, name: take.name.slice(0, 69) + ' · rendered'});
        await addTake(renderedTake, A.wav(rendered.chunks, start, end, rendered.rate), {sourceId});
        message('Edited replay printed as a new take · original recording kept');
      } else message('Replay stopped · previous project restored; saved WAV kept');
    } finally {
      busy = false;
      paintTake();
    }
  }
  $('replay').addEventListener(
    'click',
    attempt(() => startReplay()),
  );
  $('print').addEventListener(
    'click',
    attempt(() => startReplay(true)),
  );
  async function advanceReplay() {
    const r = replay;
    if (!r || !r.ready || r.processing) return;
    r.processing = true;
    try {
      const elapsed = A.context().currentTime - r.start;
      while (replay === r && r.index < take.events.length && take.events[r.index].time <= elapsed)
        await applyEvent(take.events[r.index++], r);
      if (replay === r && elapsed >= take.duration) await stopReplay(true);
    } catch (e) {
      try {
        await stopReplay();
      } catch (cleanup) {
        message('Replay restored · ' + cleanup.message, true);
        return;
      }
      message('Replay stopped · ' + e.message, true);
    } finally {
      r.processing = false;
    }
  }
  function paintTake() {
    const active = !!recording || replaying || busy;
    $('record').disabled = active || !libraryReady || unsaved;
    $('record-name').disabled = active;
    $('record').setAttribute('aria-pressed', String(!!recording));
    $('replay').disabled = $('print').disabled = active || !take || unsaved;
    $('audio').disabled = !audioBlob || active;
    $('export').disabled = !take || active;
    $('import').disabled = active || !libraryReady || unsaved;
    $('takes').disabled = active || !libraryReady || !entries.length || unsaved;
    $('take-name').disabled = $('rename-take').disabled = $('delete-take').disabled = active || !take;
    $('stop').disabled = !recording && !replaying;
    $('player').controls = !active;
    $('arm').textContent = A.armed ? 'Rolling capture armed' : 'Arm rolling capture';
    showEvent();
    paintPart();
  }
  async function restoreTake() {
    try {
      await refreshLibrary();
      const id = await library.active(),
        saved = await library.load(id || entries[0]?.id || '');
      if (saved) {
        selectEntry(saved);
        message('Last performance restored from this Mac · all takes are in Saved performances');
      }
      libraryReady = true;
      paintTake();
    } catch (e) {
      message(e.message, true);
    }
  }
  let counter = 0;
  setInterval(() => {
    updateMotion();
    advanceReplay();
    if (++counter % 4) return;
    if (!$('panel').hidden) {
      const m = A.meter();
      $('meter').textContent = `Peak ${m.peak.toFixed(1)} · RMS ${m.rms.toFixed(1)} dBFS${m.clipping ? ' · CLIP' : ''}`;
      $('meter').classList.toggle('is-clipping', m.clipping);
      const levels = AfterhoursGrooveLive.levels();
      meters.forEach((meter, i) => (meter.value = Math.min(1, levels[i])));
      refreshTargets();
    }
    const duration = recording
      ? A.context().currentTime - recording.start
      : replay
        ? A.context().currentTime - replay.start
        : take?.duration || 0;
    const label = `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;
    if ($('duration').textContent !== label) $('duration').textContent = label;
  }, 25);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      end();
      if (recording) finishRecording().catch(e => message(e.message, true));
      if (replaying) stopReplay().catch(e => message(e.message, true));
    }
  });
  window.addEventListener('beforeunload', e => {
    if (recording || replaying || busy || unsaved) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    C.overlay({});
    if (audioURL) URL.revokeObjectURL(audioURL);
  });
  window.AfterhoursPerformanceStudio = {
    record: startRecording,
    stop: finishRecording,
    replay: startReplay,
    stopReplay,
    get take() {
      return take;
    },
    get audio() {
      return audioBlob;
    },
    get recording() {
      return !!recording;
    },
    get replaying() {
      return replaying;
    },
  };
  paint(P.snapshot());
  paintTake();
  refreshTargets();
  restoreTake();
})();
