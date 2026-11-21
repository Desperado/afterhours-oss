'use strict';
/* Optional guide driven by scheduled Groove note gates, not inferred recording harmony. */
(() => {
  const {S, $g, el} = AfterhoursGrooveApp,
    Core = AfterhoursPlayalong,
    toggle = $g('playalong-toggle'),
    panel = $g('playalong'),
    guitar = $g('guitar-source'),
    bass = $g('bass-source'),
    key = 'afterhours-playalong-v1';
  let signature = '',
    reading = '',
    preference = {enabled: false, guitar: 'auto', bass: 'auto'};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) preference = {...preference, ...saved, enabled: saved.enabled === true};
  } catch {
    /* Defaults work without storage. */
  }
  function store() {
    try {
      localStorage.setItem(key, JSON.stringify(preference));
    } catch {
      /* Session-only preference. */
    }
  }
  function visibility() {
    panel.hidden = !preference.enabled;
    toggle.setAttribute('aria-pressed', String(preference.enabled));
    reading = '';
  }
  toggle.addEventListener('click', () => {
    preference.enabled = !preference.enabled;
    visibility();
    store();
    paint();
  });
  for (const [select, name] of [
    [guitar, 'guitar'],
    [bass, 'bass'],
  ])
    select.addEventListener('change', () => {
      preference[name] = select.value;
      store();
      reading = '';
      paint();
    });
  function pitched(t) {
    return (
      !['Kick', 'Snare', 'Metal', 'Perc', 'Sample'].includes(t.machine) &&
      !(t.machine === 'Instrument' && t.instrument === 'virtuosity-drums')
    );
  }
  function sources(tracks) {
    const next = JSON.stringify(tracks.map(t => [t.name, t.machine, t.instrument]));
    if (next === signature) return;
    signature = next;
    reading = '';
    for (const [select, name, label] of [
      [guitar, 'guitar', 'Harmony lanes · auto'],
      [bass, 'bass', 'Bass lane · auto'],
    ]) {
      select.replaceChildren(new Option(label, 'auto'));
      tracks.forEach((t, i) => {
        if (pitched(t)) select.add(new Option(`${i + 1} · ${t.name}`, String(i)));
      });
      select.value = [...select.options].some(o => o.value === preference[name]) ? preference[name] : 'auto';
    }
  }
  function diagram(frets, name) {
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 190 195');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `${name}, low E to high E: ${frets.map(f => (f < 0 ? 'muted' : `fret ${f}`)).join(', ')}`,
    );
    const draw = (tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      svg.append(node);
    };
    const start = Math.max(...frets) <= 4 ? 1 : Math.min(...frets.filter(f => f > 0));
    for (let row = 0; row <= 5; row++) draw('line', {x1: 35, x2: 160, y1: 32 + row * 26, y2: 32 + row * 26});
    for (let string = 0; string < 6; string++) {
      const x = 35 + string * 25,
        fret = frets[string];
      draw('line', {x1: x, x2: x, y1: 32, y2: 162});
      draw('text', {x, y: 187, 'text-anchor': 'middle'}, ['E', 'A', 'D', 'G', 'B', 'e'][string]);
      if (fret <= 0) draw('text', {x, y: 22, 'text-anchor': 'middle'}, fret < 0 ? '×' : '○');
      else draw('circle', {cx: x, cy: 45 + (fret - start) * 26, r: 8});
    }
    draw('text', {x: 3, y: 49}, start);
    return svg;
  }
  function paint() {
    if (!preference.enabled) return;
    const frame = AfterhoursGrooveApp.transport.audibleFrame(),
      tracks = S.data.patterns[frame?.pattern ?? S.data.active].tracks;
    sources(tracks);
    const pitchedLanes = tracks.flatMap((t, i) => (pitched(t) ? [i] : []));
    const bassLane =
      bass.value === 'auto'
        ? (pitchedLanes.find(i => /bass/i.test(tracks[i].name + (tracks[i].instrument || ''))) ??
          pitchedLanes
            .filter(i => tracks[i].note < 52 && !['Chord', 'WavePad'].includes(tracks[i].machine))
            .sort((a, b) => tracks[a].note - tracks[b].note)[0])
        : Number(bass.value);
    const harmonyLanes = pitchedLanes.filter(i => i !== bassLane);
    const chordLanes = harmonyLanes.filter(
      i => ['Chord', 'WavePad'].includes(tracks[i].machine) || /chord|root|third|fifth/i.test(tracks[i].name),
    );
    const instrumentLanes = harmonyLanes.filter(i =>
      /guitar|keys|strings/i.test(tracks[i].name + (tracks[i].instrument || '')),
    );
    const guitarLanes =
      guitar.value !== 'auto'
        ? [Number(guitar.value)]
        : chordLanes.length
          ? chordLanes
          : instrumentLanes.length
            ? instrumentLanes
            : harmonyLanes;
    const mixer = S.engine?.performance?.mixer,
      solo = mixer?.lanes.some(l => l.solo),
      audible = lane =>
        !mixer ||
        (mixer.music > 0 &&
          !mixer.lanes[lane].mute &&
          mixer.lanes[lane].level > 0 &&
          (!solo || mixer.lanes[lane].solo)),
      now = S.engine?.context.currentTime || 0,
      tuning = S.engine?.controller?.state,
      notes = lanes =>
        [
          ...new Set(
            (S.running ? S.hits : [])
              .filter(
                h => h.time <= now && h.end > now && h.settings.volume > 0 && lanes.includes(h.lane) && audible(h.lane),
              )
              .flatMap(h => AfterhoursGroove.notes(h.settings))
              .map(n => Math.round(n + (tuning ? AfterhoursController.cents(n, tuning) / 100 : 0))),
          ),
        ].sort((a, b) => a - b),
      harmony = notes(guitarLanes),
      low = notes([bassLane]),
      c = Core.chord(harmony),
      next = JSON.stringify([harmony, low, guitarLanes, bassLane, !!tuning?.enabled]);
    if (next === reading) return;
    reading = next;
    $g('guitar-chord').textContent = c?.name || (harmony.length ? harmony.map(Core.noteName).join(' · ') : 'Rest');
    $g('guitar-notes').textContent = harmony.length
      ? harmony.map(Core.noteName).join(' · ')
      : 'Waiting for the next part';
    const frets = Core.fingering(c);
    $g('guitar-diagram').replaceChildren(
      ...(frets
        ? [diagram(frets, c.name)]
        : [el('p', 'hint', harmony.length ? 'No chord shape for this note group.' : '—')]),
    );
    $g('bass-notes').textContent = low.length ? low.map(Core.noteName).join(' · ') : 'Rest';
    $g('bass-position').textContent =
      low
        .map(n => {
          const positions = Core.bassPositions(n);
          return `${Core.noteName(n)}: ${
            positions.length
              ? positions
                  .slice(0, 2)
                  .map(p => `${p.string} string · fret ${p.fret}`)
                  .join(' / ')
              : 'outside standard 4-string range'
          }`;
        })
        .join(' · ') || 'Waiting for the next part';
    $g('playalong-sources').textContent =
      `Guitar: ${guitarLanes.map(i => tracks[i].name).join(', ') || 'none'} · Bass: ${tracks[bassLane]?.name || 'none'}${tuning?.enabled ? ' · Tuning controller active: nearest semitone shown' : ''}`;
  }
  visibility();
  AfterhoursGrooveApp.playalong = {paint};
})();
