'use strict';
/* Groove editor: toolbar, step grid, sound and trig-lock panels, and the phone Perform view. */
(() => {
  const App = AfterhoursGrooveApp,
    {S, LETTERS, PAGE, $g, el, status, pattern, track, hosts, save, transport} = App,
    G = AfterhoursGroove,
    P = AfterhoursPresets,
    Shell = AfterhoursShell;
  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const setAttr = (node, key, value) => {
    if (node.getAttribute(key) !== value) node.setAttribute(key, value);
  };
  const setDisabled = (node, value) => {
    if (node.disabled !== value) node.disabled = value;
  };
  let locked = false,
    performKnobs = null,
    followedSection = null;

  const noteName = n =>
    `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][Math.round(n) % 12]}${Math.floor(n / 12) - 1}`;
  const format = {
    note: noteName,
    decay: v => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`),
    cutoff: v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
    pan: v => (v === 0 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.abs(Math.round(v))}`),
    volume: v => `${Math.round(v)}%`,
    velocity: v => String(v),
    chance: v => `${Math.round(v)}%`,
    micro: v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`,
    repeat: v => `${v}×`,
    gate: v => v.toFixed(1),
    depth: v => `${Math.round(v)}%`,
  };
  const fmt = (key, v) => (format[key] || (n => String(Math.round(n))))(v);
  const conditionText = {'1:2': '1:2', '2:2': '2:2', fill: 'FILL', '!fill': '!FILL'};

  /* ── song header ─────────────────────────────────────────── */
  function renderTrack() {
    const {data} = S;
    $g('track-title').textContent = data.title || 'Your session';
    $g('song').disabled = !data.arrangement?.length || S.running;
    $g('song').setAttribute('aria-pressed', String(S.songMode));
    $g('continuous').setAttribute('aria-pressed', String(S.data.continuous));
    $g('continuous').disabled = !data.arrangement?.length || !!S.sync;
    $g('song-wav').disabled = !data.arrangement?.length || S.exporting;
    try {
      $g('restore').disabled = !localStorage.getItem(App.keys.backup);
    } catch {
      $g('restore').disabled = true;
    }
    for (const key of ['space', 'pump']) $g(key).value = Math.round((data.mix?.[key] || 0) * 100);
    const sections = (data.arrangement || []).map((s, index) => {
      const node = el('button', '', s.name);
      node.type = 'button';
      node.style.flexGrow = s.bars;
      node.title = `Jump to ${s.name}${S.running ? ' on the next bar' : ''}`;
      node.disabled = !!S.sync || !!S.syncRequest;
      node.addEventListener('click', () => transport.jumpToSection(index));
      return node;
    });
    $g('arrangement').replaceChildren(...sections);
    $g('overview').replaceChildren(
      ...sections.map((section, index) => {
        const node = el('button');
        node.type = 'button';
        node.style.flexGrow = data.arrangement[index].bars;
        node.title = section.title;
        node.setAttribute('aria-label', `${index + 1}. ${data.arrangement[index].name}`);
        node.disabled = section.disabled;
        node.addEventListener('click', () => transport.jumpToSection(index));
        return node;
      }),
    );
    $g('arrangement').classList.toggle('long-song', sections.length > 12);
    followedSection = null;
    renderSection(S.shownFrame);
  }
  function renderSection(frame) {
    const {data} = S;
    const section = S.songMode && frame ? data.arrangement?.[frame.section] : null;
    const bars = (data.arrangement || []).reduce((n, s) => n + s.bars, 0);
    let text = section
      ? `${section.name} · bar ${Math.floor(frame.tick / 32) + 1}/${section.bars}`
      : S.songMode
        ? `${bars}-bar arrangement · press Play`
        : 'Pattern mode · changes on the next bar';
    if (S.sectionJump) text += ` · queued ${data.arrangement[S.sectionJump.index].name}`;
    if ($g('section').textContent !== text) $g('section').textContent = text;
    for (const [i, node] of [...$g('arrangement').children].entries()) {
      node.classList.toggle('active', !!section && i === frame.section && S.running);
      node.classList.toggle('queued', S.sectionJump?.index === i);
      setAttr(
        node,
        'aria-pressed',
        String(section ? i === frame.section : S.songMode && i === P.sectionAt(data, S.songStart)?.index),
      );
      const overview = $g('overview').children[i];
      overview.classList.toggle('active', node.classList.contains('active'));
      overview.classList.toggle('queued', node.classList.contains('queued'));
      setAttr(overview, 'aria-pressed', node.getAttribute('aria-pressed'));
    }
    if (S.follow && section && S.running && followedSection !== frame.section) {
      const host = $g('arrangement'),
        node = host.children[frame.section];
      host.scrollLeft +=
        node.getBoundingClientRect().left -
        host.getBoundingClientRect().left -
        (host.clientWidth - node.offsetWidth) / 2;
      followedSection = frame.section;
    }
  }

  function setFollow(value) {
    S.follow = value;
    $g('follow').setAttribute('aria-pressed', String(value));
    $g('follow').textContent = value ? 'Follow playback' : 'Resume follow';
    followedSection = null;
    if (value && S.shownFrame) {
      followFrame(S.shownFrame);
      renderSection(S.shownFrame);
    }
  }
  function followFrame(frame) {
    if (!S.follow) return;
    // Follow the selected player's actual loop and rate, including short polymeters.
    const t = track(),
      page = Math.floor((Math.floor((frame.tick * t.rate) / 2) % t.length) / PAGE);
    if (S.page !== page) {
      S.page = page;
      renderGrid();
      renderPages();
    }
    const index = Math.floor((frame.tick * t.rate) / 2) % t.length,
      cell = document.getElementById(`groove-step-${S.selected}-${index}`),
      host = $g('grid').parentElement;
    if (cell && host.scrollWidth > host.clientWidth) {
      const box = cell.getBoundingClientRect(),
        viewport = host.getBoundingClientRect(),
        header = $g('grid').querySelector('.track-head').offsetWidth;
      if (box.left < viewport.left + header || box.right > viewport.right)
        host.scrollLeft += box.left - viewport.left - header - (host.clientWidth - header - box.width) / 2;
    }
  }
  function revealLane(lane) {
    if (!S.follow) return;
    selectLane(lane);
    const node = $g('grid').querySelector(`[data-lane="${lane}"] .track-head`),
      host = $g('grid').parentElement;
    if (!node) return;
    const box = node.getBoundingClientRect(),
      viewport = host.getBoundingClientRect();
    if (box.top < viewport.top + 26 || box.bottom > viewport.bottom)
      host.scrollTop += box.top - viewport.top - (host.clientHeight - box.height) / 2;
  }
  $g('follow').addEventListener('click', () => setFollow(!S.follow));
  for (const name of ['wheel', 'pointerdown', 'keydown'])
    $g('arrangement').addEventListener(
      name,
      event => {
        if (name !== 'keydown' || ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
          setFollow(false);
      },
      {passive: true},
    );
  $g('grid').parentElement.addEventListener('wheel', () => setFollow(false), {passive: true});
  $g('grid').parentElement.addEventListener('touchstart', () => setFollow(false), {passive: true});

  /* ── toolbar ─────────────────────────────────────────────── */
  function selectPattern(i) {
    if (!Number.isInteger(i) || !S.data.patterns[i] || (S.running && S.songMode)) return;
    AfterhoursPerformance.event('pattern', i);
    if (S.running) transport.queuePattern(i);
    else {
      S.data.active = i;
      save();
      renderAll();
    }
  }
  function renderPatterns() {
    for (const host of hosts('patterns')) {
      let select = host.querySelector('select');
      if (S.data.patterns.length > 4) {
        if (!select) {
          select = el('select', 'pattern-select');
          select.setAttribute('aria-label', 'Song pattern');
          select.addEventListener('change', () => selectPattern(Number(select.value)));
          host.append(select);
        }
        if (select.options.length !== S.data.patterns.length)
          select.replaceChildren(
            ...S.data.patterns.map((_, i) => {
              const option = el('option', '', `Pattern ${LETTERS[i]}`);
              option.value = i;
              return option;
            }),
          );
        select.value = S.data.active;
        setDisabled(select, S.running && S.songMode);
      } else select?.remove();
    }
    for (const host of hosts('patterns'))
      for (const [i, b] of [...host.querySelectorAll('button')].entries()) {
        const isPlaying = S.running && i === S.data.active,
          isQueued = i === S.queued || S.visuals.some(v => v.pattern === i && v.pattern !== S.data.active);
        setDisabled(b, S.running && S.songMode);
        setAttr(b, 'aria-pressed', String(i === S.data.active));
        b.classList.toggle('playing', isPlaying);
        b.classList.toggle('queued', isQueued);
        setAttr(b, 'aria-label', `Pattern ${LETTERS[i]}${isPlaying ? ', playing' : isQueued ? ', queued' : ''}`);
        setText(b.querySelector('small'), isPlaying ? 'play' : isQueued ? 'next' : '');
      }
    setText($g('copy'), `Copy → ${LETTERS[(S.data.active + 1) % S.data.patterns.length]}`);
  }
  function renderPages() {
    const {page} = S;
    const longest = Math.max(...pattern().tracks.map(t => t.length));
    for (const host of hosts('pages'))
      for (const b of host.children) {
        const n = Number(b.dataset.page);
        setAttr(b, 'aria-pressed', String(n === page));
        b.classList.toggle('beyond', n * PAGE >= longest);
        setAttr(
          b,
          'title',
          `View steps ${n * PAGE + 1}–${(n + 1) * PAGE}${n * PAGE >= longest ? ' · outside loop length' : ''}`,
        );
      }
    for (const b of $g('lengths').children)
      setAttr(b, 'aria-pressed', String(Number(b.dataset.length) === pattern().length));
    const next =
      S.queued !== null ? ` → ${LETTERS[S.queued]} next bar` : S.transition ? ` → ${LETTERS[S.playing]} next bar` : '';
    setText(
      $g('pattern-status'),
      `${S.running ? 'Playing' : 'Editing'} ${LETTERS[S.data.active]}${next} · ${pattern().length} steps · viewing ${page * PAGE + 1}–${(page + 1) * PAGE}`,
    );
  }
  function renderToolbar() {
    $g('swing').value = Math.round(S.data.swing * 100);
    $g('swing-value').textContent = `${Math.round(S.data.swing * 100)}%`;
    $g('length').value = pattern().length;
    $g('lock').setAttribute('aria-pressed', String(locked));
    renderPatterns();
    renderPages();
  }

  /* ── step grid ───────────────────────────────────────────── */
  function stepLabel(s) {
    if (s.chance < 100) return `${Math.round(s.chance)}%`;
    if (s.repeat > 1) return `×${s.repeat}`;
    return conditionText[s.condition] || '';
  }
  function updateStep(lane, index) {
    const b = document.getElementById(`groove-step-${lane}-${index}`);
    if (!b) return;
    const t = pattern().tracks[lane],
      s = t.steps[index],
      beyond = index >= t.length,
      lockCount = Object.keys(s.locks).length;
    b.classList.toggle('on', s.on && !beyond);
    b.classList.toggle('beyond', beyond);
    b.classList.toggle('has-lock', lockCount > 0 && !beyond);
    b.classList.toggle('selected', lane === S.selected && index === S.selectedStep);
    b.classList.toggle('chance', s.on && s.chance < 100 && !beyond);
    b.style.setProperty('--chance', `${s.chance}%`);
    b.querySelector('.step-label').textContent = beyond ? '' : stepLabel(s);
    b.setAttribute('aria-pressed', String(s.on && !beyond));
    b.setAttribute('aria-disabled', String(beyond));
    b.setAttribute(
      'aria-label',
      `${t.machine} step ${index + 1}, ${beyond ? 'beyond length' : s.on ? 'on' : 'off'}${s.on && s.chance < 100 ? `, chance ${Math.round(s.chance)}%` : ''}${lockCount ? ', locked' : ''}`,
    );
    // The perform view shows the selected lane only; its steps carry the same state.
    const p = lane === S.selected ? document.getElementById(`perform-step-${index}`) : null;
    if (p) {
      p.classList.toggle('on', s.on && !beyond);
      p.classList.toggle('beyond', beyond);
      p.classList.toggle('has-lock', lockCount > 0 && !beyond);
      p.classList.toggle('selected', index === S.selectedStep);
      p.classList.toggle('chance', s.on && s.chance < 100 && !beyond);
      p.style.setProperty('--chance', `${s.chance}%`);
      p.querySelector('.step-label').textContent = beyond ? '' : stepLabel(s);
      p.setAttribute('aria-pressed', String(s.on && !beyond));
      p.setAttribute('aria-disabled', String(beyond));
      p.setAttribute(
        'aria-label',
        `${t.machine} step ${index + 1}, ${beyond ? 'beyond length' : s.on ? 'on' : 'off'}${lockCount ? ', locked' : ''}`,
      );
    }
  }
  function choose(lane, index, toggle) {
    const t = pattern().tracks[lane];
    if (index >= t.length) return;
    setFollow(false);
    const trackChanged = lane !== S.selected;
    const previous = [S.selected, S.selectedStep];
    S.selected = lane;
    S.selectedStep = index;
    if (toggle) {
      t.steps[index].on = !t.steps[index].on;
      save();
    }
    updateStep(...previous);
    updateStep(lane, index);
    if (trackChanged) {
      renderTrackHeads();
      renderPads();
      renderPerformSteps();
      updateAllSteps();
    }
    renderEditor();
    if (trackChanged) window.dispatchEvent(new Event('afterhours:groove-selection'));
    if (locked) status(`TRIG LOCK · ${t.machine} step ${index + 1}`, 'lock');
  }
  function renderTrackHeads() {
    for (const row of $g('grid').querySelectorAll('.seq-row')) {
      const lane = Number(row.dataset.lane),
        t = pattern().tracks[lane];
      row.classList.toggle('selected', lane === S.selected);
      row.classList.toggle('muted', t.mute);
      row.querySelector('.track-name').setAttribute('aria-pressed', String(lane === S.selected));
      row.querySelector('.tog').setAttribute('aria-pressed', String(t.mute));
    }
  }
  function renderGrid() {
    const {page} = S;
    const host = $g('grid'),
      focused = document.activeElement?.id;
    host.replaceChildren();
    host.setAttribute('aria-label', `Step sequencer, page ${page + 1} of 4`);
    const head = el('div', 'seq-head');
    head.setAttribute('role', 'row');
    const corner = el('div', 'micro-label seq-corner', 'Tracks');
    corner.setAttribute('role', 'columnheader');
    head.append(corner);
    for (let n = 0; n < PAGE; n++) {
      const num = el('div', 'seq-num mono', String(page * PAGE + n + 1).padStart(2, '0'));
      num.dataset.col = n;
      num.setAttribute('role', 'columnheader');
      head.append(num);
    }
    host.append(head);
    pattern().tracks.forEach((t, lane) => {
      const row = el('div', 'seq-row');
      row.setAttribute('role', 'row');
      row.dataset.lane = lane;
      const header = el('div', 'track-head');
      header.setAttribute('role', 'rowheader');
      const audition = el('button', 'audition');
      audition.type = 'button';
      audition.setAttribute('aria-label', `Audition ${t.machine}`);
      audition.title = 'Audition';
      audition.addEventListener('click', () => transport.auditionLane(lane));
      const name = el('button', 'track-name');
      name.type = 'button';
      name.title = t.name;
      name.setAttribute('aria-label', `Select track ${lane + 1} ${t.machine}`);
      name.append(
        el('b', '', t.machine),
        el(
          'small',
          'mono',
          `${lane + 1}. ${t.name} · len ${t.length}${t.rate !== 1 ? ` · ${t.rate === 0.5 ? '½' : t.rate}×` : ''}`,
        ),
      );
      name.addEventListener('click', () => selectLane(lane));
      const mute = el('button', 'tog', 'M');
      mute.type = 'button';
      mute.setAttribute('aria-label', `Mute ${t.machine}`);
      mute.setAttribute('aria-pressed', String(t.mute));
      mute.addEventListener('click', () => togglePerformMute(lane));
      const solo = el('button', 'tog', 'S');
      solo.type = 'button';
      solo.setAttribute('aria-label', `Solo ${t.machine}`);
      solo.setAttribute('aria-pressed', String(t.solo));
      solo.addEventListener('click', () => {
        t.solo = !t.solo;
        solo.setAttribute('aria-pressed', String(t.solo));
        if (t.solo)
          pattern().tracks.forEach((other, j) => {
            if (!other.solo) S.engine?.stopLane(j);
          });
        save();
      });
      const meter = el('span', 'activity');
      meter.setAttribute('aria-hidden', 'true');
      meter.append(el('i'));
      header.append(audition, name, mute, solo, meter);
      row.append(header);
      for (let n = 0; n < PAGE; n++) {
        const index = page * PAGE + n;
        const b = el('button', 'step');
        b.type = 'button';
        b.id = `groove-step-${lane}-${index}`;
        b.setAttribute('role', 'gridcell');
        b.dataset.lane = lane;
        b.dataset.index = index;
        b.tabIndex = -1;
        b.append(el('span', 'step-label mono'), el('span', 'lock-mark'));
        b.addEventListener('click', () => choose(lane, index, !locked));
        b.addEventListener('contextmenu', event => {
          event.preventDefault();
          choose(lane, index, false);
        });
        row.append(b);
      }
      host.append(row);
    });
    renderPads();
    renderPerformSteps();
    updateAllSteps();
    renderTrackHeads();
    rovingFocus();
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }
  function updateAllSteps() {
    pattern().tracks.forEach((_, lane) => {
      for (let n = 0; n < PAGE; n++) updateStep(lane, S.page * PAGE + n);
    });
    rovingFocus();
  }
  function rovingFocus() {
    const steps = [...$g('grid').querySelectorAll('.step')];
    const target = document.getElementById(`groove-step-${S.selected}-${S.selectedStep}`) || steps[0];
    for (const b of steps) b.tabIndex = b === target ? 0 : -1;
  }
  $g('grid').addEventListener('keydown', event => {
    const b = event.target.closest('.step');
    if (!b) return;
    const lane = Number(b.dataset.lane),
      index = Number(b.dataset.index);
    const move = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]}[event.key];
    if (move) {
      event.preventDefault();
      const nextLane = Math.min(pattern().tracks.length - 1, Math.max(0, lane + move[0])),
        col = Math.min(PAGE - 1, Math.max(0, index - S.page * PAGE + move[1]));
      const next = document.getElementById(`groove-step-${nextLane}-${S.page * PAGE + col}`);
      if (next) {
        for (const s of $g('grid').querySelectorAll('.step')) s.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      }
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      choose(lane, index, false);
    }
  });

  /* ── perform view (phone) ─────────────────────────────────── */
  // Pads and step pads reuse the desktop state: taps select, long-press (or right-click)
  // mutes, double-tap auditions. The design keeps every target at least 46 px.
  function togglePerformMute(lane) {
    const t = pattern().tracks[lane];
    t.mute = !t.mute;
    if (t.mute) S.engine?.stopLane(lane);
    renderPads();
    renderTrackHeads();
    save();
    status(`${t.machine} ${t.mute ? 'muted' : 'unmuted'}`, t.mute ? 'lock' : 'ok');
  }
  function selectLane(lane) {
    S.selected = lane;
    renderPads();
    renderPerformSteps();
    updateAllSteps();
    renderTrackHeads();
    renderEditor();
    window.dispatchEvent(new Event('afterhours:groove-selection'));
  }
  function renderPads() {
    const host = document.getElementById('perform-pads');
    // Keep nodes stable while selecting or muting: the second tap and pointerup
    // must reach the same pad as pointerdown.
    if (!host.children.length)
      pattern().tracks.forEach((_, lane) => {
        const pad = el('button', 'perform-pad');
        pad.type = 'button';
        pad.id = `perform-pad-${lane}`;
        pad.append(el('b'), el('span', 'pad-act'), el('small', 'mono pad-len'), el('i', 'pad-meter'));
        let holdTimer = null,
          held = false,
          at = null;
        const cancelHold = () => {
          clearTimeout(holdTimer);
          at = null;
        };
        pad.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          cancelHold();
          held = false;
          at = [event.clientX, event.clientY];
          pad.setPointerCapture(event.pointerId);
          holdTimer = setTimeout(() => {
            held = true;
            togglePerformMute(lane);
          }, 450);
        });
        pad.addEventListener('pointermove', event => {
          if (at && Math.hypot(event.clientX - at[0], event.clientY - at[1]) > 10) cancelHold();
        });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(name, cancelHold);
        pad.addEventListener('contextmenu', event => {
          event.preventDefault();
          if (!held) {
            held = true;
            togglePerformMute(lane);
          }
        });
        pad.addEventListener('click', () => {
          if (held) {
            held = false;
            return;
          }
          if (lane !== S.selected) selectLane(lane);
        });
        pad.addEventListener('dblclick', () => transport.auditionLane(lane));
        host.append(pad);
      });
    pattern().tracks.forEach((t, lane) => {
      const pad = host.children[lane];
      pad.setAttribute('aria-pressed', String(lane === S.selected));
      pad.setAttribute(
        'aria-label',
        `Select ${t.machine}${lane === S.selected ? ', selected' : ''}${t.mute ? ', muted' : ''}. Double-tap to audition, hold to mute.`,
      );
      pad.classList.toggle('muted', t.mute);
      pad.querySelector('b').textContent = t.machine;
      pad.querySelector('.pad-act').textContent = t.mute ? 'MUTED' : lane === S.selected ? 'EDIT' : '';
      pad.querySelector('.pad-len').textContent =
        `${lane + 1}. ${t.name}${t.rate !== 1 ? ` · ${t.rate === 0.5 ? '½' : t.rate}×` : ''}`;
    });
    const mute = document.getElementById('perform-mute');
    mute.textContent = track().mute ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(track().mute));
  }
  function renderPerformSteps() {
    const host = document.getElementById('perform-steps');
    if (!host) return;
    host.replaceChildren();
    const t = track();
    host.setAttribute('aria-label', `Steps of ${t.machine}, page ${S.page + 1} of 4`);
    for (let n = 0; n < PAGE; n++) {
      const index = S.page * PAGE + n;
      const b = el('button', 'pstep');
      b.type = 'button';
      b.id = `perform-step-${index}`;
      b.append(
        el('span', 'step-number mono', String(index + 1).padStart(2, '0')),
        el('span', 'step-label mono'),
        el('span', 'lock-mark'),
      );
      b.addEventListener('click', () => choose(S.selected, index, true));
      host.append(b);
    }
  }
  function buildPerformMacros() {
    const host = document.getElementById('perform-macros');
    if (!host) return;
    performKnobs = {};
    for (const key of ['color', 'shape', 'sweep', 'contour']) {
      const [name, min, max, step] = G.controls[key];
      const knob = Shell.knob({
        label: name,
        name,
        id: `perform-${key}`,
        min,
        max,
        step,
        size: 'lg',
        value: track()[key],
        format: v => fmt(key, v),
        onInput: v => {
          track()[key] = v;
          save();
          if (locked) renderLockView();
          else renderSoundView();
        },
      });
      performKnobs[key] = knob;
      host.append(knob.el);
    }
    syncPerform();
  }
  function syncPerform() {
    if (!performKnobs) return;
    const t = track();
    const title = document.getElementById('perform-macro-title');
    if (title) title.textContent = t.machine;
    for (const [key, knob] of Object.entries(performKnobs)) knob.set(t[key]);
  }

  /* ── editor panels ───────────────────────────────────────── */
  function knobFor(key, {size, value, locked: isLocked = false, onInput, onReset, label}) {
    const [name, min, max, step] = G.controls[key];
    const k = (key === 'volume' ? Shell.fader : Shell.knob)({
      label: label || name,
      name,
      min,
      max,
      step,
      value,
      size,
      bipolar: key === 'pan',
      format: v => fmt(key, v),
      onInput,
      onReset,
    });
    k.set(value, isLocked);
    return k;
  }
  function segmented(label, options, value, change) {
    const group = el('div', 'seg');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const [v, text] of options) {
      const b = el('button', '', text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(String(v) === String(value)));
      b.addEventListener('click', () => {
        for (const other of group.children) other.setAttribute('aria-checked', String(other === b));
        change(v);
        save();
      });
      group.append(b);
    }
    return group;
  }
  function selectField(label, options, value, change) {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (const [v, text] of options) {
      const o = el('option', '', text);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    s.addEventListener('change', () => {
      change(s.value);
      save();
    });
    return s;
  }
  const fieldRow = (host, label, control) => {
    host.append(el('span', 'micro-label', label), control);
  };
  function stepper(label, value, min, max, change) {
    const wrap = el('div', 'stepper');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label);
    const minus = el('button', '', '−'),
      out = el('output', 'mono', String(value)),
      plus = el('button', '', '+');
    minus.type = plus.type = 'button';
    minus.setAttribute('aria-label', `Shorter ${label.toLowerCase()}`);
    plus.setAttribute('aria-label', `Longer ${label.toLowerCase()}`);
    const set = v => {
      value = Math.min(max, Math.max(min, v));
      out.textContent = String(value);
      change(value);
      save();
    };
    minus.addEventListener('click', () => set(value - 1));
    plus.addEventListener('click', () => set(value + 1));
    wrap.append(minus, out, plus);
    return wrap;
  }
  function renderSoundView() {
    const t = track();
    $g('macro-title').textContent = t.machine;
    const base = key =>
      knobFor(key, {
        size: key === 'color' || key === 'shape' || key === 'sweep' || key === 'contour' ? 'lg' : undefined,
        value: t[key],
        onInput: v => {
          t[key] = v;
          save();
          syncPerform();
        },
      });
    $g('macros').replaceChildren(...['color', 'shape', 'sweep', 'contour'].map(key => base(key).el));
    $g('voice').replaceChildren(...['note', 'decay', 'cutoff', 'volume', 'pan'].map(key => base(key).el));
    const machine = $g('machine');
    machine.replaceChildren();
    fieldRow(
      machine,
      'Type',
      selectField(
        'Machine type',
        G.machines.filter(m => m !== 'Sample' || t.sample).map(m => [m, m]),
        t.machine,
        v => {
          if (S.running || S.starting) transport.stop();
          t.machine = v;
          if (v === 'Instrument') {
            t.instrument ||= 'growlybass';
            t.cutoff = 16000;
          }
          save();
          renderGrid();
          renderEditor();
        },
      ),
    );
    if (t.machine === 'Instrument') {
      $g('macros').replaceChildren();
      $g('voice').replaceChildren(...['note', 'cutoff', 'volume', 'pan'].map(key => base(key).el));
      fieldRow(
        machine,
        'Instrument',
        selectField(
          'Sampled instrument',
          AfterhoursInstrumentCatalog.map(item => [item.id, item.name]),
          t.instrument,
          id => {
            if (S.running || S.starting) transport.stop();
            t.instrument = id;
            t.note =
              id === 'virtuosity-drums' || id === 'growlybass' || id === 'freepats-guitar' || id === 'vsco-tuba'
                ? 36
                : id === 'vsco-flute'
                  ? 72
                  : 60;
            save();
            renderEditor();
          },
        ),
      );
      fieldRow(
        machine,
        'Playing',
        el(
          'span',
          'micro-label',
          'Recorded instruments · velocity layers + alternate takes · gate controls note release. Audition or Play loads the recordings.',
        ),
      );
    } else if (t.machine === 'Sample') {
      $g('macros').replaceChildren();
      $g('voice').replaceChildren(...['volume', 'pan'].map(key => base(key).el));
      fieldRow(
        machine,
        'Audio',
        el(
          'span',
          'micro-label',
          `${t.sample.id} · from ${t.sample.offset.toFixed(2)}s · ${t.sample.bpm} BPM · Level / Pan / Mute / Solo · tempo changes pitch`,
        ),
      );
    } else if (t.machine === 'Saw')
      fieldRow(
        machine,
        'Engine',
        el('span', 'micro-label', 'Detuned saws + sub · Shape: drive · Color: detune · Sweep: filter envelope'),
      );
    else if (t.machine === 'Analog')
      fieldRow(
        machine,
        'Engine',
        el(
          'span',
          'micro-label',
          'Rust analog voice · Shape: resonance · Color: saw/pulse blend · Sweep: filter envelope / PWM · Contour: envelope decay',
        ),
      );
    else if (['Ladder', 'DualVCO', 'Wavetable', 'WavePad'].includes(t.machine)) {
      fieldRow(
        machine,
        'Engine',
        el(
          'span',
          'micro-label',
          `${t.machine === 'Ladder' ? 'Warm dual oscillator' : t.machine === 'DualVCO' ? 'Triangle ↔ saw + square sub' : 'Moving harmonic frames'} · Shape: resonance · Color: wave blend · Sweep: envelope / wave motion · Contour: envelope decay`,
        ),
      );
      // A/B the original Biquad pair against the Rust/WebAssembly ladder on upcoming notes.
      const filter = segmented(
        'Filter model',
        [
          ['biquad', 'Biquad'],
          ['ladder', 'Ladder β'],
        ],
        t.filter,
        v => {
          t.filter = v;
          status(v === 'ladder' ? `${t.machine} · Ladder β filter on new notes` : `${t.machine} · Biquad filter`);
        },
      );
      filter.id = 'groove-filter-model';
      fieldRow(machine, 'Filter', filter);
    } else
      fieldRow(
        machine,
        'Algo',
        segmented(
          'FM algorithm',
          [
            ['parallel', 'Two pairs'],
            ['serial', 'Cascade'],
          ],
          t.algorithm,
          v => {
            t.algorithm = v;
          },
        ),
      );
    const chord = selectField(
      'Chord',
      [
        ['minor7', 'Minor 7'],
        ['major7', 'Major 7'],
        ['fifth', 'Fifth'],
      ],
      t.chord,
      v => {
        t.chord = v;
      },
    );
    chord.disabled = !['Chord', 'WavePad'].includes(t.machine);
    chord.title = chord.disabled ? 'Chord or WavePad machine only' : '';
    fieldRow(machine, 'Chord', chord);
    fieldRow(
      machine,
      'Length',
      stepper('Track length', t.length, 1, 64, v => {
        t.length = v;
        renderGrid();
        renderPages();
      }),
    );
    fieldRow(
      machine,
      'Speed',
      segmented(
        'Track speed',
        [
          [0.5, '½×'],
          [1, '1×'],
          [2, '2×'],
        ],
        t.rate,
        v => {
          t.rate = Number(v);
          renderGrid();
        },
      ),
    );
    const lfo = $g('lfo');
    lfo.replaceChildren();
    fieldRow(
      lfo,
      'To',
      selectField(
        'LFO destination',
        [
          ['shape', 'Shape / FM'],
          ['cutoff', 'Filter'],
          ['pitch', 'Pitch'],
          ['pan', 'Pan'],
        ],
        t.lfo.target,
        v => {
          t.lfo.target = v;
        },
      ),
    );
    fieldRow(
      lfo,
      'Shape',
      selectField(
        'LFO shape',
        ['sine', 'triangle', 'square', 'sawtooth'].map(v => [v, v[0].toUpperCase() + v.slice(1)]),
        t.lfo.shape,
        v => {
          t.lfo.shape = v;
        },
      ),
    );
    fieldRow(
      lfo,
      'Period',
      selectField(
        'LFO period',
        [
          [0.25, '1/16'],
          [0.5, '1/8'],
          [1, '1/4'],
          [2, '1/2'],
          [4, '1 bar'],
          [8, '2 bars'],
          [16, '4 bars'],
        ],
        t.lfo.division,
        v => {
          t.lfo.division = Number(v);
        },
      ),
    );
    const depth = Shell.knob({
      label: 'LFO depth',
      name: 'Depth',
      min: 0,
      max: 100,
      step: 1,
      value: t.lfo.depth,
      format: v => fmt('depth', v),
      onInput: v => {
        t.lfo.depth = v;
        save();
      },
    });
    fieldRow(lfo, '', depth.el);
    if (t.machine === 'Instrument') lfo.replaceChildren();
  }
  function renderLockView() {
    const t = track(),
      s = t.steps[S.selectedStep];
    $g('trig-title').textContent = `Step ${S.selectedStep + 1}`;
    $g('trig-meta').textContent = `${t.machine} · page ${Math.floor(S.selectedStep / PAGE) + 1}`;
    const stepKnob = (key, name, min, max, step, extra = {}) =>
      Shell.knob({
        label: name,
        name,
        min,
        max,
        step,
        value: s[key],
        format: v => fmt(key, v),
        ...extra,
        onInput: v => {
          s[key] = v;
          save();
          updateStep(S.selected, S.selectedStep);
        },
      }).el;
    $g('trig').replaceChildren(
      stepKnob('velocity', 'Velocity', 1, 127, 1),
      stepKnob('chance', 'Chance', 0, 100, 1),
      stepKnob('micro', 'Micro', -0.4, 0.4, 0.01, {bipolar: true}),
      stepKnob('repeat', 'Retrig', 1, 4, 1),
      stepKnob('gate', 'Gate', 0.1, 8, 0.1),
    );
    const condition = $g('condition');
    condition.replaceChildren();
    fieldRow(
      condition,
      'Condition',
      segmented(
        'Trig condition',
        [
          ['always', 'Always'],
          ['1:2', '1:2'],
          ['2:2', '2:2'],
          ['fill', 'Fill'],
          ['!fill', 'Not fill'],
        ],
        s.condition,
        v => {
          s.condition = v;
          updateStep(S.selected, S.selectedStep);
        },
      ),
    );
    const knobs = G.lockKeys.map(key => {
      const has = () => Object.hasOwn(s.locks, key);
      const k = knobFor(key, {
        value: has() ? s.locks[key] : t[key],
        locked: has(),
        onInput: v => {
          s.locks[key] = v;
          k.set(v, true);
          k.sub(`base ${fmt(key, t[key])}`);
          lockChanged();
          save();
        },
        onReset: () => {
          delete s.locks[key];
          k.set(t[key], false);
          k.sub('');
          lockChanged();
          save();
        },
      });
      k.sub(has() ? `base ${fmt(key, t[key])}` : '');
      return k.el;
    });
    $g('locks').replaceChildren(...knobs);
    lockChanged();
  }
  function lockChanged() {
    const count = Object.keys(track().steps[S.selectedStep].locks).length;
    $g('lock-count').textContent = `◆ ${count} locked`;
    $g('lock-count').hidden = !count;
    updateStep(S.selected, S.selectedStep);
  }
  function renderEditor() {
    $g('sound-view').hidden = locked;
    $g('lock-view').hidden = !locked;
    if (locked) renderLockView();
    else renderSoundView();
    syncPerform();
  }
  function renderAll() {
    window.dispatchEvent(new Event('afterhours:groove-selection'));
    renderToolbar();
    renderGrid();
    renderEditor();
    renderTrack();
  }

  /* ── wiring ──────────────────────────────────────────────── */
  for (let i = 0; i < 4; i++) {
    for (const host of hosts('patterns')) {
      const b = el('button', 'slot');
      b.type = 'button';
      b.append(document.createTextNode(LETTERS[i]), el('small', 'mono'));
      b.addEventListener('click', () => selectPattern(i));
      host.append(b);
    }
    for (const host of hosts('pages')) {
      const p = el('button', 'page', `${i * PAGE + 1}–${(i + 1) * PAGE}`);
      p.type = 'button';
      p.dataset.page = i;
      p.setAttribute('aria-label', `Page ${i + 1}`);
      p.addEventListener('click', () => {
        setFollow(false);
        S.page = i;
        renderPages();
        renderGrid();
      });
      host.append(p);
    }
  }
  document.getElementById('perform-mute').addEventListener('click', () => togglePerformMute(S.selected));
  document.getElementById('perform-audition').addEventListener('click', () => transport.auditionLane(S.selected));
  $g('lock').addEventListener('click', () => {
    locked = !locked;
    $g('lock').setAttribute('aria-pressed', String(locked));
    renderEditor();
    status(
      locked ? `TRIG LOCK · ${track().machine} step ${S.selectedStep + 1}` : 'TRIG LOCK off',
      locked ? 'lock' : 'ok',
    );
  });
  $g('clear-locks').addEventListener('click', () => {
    track().steps[S.selectedStep].locks = {};
    save();
    renderEditor();
  });
  $g('fill').addEventListener('click', () => {
    S.fill = !S.fill;
    $g('fill').setAttribute('aria-pressed', String(S.fill));
  });
  $g('swing').addEventListener('input', () => {
    S.data.swing = Number($g('swing').value) / 100;
    $g('swing-value').textContent = `${$g('swing').value}%`;
    save();
  });
  function setLength(v) {
    if (!Number.isInteger(v) || v < 1 || v > 64) {
      $g('length').value = pattern().length;
      return;
    }
    pattern().length = v;
    pattern().tracks.forEach(t => {
      t.length = v;
    });
    S.page = Math.min(S.page, Math.ceil(v / PAGE) - 1);
    S.selectedStep = Math.min(S.selectedStep, v - 1);
    save();
    renderAll();
    status(`${LETTERS[S.data.active]} · all lanes loop ${v} steps · hidden notes preserved`);
  }
  for (const n of [16, 32, 48, 64]) {
    const b = el('button', 'btn', String(n));
    b.dataset.length = n;
    b.addEventListener('click', () => setLength(n));
    $g('lengths').append(b);
  }
  $g('length').addEventListener('change', () => setLength($g('length').valueAsNumber));
  $g('copy').addEventListener('click', () => {
    const next = (S.data.active + 1) % S.data.patterns.length;
    S.data.patterns[next] = G.clone(pattern());
    save();
    status(`Pattern ${LETTERS[S.data.active]} copied to ${LETTERS[next]}`);
  });

  Object.assign(App.ui, {
    selectPattern,
    renderTrack,
    renderSection,
    renderPatterns,
    renderPages,
    followFrame,
    revealLane,
    setFollow,
    renderAll,
    buildPerformMacros,
  });
})();
