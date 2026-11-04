'use strict';
/* Groove files: WAV, song and MIDI exports, project JSON and MIDI overlays. */
(() => {
  const App = AfterhoursGrooveApp,
    {S, LETTERS, $g, el, status, pattern, save, flushSave, ui, transport, recordingSync} = App,
    G = AfterhoursGroove,
    P = AfterhoursPresets,
    Shell = AfterhoursShell;
  let midiSource = null;

  const download = (bytes, type, name) => {
    const url = URL.createObjectURL(new Blob([bytes], {type})),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  async function exportWav(lane = null) {
    if (S.exporting) return;
    S.exporting = true;
    $g('wav').disabled = $g('stem').disabled = true;
    try {
      const frozen = G.clone(pattern()),
        bpm = S.data.bpm,
        swing = S.data.swing,
        active = S.data.active,
        mix = G.clone(S.data.mix || {});
      const cycles = 4,
        secondsPerBeat = 60 / bpm,
        duration = frozen.length * 0.25 * cycles * secondsPerBeat;
      // A stem always includes the selected lane, even if it is muted in the mix.
      if (lane !== null)
        frozen.tracks.forEach((t, i) => {
          t.solo = i === lane;
          t.mute = false;
        });
      const planned = [];
      for (let n = 0; n < frozen.length * 2 * cycles; n++) planned.push(...G.events(frozen, n, {swing}));
      if (planned.reduce((sum, e) => sum + G.notes(e.settings).length, 0) > 2200)
        throw new Error('Too dense · export single tracks');
      status('Rendering WAV…');
      // Pulse can extend the patch decay by up to 25%.
      const instrumentPatterns = [{tracks: frozen.tracks.filter((_, i) => planned.some(e => e.lane === i))}];
      await AfterhoursInstruments.prepare(instrumentPatterns);
      const tail = Math.max(
        planned.some(e => e.gate * secondsPerBeat + e.settings.decay * 1.25 > 4) ? 10 : 4.5,
        AfterhoursInstruments.tail(instrumentPatterns, bpm),
      );
      const ctx = new OfflineAudioContext(2, Math.ceil((duration + 0.25 * secondsPerBeat + tail) * 48000), 48000);
      await AfterhoursLadder.prepare(ctx);
      if (!(await AfterhoursVoice.prepare(ctx)) && planned.some(e => e.settings.machine === 'Analog'))
        throw AfterhoursVoice.unavailable('export cancelled');
      await AfterhoursSamples.prepare([{tracks: planned.map(e => e.settings)}]);
      await AfterhoursInstruments.prepare([{tracks: planned.map(e => e.settings)}]);
      const performanceState = AfterhoursPerformance.snapshot(),
        controllerState = AfterhoursController.snapshot();
      if (!['all', 'groove'].includes(performanceState.controllerTarget)) controllerState.enabled = false;
      if (lane !== null)
        performanceState.mixer.lanes.forEach((p, i) => {
          p.mute = i !== lane;
          p.solo = i === lane;
        });
      const renderer = new FMGrooveAudio(ctx, bpm, controllerState, performanceState);
      renderer.setMix(mix);
      renderer.started = 0.25 * secondsPerBeat;
      const result = await renderer.render(planned.map(e => ({event: e, time: (e.beat + 0.25) * secondsPerBeat})));
      download(
        FMGrooveAudio.wav(result),
        'audio/wav',
        `afterhours-${LETTERS[active]}-${bpm}bpm-${lane === null ? 'mix' : frozen.tracks[lane].machine}.wav`,
      );
      renderer.dispose();
      status('WAV exported · 48 kHz 24-bit stereo');
    } catch (e) {
      status(`WAV failed · ${e.message}`, 'err');
    } finally {
      S.exporting = false;
      $g('wav').disabled = $g('stem').disabled = false;
    }
  }
  async function exportSong() {
    if (S.exporting || !S.data.arrangement?.length) return;
    S.exporting = true;
    $g('wav').disabled = $g('stem').disabled = true;
    ui.renderTrack();
    try {
      S.data.performance = AfterhoursPerformance.project();
      const frozen = G.clone(S.data),
        controllerState = AfterhoursController.snapshot(),
        spb = 60 / frozen.bpm,
        sampleRate = 48000;
      if (!['all', 'groove'].includes(frozen.performance.controllerTarget)) controllerState.enabled = false;
      const ticks = frozen.arrangement.reduce((sum, s) => sum + s.bars * 32, 0);
      // Bound output allocation for both built-in and imported arrangements.
      const seconds = (ticks / 8) * spb;
      if (seconds > 360) throw new Error('Song export limit is 6 minutes');
      // Eight-step gates at 40 BPM can hold for six seconds, plus decay.
      // Keep enough overlap for them when rendering four-bar chunks.
      // Only load instruments that participate in this arrangement, including section lane masks.
      const instrumentTracks = new Map();
      for (let n = 0; n < ticks; n++)
        for (const e of P.songEvents(frozen, n, {swing: frozen.swing}))
          if (e.settings.machine === 'Instrument') instrumentTracks.set(e.settings.steps, e.settings);
      const instrumentPatterns = [{tracks: [...instrumentTracks.values()]}];
      await AfterhoursInstruments.prepare(instrumentPatterns);
      const tail = Math.max(
        frozen.patterns.some(p =>
          p.tracks.some(t =>
            t.steps.some(s => s.on && ((s.gate * 0.25) / t.rate) * spb + (s.locks.decay ?? t.decay) * 1.25 > 4),
          ),
        )
          ? 10
          : 6,
        AfterhoursInstruments.tail(instrumentPatterns, frozen.bpm),
      );
      const output = new AudioBuffer({
        numberOfChannels: 2,
        length: Math.ceil((seconds + tail) * sampleRate),
        sampleRate,
      });
      const instrumentSequence = new Map();
      for (let start = 0; start < ticks; start += 128) {
        const end = Math.min(ticks, start + 128),
          planned = [];
        for (let n = start; n < end; n++) planned.push(...P.songEvents(frozen, n, {swing: frozen.swing}));
        if (planned.reduce((sum, e) => sum + G.notes(e.settings).length, 0) > 2200)
          throw new Error('Song too dense · simplify retriggers');
        await AfterhoursSamples.prepare([{tracks: planned.map(e => e.settings)}]);
        await AfterhoursInstruments.prepare([{tracks: planned.map(e => e.settings)}]);
        status(`Rendering song · ${Math.round((start / ticks) * 100)}%`);
        const lead = 0.25 * spb;
        const ctx = new OfflineAudioContext(
          2,
          Math.ceil((((end - start) / 8) * spb + lead + tail) * sampleRate),
          sampleRate,
        );
        await AfterhoursLadder.prepare(ctx);
        if (!(await AfterhoursVoice.prepare(ctx)) && planned.some(e => e.settings.machine === 'Analog'))
          throw AfterhoursVoice.unavailable('export cancelled');
        const renderer = new FMGrooveAudio(
          ctx,
          frozen.bpm,
          controllerState,
          AfterhoursPerformanceCore.validate(frozen.performance),
        );
        renderer.instrumentSequence = instrumentSequence;
        renderer.started = lead - (start / 8) * spb;
        renderer.setMix(frozen.mix);
        const hits = planned.map(e => ({event: e, time: (e.beat - start / 8) * spb + lead}));
        // Future closed hats must choke this chunk's ringing tails without playing their audio twice.
        // Include two ticks of margin for negative microtiming near the overlap's end.
        for (let n = end; n < Math.min(ticks, end + Math.ceil((tail * 8) / spb) + 2); n++)
          for (const event of P.songEvents(frozen, n, {swing: frozen.swing}))
            if (
              event.settings.machine === 'Instrument' &&
              event.settings.instrument === 'virtuosity-drums' &&
              event.settings.note === 42
            ) {
              const time = (event.beat - start / 8) * spb + lead;
              if (time < ctx.length / sampleRate) hits.push({time, chokeOnly: true});
            }
        const part = await renderer.render(hits),
          offset = Math.round(((start / 8) * spb - lead) * sampleRate);
        for (let c = 0; c < 2; c++) {
          const dest = output.getChannelData(c),
            src = part.getChannelData(c);
          for (let i = Math.max(0, -offset); i < src.length && offset + i < dest.length; i++)
            dest[offset + i] += src[i];
        }
        renderer.dispose();
      }
      download(
        FMGrooveAudio.wav(output),
        'audio/wav',
        `${
          (frozen.title || 'afterhours-song')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-+|-+$/g, '') || 'afterhours-song'
        }-${frozen.bpm}bpm.wav`,
      );
      status('Full song exported · 48 kHz 24-bit stereo');
    } catch (e) {
      status(`Song export failed · ${e.message}`, 'err');
    } finally {
      S.exporting = false;
      $g('wav').disabled = $g('stem').disabled = false;
      ui.renderTrack();
    }
  }

  const menu = $g('export-menu'),
    menuButton = $g('export');
  const closeMenu = () => {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  };
  menuButton.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
  });
  menu.addEventListener('click', closeMenu);
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('button')],
      i = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      closeMenu();
      menuButton.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.menu')) closeMenu();
  });

  $g('project').addEventListener('click', () => {
    S.data.performance = AfterhoursPerformance.project();
    download(G.serialize(S.data), 'application/json', 'afterhours-fm.json');
  });
  $g('import').addEventListener('click', () => $g('file').click());
  $g('file').addEventListener('change', async () => {
    const file = $g('file').files[0];
    if (!file) return;
    try {
      // Larger song banks can contain up to 32 independently editable phrases.
      if (file.size > 8 * 1024 * 1024) throw new Error('Project limit is 8 MiB');
      const imported = G.validate(JSON.parse(await file.text()));
      transport.stop();
      recordingSync.unlink();
      S.songMode = false;
      S.songStart = S.songOffset = 0;
      S.data = imported;
      AfterhoursPerformance.load(S.data.performance);
      save();
      ui.renderAll();
      status('Project imported');
    } catch (e) {
      status(`Import failed · ${e.message}`, 'err');
    } finally {
      $g('file').value = '';
    }
  });
  $g('open-midi').addEventListener('click', () => $g('midi-file').click());
  $g('midi-file').addEventListener('change', async () => {
    const file = $g('midi-file').files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('MIDI limit is 2 MiB');
      midiSource = AfterhoursMIDI.read(await file.arrayBuffer());
      $g('midi-part').replaceChildren(
        ...midiSource.parts.map((part, i) => {
          const option = el('option', '', `${part.name} · ${part.notes.length} notes`);
          option.value = i;
          return option;
        }),
      );
      const first = Math.max(
        0,
        midiSource.parts.findIndex(part => part.channel !== 9),
      );
      $g('midi-part').value = first;
      $g('midi-transpose').value = 0;
      $g('midi-melodic').checked = false;
      $g('midi-bar').value = Math.floor(midiSource.parts[first].notes[0].beat / 4) + 1;
      $g('midi-result').textContent =
        `${file.name} · source ${midiSource.bpm.toFixed(1)} BPM · destination ${S.data.bpm} BPM`;
      $g('midi-dialog').showModal();
    } catch (e) {
      status(`MIDI import failed · ${e.message}`, 'err');
    } finally {
      $g('midi-file').value = '';
    }
  });
  $g('cancel-midi').addEventListener('click', () => $g('midi-dialog').close());
  $g('apply-midi').addEventListener('click', () => {
    try {
      const imported = AfterhoursMIDI.overlay(
        S.data,
        midiSource.parts[Number($g('midi-part').value)],
        $g('midi-bar').valueAsNumber,
        $g('midi-transpose').valueAsNumber,
        $g('midi-melodic').checked,
      );
      if (!localStorage.getItem(App.keys.backup)) localStorage.setItem(App.keys.backup, G.serialize(S.data));
      transport.stop();
      recordingSync.unlink();
      S.songStart = S.songOffset = 0;
      S.data = imported.project;
      S.songMode = false;
      S.selected = imported.lanes[0];
      S.page = 0;
      S.selectedStep = 0;
      const saved = flushSave();
      ui.renderAll();
      Shell.touch('groove');
      Shell.render();
      $g('midi-dialog').close();
      if (saved)
        status(
          `MIDI added · ${imported.count} notes · lanes ${imported.lanes.map(i => i + 1).join(', ')} · ${imported.shortened} long gates shortened · press Play`,
        );
    } catch (e) {
      $g('midi-result').textContent = e.message;
    }
  });
  $g('midi').addEventListener('click', () => {
    download(
      G.midi(pattern(), S.data.bpm, S.data.swing),
      'audio/midi',
      `afterhours-${LETTERS[S.data.active]}-${S.data.bpm}bpm.mid`,
    );
    status(`MIDI exported · ${pattern().tracks.length} tracks`);
  });
  $g('wav').addEventListener('click', () => exportWav());
  $g('stem').addEventListener('click', () => exportWav(S.selected));
  $g('song-wav').addEventListener('click', exportSong);
})();
