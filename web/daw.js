'use strict';
(() => {
  let session = null,
    pending = 0,
    polling = false;
  let bass = null,
    bassTrack = null,
    surgeTracks = [];
  // Last transport report from Ardour; the strip interpolates time between polls.
  let clock = {rolling: false, sample: 0, speed: 0, rate: 48000, at: performance.now(), tempo: null};
  const gainText = db => (db <= -193 ? '−∞' : Number(db).toFixed(1));
  // Ardour accepts −193 dB as silence. Spend the fader on the audible −60…+6 dB range;
  // its bottom notch sends −∞.
  const sliderGain = db => (db < -60 ? -61 : db),
    faderGain = value => (value < -60 ? -193 : value);
  const post = data =>
    request('/api/daw', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...data, session}),
    });
  function offline(message) {
    session = null;
    bass = null;
    bassTrack = null;
    clock.rolling = false;
    $('daw-bass').hidden = true;
    $('daw-session').hidden = true;
    $('daw-offline').hidden = false;
    $('daw-error').hidden = !message;
    $('daw-error').textContent = message ? `× Last try: ${message}` : '';
    $('daw-offline-title').textContent = message ? 'Ardour isn’t answering' : 'Ardour isn’t connected';
  }
  function busy(delta) {
    pending += delta;
    for (const id of ['daw-connect', 'daw-refresh', 'daw-save', 'bass-refresh', 'bass-track'])
      $(id).disabled = pending > 0;
    AfterhoursShell.render();
  }

  /* ── Surge XT editor ─────────────────────────────────────── */
  const routing = [
    ['0.005', 'Off'],
    ['0.335', '2→1'],
    ['0.665', '3→2→1'],
    ['0.995', '2+3→1'],
  ];
  const bassKnobs = [
    ['A FM Depth', 'FM depth', value => `${(value * 72 - 48).toFixed(1)}dB`],
    ['A Filter 1 Cutoff', 'Brightness'],
    ['A Filter 1 Resonance', 'Resonance'],
    ['A Feedback', 'Feedback', value => `${value >= 0.5 ? '+' : ''}${((value - 0.5) * 2).toFixed(2)}`],
    ['A Pre-Filter Gain', 'Drive'],
    ['A Amp EG Attack', 'Attack'],
    ['A Amp EG Release', 'Release'],
  ];
  const percent = value => `${Math.round(value * 100)}%`;
  const changed = control => Math.abs(control.confirmed - control.original) > 0.0005;
  async function loadBass(track) {
    bass = null;
    bassTrack = track;
    $('daw-bass').hidden = !track;
    $('bass-controls').replaceChildren();
    $('bass-routing').replaceChildren();
    markMixerSelection();
    if (!track) return;
    $('bass-title').textContent = track.name;
    const plugin = track.plugins.find(p => p.name === 'Surge XT');
    if (!plugin) {
      $('bass-status').textContent = `${track.name} needs Surge XT`;
      return;
    }
    $('bass-status').textContent = `Reading ${track.name}…`;
    const expectedSession = session;
    try {
      const description = await post({action: 'inspect_plugin', id: track.id, pluginIndex: plugin.index});
      if (session !== expectedSession || bassTrack !== track) return;
      const editor = {
        session,
        id: track.id,
        pluginIndex: plugin.index,
        pluginId: description.plugin.uniqueId,
        queued: new Map(),
        sending: false,
        failed: false,
        controls: [],
      };
      bass = editor;
      const find = label =>
        description.parameters.find(
          p => p.label === label && p.isInput && p.isControl && !p.isHidden && Number.isFinite(p.currentInterface),
        );
      const change = (control, value) => {
        if (bass !== editor || editor.failed) return;
        control.show(value);
        editor.queued.set(control.parameter.index, {control, value});
        if (!editor.sending) sendBass(editor);
      };
      const routeParameter = find('A FM Routing');
      if (routeParameter) {
        const group = element('div', 'seg');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', `${track.name} FM routing`);
        const control = {
          parameter: routeParameter,
          original: routeParameter.currentInterface,
          confirmed: routeParameter.currentInterface,
          inputs: [],
        };
        control.show = value => {
          const nearest = routing.reduce((best, option) =>
            Math.abs(Number(option[0]) - value) < Math.abs(Number(best[0]) - value) ? option : best,
          )[0];
          for (const b of group.children) b.setAttribute('aria-checked', String(b.dataset.value === nearest));
        };
        for (const [value, text] of routing) {
          const b = element('button', '', text);
          b.type = 'button';
          b.dataset.value = value;
          b.setAttribute('role', 'radio');
          b.addEventListener('click', () => change(control, Number(value)));
          group.append(b);
          control.inputs.push(b);
        }
        control.show(control.original);
        const row = element('div', 'field-grid');
        row.append(element('span', 'micro-label', 'FM routing'), group);
        $('bass-routing').append(row);
        editor.controls.push(control);
      }
      for (const [label, name, format = percent] of bassKnobs) {
        const parameter = find(label);
        if (!parameter) continue;
        const control = {parameter, original: parameter.currentInterface, confirmed: parameter.currentInterface};
        const knob = AfterhoursShell.knob({
          label: `${track.name} ${name}`,
          name,
          min: 0,
          max: 1,
          step: 0.001,
          value: control.original,
          format,
          onInput: value => change(control, value),
          onReset: () => change(control, control.original),
        });
        const reset = element('button', 'knob-reset', '↶ Reset');
        reset.type = 'button';
        reset.hidden = true;
        reset.setAttribute('aria-label', `Restore ${track.name} ${name} to loaded value`);
        reset.addEventListener('click', () => change(control, control.original));
        knob.el.append(reset);
        control.show = value => {
          knob.set(value, Math.abs(value - control.original) > 0.0005);
          reset.hidden = Math.abs(value - control.original) <= 0.0005;
        };
        control.knob = knob;
        control.inputs = [knob.ring, reset];
        control.show(control.original);
        $('bass-controls').append(knob.el);
        editor.controls.push(control);
      }
      $('bass-status').textContent = editor.controls.length
        ? `Live on ${track.name}`
        : 'This Surge XT version lacks these controls';
    } catch (error) {
      $('bass-status').textContent = error.message;
    }
  }
  async function sendBass(editor) {
    editor.sending = true;
    busy(1);
    try {
      // One request in flight. Keep only the latest position of each control.
      while (bass === editor && session === editor.session && editor.queued.size) {
        const [index, {control, value}] = editor.queued.entries().next().value;
        editor.queued.delete(index);
        const actual = await request('/api/daw', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            action: 'parameter',
            session: editor.session,
            id: editor.id,
            pluginIndex: editor.pluginIndex,
            pluginId: editor.pluginId,
            parameterIndex: index,
            label: control.parameter.label,
            interface: value,
          }),
        });
        if (bass !== editor || session !== editor.session) return;
        if (!Number.isFinite(actual.interface)) throw new Error('Ardour did not confirm this control');
        control.confirmed = actual.interface;
        if (!editor.queued.has(index)) control.show(actual.interface);
        const edited = editor.controls.filter(changed).length;
        $('bass-status').textContent = edited
          ? `◆ ${edited} changed · Save session to keep`
          : `Live on ${bassTrack.name}`;
        AfterhoursShell.status(`${control.parameter.label.replace(/^A /, '')} → ${bassTrack.name}`, 'ok');
      }
    } catch (error) {
      editor.queued.clear();
      editor.failed = true;
      if (bass === editor) {
        $('bass-status').textContent = `${error.message} · refresh to continue`;
        for (const control of editor.controls) {
          control.show(control.confirmed);
          for (const input of control.inputs) {
            input.setAttribute('aria-disabled', 'true');
            input.classList.add('is-disabled');
          }
        }
      }
    } finally {
      editor.sending = false;
      busy(-1);
    }
  }
  $('bass-track').addEventListener('change', async () => {
    busy(1);
    try {
      await loadBass(surgeTracks.find(track => track.id === $('bass-track').value));
    } finally {
      busy(-1);
    }
  });
  $('bass-refresh').addEventListener('click', async () => {
    busy(1);
    try {
      await loadBass(bassTrack);
    } finally {
      busy(-1);
    }
  });

  /* ── transport and status ────────────────────────────────── */
  function transport(data) {
    if (data && typeof data === 'object') {
      clock = {
        ...clock,
        rolling: data.rolling === true,
        speed: Number(data.speed) || (data.rolling ? 1 : 0),
        sample: Number.isFinite(data.sample) ? data.sample : clock.sample,
        at: performance.now(),
      };
    }
    $('daw-status').textContent = data?.rolling ? 'Playing in Ardour' : 'Stopped in Ardour';
  }
  setInterval(async () => {
    if (!session || pending || polling || document.hidden) return;
    const expectedSession = session;
    polling = true;
    try {
      const data = await request('/api/daw/state');
      if (pending || session !== expectedSession) return;
      if (data.connected === false) {
        offline(data.message);
        return;
      }
      if (data.sessionName !== session) {
        offline('The session changed · reconnect');
        return;
      }
      transport(data.transport);
    } catch (error) {
      if (!pending && session === expectedSession) offline(error.message);
    } finally {
      polling = false;
    }
  }, 1500);
  async function command(action) {
    if (!session || (pending && action !== 'stop')) return;
    if (action !== 'save') AfterhoursShell.touch('ardour');
    busy(1);
    try {
      const result = await post({action});
      if (action === 'save') {
        $('daw-status').textContent = result.saved ? 'Session saved' : 'Ardour did not confirm saving';
        AfterhoursShell.status(
          result.saved ? 'Ardour session saved' : 'Save not confirmed',
          result.saved ? 'ok' : 'err',
        );
      } else transport(result);
    } catch (error) {
      $('daw-status').textContent = error.message;
      AfterhoursShell.status(error.message, 'err');
    } finally {
      busy(-1);
    }
  }

  /* ── mixer ───────────────────────────────────────────────── */
  const scale = [6, 0, -12, -24, -48];
  function markMixerSelection() {
    for (const strip of document.querySelectorAll('.daw-track'))
      strip.classList.toggle('selected', strip.dataset.id === bassTrack?.id);
  }
  function trackStrip(track) {
    const strip = element('div', 'daw-track');
    strip.dataset.id = track.id;
    const head = element('div', 'ch-head');
    head.append(
      element('strong', '', track.name),
      element('small', 'mono', track.plugins[0]?.name || track.type.replace('_', ' ')),
    );
    const fader = element('div', 'fader');
    const marks = element('div', 'fader-scale mono');
    marks.setAttribute('aria-hidden', 'true');
    for (const db of [...scale, '−∞']) {
      const mark = element('span', '', String(db));
      mark.style.bottom = `${(((typeof db === 'number' ? db : -61) + 61) / 67) * 100}%`;
      marks.append(mark);
    }
    const slider = element('input');
    slider.className = 'vfader';
    slider.type = 'range';
    slider.min = '-61';
    slider.max = '6';
    slider.step = '0.1';
    slider.value = sliderGain(track.db);
    slider.setAttribute('aria-label', `${track.name} gain in Ardour`);
    const output = element('output', 'mono', gainText(track.db));
    slider.setAttribute('aria-valuetext', `${gainText(track.db)} dB`);
    fader.append(marks, slider);
    strip.append(head, fader, output);
    let queued = null,
      sending = false,
      confirmed = track.db;
    const show = db => {
      slider.value = sliderGain(db);
      output.textContent = gainText(db);
      slider.setAttribute('aria-valuetext', `${gainText(db)} dB`);
    };
    slider.addEventListener('input', async () => {
      queued = faderGain(Number(slider.value));
      output.textContent = gainText(queued);
      slider.setAttribute('aria-valuetext', `${gainText(queued)} dB`);
      if (sending) return;
      sending = true;
      busy(1);
      try {
        while (queued !== null && session) {
          const db = queued;
          queued = null;
          const actual = await post({action: 'fader', id: track.id, db});
          confirmed = actual.db;
          if (queued === null) show(actual.db);
        }
      } catch (error) {
        // Keep the session open; the status poll disconnects if Ardour itself is gone.
        queued = null;
        show(confirmed);
        $('daw-status').textContent = `${track.name}: ${error.message}`;
        AfterhoursShell.status(`${track.name}: ${error.message}`, 'err');
      } finally {
        sending = false;
        busy(-1);
      }
    });
    if (track.plugins.some(p => p.name === 'Surge XT')) {
      head.classList.add('pickable');
      head.title = 'Edit this Surge XT';
      head.addEventListener('click', () => {
        if ($('bass-track').value !== track.id) {
          $('bass-track').value = track.id;
          $('bass-track').dispatchEvent(new Event('change'));
        }
      });
    }
    return strip;
  }
  async function connect() {
    busy(1);
    try {
      const data = await request('/api/daw');
      if (!data.connected) {
        offline(data.message);
        AfterhoursShell.status('Ardour offline', 'err');
        return;
      }
      session = data.session.sessionName;
      clock.rate = Number(data.session.sampleRate) || 48000;
      clock.tempo = data.session.tempoBpm;
      $('daw-offline').hidden = true;
      $('daw-session').hidden = false;
      $('daw-title').textContent = session;
      $('daw-bpm').textContent = number(data.session.tempoBpm, 0);
      $('daw-routes').textContent = String(data.tracks.length);
      $('daw-omitted').textContent = data.omitted_tracks ? `+${data.omitted_tracks} more in Ardour` : '';
      $('daw-tracks').replaceChildren(...data.tracks.map(trackStrip));
      transport(data.session.transport);
      AfterhoursShell.status(`Connected · ${session}`, 'ok');
      surgeTracks = data.tracks.filter(track => track.plugins.some(p => p.name === 'Surge XT'));
      const picker = $('bass-track');
      picker.replaceChildren(
        ...surgeTracks.map(track => {
          const o = element('option', '', track.name);
          o.value = track.id;
          return o;
        }),
      );
      picker.closest('label').hidden = surgeTracks.length < 2;
      $('bass-title').hidden = surgeTracks.length >= 2;
      const chosen =
        surgeTracks.find(track => track.id === bassTrack?.id) ||
        surgeTracks.find(track => track.name === 'Night Bass') ||
        surgeTracks[0];
      if (chosen) picker.value = chosen.id;
      await loadBass(chosen);
    } catch (error) {
      offline(error.message);
    } finally {
      busy(-1);
    }
  }
  $('daw-connect').addEventListener('click', connect);
  $('daw-refresh').addEventListener('click', connect);
  $('daw-save').addEventListener('click', () => command('save'));
  $('daw-setup-toggle').addEventListener('click', () => {
    const open = $('daw-setup').hidden;
    $('daw-setup').hidden = !open;
    $('daw-setup-toggle').setAttribute('aria-expanded', String(open));
  });

  const clockSeconds = () => {
    const elapsed = clock.rolling ? ((performance.now() - clock.at) / 1000) * (clock.speed || 1) : 0;
    return clock.sample / clock.rate + elapsed;
  };
  const clockText = seconds =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  AfterhoursShell.register('ardour', {
    label: 'Ardour',
    available: action => !!session && (action === 'stop' || !pending),
    playing: () => !!session && clock.rolling,
    state: () =>
      !session
        ? {text: 'Offline', dot: 'off'}
        : clock.rolling
          ? {text: 'Playing', dot: 'live'}
          : {text: 'Ready', dot: 'ok'},
    play: () => command('play'),
    stop: () => command('stop'),
    start: () => command('rewind'),
    position: () => ({label: 'Ardour · time', text: session ? clockText(clockSeconds()) : '--:--.-'}),
    tempo: () => ({label: 'BPM', text: session && clock.tempo ? number(clock.tempo, 0) : '—'}),
  });
})();
