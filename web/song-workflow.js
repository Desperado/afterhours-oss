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
  // A song browsed on the MPK waits here; Play loads it, so browsing never replaces the session.
  let pending = null;
  const loaded = () => Presets.catalog.find(c => c.title === App.S.data.title)?.id;
  const title = id => Presets.catalog.find(c => c.id === id)?.title;
  function browse(direction) {
    const list = Presets.catalog,
      from = list.findIndex(c => c.id === (pending ?? loaded() ?? preset.value));
    const next =
      list[from < 0 ? (direction > 0 ? 0 : list.length - 1) : (from + direction + list.length) % list.length];
    pending = next.id === loaded() ? null : next.id;
    preset.value = next.id;
    preset.dispatchEvent(new Event('change'));
    status(
      pending
        ? `Вибрано «${next.title}» · натисни Play/Stop, щоб завантажити й запустити`
        : `«${next.title}» уже завантажена`,
    );
  }
  function loadPending() {
    if (!pending) return false;
    const id = pending;
    pending = null;
    preset.value = id;
    document.getElementById('groove-load-preset').click();
    if (loaded() !== id) throw new Error('Не вдалося завантажити пісню · спершу збережи поточний проєкт');
    status(`«${title(id)}» завантажено`);
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
      return pending ? title(pending) : null;
    },
  };
  $('play').addEventListener('click', async () => {
    try {
      if (!Live.clock().running) {
        loadPending();
        await Live.play();
      }
      status('Пісня грає · грай на MPK поверх неї');
    } catch (error) {
      status(error.message);
    }
  });
  $('stop').addEventListener('click', () => {
    Live.stop();
    status('Зупинено');
  });
  $('new').addEventListener('click', () => {
    if (
      !window.confirm(
        'Почати нову порожню пісню? Поточна заміниться. Якщо вона потрібна, спершу натисни «Зберегти пісню».',
      )
    )
      return;
    if (Live.blank()) status('Нова пісня · увімкни метроном, ▶ Грати й записуй педами або клавішами');
  });
  $('metronome').addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('afterhours:midiaction', {detail: {target: 'action.metronome'}})),
  );
  $('beat').addEventListener('click', () => {
    AfterhoursPerformance.store.update(s => {
      s.midi.padMode = 'beat';
    }, 'midi-profile');
    status('Педи грають треки й записують удари, коли пісня грає');
  });
  $('keys').addEventListener('click', () => {
    const armed = Live.armKeys();
    status(armed ? `Запис клавіш у трек ${App.S.selected + 1} · натисни ▶ Грати й грай` : 'Запис клавіш вимкнено');
  });
  $('clear').addEventListener('click', () => Live.clearTrack());
  $('undo').addEventListener('click', () => {
    if (!Live.undoHits()) status('Немає запису, який можна скасувати');
  });
  window.addEventListener('afterhours:midiaction', e => {
    if (e.detail.target !== 'action.keys-record' || window.AfterhoursPerformanceStudio?.replaying) return;
    const armed = Live.armKeys();
    status(armed ? `Запис клавіш у трек ${App.S.selected + 1}` : 'Запис клавіш вимкнено');
  });
  $('open').addEventListener('click', () => document.getElementById('groove-import').click());
  $('save').addEventListener('click', () => {
    document.getElementById('groove-project').click();
    status('JSON пісні збережено у завантаження');
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
