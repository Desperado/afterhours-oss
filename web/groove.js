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
  $g('load-preset').addEventListener('click', () => {
    try {
      // Keep the original session across multiple preset auditions and app restarts.
      S.data.performance = AfterhoursPerformance.project();
      if (!localStorage.getItem(App.keys.backup)) localStorage.setItem(App.keys.backup, G.serialize(S.data));
      const next = P.create($g('preset').value);
      transport.stop();
      recordingSync.unlink();
      S.songStart = S.songOffset = 0;
      S.data = next;
      AfterhoursPerformance.load(S.data.performance);
      S.songMode = true;
      S.page = 0;
      S.selectedStep = 0;
      const saved = flushSave();
      ui.renderAll();
      Shell.touch('groove');
      Shell.render();
      if (saved) status(`${S.data.title} loaded · previous session backed up · press Play`, 'ok');
    } catch {
      status('Could not save session · export it before loading a track', 'err');
    }
  });
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
    play: transport.play,
    stop: transport.stop,
    section: transport.jumpToSection,
    pattern: ui.selectPattern,
    continuous: setContinuous,
    levels: () => S.engine?.mixer.levels() || Array(16).fill(0),
    clock: () => {
      const frame = transport.audibleFrame();
      return {
        running: S.running,
        bpm: S.data.bpm,
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
