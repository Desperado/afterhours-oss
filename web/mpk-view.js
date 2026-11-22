'use strict';
/* On-screen controls and feedback for both the app widget and the automated demo. */
window.mountAfterhoursMPKView = (mpk, {onClose} = {}) => {
  // MPK colour indices used by Afterhours, from Bitwig's MpkColorLookup.
  const COLORS = {
    0: '#000000',
    2: '#7f7f7f',
    3: '#ffffff',
    5: '#ff0000',
    9: '#ff5400',
    13: '#ffff00',
    21: '#00ff00',
    67: '#0000ff',
  };
  const color = index => COLORS[index] || `hsl(${(index * 37) % 360} 90% 55%)`;
  const MENU_LABELS = [
    'Mute & Solo',
    'Mixer/PC',
    'Clip/CC',
    'Drum/Notes',
    'Prog Play',
    'Prog Edit',
    'Chord Type',
    'Chord Inv',
  ];
  const css = `
    #mpk-view{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(960px,calc(100% - 24px));max-height:calc(100% - 24px);
      box-sizing:border-box;overflow:auto;padding:14px 16px 10px;
      background:#e9e7e3;border:2px solid #8b1d24;border-radius:14px;box-shadow:0 12px 40px #0008;
      font:600 11px/1.2 -apple-system,system-ui,sans-serif;color:#222;user-select:none;color-scheme:light}
    #mpk-view .row{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
    #mpk-view .brand{font:800 15px system-ui;letter-spacing:.5px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px}
    #mpk-view .brand small{font-weight:600;color:#8b1d24;margin-right:auto}
    #mpk-view.detached{position:static;width:100%;min-height:100vh;max-height:none;border:0;border-radius:0;box-shadow:none}
    body:has(>#mpk-view.detached){margin:0}
    #mpk-view .help{margin:6px 0 10px;font-weight:500}
    #mpk-view .brand button{padding:0 8px;flex-shrink:0}
    #mpk-view button:focus-visible,#mpk-view input:focus-visible{outline:2px solid #b3152e;outline-offset:2px}
    #mpk-view .screen{width:200px;height:74px;background:#05070b;border:3px solid #222;border-radius:6px;padding:5px 7px;
      font:700 13px/22px ui-monospace,Menlo,monospace;color:#cfe8ff;white-space:pre;overflow:hidden}
    #mpk-view .screen.firmware{color:#ffb15c}
    #mpk-view button{font:700 9px system-ui;border:0;border-radius:5px;padding:0;cursor:pointer;color:#eee;
      background:#2a2a2a;box-shadow:inset 0 -3px 0 #0006;height:26px;min-width:44px;touch-action:none}
    #mpk-view button.on{box-shadow:0 0 0 2px #8b1d24 inset,0 0 10px #ff3b3b}
    #mpk-view button.lit{color:#111}
    #mpk-view .pads{display:grid;grid-template-columns:repeat(4,52px);gap:7px}
    #mpk-view .pad{height:48px;border-radius:6px;background:#9a9a9a;border:2px solid #555;position:relative}
    #mpk-view .pad span{position:absolute;left:4px;top:3px;font-size:9px;color:#222}
    #mpk-view .pad.down{transform:scale(.94)}
    #mpk-view .knobs{display:grid;grid-template-columns:repeat(4,38px);gap:8px 8px}
    #mpk-view .knob{min-width:0;width:36px;height:36px;border-radius:50%;background:radial-gradient(#bbb,#777);border:3px solid #8b1d24;
      display:grid;place-items:center;font-size:10px;cursor:ns-resize}
    #mpk-view .encoder{width:46px;height:46px;border-radius:50%;background:radial-gradient(#ccc,#666);border:4px solid #8b1d24;
      cursor:pointer;display:grid;place-items:center;font-size:9px}
    #mpk-view .encoder.down{transform:scale(.92)}
    #mpk-view .col{display:flex;flex-direction:column;gap:6px}
    #mpk-view .grid2{display:grid;grid-template-columns:repeat(3,auto);gap:6px}
    #mpk-view .key-scroll{overflow:auto;margin-top:8px}
    #mpk-view .keys{position:relative;height:66px;width:442px}
    #mpk-view .keys button{min-width:0;box-shadow:none}
    #mpk-view .white{position:absolute;top:0;width:20px;height:60px;background:#fff;border:1px solid #888;border-radius:0 0 3px 3px}
    #mpk-view .black{position:absolute;top:0;width:13px;height:37px;background:#111;border-radius:0 0 2px 2px;z-index:1}
    #mpk-view .white.down,#mpk-view .black.down{background:#ff4b4b}
    #mpk-view .perf{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #mpk-view .perf label{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:8px;color:#8b1d24}
    #mpk-view .perf button{min-width:56px}
    #mpk-view .perf button.lit{background:#ff3b3b}
    #mpk-view .wheels{display:flex;gap:6px}
    #mpk-view .wheels input{writing-mode:vertical-lr;direction:rtl;width:22px;height:60px;accent-color:#8b1d24}
    #mpk-view .status{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:10px;color:#555}
    #mpk-view .status b{color:#8b1d24}`;
  const root = document.createElement('section');
  root.id = 'mpk-view';
  root.setAttribute('aria-label', 'MPK mini Plus II emulator');
  root.inert = !onClose;
  const style = document.createElement('style');
  style.textContent = css;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, name) => {
    const b = el('button', '', label);
    b.dataset.name = name;
    b.addEventListener('click', () => mpk.button(name));
    return b;
  };
  const momentary = (control, down, up) => {
    let pointer = null;
    control.addEventListener('pointerdown', e => {
      if (pointer !== null || e.button !== 0) return;
      pointer = e.pointerId;
      control.setPointerCapture(pointer);
      down();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      control.addEventListener(event, e => {
        if (pointer !== e.pointerId) return;
        pointer = null;
        up();
      });
    }
    control.addEventListener('click', e => {
      if (e.detail === 0) {
        down();
        up();
      }
    });
  };
  const toggle = (label, onClick) => {
    const control = el('button', '', label);
    control.addEventListener('click', onClick);
    control.setAttribute('aria-pressed', 'false');
    return control;
  };
  const brand = el('div', 'brand', 'AKAI MPK mini Plus II');
  brand.append(el('small', '', 'Emulator'));
  const detachLabel = 'Open in separate window';
  const dockLabel = 'Dock in Afterhours';
  const detach = el('button', '', detachLabel);
  const close = el('button', '', 'Close');
  const popupError = el('p', '', 'Could not open the MPK window. Allow pop-ups for this site and try again.');
  popupError.setAttribute('role', 'status');
  popupError.hidden = true;
  if (onClose) {
    detach.addEventListener('click', () => (popup ? dock() : openPopup()));
    close.setAttribute('aria-label', 'Close emulator');
    close.addEventListener('click', onClose);
    brand.append(detach, close);
  }
  const help = el(
    'p',
    'help',
    'Play the pads and keys. Scroll or use the arrow keys to turn a control. Hold the encoder and press a pad to select a track.',
  );
  // Left column: display and the buttons around it.
  const screen = el('div', 'screen');
  screen.dataset.i18nSkip = '';
  const shift = toggle('SHIFT', () => mpk.shift(!mpk.state.shift));
  const left = el('div', 'col');
  const buttons = el('div', 'grid2');
  buttons.append(
    button('PAD BANK A/B', 'pad-bank'),
    button('BANK −', 'bank-'),
    button('BANK +', 'bank+'),
    shift,
    button('PLUGIN/DAW', 'plugin-daw'),
    button('TAP', 'tap'),
  );
  left.append(screen, buttons);
  // Central encoder: wheel turns it, a click pushes it.
  const turn = (control, rotate) => {
    control.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        if (e.deltaY) rotate(e.deltaY < 0 ? 1 : -1);
      },
      {passive: false},
    );
    control.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      rotate(e.key === 'ArrowUp' ? 1 : -1);
    });
  };
  const encoder = el('button', 'encoder', 'PUSH');
  encoder.setAttribute('aria-label', 'Central encoder');
  turn(encoder, steps => mpk.encoder(steps));
  encoder.addEventListener('click', () => {
    if (mpk.state.encoderDown) return;
    mpk.encoderPush(true);
    mpk.encoderPush(false);
  });
  const hold = toggle('Hold encoder', () => mpk.encoderPush(!mpk.state.encoderDown));
  const encoderColumn = el('div', 'col');
  encoderColumn.append(encoder, hold);
  // Pads: the top row is 5–8, the bottom row 1–4, as printed on the hardware.
  const pads = el('div', 'pads');
  const padNodes = [];
  for (const index of [5, 6, 7, 8, 1, 2, 3, 4]) {
    const pad = el('button', 'pad');
    const label = el('span', '', String(index));
    pad.append(label);
    let note = null;
    momentary(
      pad,
      () => (note = mpk.padDown(index)),
      () => mpk.padUp(note),
    );
    pads.append(pad);
    padNodes[index] = {pad, label};
  }
  const knobs = el('div', 'knobs');
  for (let i = 1; i <= 8; i++) {
    const knob = el('button', 'knob', String(i));
    knob.setAttribute('aria-label', `MPK · Knob ${i}`);
    turn(knob, steps => mpk.knob(i, steps));
    knobs.append(knob);
  }
  const transport = el('div', 'grid2');
  transport.style.gridTemplateColumns = 'repeat(5,auto)';
  const lightButtons = {
    undo: button('UNDO', 'undo'),
    loop: button('LOOP', 'loop'),
    play: button('■/▶', 'play'),
    record: button('●', 'record'),
    quantize: button('+', 'quantize'),
  };
  lightButtons.play.setAttribute('aria-label', 'Play / Stop');
  lightButtons.record.setAttribute('aria-label', 'Record');
  lightButtons.quantize.setAttribute('aria-label', 'Quantize');
  transport.append(...Object.values(lightButtons));
  const right = el('div', 'col');
  right.append(knobs, transport);
  // Pitch wheel springs back to centre; the mod wheel stays where it is left.
  const wheels = el('div', 'wheels');
  const pitch = el('input'),
    mod = el('input');
  for (const [input, max, value] of [
    [pitch, 100, 50],
    [mod, 127, 0],
  ])
    Object.assign(input, {type: 'range', min: 0, max, value});
  pitch.title = 'Pitch';
  mod.title = 'Mod';
  pitch.addEventListener('input', () => mpk.pitchWheel((pitch.value - 50) / 50));
  const resetPitch = () => {
    if (pitch.value === '50') return;
    pitch.value = 50;
    mpk.pitchWheel(0);
  };
  for (const event of ['pointerup', 'pointercancel', 'keyup', 'blur']) pitch.addEventListener(event, resetPitch);
  mod.addEventListener('input', () => mpk.modWheel(Number(mod.value)));
  wheels.append(pitch, mod);
  const octave = el('div', 'col');
  const sustain = toggle('Sustain', () => mpk.sustainPedal(!mpk.state.sustain));
  octave.append(wheels, button('OCT −', 'oct-'), button('OCT +', 'oct+'), sustain);
  const top = el('div', 'row');
  top.append(octave, left, encoderColumn, pads, right);
  // 37 keys, C3–C6.
  const keyScroll = el('div', 'key-scroll');
  const keys = el('div', 'keys');
  keyScroll.append(keys);
  const keyNodes = new Map();
  let x = 0;
  for (let note = 48; note <= 84; note++) {
    const black = [1, 3, 6, 8, 10].includes(note % 12);
    const key = el('button', black ? 'black' : 'white');
    const name = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12];
    key.setAttribute('aria-label', name + (Math.floor(note / 12) - 1));
    key.style.left = (black ? x - 7 : x) + 'px';
    if (!black) x += 20;
    momentary(
      key,
      () => mpk.keyDown(note),
      () => mpk.keyUp(note),
    );
    keys.append(key);
    keyNodes.set(note, key);
  }
  // ARP, LATCH, CHORDS, SCALES and NOTE REPEAT, with their SHIFT functions printed underneath.
  const perf = el('div', 'perf');
  const perfButtons = {};
  for (const [name, label, second] of [
    ['arp', 'ARP', 'CONFIG'],
    ['latch', 'LATCH', 'FREEZE'],
    ['chords', 'CHORDS', 'CONFIG'],
    ['scales', 'SCALES', 'CONFIG'],
    ['note-repeat', 'NOTE REPEAT', 'FULL LEVEL'],
  ]) {
    const wrap = el('label');
    perfButtons[name] = button(label, name);
    wrap.append(perfButtons[name], el('span', '', second));
    perf.append(wrap);
  }
  const status = el('div', 'status');
  root.append(style, brand);
  if (onClose) root.append(popupError, help);
  root.append(top, perf, keyScroll, status);
  document.body.append(root);
  let frame, popup;
  let frameWindow = window;
  let screenText;
  let statusText;
  function moveView(target) {
    frameWindow.cancelAnimationFrame(frame);
    target.document.body.append(root);
    frameWindow = target;
    paint();
    detach.focus();
  }
  function openPopup() {
    const target = window.open('', 'afterhours-mpk', 'popup,width=960,height=410');
    popupError.hidden = !!target;
    if (!target) return;
    popup = target;
    const i18n = window.AfterhoursI18n;
    target.document.title = 'Afterhours · MPK mini Plus II';
    target.document.documentElement.lang = i18n?.lang || 'en';
    detach.textContent = i18n?.t(dockLabel) || dockLabel;
    root.classList.add('detached');
    target.addEventListener('pagehide', () => {
      if (popup === target) onClose();
    });
    moveView(target);
    target.focus();
  }
  function dock() {
    const target = popup;
    popup = null;
    root.classList.remove('detached');
    detach.textContent = detachLabel;
    moveView(window);
    target.close();
    window.focus();
  }
  const paintToggle = (control, active) => {
    control.classList.toggle('on', active);
    if (control.getAttribute('aria-pressed') !== String(active)) control.setAttribute('aria-pressed', String(active));
  };
  function paint() {
    const s = mpk.state;
    const lines = mpk
      .screen()
      .map(line => line.slice(0, 20))
      .join('\n');
    if (lines !== screenText) screen.textContent = screenText = lines;
    screen.classList.toggle('firmware', !!s.menu || s.mode !== 'daw' || s.owner !== 'host');
    const now = performance.now();
    const blinkTime = Math.floor(now / 250) % 2;
    for (let index = 1; index <= 8; index++) {
      const note = 36 + s.padBank * 8 + index - 1;
      const light = s.lights[note] || {color: 0, animation: 0};
      const {pad, label} = padNodes[index];
      const on = s.owner === 'host' && s.mode === 'daw' && light.color;
      const blink = light.animation === 9 && blinkTime;
      pad.style.background = on && !blink ? color(light.color) : '#9a9a9a';
      pad.style.opacity = on && light.animation === 1 ? 0.55 : 1;
      pad.classList.toggle('down', mpk.pressedPads.has(note) || mpk.padFlashes.get(note) > now);
      const text = s.shift ? MENU_LABELS[index - 1] : `${s.padBank ? 'B' : 'A'}${index}`;
      if (label.dataset.caption !== text) {
        label.dataset.caption = text;
        label.textContent = text;
        pad.setAttribute('aria-label', `Pad ${text}`);
      }
    }
    const ids = {undo: 73, loop: 74, play: 76, record: 77, quantize: 78};
    for (const [name, b] of Object.entries(lightButtons)) {
      const light = s.lights[ids[name]] || {color: 0, animation: 0};
      const lit = light.color && light.animation && !(light.animation === 9 && blinkTime);
      b.style.background = lit ? (name === 'record' ? '#ff3030' : name === 'play' ? '#34e05c' : '#f2f2f2') : '#2a2a2a';
      b.classList.toggle('lit', !!lit);
    }
    const flags = {arp: s.arp, latch: s.latch, chords: s.chords, scales: s.scales, 'note-repeat': s.repeat};
    for (const [name, b] of Object.entries(perfButtons)) b.classList.toggle('lit', !!flags[name]);
    paintToggle(shift, s.shift);
    paintToggle(hold, !!s.encoderDown);
    paintToggle(sustain, s.sustain);
    encoder.classList.toggle('down', !!s.encoderDown);
    for (const [note, key] of keyNodes) key.classList.toggle('down', mpk.held.has(note));
    const details = [
      ['Mode', s.mode.toUpperCase()],
      ['Pad bank', s.padBank ? 'B' : 'A'],
      ['Octave', (s.octave > 0 ? '+' : '') + s.octave],
      ['Screen', s.menu ? `firmware menu: ${s.menu}` : s.owner === 'host' ? 'Afterhours' : 'firmware'],
      ['USB', s.plugged ? 'connected' : 'unplugged'],
      ['Arp clock', s.arpClock],
      ['Full Level', s.fullLevel ? 'on' : 'off'],
    ];
    const text = details.flat().join('|');
    if (statusText !== text) {
      statusText = text;
      status.replaceChildren(
        ...details.map(([label, value]) => {
          const item = el('span', '', label + ' ');
          item.append(el('b', '', value));
          return item;
        }),
      );
    }
    frame = frameWindow.requestAnimationFrame(paint);
  }
  paint();
  if (onClose) detach.focus();
  return () => {
    const target = popup;
    popup = null;
    frameWindow.cancelAnimationFrame(frame);
    root.remove();
    if (target && !target.closed) target.close();
  };
};
