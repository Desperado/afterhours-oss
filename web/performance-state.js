'use strict';
// The project owns the base state. Fast modulation never writes into it.
window.AfterhoursPerformance = (() => {
  const Core = AfterhoursPerformanceCore,
    C = AfterhoursController,
    store = new Core.Store(),
    targets = new Map();
  const deviceKey = 'afterhours-midi-device-v1';
  let deviceProfile = null,
    deviceSaved = true;
  try {
    const raw = JSON.parse(localStorage.getItem(deviceKey));
    if (raw?.version === 1) {
      const valid = Core.validate(raw);
      deviceProfile = {version: 1, midi: valid.midi, mappings: valid.mappings};
    }
  } catch {
    // A damaged device profile must not prevent opening a song.
  }
  let applying = false;
  store.subscribe((s, reason) => {
    if (
      reason.startsWith('midi-') ||
      (reason === 'load' && s.midi.profile === 'mpk-mini-plus-ii') ||
      (deviceProfile && ['undo', 'redo'].includes(reason))
    ) {
      deviceProfile = {version: 1, midi: s.midi, mappings: s.mappings};
      try {
        localStorage.setItem(deviceKey, JSON.stringify(deviceProfile));
        deviceSaved = true;
      } catch {
        deviceSaved = false;
      }
    }
    applying = true;
    try {
      C.change({...s.controller, bend: reason === 'load' ? 0 : C.snapshot().bend});
      C.setTarget(s.controllerTarget);
    } finally {
      applying = false;
    }
  });
  C.subscribe(s => {
    if (!applying) {
      const next = Core.controller(s),
        keys = Object.keys(next).filter(k => next[k] !== store.state.controller[k]);
      store.update(
        v => {
          v.controller = next;
        },
        'controller-' + keys.join('-'),
      );
    }
  });
  return {
    store,
    targets,
    core: Core,
    register(id, target) {
      targets.set(id, target);
    },
    // Device assignments belong to this computer, independently of the song.
    load: raw => store.load(deviceProfile ? {...raw, ...deviceProfile} : raw),
    get deviceSaved() {
      return deviceSaved;
    },
    snapshot: () => store.snapshot(),
    project: () => store.project(),
    event(type, value) {
      window.dispatchEvent(new CustomEvent('afterhours:gesture', {detail: {type, value}}));
    },
  };
})();
