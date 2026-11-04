'use strict';
(() => {
  const C = AfterhoursController,
    S = AfterhoursShell,
    $ = id => document.getElementById('controller-' + id),
    knobs = new Map();
  const presets = {
    original: {name: 'Original', values: {}},
    velvet: {name: 'Velvet drift', values: {cutoff: 83, drive: 0.13, motion: 0.35, rate: 0.4, space: 0.25, cents: -7}},
    wire: {
      name: 'Wire ritual',
      values: {cutoff: 70, resonance: 3.2, drive: 0.3, space: 0.22, scale: 'dorian', temperament: 'pythagorean'},
    },
    glass: {name: 'Nineteen moons', values: {cutoff: 94, motion: 0.25, rate: 1.2, space: 0.45, temperament: '19edo'}},
    dream: {name: 'Whole-tone dream', values: {cutoff: 88, motion: 0.45, rate: 0.2, space: 0.55, scale: 'whole'}},
    garden: {name: 'Suspended garden', values: {cutoff: 78, space: 0.35, scale: 'hirajoshi', temperament: 'just'}},
  };
  let selected = 'a';
  const performance = AfterhoursPerformance;
  const open = value => {
    $('panel').hidden = !value;
    $('toggle').setAttribute('aria-expanded', String(value));
  };
  $('toggle').addEventListener('click', () => open($('panel').hidden));
  $('close').addEventListener('click', () => {
    open(false);
    $('toggle').focus();
  });
  for (const [key, control] of Object.entries(C.controls)) {
    const k = S.knob({
      ...control,
      performanceId: 'controller.' + key,
      label: 'Controller ' + control.label,
      name: control.label,
      format: v =>
        key === 'transpose'
          ? `${v > 0 ? '+' : ''}${v} st`
          : key === 'cents'
            ? `${v} ct`
            : key === 'glide'
              ? `${Math.round(v * 1000)}ms`
              : key === 'rate'
                ? `${v.toFixed(1)}Hz`
                : key === 'resonance'
                  ? v.toFixed(1)
                  : `${Math.round(key === 'cutoff' ? v : v * 100)}%`,
      onInput: v => C.change({[key]: v}),
      onReset: () => C.change({[key]: control.value}),
    });
    knobs.set(key, k);
    $(['transpose', 'cents', 'glide'].includes(key) ? 'tuning-knobs' : 'knobs').append(k.el);
  }
  for (const [id, preset] of Object.entries(presets)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = preset.name;
    $('preset').append(option);
  }
  $('preset').addEventListener('change', () => {
    C.change({...C.defaults(), ...presets[$('preset').value].values});
  });
  for (const key of ['scale', 'temperament', 'root'])
    $(key).addEventListener('change', () => C.change({[key]: key === 'root' ? Number($(key).value) : $(key).value}));
  $('bypass').addEventListener('click', () => C.change({enabled: !C.snapshot().enabled}));
  $('reset').addEventListener('click', () => {
    C.reset();
    $('preset').value = 'original';
  });
  for (const slot of ['a', 'b']) {
    $(slot).addEventListener('click', () => {
      selected = slot;
      C.change({...performance.snapshot().slots[slot], bend: 0});
    });
    $('save-' + slot).addEventListener('click', () => {
      performance.store.update(s => {
        s.slots[slot] = {...C.snapshot(), bend: 0};
      }, 'capture-' + slot);
      S.status('Controller snapshot ' + slot.toUpperCase() + ' captured');
    });
  }
  $('explore').addEventListener('click', () => {
    const pick = list => list[Math.floor(Math.random() * list.length)];
    C.change({
      enabled: true,
      cutoff: 60 + Math.round(Math.random() * 35),
      resonance: 0.7 + Math.round(Math.random() * 25) / 10,
      drive: Math.round(Math.random() * 35) / 100,
      space: Math.round(Math.random() * 50) / 100,
      motion: Math.round(Math.random() * 60) / 100,
      rate: pick([0.2, 0.4, 0.7, 1.4, 2.8]),
      scale: pick(['minor', 'dorian', 'whole', 'hirajoshi']),
      temperament: pick(['equal', 'just', 'pythagorean', '19edo']),
      cents: 0,
      transpose: pick([-12, 0, 0, 12]),
      bend: 0,
    });
  });
  $('groove').addEventListener('click', () => {
    const g = S.getEngine('groove');
    if (g.playing()) g.stop();
    else g.play();
  });
  setInterval(() => {
    const label = S.getEngine('groove')?.playing() ? 'Stop Groove' : 'Play Groove';
    if ($('groove').textContent !== label) $('groove').textContent = label;
  }, 200);
  const pad = $('pad');
  let pointer = null;
  const move = e => {
    const r = pad.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    C.change({cutoff: Math.round(x * 100), motion: Number((1 - y).toFixed(2))});
  };
  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    pad.setPointerCapture(pointer);
    move(e);
  });
  pad.addEventListener('pointermove', e => {
    if (e.pointerId === pointer) move(e);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    pad.addEventListener(event, e => {
      if (e.pointerId === pointer) pointer = null;
    });
  // The pad has two axes; ordinary range inputs provide separate keyboard / AT controls.
  for (const [id, key] of [
    ['x', 'cutoff'],
    ['y', 'motion'],
  ])
    $(id).addEventListener('input', () => C.change({[key]: Number($(id).value)}));
  const releaseBend = () => C.change({bend: 0});
  for (const [id, bend] of [
    ['bend-down', -2],
    ['bend-up', 2],
  ]) {
    const button = $(id);
    button.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      button.setPointerCapture(e.pointerId);
      C.change({bend});
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
      button.addEventListener(event, releaseBend);
    button.addEventListener('keydown', e => {
      if (['Space', 'Enter'].includes(e.code)) {
        e.preventDefault();
        C.change({bend});
      }
    });
    button.addEventListener('keyup', e => {
      if (['Space', 'Enter'].includes(e.code)) {
        e.preventDefault();
        releaseBend();
      }
    });
  }
  window.addEventListener('blur', releaseBend);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseBend();
  });
  function paint(s) {
    for (const [key, k] of knobs) k.set(s[key]);
    for (const key of ['scale', 'temperament', 'root']) $(key).value = s[key];
    $('bypass').setAttribute('aria-pressed', String(!s.enabled));
    $('bypass').textContent = s.enabled ? 'Bypass' : 'Bypassed · hear original';
    $('panel').classList.toggle('is-bypassed', !s.enabled);
    $('x').value = s.cutoff;
    $('y').value = s.motion;
    pad.style.setProperty('--x', `${s.cutoff}%`);
    pad.style.setProperty('--y', `${(1 - s.motion) * 100}%`);
    for (const slot of ['a', 'b']) $(slot).setAttribute('aria-pressed', String(slot === selected));
    $('bend-down').setAttribute('aria-pressed', String(s.bend < 0));
    $('bend-up').setAttribute('aria-pressed', String(s.bend > 0));
  }
  C.subscribe(paint);
  paint(C.snapshot());
})();
