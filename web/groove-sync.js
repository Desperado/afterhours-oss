'use strict';
/* Auto sync: Groove follows the beat grid detected in the Listen recording. */
(() => {
  const App = AfterhoursGrooveApp,
    {S, $g, transport} = App,
    Shell = AfterhoursShell;
  const recording = () => Shell.getEngine('recording');
  const source = () => recording()?.source();
  const mediaEvents = ['play', 'playing', 'pause', 'ended', 'waiting', 'seeking', 'seeked', 'ratechange'];
  let version = 0;

  function render(message) {
    const ready = !!source();
    $g('sync').disabled = !ready && !S.syncRequest && !S.sync;
    $g('sync').setAttribute('aria-pressed', String(!!S.sync));
    for (const button of $g('arrangement').children) button.disabled = !!S.sync || !!S.syncRequest;
    $g('sync').textContent = S.syncRequest ? 'Cancel sync' : S.sync ? 'Auto sync: on' : 'Auto sync track';
    $g('sync-status').textContent =
      message ||
      (S.sync
        ? `Following ${S.sync.title} · ${S.sync.bpm} BPM estimated · Play either engine`
        : ready
          ? 'Detect beats locally · no upload · then press Play'
          : 'Import a recording in Listen to sync its beat.');
    Shell.render();
  }
  function unlink() {
    const linked = !!S.sync;
    if (S.starting && S.sync) transport.stop('Auto sync off', true, 'ok');
    const now = S.engine?.context.currentTime,
      current = transport.audibleFrame();
    const resumeTick =
      S.sync && S.running
        ? Math.max(0, Math.floor(AfterhoursBeatGrid.beatAt(S.sync.beats, S.sync.media.currentTime) * 8) + 1)
        : S.tick;
    ++version;
    S.syncRequest?.abort();
    S.syncRequest = null;
    if (S.sync) for (const name of mediaEvents) S.sync.media.removeEventListener(name, followRecording);
    S.sync = null;
    S.syncTick = null;
    // A manual unlink continues Groove on its own clock from the next step.
    if (S.running && linked) {
      S.engine.cancelFromTick?.(resumeTick);
      if (S.transition && S.transition.absolute >= resumeTick) {
        S.queued = S.playing;
        S.playing = S.transition.playing;
        S.loopOrigin = S.transition.loopOrigin;
      }
      if (current) {
        S.playing = current.pattern;
        S.loopOrigin = current.origin;
      }
      S.tick = resumeTick;
      S.nextTime = now + 0.05;
      S.visuals = S.visuals.filter(v => v.absolute < resumeTick);
      S.hits = S.hits.filter(h => h.planTick < resumeTick);
      S.transition = null;
    }
    if (linked && S.engine) {
      S.engine.bpm = S.data.bpm;
      S.engine.setMix?.(S.data.mix);
    }
    render();
  }
  function followRecording(event) {
    if (!S.sync) return;
    if (['pause', 'ended', 'waiting'].includes(event.type)) {
      transport.stop('Synced Groove paused', false, 'ok');
      return;
    }
    if (['seeking', 'seeked', 'ratechange'].includes(event.type)) {
      S.engine?.stop();
      S.syncTick = null;
      S.transition = null;
      S.shownFrame = null;
      S.visuals = [];
      S.hits = [];
      S.shownTick = null;
    }
    if (!S.sync.media.paused && !S.sync.media.seeking) transport.play();
  }
  async function toggle() {
    if (S.sync || S.syncRequest) {
      unlink();
      return;
    }
    const current = source();
    if (!current) return;
    const request = ++version;
    const controller = (S.syncRequest = new AbortController());
    render('Finding the recording’s beat grid on this Mac…');
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(current.id)}/sync`, {
        method: 'POST',
        body: '{}',
        headers: {'Content-Type': 'application/json'},
        signal: controller.signal,
      });
      const grid = await response.json();
      if (request !== version) return;
      if (!response.ok) throw new Error(grid.error || 'Beat detection could not finish. Try again.');
      if (
        !Number.isFinite(grid.bpm) ||
        grid.bpm < 40 ||
        grid.bpm > 240 ||
        !Array.isArray(grid.beats) ||
        grid.beats.length < 8 ||
        !grid.beats.every((b, i) => Number.isFinite(b) && b >= 0 && (!i || b > grid.beats[i - 1]))
      )
        throw new Error('No usable beat grid. Set BPM manually.');
      transport.stop('Track sync ready', false, 'ok');
      S.sync = {...current, ...grid};
      S.syncTick = null;
      S.loopOrigin = 0;
      S.songStart = S.songOffset = 0;
      S.data.bpm = Math.round(grid.bpm);
      if (S.engine) S.engine.bpm = grid.bpm;
      App.save();
      for (const name of mediaEvents) S.sync.media.addEventListener(name, followRecording);
      S.syncRequest = null;
      render();
      if (!S.sync.media.paused) transport.play();
    } catch (error) {
      if (request !== version) return;
      S.syncRequest = null;
      render(error.name === 'AbortError' ? undefined : error.message);
    }
  }

  $g('sync').addEventListener('click', toggle);
  window.addEventListener('afterhours:recordingchange', () => {
    if (S.sync || S.syncRequest) {
      transport.stop('Recording changed · Auto sync off', false, 'ok');
      unlink();
    }
    render();
  });

  Object.assign(App.recordingSync, {recording, render, unlink});
})();
