'use strict';
(() => {
  const S = AfterhoursShell,
    Audio = AfterhoursSynthAudio,
    $ = id => document.getElementById('synth-' + id);
  const storageKey = 'afterhours-synth-v1',
    held = new Map(),
    keys = new Map(),
    knobs = new Map();
  const codes = [
    'KeyA',
    'KeyW',
    'KeyS',
    'KeyE',
    'KeyD',
    'KeyF',
    'KeyT',
    'KeyG',
    'KeyY',
    'KeyH',
    'KeyU',
    'KeyJ',
    'KeyK',
    'KeyO',
    'KeyL',
    'KeyP',
    'Semicolon',
  ];
  const labels = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'];
  const name = n =>
    ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][n % 12] + (Math.floor(n / 12) - 1);
  let patch = {...Audio.presets[0]},
    octave = 4,
    engine,
    generation = 0;
  const Key = AfterhoursSynthKey,
    matchStorage = 'afterhours-synth-key-v1';
  let matching = {root: 0, scale: 'chromatic', snap: false, follow: false, midiRange: false};
  try {
    const saved = JSON.parse(localStorage.getItem(matchStorage));
    if (saved && Number.isInteger(saved.root) && saved.root >= 0 && saved.root < 12 && Key.scales[saved.scale]) {
      matching = {
        root: saved.root,
        scale: saved.scale,
        snap: saved.snap === true,
        follow: saved.follow === true,
        midiRange: saved.midiRange === true,
      };
      if (Number.isInteger(saved.octave)) octave = Math.max(1, Math.min(6, saved.octave));
    }
  } catch {
    /* Keep a chromatic keyboard if saved matching settings are unreadable. */
  }
  const saveMatching = () => {
    try {
      localStorage.setItem(matchStorage, JSON.stringify({...matching, octave}));
    } catch {
      S.status('Keyboard settings could not be saved', 'err');
    }
  };
  function inputNote(note, midi = false) {
    if (midi && matching.midiRange) note += (octave - 4) * 12;
    note = Math.max(0, Math.min(127, note));
    return matching.snap ? Key.snap(note, matching.root, matching.scale) : note;
  }
  const play = (id, note, velocity = 0.8, midi = false) => on(id, inputNote(note, midi), velocity);
  function matchingControls() {
    $('root').value = String(matching.root);
    $('scale').value = matching.scale;
    $('snap').checked = matching.snap;
    $('follow').checked = matching.follow;
    $('midi-range').checked = matching.midiRange;
  }
  // force: match the selected lane even when it has no notes yet (recording keys into an empty track).
  function matchGroove(force = false) {
    if (window.AfterhoursPerformanceStudio?.replaying) return;
    const grooveState = AfterhoursGrooveApp.S;
    if (grooveState.data.patterns[grooveState.data.active].tracks[grooveState.selected].machine === 'Sample') {
      $('match-status').textContent = 'Audio stem selected · choose an editable synth lane to play it on the keyboard.';
      return;
    }
    const groove = AfterhoursGrooveApp.S;
    const chosen = groove.data.patterns[groove.data.active].tracks[groove.selected];
    let suggestion =
      chosen.machine === 'Instrument' && chosen.instrument === 'virtuosity-drums'
        ? {root: 0, scale: 'chromatic', octave: 2, lane: groove.selected, estimated: false, name: chosen.name}
        : Key.suggest(groove.data, groove.selected);
    if (chosen.machine === 'Instrument' && (!suggestion || suggestion.lane !== groove.selected)) {
      suggestion = {
        root: 0,
        scale: 'chromatic',
        octave: Math.max(1, Math.min(6, Math.floor(chosen.note / 12) - 1)),
        lane: groove.selected,
        estimated: false,
        name: chosen.name,
      };
    }
    if (force && suggestion?.lane !== groove.selected)
      suggestion = {
        root: 0,
        scale: 'chromatic',
        octave: Math.max(1, Math.min(6, Math.floor(chosen.note / 12) - 1)),
        lane: groove.selected,
        estimated: false,
        name: chosen.name,
      };
    if (!suggestion) {
      $('match-status').textContent = 'No melodic notes in this project yet. Choose a key and octave manually.';
      return;
    }
    const {root, scale, octave: register, name: part, estimated, lane} = suggestion;
    const track = groove.data.patterns[groove.data.active].tracks[lane];
    const selected = lane === groove.selected ? track.steps[groove.selectedStep] : null;
    const first = selected?.on ? selected : track.steps.slice(0, track.length).find(s => s.on);
    const matched = AfterhoursGrooveInstrument.validate({
      lane,
      track: {...track, ...first?.locks},
      gate: ((first?.gate || 1) * 0.25) / track.rate / (first?.repeat || 1),
      performance: AfterhoursPerformance.snapshot(),
      mix: groove.data.mix,
    });
    const soundChanged = JSON.stringify(patch) !== JSON.stringify(matched);
    if (
      root !== matching.root ||
      scale !== matching.scale ||
      register !== octave ||
      !matching.snap ||
      !matching.midiRange ||
      soundChanged
    )
      panic();
    if (soundChanged) {
      engine?.dispose();
      engine = null;
      patch = matched;
      save();
      renderPatch();
      AfterhoursPerformance.event('patch', structuredClone(patch));
    }
    Object.assign(matching, {root, scale, snap: true, midiRange: true});
    octave = register;
    matchingControls();
    keyboard();
    saveMatching();
    $('match-status').textContent =
      `${groove.data.title || 'Your session'} · ${part} (${track.machine} sound + effects) · ${name(root + 60).slice(0, -1)} ${scale === 'minorLeading' ? 'minor (with leading tone)' : scale}${estimated ? ' (estimated; adjust if needed)' : ''} · MIDI C4 plays C${octave}.`;
  }
  for (let i = 0; i < 12; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = name(i + 60).slice(0, -1);
    $('root').append(option);
  }
  $('match').addEventListener('click', () => {
    matching.follow = true;
    matchGroove();
    matchingControls();
    saveMatching();
  });
  $('follow').addEventListener('change', () => {
    matching.follow = $('follow').checked;
    if (matching.follow) matchGroove();
    saveMatching();
  });
  for (const id of ['root', 'scale', 'snap', 'midi-range'])
    $(id).addEventListener('change', () => {
      panic();
      matching = {
        root: Number($('root').value),
        scale: $('scale').value,
        snap: $('snap').checked,
        midiRange: $('midi-range').checked,
        follow: false,
      };
      matchingControls();
      keyboard();
      saveMatching();
      $('match-status').textContent =
        `Manual keyboard settings · MIDI ${matching.midiRange ? 'C4 plays C' + octave : 'keeps its original octave'}.`;
    });
  window.addEventListener('afterhours:groove-selection', () => {
    // While recording keys, always sound like the newly selected track, even an empty one.
    if (matching.follow) matchGroove(window.AfterhoursGrooveLive?.keysArmed === true);
  });
  // Update a matched part without restarting its held notes on each encoder tick.
  function refreshMatchedSound(event) {
    const replay = window.AfterhoursPerformanceStudio?.replaying;
    if ((!matching.follow && !replay) || patch.family !== 'groove') return;
    const groove = AfterhoursGrooveApp.S;
    if (
      patch.lane !== (event?.detail?.lane ?? (replay ? patch.lane : groove.selected)) ||
      (event?.detail && event.detail.pattern !== groove.data.active)
    )
      return;
    const track = groove.data.patterns[groove.data.active].tracks[patch.lane];
    if (track.machine !== patch.track.machine || track.instrument !== patch.track.instrument) return;
    // Keep the matched note's other sound locks when adjusting one parameter or its mixer.
    const sound = {...patch.track, lfo: {...patch.track.lfo}};
    if (event?.detail?.path) {
      const [key, nested] = event.detail.path.split('.');
      if (nested) sound[key][nested] = track[key][nested];
      else if (track[key] === undefined) delete sound[key];
      else sound[key] = track[key];
    }
    const next = AfterhoursGrooveInstrument.validate({
      ...patch,
      track: sound,
      performance: AfterhoursPerformance.snapshot(),
      mix: groove.data.mix,
    });
    Object.assign(patch, next);
    engine?.renderer.setPerformance(patch.performance);
    engine?.renderer.setMix(patch.mix);
    save();
  }
  window.addEventListener('afterhours:groove-sound', refreshMatchedSound);
  // Macros, scenes, undo/redo and loads change the performance the matched sound plays through too.
  AfterhoursPerformance.store.subscribe((_, reason) => {
    if (!reason.startsWith('midi')) refreshMatchedSound();
  });
  const controls = [
    ['cutoff', 'Filter', 80, 16000, 10],
    ['resonance', 'Resonance', 0.1, 12, 0.1],
    ['position', 'Wave blend', 0, 1, 0.01],
    ['motion', 'Motion', 0, 1, 0.01],
    ['pulseWidth', 'Pulse width', 0.05, 0.95, 0.01],
    ['glide', 'Glide', 0, 0.3, 0.005],
    ['envelope', 'Filter env', 0, 1, 0.01],
    ['attack', 'Attack', 0.003, 2, 0.001],
    ['release', 'Release', 0.05, 4, 0.01],
    ['drive', 'Drive', 0, 1, 0.01],
    ['chorus', 'Chorus', 0, 1, 0.01],
    ['delay', 'Delay', 0, 1, 0.01],
    ['reverb', 'Reverb', 0, 1, 0.01],
    ['volume', 'Volume', 0, 1, 0.01],
  ];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.id === 'groove-part') patch = AfterhoursGrooveInstrument.validate(saved);
    const base = Audio.presets.find(p => p.id === saved?.id);
    if (base) {
      patch = {...base};
      for (const [key, , min, max] of controls)
        if (Number.isFinite(saved[key])) patch[key] = Math.max(min, Math.min(max, saved[key]));
    }
  } catch {
    /* A malformed patch leaves the factory sound intact. */
  }
  const save = () => {
    if (window.AfterhoursPerformanceStudio?.replaying) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(patch));
    } catch {
      S.status('Synth storage full · keep this window open', 'err');
    }
  };
  function paint() {
    const notes = new Set([...held.values()].map(p => p.note));
    for (const [n, b] of keys) {
      const on = notes.has(n);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('notes').textContent = notes.size
      ? [...notes]
          .sort((a, b) => a - b)
          .map(name)
          .join(' · ')
      : 'Ready';
  }
  function panic() {
    AfterhoursPerformance.event('panic', null);
    generation++;
    held.clear();
    engine?.panic();
    paint();
  }
  function ensureEngine() {
    if (engine) return;
    const ctx = AfterhoursAudio.context();
    engine =
      patch.family === 'groove'
        ? new AfterhoursGrooveInstrument(ctx, patch, AfterhoursGrooveApp.S.data.bpm)
        : new Audio(ctx);
  }
  async function on(id, note, velocity = 0.8, when) {
    if (held.has(id)) return;
    if (held.size >= 8) off(held.keys().next().value);
    const press = {note, velocity};
    held.set(id, press);
    paint();
    const version = generation;
    try {
      ensureEngine();
      await engine.context.resume();
      // Every defined family uses Rust; the original patches have no family.
      const voiceReady = patch.family ? await AfterhoursVoice.prepare(engine.context) : true;
      if (!voiceReady && (patch.family === 'analog' || patch.track?.machine === 'Analog'))
        throw new Error('Rust voice unavailable');
      if (version !== generation || held.get(id) !== press) return;
      if (patch.track?.filter === 'ladder') await AfterhoursLadder.prepare(engine.context);
      if (patch.track?.machine === 'Instrument') await AfterhoursInstruments.prepare([{tracks: [patch.track]}]);
      if (version !== generation || held.get(id) !== press) return;
      if (patch.family !== 'groove') engine.setPatch(patch);
      engine.setTempo(Number(S.getEngine('groove')?.tempo().text) || 112);
      engine.noteOn(id, note, velocity, when);
      for (const type of ['bend', 'pressure'])
        if (Number.isFinite(press[type])) engine.expression(id, type, press[type]);
      AfterhoursPerformance.event('noteOn', {id, note, velocity});
      return press;
    } catch (error) {
      if (held.get(id) !== press) return;
      held.delete(id);
      paint();
      S.status(error.message || 'Synth audio could not start · try another key', 'err');
    }
  }
  function off(id) {
    if (held.has(id)) AfterhoursPerformance.event('noteOff', {id});
    held.delete(id);
    engine?.noteOff(id);
    paint();
  }
  function keyboard() {
    keys.clear();
    $('keyboard').replaceChildren();
    let white = 0;
    for (let i = 0; i <= 24; i++) {
      const note = (octave + 1) * 12 + i,
        black = [1, 3, 6, 8, 10].includes(note % 12);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `synth-key ${black ? 'black' : 'white'}`;
      b.dataset.note = note;
      if (matching.snap)
        b.classList.toggle('out-of-key', !Key.scales[matching.scale].includes((note - matching.root + 120) % 12));
      b.title = matching.snap ? `Plays ${name(inputNote(note))}` : name(note);
      b.setAttribute('aria-label', name(note));
      b.setAttribute('aria-pressed', 'false');
      b.style.left = `${black ? (white * 100) / 15 - 2 : (white * 100) / 15}%`;
      if (!black) white++;
      const hint = document.createElement('small');
      hint.textContent = labels[i] || '';
      const text = document.createElement('span');
      text.textContent = name(note);
      b.append(hint, text);
      b.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        play('pointer-' + e.pointerId, note);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
        b.addEventListener(event, e => off('pointer-' + e.pointerId));
      // Native button activation also supports assistive technology; use Enter/Space as a held note.
      b.addEventListener('keydown', e => {
        if (['Enter', 'Space'].includes(e.code)) {
          e.preventDefault();
          if (!e.repeat) play('button-' + note, note);
        }
      });
      b.addEventListener('keyup', e => {
        if (['Enter', 'Space'].includes(e.code)) {
          e.preventDefault();
          off('button-' + note);
        }
      });
      b.addEventListener('click', async e => {
        if (e.detail || [...held.values()].some(p => p.note === note)) return;
        const id = 'activate-' + note;
        const press = await play(id, note);
        if (press && held.get(id) === press)
          setTimeout(() => {
            if (held.get(id) === press) off(id);
          }, 180);
      });
      b.addEventListener('blur', () => off('button-' + note));
      keys.set(note, b);
      $('keyboard').append(b);
    }
    $('octave').textContent = `C${octave}–C${octave + 2}`;
    $('octave-down').disabled = octave <= 1;
    $('octave-up').disabled = octave >= 6;
    paint();
  }
  function renderPatch() {
    for (const b of $('patches').children) b.setAttribute('aria-pressed', String(b.dataset.patch === patch.id));
    $('shape-panel').hidden = patch.family === 'groove';
    $('description').textContent =
      patch.family === 'groove'
        ? `Groove instrument: ${patch.track.name} · ${patch.track.machine}. Uses its sound and mixer effects. Edit the sound in Groove and match again, or choose a keyboard preset here.`
        : Audio.presets.find(p => p.id === patch.id).description;
    if (patch.family === 'groove') return;
    for (const [key, k] of knobs) {
      k.set(patch[key]);
      k.el.hidden =
        (['position', 'envelope'].includes(key) && !patch.family) ||
        (key === 'motion' && !['wave', 'analog'].includes(patch.family)) ||
        (['pulseWidth', 'glide'].includes(key) && patch.family !== 'analog');
    }
  }
  function selectPreset(p) {
    panic();
    engine?.dispose();
    engine = null;
    patch = {...p};
    matching.follow = false;
    matchingControls();
    saveMatching();
    $('match-status').textContent = 'Keyboard preset selected · key and octave retained.';
    save();
    renderPatch();
    AfterhoursPerformance.event('patch', {...patch});
  }
  for (const p of Audio.presets) {
    const b = document.createElement('button');
    b.className = 'synth-patch';
    b.dataset.patch = p.id;
    const title = document.createElement('strong');
    title.textContent = p.name;
    const sub = document.createElement('span');
    sub.textContent = p.era;
    b.append(title, sub);
    b.addEventListener('click', () => selectPreset(p));
    $('patches').append(b);
  }
  for (const [key, label, min, max, step] of controls) {
    const k = (key === 'volume' ? S.fader : S.knob)({
      performanceId: 'synth.' + key,
      label: 'Synth ' + label,
      name: label,
      min,
      max,
      step,
      value: patch[key] ?? Audio.presets[0][key],
      format: v =>
        key === 'cutoff'
          ? `${(v / 1000).toFixed(1)}k`
          : ['attack', 'release'].includes(key)
            ? `${v.toFixed(2)}s`
            : key === 'resonance'
              ? v.toFixed(1)
              : `${Math.round(v * 100)}%`,
      onInput: v => {
        if (patch.family === 'groove') return;
        patch[key] = v;
        engine?.set(key, v);
        save();
        AfterhoursPerformance.event('synthControl', {key, value: v});
      },
    });
    knobs.set(key, k);
    $('controls').append(k.el);
  }
  document.addEventListener('keydown', e => {
    if (
      $('workspace').hidden ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ||
      e.target.isContentEditable ||
      e.target.closest('[role="slider"]')
    )
      return;
    const i = codes.indexOf(e.code);
    if (i >= 0) {
      e.preventDefault();
      if (!e.repeat) play(e.code, (octave + 1) * 12 + i);
    } else if (e.code === 'KeyZ' || e.code === 'KeyX') {
      e.preventDefault();
      if (!e.repeat) shift(e.code === 'KeyZ' ? -1 : 1);
    } else if (e.code === 'Escape') panic();
  });
  document.addEventListener('keyup', e => {
    if (held.has(e.code)) {
      e.preventDefault();
      off(e.code);
    }
  });
  function shift(delta) {
    panic();
    octave = Math.max(1, Math.min(6, octave + delta));
    matching.follow = false;
    matchingControls();
    saveMatching();
    keyboard();
    $('match-status').textContent =
      `Manual octave · MIDI ${matching.midiRange ? 'C4 plays C' + octave : 'keeps its original octave'}.`;
  }
  $('octave-down').addEventListener('click', () => shift(-1));
  $('octave-up').addEventListener('click', () => shift(1));
  $('panic').addEventListener('click', panic);
  $('groove').addEventListener('click', () => {
    const g = S.getEngine('groove');
    if (g.playing()) g.stop();
    else g.play();
  });
  let previousPlaying;
  setInterval(() => {
    const g = S.getEngine('groove');
    if (previousPlaying !== g?.playing()) {
      previousPlaying = g?.playing();
      $('groove').textContent = previousPlaying ? 'Stop Groove' : 'Play Groove';
    }
  }, 200);
  new MutationObserver(() => {
    if ($('workspace').hidden) panic();
  }).observe($('workspace'), {attributes: true, attributeFilter: ['hidden']});
  window.addEventListener('blur', panic);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) panic();
  });
  window.addEventListener('pagehide', () => {
    panic();
    engine?.dispose();
    engine = null;
  });
  // Play the given Groove lane's sound on the keys, with a neutral key when it has no notes yet.
  function followLane() {
    matching.follow = true;
    $('follow').checked = true;
    matchGroove(true);
    saveMatching();
  }
  window.AfterhoursSynth = {
    followLane,
    on,
    midiOn: (id, note, velocity) => play(id, note, velocity, true),
    off,
    panic,
    held: () => [...held].map(([id, v]) => ({id, ...v})),
    snapshot: () => structuredClone(patch),
    presets: () => Audio.presets.map(({id, name}) => ({id, name})),
    selectPreset: id => {
      const preset = Audio.presets.find(p => p.id === id);
      if (preset) selectPreset(preset);
    },
    stepPreset: direction => {
      const index = Audio.presets.findIndex(p => p.id === patch.id);
      const next =
        index < 0
          ? direction > 0
            ? 0
            : Audio.presets.length - 1
          : (index + (direction > 0 ? 1 : -1) + Audio.presets.length) % Audio.presets.length;
      selectPreset(Audio.presets[next]);
      return patch.name;
    },
    prepare: async () => {
      ensureEngine();
      await engine.context.resume();
    },
    expression: (id, type, value) => {
      const voice = held.get(id);
      if (voice && ['bend', 'pressure'].includes(type)) voice[type] = value;
      engine?.expression(id, type, value);
    },
    patch: value => {
      const base = Audio.presets.find(p => p.id === value?.id);
      if (!base && value?.id !== 'groove-part') throw new Error('Unknown synth patch');
      panic();
      engine?.dispose();
      engine = null;
      patch = value.id === 'groove-part' ? AfterhoursGrooveInstrument.validate(value) : {...base};
      for (const [k, , lo, hi] of controls)
        if (Number.isFinite(value[k])) patch[k] = Math.max(lo, Math.min(hi, value[k]));
      save();
      renderPatch();
    },
    control: (key, value) => {
      if (patch.family === 'groove') return;
      const target = AfterhoursPerformance.targets.get('synth.' + key);
      target?.set(value);
    },
  };
  renderPatch();
  matchingControls();
  keyboard();
  // Keep the restored patch/register until Follow receives a real Groove selection.
})();
