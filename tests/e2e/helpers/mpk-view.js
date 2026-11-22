'use strict';
/* A drawn MPK mini Plus II for the emulator: it shows the display, pad and button lights, held keys
   and controller mode as they change, and it can be played with the mouse.

   Enable it in tests with MPK.install(page, {view: true}) or MPK_VIEW=1. Runs in the page after
   the emulator; it only reads and drives window.__mpk. */
function mpkView() {
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
    #mpk-view{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:860px;padding:14px 16px 10px;
      background:#e9e7e3;border:2px solid #8b1d24;border-radius:14px;box-shadow:0 12px 40px #0008;
      font:600 11px/1.2 -apple-system,system-ui,sans-serif;color:#222;user-select:none}
    #mpk-view .row{display:flex;gap:14px;align-items:flex-start}
    #mpk-view .brand{font:800 15px system-ui;letter-spacing:.5px;margin-bottom:6px;display:flex;justify-content:space-between}
    #mpk-view .brand small{font-weight:600;color:#8b1d24}
    #mpk-view .screen{width:200px;height:74px;background:#05070b;border:3px solid #222;border-radius:6px;padding:5px 7px;
      font:700 13px/22px ui-monospace,Menlo,monospace;color:#cfe8ff;white-space:pre;overflow:hidden}
    #mpk-view .screen.firmware{color:#ffb15c}
    #mpk-view button{font:700 9px system-ui;border:0;border-radius:5px;padding:0;cursor:pointer;color:#eee;
      background:#2a2a2a;box-shadow:inset 0 -3px 0 #0006;height:26px;min-width:44px}
    #mpk-view button.on{box-shadow:0 0 0 2px #8b1d24 inset,0 0 10px #ff3b3b}
    #mpk-view button.lit{color:#111}
    #mpk-view .pads{display:grid;grid-template-columns:repeat(4,52px);gap:7px}
    #mpk-view .pad{height:48px;border-radius:6px;background:#9a9a9a;border:2px solid #555;position:relative}
    #mpk-view .pad span{position:absolute;left:4px;top:3px;font-size:9px;color:#222}
    #mpk-view .pad.down{transform:scale(.94)}
    #mpk-view .knobs{display:grid;grid-template-columns:repeat(4,38px);gap:8px 8px}
    #mpk-view .knob{width:36px;height:36px;border-radius:50%;background:radial-gradient(#bbb,#777);border:3px solid #8b1d24;
      display:grid;place-items:center;font-size:10px;cursor:ns-resize}
    #mpk-view .encoder{width:46px;height:46px;border-radius:50%;background:radial-gradient(#ccc,#666);border:4px solid #8b1d24;
      cursor:pointer;display:grid;place-items:center;font-size:9px}
    #mpk-view .encoder.down{transform:scale(.92)}
    #mpk-view .col{display:flex;flex-direction:column;gap:6px}
    #mpk-view .grid2{display:grid;grid-template-columns:repeat(3,auto);gap:6px}
    #mpk-view .keys{position:relative;height:62px;margin-top:10px}
    #mpk-view .white{position:absolute;top:0;width:20px;height:60px;background:#fff;border:1px solid #888;border-radius:0 0 3px 3px}
    #mpk-view .black{position:absolute;top:0;width:13px;height:37px;background:#111;border-radius:0 0 2px 2px;z-index:1}
    #mpk-view .white.down,#mpk-view .black.down{background:#ff4b4b}
    #mpk-view .status{margin-top:6px;display:flex;gap:14px;font-size:10px;color:#555}
    #mpk-view .status b{color:#8b1d24}`;
  function build() {
    const mpk = window.__mpk;
    const root = document.createElement('div');
    root.id = 'mpk-view';
    root.setAttribute('aria-hidden', 'true');
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
      b.addEventListener('click', () => mpk.button(name, {shift: shiftLatched}));
      return b;
    };
    const brand = el('div', 'brand', 'AKAI  MPK mini plus II');
    brand.append(el('small', '', 'emulator'));
    // Left column: display and the buttons around it.
    const screen = el('div', 'screen');
    let shiftLatched = false;
    const shift = el('button', '', 'SHIFT');
    shift.addEventListener('click', () => {
      shiftLatched = !shiftLatched;
      mpk.shift(shiftLatched);
    });
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
    const encoder = el('div', 'encoder', 'PUSH');
    encoder.addEventListener('wheel', e => {
      e.preventDefault();
      mpk.encoder(e.deltaY < 0 ? 1 : -1);
    });
    encoder.addEventListener('pointerdown', () => mpk.encoderPush(true));
    encoder.addEventListener('pointerup', () => mpk.encoderPush(false));
    // Pads: the top row is 5–8, the bottom row 1–4, as printed on the hardware.
    const pads = el('div', 'pads');
    const padNodes = [];
    for (const index of [5, 6, 7, 8, 1, 2, 3, 4]) {
      const pad = el('div', 'pad');
      const label = el('span', '', String(index));
      pad.append(label);
      let note = null;
      pad.addEventListener('pointerdown', () => (note = mpk.padDown(index, 100)));
      pad.addEventListener('pointerup', () => note !== null && mpk.padUp(note));
      pads.append(pad);
      padNodes[index] = {pad, label};
    }
    const knobs = el('div', 'knobs');
    for (let i = 1; i <= 8; i++) {
      const knob = el('div', 'knob', String(i));
      knob.addEventListener('wheel', e => {
        e.preventDefault();
        mpk.knob(i, e.deltaY < 0 ? 1 : -1);
      });
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
    transport.append(...Object.values(lightButtons));
    const right = el('div', 'col');
    right.append(knobs, transport);
    const octave = el('div', 'col');
    octave.append(button('OCT −', 'oct-'), button('OCT +', 'oct+'));
    const top = el('div', 'row');
    top.append(octave, left, encoder, pads, right);
    // 37 keys, C3–C6.
    const keys = el('div', 'keys');
    const keyNodes = new Map();
    let x = 0;
    for (let note = 48; note <= 84; note++) {
      const black = [1, 3, 6, 8, 10].includes(note % 12);
      const key = el('div', black ? 'black' : 'white');
      key.style.left = (black ? x - 7 : x) + 'px';
      if (!black) x += 20;
      key.addEventListener('pointerdown', () => mpk.keyDown(note));
      key.addEventListener('pointerup', () => mpk.keyUp(note));
      key.addEventListener('pointerleave', e => e.buttons && mpk.keyUp(note));
      keys.append(key);
      keyNodes.set(note, key);
    }
    const status = el('div', 'status');
    root.append(style, brand, top, keys, status);
    document.body.append(root);
    // Held keys, as the host hears them (after octave shift).
    const held = new Set();
    const keyDown = mpk.keyDown.bind(mpk),
      keyUp = mpk.keyUp.bind(mpk);
    mpk.keyDown = (note, velocity) => (held.add(note), keyDown(note, velocity));
    mpk.keyUp = note => (held.delete(note), keyUp(note));
    const padDown = mpk.padDown.bind(mpk),
      padUp = mpk.padUp.bind(mpk);
    const struck = new Map();
    mpk.padDown = (pad, velocity) => {
      const note = padDown(pad, velocity);
      struck.set(note, performance.now());
      return note;
    };
    mpk.padUp = note => {
      setTimeout(() => struck.delete(note), 150);
      padUp(note);
    };
    function paint() {
      const s = mpk.state;
      const lines = mpk.screen();
      screen.textContent = lines.map(line => line.slice(0, 20)).join('\n');
      screen.classList.toggle('firmware', !!s.menu || s.mode !== 'daw' || s.owner !== 'host');
      for (let index = 1; index <= 8; index++) {
        const note = 36 + s.padBank * 8 + index - 1;
        const light = s.lights[note] || {color: 0, animation: 0};
        const {pad, label} = padNodes[index];
        const on = s.owner === 'host' && s.mode === 'daw' && light.color;
        const blink = light.animation === 9 && Math.floor(performance.now() / 250) % 2;
        pad.style.background = on && !blink ? color(light.color) : '#9a9a9a';
        pad.style.opacity = on && light.animation === 1 ? 0.55 : 1;
        pad.classList.toggle('down', struck.has(note));
        label.textContent = (s.shift ? MENU_LABELS[index - 1] : `${s.padBank ? 'B' : 'A'}${index}`) || '';
      }
      const ids = {undo: 73, loop: 74, play: 76, record: 77, quantize: 78};
      for (const [name, b] of Object.entries(lightButtons)) {
        const light = s.lights[ids[name]] || {color: 0, animation: 0};
        const lit =
          light.color && light.animation && !(light.animation === 9 && Math.floor(performance.now() / 250) % 2);
        b.style.background = lit
          ? name === 'record'
            ? '#ff3030'
            : name === 'play'
              ? '#34e05c'
              : '#f2f2f2'
          : '#2a2a2a';
        b.classList.toggle('lit', !!lit);
      }
      shift.classList.toggle('on', s.shift);
      encoder.classList.toggle('down', !!s.encoderDown);
      for (const [note, key] of keyNodes) key.classList.toggle('down', held.has(note));
      status.innerHTML = '';
      for (const [label, value] of [
        ['Mode', s.mode.toUpperCase()],
        ['Pad bank', s.padBank ? 'B' : 'A'],
        ['Octave', (s.octave > 0 ? '+' : '') + s.octave],
        ['Screen', s.menu ? `firmware menu: ${s.menu}` : s.owner === 'host' ? 'Afterhours' : 'firmware'],
        ['USB', s.plugged ? 'connected' : 'unplugged'],
      ]) {
        const item = el('span', '', label + ' ');
        item.append(el('b', '', value));
        status.append(item);
      }
      requestAnimationFrame(paint);
    }
    paint();
  }
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
}

module.exports = {mpkView};
