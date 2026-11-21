'use strict';
(() => {
  const $ = id => document.getElementById('song-' + id),
    Synth = AfterhoursSynth,
    Live = AfterhoursGrooveLive;
  const status = text => {
    $('status').textContent = text;
  };
  const Presets = AfterhoursPresets,
    App = AfterhoursGrooveApp,
    preset = document.getElementById('groove-preset');
  const t = (s, ...a) =>
    globalThis.AfterhoursI18n?.t ? globalThis.AfterhoursI18n.t(s, ...a) : s.replace(/\{(\d+)\}/g, (_, i) => a[i]);
  // A song browsed on the MPK waits here; Play loads it, so browsing never replaces the session.
  // It belongs to the project it was chosen over: a new, imported or restored project drops it.
  let pending = null;
  const current = () => (pending?.over === App.S.data ? pending.id : null);
  const title = id => Presets.catalog.find(c => c.id === id)?.title;
  function browse(direction) {
    const list = Presets.catalog,
      loaded = Live.loadedPreset,
      from = list.findIndex(c => c.id === (current() ?? loaded ?? preset.value));
    const next =
      list[from < 0 ? (direction > 0 ? 0 : list.length - 1) : (from + direction + list.length) % list.length];
    pending = next.id === loaded ? null : {id: next.id, over: App.S.data};
    preset.value = next.id;
    preset.dispatchEvent(new Event('change'));
    status(pending ? `Selected “${next.title}” · press Play/Stop to load and play` : `Already loaded: “${next.title}”`);
  }
  function loadPending() {
    const id = current();
    pending = null;
    if (!id) return false;
    preset.value = id;
    if (!Live.loadPreset(id)) throw new Error('Could not load the song · save the current project first');
    status(`Loaded “${title(id)}”`);
    return true;
  }
  document.getElementById('groove-load-preset').addEventListener('click', () => {
    pending = null;
  });
  window.addEventListener('afterhours:midiaction', e => {
    if (window.AfterhoursPerformanceStudio?.replaying) return;
    if (e.detail.target === 'action.song-prev') browse(-1);
    if (e.detail.target === 'action.song-next') browse(1);
  });
  window.AfterhoursSongWorkflow = {
    browse,
    loadPending,
    get pending() {
      const id = current();
      return id ? title(id) : null;
    },
  };
  $('play').addEventListener('click', async () => {
    try {
      const clock = Live.clock();
      if (!clock.running && !clock.starting) {
        loadPending();
        await Live.play();
      }
      status('Song playing · play the MPK over it');
    } catch (error) {
      status(error.message);
    }
  });
  $('stop').addEventListener('click', async () => {
    Live.stop();
    try {
      // Also finish a performance take or stop its replay, like the top Stop.
      await window.AfterhoursPerformanceStudio?.stopTake();
      status('Stopped');
    } catch (error) {
      status(error.message);
    }
  });
  $('new').addEventListener('click', () => {
    if (
      !window.confirm(
        t('Start a new empty song? The current one will be replaced. If you need it, click “Save song” first.'),
      )
    )
      return;
    if (Live.blank()) status('New song · turn on the metronome, press ▶ Play and record with pads or keys');
  });
  $('metronome').addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.metronome'}})),
  );
  $('beat').addEventListener('click', () => {
    AfterhoursPerformance.store.update(s => {
      s.midi.padMode = 'beat';
    }, 'midi-profile');
    status('Pads play tracks and record hits while the song plays');
  });
  $('keys').addEventListener('click', () => {
    const armed = Live.armKeys();
    status(armed ? `Recording keys into track ${App.S.selected + 1} · press ▶ Play and play` : 'Keys recording off');
  });
  $('clear').addEventListener('click', () => Live.clearTrack());
  $('undo').addEventListener('click', () => {
    if (!Live.undoHits()) status('No recording to undo');
  });
  window.addEventListener('afterhours:midiaction', e => {
    if (e.detail.target !== 'action.keys-record' || window.AfterhoursPerformanceStudio?.replaying) return;
    const armed = Live.armKeys();
    status(armed ? `Recording keys into track ${App.S.selected + 1}` : 'Keys recording off');
  });
  $('open').addEventListener('click', () => document.getElementById('groove-import').click());
  $('save').addEventListener('click', () => {
    document.getElementById('groove-project').click();
    status('Song JSON saved to Downloads');
  });
  $('instrument').replaceChildren(
    ...Synth.presets().map(({id, name}) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      return option;
    }),
  );
  $('instrument').addEventListener('change', () => Synth.selectPreset($('instrument').value));
  $('instrument-prev').addEventListener('click', () => Synth.stepPreset(-1));
  $('instrument-next').addEventListener('click', () => Synth.stepPreset(1));
  $('instrument-edit').addEventListener('click', () => AfterhoursShell.show('synth'));
  setInterval(() => {
    const patch = Synth.snapshot();
    if (patch.id === 'groove-part' && !$('instrument').querySelector('[value="groove-part"]')) {
      const option = document.createElement('option');
      option.value = patch.id;
      option.textContent = patch.name;
      $('instrument').append(option);
    }
    if ($('instrument').value !== patch.id) $('instrument').value = patch.id;
    $('play').setAttribute('aria-pressed', String(Live.clock().running));
    $('keys').setAttribute('aria-pressed', String(Live.keysArmed));
    $('beat').setAttribute('aria-pressed', String(AfterhoursPerformance.store.state.midi.padMode === 'beat'));
    $('metronome').setAttribute(
      'aria-pressed',
      document.getElementById('jam-metronome').getAttribute('aria-pressed') || 'false',
    );
  }, 200);
})();
