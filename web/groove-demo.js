'use strict';
/* The tour transforms scheduled notes, never the stored project or its exports. */
(() => {
  const {S, transport, status} = AfterhoursGrooveApp,
    Core = AfterhoursDemoCore;
  const $ = id => document.getElementById('demo-' + id);
  const demo = AfterhoursPresets.demo;
  $('toggle').hidden = !demo;
  if (!demo) {
    $('panel').hidden = true;
    window.AfterhoursDemo = {events: events => events, observe() {}, paint() {}, stop() {}, active: false};
    return;
  }
  const demoProject = AfterhoursPresets.create(demo.preset),
    demoTitle = demoProject.title;
  let project = null,
    commands = [],
    compare = false,
    amount = 1,
    roomKey = null,
    roomApplied = false;
  let heard = [],
    lastReading = '',
    starting = false,
    nextPaint = 0,
    shownChapter = null;
  const active = () => project !== null && project === S.data;
  const current = beat => Core.position(commands.findLast(c => c.beat <= beat) || commands[0], beat);
  const compatible = () => S.data.title === demoTitle;
  const text = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const noteName = note =>
    ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12] + (Math.floor(note / 12) - 1);

  function restoreRoom() {
    if (roomApplied) S.engine?.setPerformance(AfterhoursPerformance.snapshot());
    roomApplied = false;
    roomKey = null;
  }
  function stop() {
    project = null;
    heard = [];
    restoreRoom();
    paint();
  }
  function choose(index, auto = false) {
    if (!active()) return;
    // Use the first unscheduled bar. Previously queued audio keeps its promised sound.
    const beat = Math.ceil(S.tick / 32) * 4;
    commands = commands.filter(c => c.beat < beat);
    commands.push({beat, index: Math.max(0, Math.min(Core.stages.length - 1, index)), auto});
    // Only the audible command and the short scheduler lookahead are needed.
    if (commands.length > 4) commands.splice(0, commands.length - 4);
    paint();
  }
  const cards = Core.stages.map((stage, index) => {
    const button = document.createElement('button');
    button.className = 'demo-chapter';
    button.textContent = `${String(index + 1).padStart(2, '0')} · ${stage.title}`;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => choose(index));
    $('chapters').append(button);
    return button;
  });
  $('toggle').addEventListener('click', () => {
    $('panel').hidden = !$('panel').hidden;
    $('toggle').setAttribute('aria-expanded', String(!$('panel').hidden));
  });
  $('collapse').addEventListener('click', () => {
    const collapsed = !$('details').hidden;
    $('details').hidden = collapsed;
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    $('collapse').textContent = collapsed ? 'Expand demo' : 'Collapse demo';
  });
  $('start').addEventListener('click', async () => {
    if (starting) return;
    starting = true;
    $('start').disabled = true;
    try {
      if (AfterhoursPerformanceStudio.replaying || AfterhoursPerformanceStudio.recording)
        throw new Error('Stop the performance take or replay before starting a demo');
      transport.stop();
      if (!compatible()) {
        const before = S.data;
        document.getElementById('groove-preset').value = demo.preset;
        document.getElementById('groove-load-preset').click();
        if (S.data === before) throw new Error(`Could not load ${demo.label} · export your session first`);
      }
      AfterhoursGrooveApp.recordingSync.unlink();
      S.songMode = true;
      transport.restart();
      // The pack selects a section with parts for the tour.
      transport.jumpToSection(demo.startSection);
      AfterhoursGrooveApp.ui.setFollow(true);
      shownChapter = null;
      project = S.data;
      commands = [{beat: 0, index: 0, auto: true}];
      compare = false;
      heard = [];
      lastReading = '';
      AfterhoursShell.touch('groove');
      await transport.play();
      if (!S.running) stop();
    } catch (error) {
      stop();
      status(error.message, 'err');
    } finally {
      starting = false;
      $('start').disabled = false;
      paint();
    }
  });
  $('end').addEventListener('click', () => {
    stop();
    status('Demo off · original arrangement playing');
  });
  $('previous').addEventListener('click', () => choose(current(AfterhoursGrooveLive.clock().beat).index - 1));
  $('next').addEventListener('click', () => choose(current(AfterhoursGrooveLive.clock().beat).index + 1));
  $('auto').addEventListener('click', () => choose(current(AfterhoursGrooveLive.clock().beat).index, true));
  $('original').addEventListener('click', () => {
    compare = !compare;
    roomKey = null;
    paint();
  });
  $('amount').addEventListener('input', () => {
    amount = Number($('amount').value) / 100;
    roomKey = null;
    paint();
  });
  AfterhoursPerformance.store.subscribe(() => {
    roomKey = null;
  });

  function events(events, absolute) {
    if (!active() || compare) return events;
    const state = current(absolute / 8);
    return events.map(e => Core.transform(e, state, amount));
  }
  function observe(voice, event, time) {
    if (!active() || !voice) return;
    const state = current(event.planTick / 8);
    if (
      !compare &&
      ((state.id === 'wavetable' && event.settings.machine !== 'Wavetable') ||
        (state.id === 'analog' && event.settings.machine !== 'DualVCO') ||
        (state.id === 'flutes' && event.settings.instrument !== 'vsco-flute') ||
        (state.id === 'brass' &&
          !['vsco-trumpet', 'vsco-horn', 'vsco-trombone', 'vsco-tuba'].includes(event.settings.instrument)) ||
        (state.id === 'strings' && !['vsco-violins', 'vsco-violas', 'vsco-cellos'].includes(event.settings.instrument)))
    )
      return;
    const sample = voice.recording;
    let reading;
    if (sample) {
      const r = sample.regions[0],
        name = sample.id.replace('vsco-', '');
      reading = `${name} · ${noteName(sample.note)} · velocity ${Math.round(sample.velocity * 127)} · recording ${r.take + 1}/${r.takes} · ${r.channels === 2 ? 'stereo' : 'mono'} · sample root ${noteName(r.root)}`;
    } else if (['Wavetable', 'DualVCO'].includes(event.settings.machine)) {
      reading = `${event.settings.machine} · ${noteName(event.settings.note)} · ${event.settings.machine === 'Wavetable' ? `frame ${Math.round(event.settings.color)}%` : `ladder cutoff ${Math.round(event.settings.cutoff)} Hz`}`;
    }
    if (reading) {
      heard.push({time, reading});
      if (heard.length > 128) heard.shift();
    }
  }
  const disabled = (node, value) => {
    if (node.disabled !== value) node.disabled = value;
  };
  const pressed = (node, value) => {
    if (node.getAttribute('aria-pressed') !== value) node.setAttribute('aria-pressed', value);
  };
  function paint() {
    if (performance.now() < nextPaint) return;
    nextPaint = performance.now() + 100;
    const enabled = active();
    disabled($('end'), !enabled);
    text(
      $('start'),
      starting ? 'Loading instruments…' : compatible() ? `Play ${demo.label} demo` : `Load ${demo.label} & play demo`,
    );
    for (const id of ['previous', 'next', 'auto', 'original', 'amount']) disabled($(id), !enabled);
    pressed($('original'), String(compare && enabled));
    text($('amount-value'), `${Math.round(amount * 100)}%`);
    if (!enabled) {
      cards.forEach(c => {
        disabled(c, true);
        pressed(c, 'false');
      });
      text($('state'), `READY · ${demo.label.toUpperCase()} · ${demoProject.bpm} BPM`);
      text($('title'), 'An orchestra, then a sound laboratory.');
      text(
        $('description'),
        `Start with ${demo.label}. Nine chapters reveal the players, phrasing, dynamics, synthesis and space. Choose a chapter to take control; Resume tour continues automatically.`,
      );
      if ($('progress').value !== 0) $('progress').value = 0;
      text($('reading'), 'Live sound details appear here as notes become audible.');
      return;
    }
    const clock = AfterhoursGrooveLive.clock(),
      state = current(clock.beat),
      stage = Core.stages[state.index],
      command = commands.findLast(c => c.beat <= clock.beat) || commands[0];
    const queued = commands.at(-1).beat > clock.beat ? ` · NEXT BAR: ${Core.stages[commands.at(-1).index].title}` : '';
    text(
      $('state'),
      `${compare ? 'ORIGINAL' : command.auto ? 'AUTO TOUR' : 'MANUAL'} · CHAPTER ${state.index + 1}/9 · BAR ${Math.floor(clock.beat / 4) + 1}${queued}`,
    );
    if (shownChapter !== state.id) {
      shownChapter = state.id;
      const instrument =
        state.id === 'strings'
          ? 'vsco-violins'
          : state.id === 'brass'
            ? 'vsco-trumpet'
            : state.id === 'analog'
              ? 'vsco-tuba'
              : 'vsco-flute';
      const lane = AfterhoursGrooveApp.pattern().tracks.findIndex(t => t.instrument === instrument);
      if (lane >= 0) AfterhoursGrooveApp.ui.revealLane(lane);
    }
    text($('title'), stage.title);
    text($('description'), stage.description);
    $('progress').value = state.phase;
    cards.forEach((c, i) => {
      disabled(c, false);
      pressed(c, String(i === state.index));
    });
    const key = `${compare}:${state.id}:${Math.floor(state.beat / 8) % 2}:${amount}`;
    if (key !== roomKey) {
      const base = AfterhoursPerformance.snapshot();
      if (!compare && state.id === 'space' && amount > 0) {
        S.engine?.setPerformance(Core.room(base, state, amount));
        roomApplied = true;
      } else restoreRoom();
      roomKey = key;
    }
    const now = S.engine?.context.currentTime || 0;
    const ready = heard.filter(h => h.time <= now);
    if (ready.length) {
      lastReading = ready.at(-1).reading;
      heard = heard.filter(h => h.time > now);
    }
    text($('reading'), lastReading || 'Waiting for the first audible note…');
  }
  window.AfterhoursDemo = {
    events,
    observe,
    paint,
    stop,
    get active() {
      return active();
    },
  };
  paint();
})();
