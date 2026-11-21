'use strict';
/* Play a phrase, confirm it, then keep editing the resulting Groove tracks. */
(() => {
  const G = AfterhoursGroove,
    Live = AfterhoursGrooveLive,
    App = AfterhoursGrooveApp;
  const $ = id => document.getElementById('jam-' + id),
    backupKey = 'afterhours-jam-backup-v1';
  let mode = 'idle',
    busy = false,
    notes = [],
    held = new Map(),
    origin = 0,
    captureBpm = 100;
  let editUndo = null,
    editRedo = null,
    editExpected = null,
    metronome = false,
    clickBus = null,
    nextClick = 0,
    clickBeat = 0;
  const now = () => AfterhoursAudio.context().currentTime;
  const status = text => {
    $('status').textContent = text;
  };
  function paint() {
    $('listen').disabled = busy;
    $('confirm').disabled = busy || !['listening', 'ready', 'generated'].includes(mode);
    $('cancel').disabled = busy || mode !== 'listening';
    $('listen').textContent = mode === 'listening' ? 'Restart the phrase' : '1 · Listen to my phrase';
    $('confirm').textContent = mode === 'generated' ? 'Rebuild accompaniment' : '2 · Done — add the band';
    $('listen').setAttribute('aria-pressed', String(mode === 'listening'));
    $('metronome').setAttribute('aria-pressed', String(metronome));
    try {
      $('restore').disabled = busy || !localStorage.getItem(backupKey);
    } catch {
      $('restore').disabled = true;
    }
  }
  function available() {
    if (AfterhoursPerformanceStudio.recording)
      throw new Error('Recording in progress. Press Stop ■ (on the MPK or at the top) to save it, then try again.');
    if (AfterhoursPerformanceStudio.replaying)
      throw new Error('A take is replaying. Press Stop ■ to stop it, then try again.');
    if (App.S.exporting) throw new Error('The song is exporting. Wait until it finishes.');
  }
  function closeNote(id, time = now()) {
    const note = held.get(id);
    if (!note) return;
    note.duration = Math.max(0.025, time - note.start);
    held.delete(id);
  }
  function finishCapture() {
    if (mode !== 'listening') return;
    const time = now();
    for (const id of held.keys()) closeNote(id, time);
    mode = 'ready';
    AfterhoursSynth.panic();
    paint();
  }
  async function listen() {
    if (busy) return;
    available();
    busy = true;
    paint();
    try {
      AfterhoursLiveMIDI.cancel();
      Live.stop();
      AfterhoursSynth.panic();
      await AfterhoursSynth.prepare();
      captureBpm = Number($('bpm').value);
      if (!Number.isFinite(captureBpm) || captureBpm < 40 || captureBpm > 240)
        throw new Error('Tempo must be 40–240 BPM.');
      notes = [];
      held.clear();
      origin = now();
      nextClick = origin + 0.08;
      clickBeat = 0;
      mode = 'listening';
      status('Listening… Play a short phrase. When you like it, press “Done” or the central encoder.');
    } finally {
      busy = false;
      paint();
    }
  }
  async function confirm() {
    if (busy) return;
    available();
    finishCapture();
    busy = true;
    paint();
    const before = Live.snapshot();
    let applied = false;
    try {
      const result = AfterhoursJamCore.compose(notes, {bpm: captureBpm, style: $('style').value});
      // Start a clean mix, retaining the connected controller's learned assignments.
      const performance = AfterhoursPerformance.project();
      result.project.performance = AfterhoursPerformanceCore.validate({
        midi: performance.midi,
        mappings: performance.mappings,
      });
      // Save before replacing the session. Never replace the first backup on regeneration.
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, JSON.stringify(before));
      applied = true;
      Live.restore({project: result.project, songMode: true, continuous: true});
      if (!Live.flush()) throw new Error('Not enough storage space to save. The project was restored; export it.');
      editUndo = editRedo = null;
      mode = 'generated';
      await Live.play();
      status(
        `Phrase captured · ${result.count} note(s) · ${result.bars} bar(s) · ${result.project.title}. Bass, drums and harmony are ready — edit them in Groove.` +
          (result.shortened ? ` Long notes shortened to 2 beats: ${result.shortened}.` : ''),
      );
    } catch (error) {
      if (applied) {
        Live.restore(before);
        Live.flush();
        mode = 'ready';
      }
      throw error;
    } finally {
      busy = false;
      paint();
    }
  }
  function cancel() {
    if (busy) return;
    finishCapture();
    mode = 'idle';
    notes = [];
    held.clear();
    status('Phrase cancelled. The project is unchanged.');
    paint();
  }
  function restore() {
    available();
    if (busy) return;
    const saved = localStorage.getItem(backupKey);
    if (!saved) return;
    const snapshot = JSON.parse(saved);
    G.validate(snapshot.project);
    finishCapture();
    Live.restore(snapshot);
    if (!Live.flush()) throw new Error('The project was restored in memory but not saved. The backup was kept.');
    localStorage.removeItem(backupKey);
    notes = [];
    mode = 'idle';
    editUndo = editRedo = null;
    status('Previous project restored.');
    paint();
  }
  function quantize() {
    available();
    if (mode === 'listening' || busy) throw new Error('Finish the phrase first.');
    const track = App.track();
    if (!track.steps.some(s => s.on && s.micro !== 0)) {
      status('The selected track has no microtiming left: 1/16 grid.');
      return;
    }
    editUndo = Live.snapshot();
    editRedo = null;
    for (const step of track.steps) step.micro = 0;
    App.ui.renderAll();
    if (!Live.flush()) {
      Live.restore(editUndo);
      editUndo = null;
      throw new Error('Quantize cancelled: no storage space to save.');
    }
    editExpected = G.serialize(Live.snapshot().project);
    status('Microtiming removed from the selected track. Undo restores it.');
  }
  function undoEdit(redo = false) {
    if (busy || mode === 'listening' || AfterhoursPerformanceStudio.recording) return false;
    if (editExpected !== G.serialize(Live.snapshot().project)) {
      editUndo = editRedo = editExpected = null;
      return false;
    }
    const snapshot = redo ? editRedo : editUndo;
    if (!snapshot) return false;
    const before = Live.snapshot();
    Live.restore(snapshot);
    if (!Live.flush()) {
      Live.restore(before);
      Live.flush();
      status('Change cancelled: no storage space to save.');
      return true;
    }
    if (redo) {
      editUndo = before;
      editRedo = null;
    } else {
      editRedo = before;
      editUndo = null;
    }
    editExpected = G.serialize(Live.snapshot().project);
    status(redo ? 'Quantize redone.' : 'Quantize undone.');
    return true;
  }
  function click(tick, time) {
    if (!metronome || tick % 8 || document.hidden) return;
    const ctx = AfterhoursAudio.context();
    if (!clickBus) {
      clickBus = ctx.createGain();
      clickBus.connect(AfterhoursAudio.output(ctx));
    }
    clickBus.gain.value = 1;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.frequency.value = tick % 32 === 0 ? 1320 : 880;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.06, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    oscillator.connect(gain).connect(clickBus);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(time);
    oscillator.stop(time + 0.05);
  }
  function toggleMetronome() {
    metronome = !metronome;
    if (clickBus) clickBus.gain.value = metronome ? 1 : 0;
    if (mode === 'listening') {
      nextClick = now() + 0.05;
      clickBeat = 0;
    }
    status(metronome ? 'Metronome on: during the phrase and Groove playback.' : 'Metronome off.');
    paint();
  }
  const run = fn =>
    Promise.resolve()
      .then(fn)
      .catch(error => {
        status(error.message);
        paint();
      });
  $('listen').addEventListener('click', () => run(listen));
  $('confirm').addEventListener('click', () => run(confirm));
  $('cancel').addEventListener('click', cancel);
  $('restore').addEventListener('click', () => run(restore));
  $('metronome').addEventListener('click', toggleMetronome);
  $('quantize').addEventListener('click', () => run(quantize));
  window.addEventListener('afterhours:gesture', e => {
    if (mode !== 'listening' || AfterhoursPerformanceStudio.replaying) return;
    const {type, value} = e.detail,
      time = now();
    if (type === 'noteOn') {
      closeNote(value.id, time);
      if (notes.length >= 256) {
        finishCapture();
        status('Limit of 256 notes. Confirm the phrase or play a shorter one.');
        return;
      }
      const note = {note: value.note, velocity: value.velocity, start: time, duration: 0.025};
      notes.push(note);
      held.set(value.id, note);
      status(`Listening… ${notes.length} note(s). Press “Done” when you like the phrase.`);
    } else if (type === 'noteOff') closeNote(value.id, time);
    else if (type === 'panic') for (const id of held.keys()) closeNote(id, time);
  });
  window.addEventListener('afterhours:midiaction', e => {
    if (AfterhoursPerformanceStudio.replaying) return;
    switch (e.detail.target) {
      case 'action.jam-confirm':
        run(() => (mode === 'listening' || mode === 'ready' ? confirm() : listen()));
        break;
      case 'action.jam-listen':
        run(listen);
        break;
      case 'action.jam-cancel':
        cancel();
        break;
      case 'action.metronome':
        toggleMetronome();
        break;
      case 'action.quantize':
        run(quantize);
        break;
    }
  });
  App.metronome = click;
  setInterval(() => {
    if (mode !== 'listening') return;
    const time = now(),
      elapsed = time - (notes[0]?.start ?? origin);
    if (elapsed > (notes.length ? (16 * 60) / captureBpm : 30)) {
      finishCapture();
      status('Listening finished. Confirm the phrase or start again.');
      return;
    }
    if (metronome && !document.hidden && !Live.clock().running) {
      if (nextClick < time) nextClick = time + 0.02;
      while (nextClick < time + 0.1) {
        click(clickBeat++ * 8, nextClick);
        nextClick += 60 / captureBpm;
      }
    }
  }, 25);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'listening') {
      finishCapture();
      status('Phrase stopped while the window is inactive.');
    }
    if (document.hidden && clickBus) clickBus.gain.value = 0;
  });
  $('bpm').value = Math.round(App.S.data.bpm);
  window.AfterhoursJam = {
    listen,
    confirm,
    cancel,
    restore,
    quantize,
    undoEdit,
    get mode() {
      return mode;
    },
  };
  paint();
})();
