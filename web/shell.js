'use strict';
/* Studio shell: one active engine in the strip, workspaces in the rail, one status line.
   Modules register an engine; the strip only ever drives the active one. */
window.AfterhoursShell = (() => {
  const byId = id => document.getElementById(id);
  const engines = {},
    order = ['groove', 'recording', 'ardour'];
  const store = {
    get: key => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Private mode keeps defaults. */
      }
    },
  };
  let active = order.includes(store.get('afterhours-engine')) ? store.get('afterhours-engine') : 'groove';
  let workspace = store.get('afterhours-workspace') || 'groove';

  function register(name, api) {
    engines[name] = api;
    render();
  }
  function setActive(name) {
    if (!engines[name] || active === name) return;
    active = name;
    store.set('afterhours-engine', name);
    render();
  }
  // Pressing Play inside a module makes that module the active engine.
  const touch = name => setActive(name);

  function show(name) {
    workspace = name;
    store.set('afterhours-workspace', name);
    for (const button of document.querySelectorAll('[data-ws]')) {
      if (button.dataset.ws === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const panel of document.querySelectorAll('[data-ws-panel]')) panel.hidden = panel.dataset.wsPanel !== name;
  }

  function status(text, tone = 'ok') {
    byId('status-text').textContent = text;
    byId('status-line').dataset.tone = tone;
  }

  // Called ten times a second: touch the DOM only when something changed, so idle frames don't repaint.
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setAttr = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  function render() {
    const engine = engines[active];
    for (const name of order) {
      const api = engines[name],
        button = byId('engine-' + name);
      if (!button) continue;
      const state = api ? api.state() : {text: 'Loading', dot: 'idle'};
      setAttr(button, 'aria-checked', String(name === active));
      setAttr(button, 'tabindex', name === active ? '0' : '-1');
      setText(button.querySelector('.engine-state'), state.text);
      setAttr(button.querySelector('.dot'), 'data-dot', state.dot);
      setAttr(button, 'aria-label', `${api?.label || name} engine, ${state.text}`);
    }
    const playing = !!engine && engine.playing();
    for (const [id, action] of [
      ['transport-start', 'start'],
      ['transport-play', playing ? 'stop' : 'play'],
      ['transport-stop', 'stop'],
    ]) {
      const ready = !!engine && engine.available(action);
      if (byId(id).disabled !== !ready) byId(id).disabled = !ready;
    }
    setAttr(byId('transport-play'), 'aria-pressed', String(playing));
    setAttr(byId('transport'), 'aria-label', `${engine?.label || 'Engine'} transport`);
    const position = engine ? engine.position() : {label: '', text: '—'};
    setText(byId('transport-position-label'), position.label);
    setText(byId('transport-position'), position.text);
    const tempo = engine ? engine.tempo() : {label: 'BPM', text: '—'};
    const input = byId('transport-tempo');
    setText(byId('transport-tempo-label'), tempo.label);
    if (input.readOnly !== !tempo.set) {
      input.readOnly = !tempo.set;
      input.tabIndex = tempo.set ? 0 : -1;
    }
    if (document.activeElement !== input && input.value !== tempo.text) input.value = tempo.text;
    const slider = byId('transport-tempo-slider');
    if (slider.hidden !== !tempo.set) slider.hidden = !tempo.set;
    if (tempo.set && Number(slider.value) !== Number(tempo.text)) slider.value = tempo.text;
    let playingCount = order.filter(name => engines[name]?.playing()).length;
    if (engines.groove?.synced() && engines.groove.playing() && engines.recording?.playing()) playingCount--;
    if (byId('chip-separate-clock').hidden !== playingCount < 2) byId('chip-separate-clock').hidden = playingCount < 2;
  }

  // Shared knob: drag vertically (Shift = fine), arrows ±1 step, PgUp/PgDn ×10, Home/End, Delete resets.
  function knob(o) {
    const decimals = String(o.step).split('.')[1]?.length || 0;
    const clamp = v => Math.min(o.max, Math.max(o.min, Number((Math.round(v / o.step) * o.step).toFixed(decimals))));
    const wrap = document.createElement('div');
    wrap.className = o.fader ? 'level-control' : `knob${o.size ? ' knob-' + o.size : ''}`;
    const ring = document.createElement(o.fader ? 'input' : 'div');
    ring.className = o.fader ? 'level-slider' : 'knob-ring';
    if (o.fader) {
      ring.type = 'range';
      ring.min = o.min;
      ring.max = o.max;
      ring.step = o.step;
    }
    ring.tabIndex = 0;
    ring.setAttribute('role', 'slider');
    ring.setAttribute('aria-label', o.label);
    ring.setAttribute('aria-valuemin', o.min);
    ring.setAttribute('aria-valuemax', o.max);
    if (o.id) ring.id = o.id;
    const cap = document.createElement('div');
    cap.className = 'knob-cap';
    if (!o.fader) ring.append(cap);
    const name = document.createElement('span');
    name.className = 'knob-label';
    name.textContent = o.name || o.label;
    const out = document.createElement('output');
    out.className = 'knob-value';
    const sub = document.createElement('span');
    sub.className = 'knob-sub';
    wrap.append(ring, name, out, sub);
    let value = clamp(o.value),
      locked = false;
    function paint() {
      const p = (value - o.min) / (o.max - o.min),
        deg = p * 270;
      const [a, b] = o.bipolar ? [Math.min(135, deg), Math.max(135, deg, Math.min(135, deg) + 3)] : [0, deg];
      ring.style.setProperty('--a', `${a}deg`);
      ring.style.setProperty('--b', `${b}deg`);
      ring.style.setProperty('--turn', `${deg - 135}deg`);
      const text = o.format ? o.format(value) : String(value);
      out.textContent = text;
      ring.setAttribute('aria-valuenow', value);
      ring.setAttribute('aria-valuetext', `${text}${locked ? ', locked' : ''}`);
      if (o.fader) ring.value = value;
      wrap.classList.toggle('is-locked', locked);
    }
    function change(v) {
      if (ring.getAttribute('aria-disabled') === 'true') {
        paint();
        return;
      }
      const next = clamp(v);
      if (next === value) return;
      value = next;
      paint();
      o.onInput?.(value);
    }
    let drag = null;
    if (o.fader) ring.addEventListener('input', () => change(Number(ring.value)));
    ring.addEventListener('pointerdown', event => {
      if (o.fader) return;
      if (event.button !== 0 || ring.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      ring.focus();
      ring.setPointerCapture(event.pointerId);
      drag = {y: event.clientY, value};
      wrap.classList.add('is-dragging');
    });
    ring.addEventListener('pointermove', event => {
      if (!drag) return;
      change(drag.value + ((drag.y - event.clientY) * (o.max - o.min)) / (event.shiftKey ? 1500 : 150));
    });
    const end = () => {
      drag = null;
      wrap.classList.remove('is-dragging');
    };
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
    ring.addEventListener('keydown', event => {
      if (ring.getAttribute('aria-disabled') === 'true') return;
      const big = (o.max - o.min) / 10;
      const delta = {
        ArrowUp: o.step,
        ArrowRight: o.step,
        ArrowDown: -o.step,
        ArrowLeft: -o.step,
        PageUp: Math.max(o.step, big),
        PageDown: -Math.max(o.step, big),
      }[event.key];
      if (delta !== undefined) {
        event.preventDefault();
        change(value + delta);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        change(o.min);
      } else if (event.key === 'End') {
        event.preventDefault();
        change(o.max);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && o.onReset) {
        event.preventDefault();
        o.onReset();
      }
    });
    if (o.performanceId) {
      ring.dataset.midiTarget = o.performanceId;
      ring.title = 'Right-click to learn a MIDI control';
      window.AfterhoursPerformance?.register(o.performanceId, {
        label: o.label,
        min: o.min,
        max: o.max,
        get: () => value,
        set: change,
      });
      ring.addEventListener('contextmenu', e => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('afterhours:midilearn', {detail: o.performanceId}));
      });
    }
    paint();
    return {
      el: wrap,
      ring,
      set(v, isLocked = locked) {
        value = clamp(v);
        locked = isLocked;
        paint();
      },
      sub(text) {
        sub.textContent = text || '';
      },
      get value() {
        return value;
      },
    };
  }

  function typing(target) {
    return (
      /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName) ||
      target.isContentEditable ||
      target.closest('[data-own-keys]')
    );
  }
  function init() {
    byId('transport-play').addEventListener('click', () => {
      const engine = engines[active];
      if (!engine) return;
      const action = engine.playing() ? 'stop' : 'play';
      if (engine.available(action)) engine[action]();
    });
    byId('transport-stop').addEventListener('click', () => {
      const engine = engines[active];
      if (engine?.available('stop')) engine.stop();
    });
    byId('transport-start').addEventListener('click', () => {
      const engine = engines[active];
      if (engine?.available('start')) engine.start();
    });
    const setTempo = event => {
      const tempo = engines[active]?.tempo();
      if (tempo?.set) tempo.set(Number.parseFloat(event.target.value));
      render();
    };
    byId('transport-tempo').addEventListener('change', setTempo);
    byId('transport-tempo-slider').addEventListener('input', setTempo);
    for (const button of document.querySelectorAll('[data-engine]'))
      button.addEventListener('click', () => setActive(button.dataset.engine));
    byId('engines').addEventListener('keydown', event => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
      if (!step) return;
      event.preventDefault();
      const next = order[(order.indexOf(active) + step + order.length) % order.length];
      setActive(next);
      byId('engine-' + next).focus();
    });
    for (const button of document.querySelectorAll('[data-ws]'))
      button.addEventListener('click', () => show(button.dataset.ws));
    byId('help-open').addEventListener('click', () => byId('help-sheet').showModal());
    byId('help-close').addEventListener('click', () => byId('help-sheet').close());
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        byId('transport-play').click();
      } else if (event.key === '?') {
        event.preventDefault();
        byId('help-sheet').showModal();
      }
    });
    const volume = byId('output-volume');
    const paintVolume = () => {
      if (!window.AfterhoursAudio) return;
      volume.value = AfterhoursAudio.volume;
      byId('output-volume-value').textContent = `${Math.round(AfterhoursAudio.volume * 100)}%`;
      volume.setAttribute('aria-valuetext', byId('output-volume-value').textContent);
    };
    volume.addEventListener('input', () => AfterhoursAudio.setVolume(Number(volume.value)));
    window.addEventListener('afterhours:volume', paintVolume);
    document.addEventListener('DOMContentLoaded', paintVolume, {once: true});
    paintVolume();
    show(document.querySelector(`[data-ws="${workspace}"]`) ? workspace : 'groove');
    setInterval(render, 100);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  return {
    register,
    getEngine: name => engines[name],
    setActive,
    touch,
    show,
    status,
    knob,
    fader: options => knob({...options, fader: true}),
    render,
    get active() {
      return active;
    },
  };
})();
