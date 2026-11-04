'use strict';
/* Shared Groove project state, storage and DOM helpers for the groove-*.js modules. */
(() => {
  const G = AfterhoursGroove,
    Shell = AfterhoursShell;
  const project = 'afterhours-fm-project-v1';
  const keys = {project, backup: project + '-before-preset', mode: project + '-song-mode'};
  const $g = id => document.getElementById('groove-' + id);
  const status = (text, tone = 'ok') => Shell.status(text, tone);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // Everything that more than one Groove module reads or writes. Positions are in
  // ticks (8 per beat); visuals and hits are scheduled ahead of the audio clock.
  const S = {
    data: G.project(),
    selected: 4,
    selectedStep: 0,
    page: 0,
    follow: true,
    fill: false,
    exporting: false,
    songMode: false,
    sampleResume: false,
    songStart: 0,
    songOffset: 0,
    sectionJump: null,
    resumePosition: null,
    engine: null,
    running: false,
    starting: false,
    tick: 0,
    nextTime: 0,
    queued: null,
    queuedAt: 0,
    playing: 0,
    loopOrigin: 0,
    transition: null,
    visuals: [],
    hits: [],
    shownTick: null,
    shownFrame: null,
    sync: null,
    syncRequest: null,
    syncTick: null,
  };
  const pattern = () => S.data.patterns[S.data.active],
    track = () => pattern().tracks[S.selected];
  const hosts = id =>
    [document.getElementById('groove-' + id), document.getElementById('perform-' + id)].filter(Boolean);

  try {
    const saved = localStorage.getItem(keys.project);
    if (saved) S.data = G.validate(JSON.parse(saved));
  } catch {
    status('Saved project unreadable · starter loaded', 'err');
  }
  try {
    S.songMode = !!S.data.arrangement?.length && localStorage.getItem(keys.mode) === 'true';
  } catch {
    /* Keep pattern mode when storage is unavailable. */
  }

  AfterhoursPerformance.load(S.data.performance);
  AfterhoursPerformance.store.subscribe(state => {
    S.engine?.setPerformance(state);
    save();
  });

  let saveTimer = null;
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (window.AfterhoursPerformanceStudio?.replaying) return true;
    try {
      S.data.performance = AfterhoursPerformance.project();
      localStorage.setItem(keys.project, G.serialize(S.data));
      if ((localStorage.getItem(keys.mode) === 'true') !== S.songMode)
        localStorage.setItem(keys.mode, String(S.songMode));
      return true;
    } catch {
      status('Storage full · export project', 'err');
      return false;
    }
  }
  // Knob drags fire many input events; write the whole project at most a few times a second.
  function save() {
    if (!saveTimer) saveTimer = setTimeout(flushSave, 400);
  }

  // The other modules fill ui, transport and recordingSync; calls between them resolve at run time.
  window.AfterhoursGrooveApp = {
    S,
    keys,
    LETTERS: Array.from({length: 32}, (_, i) =>
      i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`,
    ),
    PAGE: 16,
    $g,
    el,
    status,
    pattern,
    track,
    hosts,
    save,
    flushSave,
    ui: {},
    transport: {},
    recordingSync: {},
  };
})();
