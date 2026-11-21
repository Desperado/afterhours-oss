'use strict';
/* Groove workspace: presets, the paint loop and the Shell engine. State and features live in groove-*.js. */
(() => {
  const App = AfterhoursGrooveApp,
    {S, PAGE, $g, el, status, pattern, save, flushSave, ui, transport, recordingSync} = App,
    G = AfterhoursGroove,
    P = AfterhoursPresets,
    Shell = AfterhoursShell;
  const visual = new AfterhoursVisual($g('visual'));
  const meterStyle = $g('meter-style');
  try {
    if ([...meterStyle.options].some(o => o.value === localStorage.getItem('afterhours-meter-style')))
      meterStyle.value = localStorage.getItem('afterhours-meter-style');
  } catch {
    /* Defaults work without storage. */
  }
  visual.style = meterStyle.value;
  meterStyle.addEventListener('change', () => {
    visual.style = meterStyle.value;
    visual.dirty = true;
    try {
      localStorage.setItem('afterhours-meter-style', meterStyle.value);
    } catch {
      /* Session-only preference. */
    }
  });
  const activity = Array.from({length: G.trackCount}, () => ({time: -1, v: 0}));

  /* ── tracks and session backup ───────────────────────────── */
  for (const c of P.catalog) {
    const option = el('option', '', `${c.title} · ${c.genre} · ${c.bpm} BPM`);
    option.value = c.id;
    $g('preset').append(option);
  }
  function describePreset() {
    $g('preset-description').textContent = P.catalog.find(c => c.id === $g('preset').value).description;
  }
  $g('preset').addEventListener('change', describePreset);
  describePreset();
  // Undo/redo groups of recorded steps, per project (see take() below).
  let takes = [],
    redos = [];
  // Replace the session with a new project; the first replaced session stays restorable.
  // All or nothing: if the new project cannot be saved, the current one is put back untouched.
  function replaceProject(next, {songMode = !!next.arrangement?.length, preset = null} = {}) {
    const previous = {
      data: S.data,
      songMode: S.songMode,
      songStart: S.songStart,
      songOffset: S.songOffset,
      page: S.page,
      selected: S.selected,
      selectedStep: S.selectedStep,
      loadedPreset: S.loadedPreset,
    };
    let performance = null;
    try {
      performance = S.data.performance = AfterhoursPerformance.project();
      // Keep the original session across multiple preset auditions and app restarts.
      if (!localStorage.getItem(App.keys.backup)) localStorage.setItem(App.keys.backup, G.serialize(S.data));
      transport.stop();
      recordingSync.unlink();
      S.songStart = S.songOffset = 0;
      S.data = next;
      AfterhoursPerformance.load(S.data.performance);
      S.songMode = songMode;
      S.page = 0;
      S.selected = 0;
      S.selectedStep = 0;
      // Tied to this project object, so imports, restores and jams clear it implicitly.
      S.loadedPreset = preset ? {id: preset, data: next} : null;
      if (!flushSave()) throw new Error('Session not saved');
    } catch {
      Object.assign(S, previous);
      if (performance) AfterhoursPerformance.load(performance);
      ui.renderAll();
      Shell.render();
      status('Could not save session · export it before loading a track', 'err');
      return false;
    }
    takes = [];
    redos = [];
    ui.renderAll();
    Shell.touch('groove');
    Shell.render();
    window.dispatchEvent(new Event('afterhours:project-replaced'));
    status(`${S.data.title} loaded · previous session backed up · press Play`, 'ok');
    return true;
  }
  function loadPreset(id) {
    try {
      return replaceProject(P.create(id), {preset: id});
    } catch {
      status('Could not load this track', 'err');
      return false;
    }
  }
  $g('load-preset').addEventListener('click', () => loadPreset($g('preset').value));
  // An empty loop on the starter kit, keeping the tempo and the connected controller's setup.
  function blank(bpm = S.data.bpm) {
    const data = G.project();
    data.title = 'Нова пісня';
    data.bpm = Math.max(40, Math.min(240, Math.round(Number(bpm) || 100)));
    data.swing = 0;
    for (const p of data.patterns) for (const t of p.tracks) t.steps = t.steps.map(() => G.step());
    const performance = AfterhoursPerformance.project();
    data.performance = AfterhoursPerformanceCore.validate({midi: performance.midi, mappings: performance.mappings});
    return replaceProject(G.validate(data), {songMode: false});
  }
  $g('restore').addEventListener('click', () => {
    try {
      const previous = G.validate(JSON.parse(localStorage.getItem(App.keys.backup)));
      transport.stop();
      recordingSync.unlink();
      S.songStart = S.songOffset = 0;
      S.data = previous;
      AfterhoursPerformance.load(S.data.performance);
      S.songMode = false;
      S.page = 0;
      const saved = flushSave();
      if (saved) localStorage.removeItem(App.keys.backup);
      ui.renderAll();
      Shell.render();
      if (saved) status('Previous session restored');
    } catch {
      status('Session backup unreadable · export current project', 'err');
    }
  });
  $g('song').addEventListener('click', () => {
    S.songMode = !S.songMode;
    save();
    ui.renderTrack();
    status(S.songMode ? 'Song mode · Play the full arrangement' : 'Pattern mode · Play and queue patterns');
  });
  function setContinuous(value) {
    S.data.continuous = value === true;
    AfterhoursPerformance.event('continuous', S.data.continuous);
    if (S.data.continuous) S.visuals = S.visuals.filter(v => !v.finished);
    else transport.cancelPendingWrap();
    save();
    ui.renderTrack();
    status(
      S.data.continuous
        ? 'Continuous Play on · song repeats until stopped'
        : 'Continuous Play off · song ends after this pass',
    );
  }
  $g('continuous').addEventListener('click', () => setContinuous(!S.data.continuous));
  for (const key of ['space', 'pump'])
    $g(key).addEventListener('input', () => {
      S.data.mix = {...S.data.mix, [key]: Number($g(key).value) / 100};
      S.engine?.setMix?.(S.data.mix);
      save();
    });

  /* ── paint loop ──────────────────────────────────────────── */
  let lastPaint = -Infinity;
  function paint(nowMs) {
    requestAnimationFrame(paint);
    if (document.hidden || nowMs - lastPaint < 1000 / 30) return;
    lastPaint = nowMs;
    if (S.engine) {
      const now = S.engine.context.currentTime;
      let current = null;
      while (S.visuals.length && S.visuals[0].time <= now) current = S.visuals.shift();
      for (const h of S.hits)
        if (h.time <= now && h.time > activity[h.lane].time) activity[h.lane] = {time: h.time, v: h.v};
      if (current?.finished) {
        transport.stop('Song finished · tails ringing', true, 'ok', true);
        current = null;
      }
      if (current) {
        if (S.transition && current.absolute >= S.transition.absolute) S.transition = null;
        if (S.sectionJump && current.absolute >= S.sectionJump.absolute) S.sectionJump = null;
        S.shownFrame = current;
        ui.renderSection(current);
        // Show a queued pattern when it becomes audible, not when it is scheduled.
        if (current.pattern !== S.data.active) {
          S.data.active = current.pattern;
          save();
          ui.renderAll();
        }
        S.shownTick = current.tick;
        ui.followFrame(current);
        const playing = new Set();
        pattern().tracks.forEach((t, lane) => {
          const index = Math.floor((current.tick * t.rate) / 2) % t.length;
          playing.add(`groove-step-${lane}-${index}`);
          if (lane === S.selected) playing.add(`perform-step-${index}`);
        });
        for (const b of document.querySelectorAll('#groove-grid .playing, #perform-steps .playing'))
          if (!playing.has(b.id)) b.classList.remove('playing');
        for (const id of playing) {
          const b = document.getElementById(id);
          if (b && !b.classList.contains('playing')) b.classList.add('playing');
        }
        const column = Math.floor(current.tick / 2) % pattern().length;
        for (const num of $g('grid').querySelectorAll('.seq-num'))
          num.classList.toggle('playing', Number(num.dataset.col) + S.page * PAGE === column);
        if (current.tick % 2 === 0) ui.renderPatterns();
        ui.renderPages();
      }
      if ($g('grid').clientWidth)
        for (const [lane, meter] of [...$g('grid').querySelectorAll('.activity i')].entries()) {
          const a = activity[lane],
            level = a.time < 0 ? 0 : a.v * Math.exp(-Math.max(0, now - a.time) * 7);
          const value = `scaleY(${level < 0.01 ? 0 : level.toFixed(2)})`;
          if (meter.style.transform !== value) meter.style.transform = value;
        }
      if (document.getElementById('perform-pads').clientWidth)
        for (const [lane, meter] of document.querySelectorAll('#perform-pads .pad-meter').entries()) {
          const a = activity[lane],
            level = a.time < 0 ? 0 : a.v * Math.exp(-Math.max(0, now - a.time) * 7);
          const value = `scaleX(${level < 0.01 ? 0 : level.toFixed(2)})`;
          if (meter.style.transform !== value) meter.style.transform = value;
        }
    }
    visual.paint(S.engine, S.shownFrame, S.running, performance.now() / 1000);
    App.playalong.paint();
    window.AfterhoursDemo?.paint();
  }

  /* ── lifecycle and Shell engine ──────────────────────────── */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSave();
    if (document.hidden) transport.schedule();
  });
  window.addEventListener('pagehide', () => {
    transport.stop();
    flushSave();
    S.engine?.dispose();
    S.engine = null;
  });

  Shell.register('groove', {
    label: 'Groove',
    available: () => true,
    playing: () => S.running,
    synced: () => !!S.sync,
    state: () => (S.running ? {text: 'Playing', dot: 'live'} : {text: 'Stopped', dot: 'idle'}),
    play: () => {
      Shell.touch('groove');
      transport.play();
    },
    stop: () => transport.stop(),
    start: () => {
      if (S.sync) recordingSync.recording().start();
      else transport.restart();
      AfterhoursPerformance.event('transport', 'rewind');
    },
    position: () => {
      const step =
        S.shownFrame && S.songMode
          ? Math.floor(S.shownFrame.absolute / 2)
          : S.shownTick === null
            ? 0
            : Math.floor(S.shownTick / 2) % pattern().length;
      return {
        label: 'Groove · bar.step',
        text: `${Math.floor(step / PAGE) + 1}.${String((step % PAGE) + 1).padStart(2, '0')}`,
      };
    },
    tempo: () => ({
      label: S.sync ? 'BPM · synced' : 'BPM',
      text: S.sync ? (S.sync.bpm * S.sync.media.playbackRate).toFixed(1) : String(S.data.bpm),
      set: v => {
        if (Number.isFinite(v) && v >= 40 && v <= 240) {
          if (S.sync || S.syncRequest) recordingSync.unlink();
          S.data.bpm = Math.round(v);
          AfterhoursPerformance.event('tempo', S.data.bpm);
          if (S.engine) {
            S.engine.bpm = S.data.bpm;
            S.engine.setMix?.(S.data.mix);
          }
          save();
        } else status('BPM must be 40–240', 'err');
      },
    }),
  });
  // Pads and keys write while playing; keys go to the selected track with their pitch and length.
  let keysArmed = false;
  const heldKeys = new Map();
  // Step edits are gestures too, so a performance take replays the overdubs it captured.
  const recordStep = (pattern, lane, index, step) =>
    AfterhoursPerformance.event('stepWrite', {pattern, lane, index, step: G.clone(step)});
  function setStep(step, value) {
    for (const key of Object.keys(step)) delete step[key];
    Object.assign(step, G.clone(value));
  }
  function finishKey(hit) {
    if (!S.engine) return;
    const seconds = S.engine.context.currentTime - hit.time;
    hit.step.gate = Math.round(Math.max(0.1, Math.min(8, seconds / hit.stepSeconds)) * 100) / 100;
    recordStep(hit.pattern, hit.lane, hit.index, hit.step);
  }
  function armKeys(value = !keysArmed) {
    // Notes still held keep the length played so far.
    for (const hit of heldKeys.values()) finishKey(hit);
    if (heldKeys.size) save();
    heldKeys.clear();
    keysArmed = value === true;
    // Play with the selected track's own sound, so what you hear is what gets recorded.
    if (keysArmed) AfterhoursSynth.followLane?.(S.selected);
    window.dispatchEvent(new CustomEvent('afterhours:keys-record', {detail: {armed: keysArmed}}));
    return keysArmed;
  }
  window.addEventListener('afterhours:gesture', e => {
    if (!keysArmed || window.AfterhoursPerformanceStudio?.replaying) return;
    const {type, value} = e.detail;
    if (type === 'noteOn') {
      const hit = recordHit(S.selected, value.velocity, value.note);
      if (hit) heldKeys.set(value.id, hit);
    } else if (type === 'noteOff') {
      const hit = heldKeys.get(value.id);
      heldKeys.delete(value.id);
      if (!hit) return;
      finishKey(hit);
      save();
    }
  });
  // Undo groups, newest last: one per playback run and source (beat pads, or keys into one track),
  // so UNDO removes the last recorded part without stopping or touching the others.
  function take(source, started) {
    takes = takes.filter(t => t.data === S.data).slice(-19);
    redos = [];
    let group = takes.find(t => t.source === source && t.started === started);
    if (group) takes = takes.filter(t => t !== group);
    else group = {data: S.data, source, started, changes: new Map()};
    takes.push(group);
    return group;
  }
  function clearTrack(lane = S.selected) {
    const track = S.data.patterns[S.data.active]?.tracks[lane];
    if (!track) return false;
    const group = take('clear', Symbol('clear'));
    track.steps.forEach((step, index) => {
      group.changes.set(`${S.data.active}:${lane}:${index}`, {
        pattern: S.data.active,
        lane,
        index,
        step,
        before: G.clone(step),
      });
      // Defaults, so chance, conditions or repeats from old notes cannot silence new hits.
      setStep(step, G.step());
      recordStep(S.data.active, lane, index, step);
    });
    save();
    ui.renderTrack();
    status(`Трек ${lane + 1} очищено · UNDO поверне ноти`);
    return true;
  }
  // Hits while playing are written to the nearest step of the pattern being heard.
  function recordHit(lane, velocity = 0.8, note = null) {
    const frame = S.running && transport.audibleFrame();
    if (!frame?.secondsPerBeat) return null;
    const track = S.data.patterns[frame.pattern]?.tracks[lane];
    if (!track) return null;
    const tick = frame.tick + (Math.max(0, S.engine.context.currentTime - frame.time) / frame.secondsPerBeat) * 8,
      index = ((Math.round((tick * track.rate) / 2) % track.length) + track.length) % track.length,
      step = track.steps[index],
      group = take(Number.isFinite(note) ? 'keys:' + lane : 'pads', S.engine.started),
      key = `${frame.pattern}:${lane}:${index}`;
    if (!group.changes.has(key))
      group.changes.set(key, {pattern: frame.pattern, lane, index, step, before: G.clone(step)});
    step.on = true;
    step.velocity = Math.max(1, Math.min(127, Math.round((Number.isFinite(velocity) ? velocity : 0.8) * 127)));
    step.micro = 0;
    if (Number.isFinite(note)) {
      step.locks = {...step.locks, note: Math.max(24, Math.min(108, Math.round(note)))};
      step.gate = 0.7;
    }
    recordStep(frame.pattern, lane, index, step);
    save();
    ui.renderTrack();
    return {
      pattern: frame.pattern,
      lane,
      index,
      step,
      time: S.engine.context.currentTime,
      stepSeconds: (frame.secondsPerBeat / 4) * (1 / track.rate),
    };
  }
  function applyGroup(group, field) {
    const steps = new Set([...group.changes.values()].map(c => c.step));
    // A held key must not change a step after its recording is undone or redone.
    for (const [id, hit] of heldKeys) if (steps.has(hit.step)) heldKeys.delete(id);
    for (const change of group.changes.values()) {
      setStep(change.step, change[field]);
      recordStep(change.pattern, change.lane, change.index, change.step);
    }
    save();
    ui.renderTrack();
  }
  function undoHits() {
    takes = takes.filter(t => t.data === S.data && t.changes.size);
    const group = takes.pop();
    if (!group) return false;
    for (const change of group.changes.values()) change.after = G.clone(change.step);
    applyGroup(group, 'before');
    redos.push(group);
    status(group.source === 'clear' ? 'Очищення трека скасовано' : 'Останній запис скасовано');
    return true;
  }
  function redoHits() {
    redos = redos.filter(t => t.data === S.data);
    const group = redos.pop();
    if (!group) return false;
    applyGroup(group, 'after');
    takes.push(group);
    status(group.source === 'clear' ? 'Трек знову очищено' : 'Запис повернуто');
    return true;
  }
  // Replays a recorded step edit from a performance take.
  function writeStep({pattern, lane, index, step}) {
    const target = S.data.patterns[pattern]?.tracks[lane]?.steps[index];
    if (!target) return false;
    setStep(target, G.cleanStep(step));
    save();
    ui.renderTrack();
    return true;
  }
  window.AfterhoursGrooveLive = {
    snapshot: () => {
      S.data.performance = AfterhoursPerformance.project();
      const clock = window.AfterhoursGrooveLive.clock();
      return {
        project: G.clone(S.data),
        songMode: S.songMode,
        continuous: S.data.continuous,
        songStart: S.songStart,
        running: S.running,
        offsetTicks: clock.beat * 8,
        loopOrigin: transport.audibleFrame()?.origin || 0,
        songOffset: transport.audibleFrame()?.songOffset ?? S.songStart,
      };
    },
    restore: value => {
      transport.stop();
      recordingSync.unlink();
      S.data = G.validate(value.project);
      S.songMode = !!value.songMode && !!S.data.arrangement?.length;
      if (typeof value.continuous === 'boolean') S.data.continuous = value.continuous;
      S.songStart = value.songStart || 0;
      S.songOffset = S.songStart;
      S.resumePosition = value.offsetTicks
        ? {offsetTicks: value.offsetTicks, loopOrigin: value.loopOrigin, songOffset: value.songOffset}
        : null;
      AfterhoursPerformance.load(S.data.performance);
      save();
      ui.renderAll();
    },
    flush: flushSave,
    recordHit,
    undoHits,
    redoHits,
    writeStep,
    clearTrack,
    blank,
    loadPreset,
    get loadedPreset() {
      return S.loadedPreset?.data === S.data ? S.loadedPreset.id : null;
    },
    armKeys,
    get keysArmed() {
      return keysArmed;
    },
    // Starting Groove from anywhere makes it the shell's active engine, as the top transport does.
    play: () => {
      Shell.touch('groove');
      return transport.play();
    },
    continue: () => {
      Shell.touch('groove');
      return transport.continuePlay();
    },
    stop: transport.stop,
    audition: transport.auditionLane,
    selectLane: ui.selectLane,
    section: transport.jumpToSection,
    pattern: ui.selectPattern,
    continuous: setContinuous,
    levels: () => S.engine?.mixer.levels() || Array(16).fill(0),
    clock: () => {
      const frame = transport.audibleFrame();
      return {
        running: S.running,
        starting: !!S.starting,
        run: S.run ?? 0,
        startBeat: S.runStartBeat ?? 0,
        ready: !!frame,
        bpm: frame ? 60 / frame.secondsPerBeat : S.data.bpm,
        beat: frame
          ? frame.absolute / 8 + Math.max(0, S.engine.context.currentTime - frame.time) / frame.secondsPerBeat
          : 0,
      };
    },
  };
  ui.buildPerformMacros();
  ui.renderAll();
  recordingSync.render();
  requestAnimationFrame(paint);
})();
