'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const effects = new LiveEffects(audio, renderEffects);
const effectKnobs = {};
const state = {
  tracks: [],
  track: null,
  keyReady: false,
  jobs: [],
  session: null,
  loopA: null,
  loopB: null,
  loopOn: false,
  loading: false,
  request: 0,
  mode: 'whole',
  view: 'report',
  preset: null,
};
let recordingVersion = 0,
  recordingStarting = false;
const time = value => {
  const s = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const number = (value, decimals = 1) =>
  Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value).toFixed(decimals) : '—';
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message, tone = 'ok') {
  AfterhoursShell.status(message, tone);
}
async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'This request could not finish.');
  return data;
}
const busy = () => state.jobs.some(job => ['queued', 'running'].includes(job.status));
const wholeRequests = () => (state.track ? Math.max(1, Math.ceil(Math.max(0, state.track.duration - 5) / 115)) : 1);
// Requests a saved session used: one per excerpt for audio-model sessions, none for local scans.
const requestsUsed = session => (session.method === 'local_signal_features' ? 0 : session.segments.length);
function latestSession(sessions) {
  return sessions.find(s => s.method === 'audio_model_sections' && s.status === 'complete') || sessions[0] || null;
}

/* ── library ───────────────────────────────────────────────── */
function renderLibrary() {
  $('track-count').textContent = String(state.tracks.length).padStart(2, '0');
  $('library').replaceChildren(
    ...state.tracks.map(track => {
      const item = element('button', `library-item${state.track?.id === track.id ? ' active' : ''}`);
      const cover = element('span', 'mini-cover');
      cover.setAttribute('aria-hidden', 'true');
      const label = element('span');
      label.append(
        element('strong', '', track.title),
        element('small', '', `${track.format} · ${time(track.duration)}`),
      );
      item.append(cover, label);
      item.addEventListener('click', () => loadTrack(track.id));
      return item;
    }),
  );
}
async function loadTrack(id, keepSession = false) {
  const serial = ++state.request;
  state.loading = true;
  updateForm();
  if (!keepSession) window.dispatchEvent(new Event('afterhours:recordingchange'));
  if (!keepSession) {
    pauseRecording();
    $('loading').hidden = false;
    $('loading').textContent = 'Reading your recording…';
    $('studio').hidden = true;
  }
  try {
    const track = await request(`/api/tracks/${encodeURIComponent(id)}`);
    if (serial !== state.request) return;
    const oldId = state.track?.id,
      oldSession = state.session?.id;
    state.track = track;
    track.sessions.sort((a, b) => new Date(b.created) - new Date(a.created));
    state.session = keepSession
      ? track.sessions.find(s => s.id === oldSession) || latestSession(track.sessions)
      : latestSession(track.sessions);
    if (!keepSession) state.view = state.session ? 'report' : 'setup';
    if (oldId !== track.id || !keepSession) {
      audio.src = `/api/tracks/${encodeURIComponent(id)}/audio`;
      audio.playbackRate = Number($('speed').value);
      clearLoop();
      state.preset = null;
      effects.reset();
    }
    renderLibrary();
    renderTrack();
    $('loading').hidden = true;
    $('studio').hidden = false;
  } catch (error) {
    if (serial !== state.request) return;
    toast(error.message, 'err');
    $('loading').hidden = false;
    $('loading').textContent = 'Could not open this recording. Import another file or reload.';
  } finally {
    if (serial === state.request) {
      state.loading = false;
      updateForm();
      if (!keepSession) window.dispatchEvent(new Event('afterhours:recordingchange'));
    }
  }
}
function renderTrack() {
  const track = state.track;
  $('title').textContent = track.title;
  $('ai-title').textContent = track.title;
  $('ai-duration').textContent = time(track.duration);
  $('file-meta').textContent =
    `${track.format} · ${number(track.sample_rate / 1000, 1)} kHz · ${track.channels === 2 ? 'stereo' : 'mono'}`;
  $('player-quality').textContent = track.summary?.quality || '';
  $('seek').max = track.duration;
  $('duration').textContent = time(track.duration);
  const ns = 'http://www.w3.org/2000/svg';
  const bars = track.waveform.map((v, i) => {
    const bar = document.createElementNS(ns, 'rect');
    const height = Math.max(2, Math.sqrt(v) * 135);
    bar.setAttribute('x', i * 3);
    bar.setAttribute('y', 75 - height / 2);
    bar.setAttribute('width', 1.8);
    bar.setAttribute('height', height);
    bar.setAttribute('rx', '.8');
    bar.setAttribute('fill', 'currentColor');
    return bar;
  });
  $('waveform').replaceChildren(...bars);
  // The played part is the same waveform in the live colour, clipped at the playhead.
  const played = $('waveform').cloneNode(true);
  played.removeAttribute('id');
  played.setAttribute('class', 'wave-base');
  $('wave-played').replaceChildren(played);
  renderAI();
  renderTime();
  renderLoop();
  $('export').disabled = false;
}

/* ── player ────────────────────────────────────────────────── */
function seek(value) {
  if (!state.track) return;
  audio.currentTime = Math.min(Math.max(0, Number(value)), Math.max(0, state.track.duration - 0.01));
  renderTime();
}
function renderTime() {
  const current = audio.currentTime || 0,
    progress = Math.min(100, (current / (state.track?.duration || 1)) * 100);
  $('current-time').textContent = time(current);
  $('seek').value = current;
  $('playhead').style.left = `${progress}%`;
  $('wave-played').style.clipPath = `inset(0 ${100 - progress}% 0 0)`;
  $('seek').setAttribute('aria-valuetext', `${time(current)} of ${time(state.track?.duration)}`);
}
function updatePlay() {
  $('play').textContent = audio.paused ? '▶' : 'Ⅱ';
  $('play').setAttribute('aria-pressed', String(!audio.paused));
  $('play').setAttribute('aria-label', audio.paused ? 'Play recording' : 'Pause recording');
}
const loopReady = () => state.loopA !== null && state.loopB !== null;
function renderLoop() {
  const duration = state.track?.duration || 1,
    ready = loopReady();
  $('loop').disabled = !ready;
  $('loop').setAttribute('aria-pressed', String(ready && state.loopOn));
  $('loop').textContent = ready
    ? `Loop ${time(state.loopA)}–${time(state.loopB)}`
    : state.loopA !== null
      ? `A ${time(state.loopA)} · set B`
      : 'No loop';
  $('loop-a').classList.toggle('is-set', state.loopA !== null);
  $('loop-b').classList.toggle('is-set', state.loopB !== null);
  const band = $('wave-loop');
  band.hidden = state.loopA === null;
  if (state.loopA !== null) {
    const end = state.loopB ?? state.loopA;
    band.style.left = `${(state.loopA / duration) * 100}%`;
    band.style.width = `${Math.max(0.3, ((end - state.loopA) / duration) * 100)}%`;
    band.classList.toggle('active', ready && state.loopOn);
  }
  renderModeCards();
}
function clearLoop() {
  state.loopA = null;
  state.loopB = null;
  state.loopOn = false;
  renderLoop();
}
$('loop-a').addEventListener('click', () => {
  state.loopA = audio.currentTime;
  if (state.loopB !== null && state.loopB < state.loopA + 0.25) state.loopB = null;
  state.loopOn = loopReady();
  renderLoop();
  toast(`Loop A · ${time(state.loopA)}`);
});
$('loop-b').addEventListener('click', () => {
  if (state.loopA === null) {
    toast('Set A first', 'err');
    return;
  }
  if (audio.currentTime < state.loopA + 0.25) {
    toast('B must be after A', 'err');
    return;
  }
  state.loopB = audio.currentTime;
  state.loopOn = true;
  renderLoop();
  seek(state.loopA);
  toast(`Loop ${time(state.loopA)}–${time(state.loopB)}`);
});
$('loop').addEventListener('click', () => {
  if (!loopReady()) return;
  state.loopOn = !state.loopOn;
  renderLoop();
});
$('loop').addEventListener('dblclick', clearLoop);
function pauseRecording() {
  ++recordingVersion;
  recordingStarting = false;
  audio.pause();
}
async function playRecording() {
  if (!state.track || state.loading || recordingStarting || !audio.paused) return;
  const version = ++recordingVersion;
  recordingStarting = true;
  if (audio.ended) seek(0);
  try {
    await effects.start();
    if (version !== recordingVersion) return;
    await audio.play();
  } catch {
    if (version === recordingVersion) toast('Playback could not start · try WAV or MP3', 'err');
  } finally {
    if (version === recordingVersion) recordingStarting = false;
  }
}
$('play').addEventListener('click', () => {
  AfterhoursShell.touch('recording');
  if (recordingStarting || !audio.paused) pauseRecording();
  else playRecording();
});
window.addEventListener('pagehide', pauseRecording);
$('rewind').addEventListener('click', () => seek(audio.currentTime - 10));
$('seek').addEventListener('input', event => seek(event.target.value));
$('volume').addEventListener('input', event => {
  audio.volume = Number(event.target.value);
});
audio.volume = 0.8;
$('speed').addEventListener('input', event => {
  audio.playbackRate = Number(event.target.value);
  $('speed-value').textContent = `${audio.playbackRate.toFixed(2)}×`;
});
audio.addEventListener('timeupdate', () => {
  if (state.loopOn && loopReady() && audio.currentTime >= state.loopB) seek(state.loopA);
  renderTime();
});
for (const name of ['play', 'pause', 'ended']) audio.addEventListener(name, updatePlay);
audio.addEventListener('error', () => {
  if (audio.src) toast('Browser could not decode this file', 'err');
});

/* ── AI listening ──────────────────────────────────────────── */
function sessionLabel(session) {
  const kind =
    session.method === 'audio_model_sections' ? 'Whole' : session.method === 'audio_model' ? 'Excerpt' : 'Local scan';
  const features = session.segments[0]?.features;
  const range =
    session.method !== 'audio_model_sections' && features
      ? ` ${time(features.start_seconds)}–${time((features.start_seconds || 0) + (features.duration_seconds || 0))}`
      : '';
  return `${kind}${range}`;
}
function renderAI() {
  const hasTrack = !!state.track;
  $('ai-empty').hidden = hasTrack;
  $('ai-setup').hidden = !hasTrack || state.view !== 'setup';
  $('ai-report').hidden = !hasTrack || state.view !== 'report' || !state.session;
  $('ai-new').hidden = !hasTrack || state.view !== 'report';
  $('ai-eyebrow').textContent = state.view === 'report' && state.session ? 'Report' : 'Listening to';
  renderSaved();
  updateForm();
  if (state.view === 'report' && state.session) renderReport();
  else $('ai-used').hidden = true;
}
function renderSaved() {
  const sessions = state.track?.sessions || [];
  $('session-count').textContent = String(sessions.length).padStart(2, '0');
  if (!sessions.length) {
    $('saved').replaceChildren(element('p', 'hint', state.track ? 'No sessions yet' : ''));
    return;
  }
  $('saved').replaceChildren(
    ...sessions.map(session => {
      const used = requestsUsed(session);
      const item = element('button', 'saved-item');
      item.type = 'button';
      item.setAttribute('aria-current', String(state.view === 'report' && state.session?.id === session.id));
      const when = new Date(session.created).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      item.append(
        element('strong', '', sessionLabel(session)),
        element('small', 'mono', `${when} · ${used ? `${used} paid` : 'free'}`),
      );
      item.addEventListener('click', () => {
        state.session = session;
        state.view = 'report';
        renderAI();
      });
      return item;
    }),
  );
}
function parseNotes(text) {
  const groups = {observations: [], uncertainty: [], experiments: []};
  let group = 'observations';
  for (const raw of text.split('\n')) {
    const line = raw
      .trim()
      .replace(/\*\*/g, '')
      .replace(/^#{1,6}\s*/, '');
    if (!line) continue;
    if (
      line.length < 120 &&
      /^(?:\d[.)]\s*)?(?:почуті спостереження|спостереження|observations|what i hear)/iu.test(line)
    ) {
      group = 'observations';
      continue;
    }
    if (line.length < 120 && /^(?:\d[.)]\s*)?(?:непевні|невпевнені|припущення|uncertain|assumptions)/iu.test(line)) {
      group = 'uncertainty';
      continue;
    }
    if (
      line.length < 120 &&
      /^(?:\d[.)]\s*)?(?:творчі|музичні експерименти|пропозиції|експерименти|creative|experiments|suggestions|3 конкретні)/iu.test(
        line,
      )
    ) {
      group = 'experiments';
      continue;
    }
    groups[group].push(line);
  }
  return groups;
}
function noteLine(line) {
  const p = element('p'),
    split = line.indexOf(':');
  if (split > 0 && split < 45)
    p.append(element('strong', '', line.slice(0, split + 1)), document.createTextNode(line.slice(split + 1)));
  else p.textContent = line;
  return p;
}
function stat(label, value, unit, note) {
  const card = element('div', 'metric');
  const main = element('div', 'metric-value', value);
  if (unit) main.append(element('small', '', unit));
  card.append(element('div', 'metric-label', label), main, element('div', 'metric-note', note));
  return card;
}
function balanceStat(bands) {
  const card = element('div', 'metric metric-balance');
  card.append(element('div', 'metric-label', 'Balance'));
  const entries = Object.entries(bands || {});
  const chart = element('div', 'balance');
  chart.setAttribute('role', 'img');
  const names = ['Sub', 'Bass', 'Mid', 'High'],
    max = Math.max(...entries.map(([, v]) => v), 0.0001);
  chart.setAttribute('aria-label', entries.map(([, v], i) => `${names[i] || i} ${Math.round(v * 100)}%`).join(', '));
  entries.forEach(([, v], i) => {
    const bar = element('i');
    bar.style.height = `${Math.max(4, (v / max) * 100)}%`;
    bar.classList.toggle('top', v === max);
    bar.title = `${names[i]} ${Math.round(v * 100)}%`;
    chart.append(bar);
  });
  card.append(chart, element('div', 'metric-note', entries.length ? 'sub · bass · mid · high' : 'No band data'));
  return card;
}
function renderReport() {
  const session = state.session,
    track = state.track,
    used = requestsUsed(session),
    local = session.method === 'local_signal_features';
  $('ai-used').hidden = false;
  $('ai-used').className = `chip ${used ? 'chip-paid' : 'chip-ok'}`;
  $('ai-used').textContent = used ? `$ ${used} request${used > 1 ? 's' : ''} used` : 'Free · local scan';
  const first = session.segments[0]?.features || {};
  const bpm = track.summary?.estimated_bpm ?? first.estimated_bpm,
    loudness = track.summary?.loudness?.input_i,
    truePeak = track.summary?.loudness?.input_tp;
  $('metrics').replaceChildren(
    stat('Tempo', number(bpm, 1), 'BPM', bpm ? `or ${number(bpm / 2, 1)} · ½× / 2×` : 'Run a local scan'),
    stat(
      'Loudness',
      number(loudness ?? track.rms_dbfs),
      loudness !== undefined ? 'LUFS' : 'dBFS',
      loudness !== undefined ? 'integrated · full track' : 'RMS · full track',
    ),
    stat(
      'Peak',
      number(truePeak ?? track.peak_dbfs),
      truePeak !== undefined ? 'dBTP' : 'dBFS',
      truePeak !== undefined ? 'true peak' : 'sample peak',
    ),
    balanceStat(first.frequency_band_power_fractions || track.summary?.bands),
  );
  $('report-meta').textContent =
    `${session.status !== 'complete' ? 'Incomplete report · saved excerpts only · ' : ''}${local ? 'Local measurements' : session.segments[0]?.model || 'Audio model'}${session.method === 'audio_model_sections' ? ' · excerpts overlap 5 s' : ''}`;
  const heard = $('notes');
  heard.replaceChildren();
  const experiments = [];
  for (const [segmentIndex, segment] of session.segments.entries()) {
    const f = segment.features || {},
      start = f.start_seconds || 0,
      end = start + (f.duration_seconds || 0);
    const block = element('div', 'heard-block');
    const stamp = element('button', 'heard-time mono', `${time(start)}–${time(end)}`);
    stamp.type = 'button';
    stamp.title = 'Play from here';
    stamp.addEventListener('click', () => {
      seek(start);
      AfterhoursShell.show('listen');
    });
    const copy = element('div', 'heard-copy');
    if (local) {
      copy.append(
        noteLine(`Tempo: ${number(f.estimated_bpm)} BPM (½× / 2× possible)`),
        noteLine(`Level: peak ${number(f.peak_dbfs)} dBFS · RMS ${number(f.rms_dbfs)} dBFS`),
      );
      const bands = Object.values(f.frequency_band_power_fractions || {});
      if (bands.length)
        copy.append(
          noteLine(
            `Bands: ${bands.map((v, i) => `${['sub', 'bass', 'mid', 'high'][i]} ${Math.round(v * 100)}%`).join(' · ')}`,
          ),
        );
    } else {
      const groups = parseNotes(segment.notes || '');
      const lines = groups.observations.length ? groups.observations : [segment.notes || 'No notes returned.'];
      copy.append(...lines.map(noteLine));
      if (groups.uncertainty.length) {
        copy.append(element('span', 'micro-label', 'Open questions'), ...groups.uncertainty.map(noteLine));
      }
      experiments.push(...splitIdeas(groups.experiments).map((text, ideaIndex) => ({text, segmentIndex, ideaIndex})));
      if (segment.truncated) copy.append(element('p', 'hint', 'Notes truncated'));
    }
    block.append(stamp, copy);
    heard.append(block);
  }
  renderExperiments(local ? null : experiments);
}
function splitIdeas(lines) {
  const ideas = [];
  for (const line of lines) {
    if (/^\d+[.)]\s/.test(line)) ideas.push(line.replace(/^\d+[.)]\s*/, ''));
    else if (ideas.length) ideas[ideas.length - 1] += '\n' + line;
    else ideas.push(line);
  }
  return ideas;
}
function renderExperiments(ideas) {
  const host = $('experiments');
  host.replaceChildren();
  $('try-count').textContent = '';
  if (!ideas) {
    host.append(element('p', 'note-empty', 'Local scans have no suggestions.'));
    return;
  }
  if (!ideas.length) {
    host.append(element('p', 'note-empty', 'No suggestions in these notes.'));
    return;
  }
  const checks = ideas.map(({text: idea, segmentIndex, ideaIndex}, i) => {
    const split = idea.indexOf(':');
    const title = split > 0 && split < 80 ? idea.slice(0, split) : idea.split('\n')[0];
    const body = split > 0 && split < 80 ? idea.slice(split + 1).trim() : idea.split('\n').slice(1).join(' ');
    const row = element('label', 'experiment');
    const check = element('input');
    check.type = 'checkbox';
    const prefix = `afterhours:${state.track.id}:${state.session.id}`,
      key = `${prefix}:${segmentIndex}:${ideaIndex}`;
    try {
      check.checked = (localStorage.getItem(key) ?? localStorage.getItem(`${prefix}:${i}`)) === 'done';
    } catch {
      /* Private mode: unchecked. */
    }
    const text = element('span', 'experiment-text');
    text.append(element('strong', '', title));
    if (body) text.append(element('small', '', body));
    row.classList.toggle('done', check.checked);
    row.append(check, text);
    check.addEventListener('change', () => {
      row.classList.toggle('done', check.checked);
      try {
        localStorage.setItem(key, check.checked ? 'done' : '');
      } catch {
        /* Not persisted. */
      }
      count();
    });
    host.append(row);
    return check;
  });
  const count = () => {
    $('try-count').textContent = `${checks.filter(c => c.checked).length} of ${checks.length} done`;
  };
  count();
}
function renderModeCards() {
  const requests = wholeRequests(),
    excerptRange = loopReady() ? `A–B loop · ${time(state.loopA)}–${time(state.loopB)}` : 'Start and length below';
  for (const card of document.querySelectorAll('.mode-card')) {
    card.setAttribute('aria-checked', String(card.dataset.mode === state.mode));
    const cost = card.querySelector('[data-cost]');
    if (cost)
      cost.textContent =
        card.dataset.mode === 'whole' ? `$ Paid · ${requests} request${requests > 1 ? 's' : ''}` : '$ Paid · 1 request';
    const range = card.querySelector('[data-range]');
    if (range) range.textContent = excerptRange;
  }
}
function updateForm() {
  const mode = state.mode,
    local = mode === 'local',
    paid = mode === 'whole' ? wholeRequests() : 1,
    running = busy();
  renderModeCards();
  $('range-fields').hidden = mode === 'whole';
  $('start').disabled = $('length').disabled = mode === 'whole';
  $('use-loop').disabled = !loopReady();
  $('analysis-form').classList.toggle('is-paid', !local);
  $('cost-chip').hidden = local;
  $('engine').textContent = local ? 'librosa + NumPy' : 'OpenAI audio';
  $('destination').textContent = local ? 'This Mac only' : 'api.openai.com';
  $('request-count').textContent = local
    ? '0 · free'
    : mode === 'whole'
      ? `${paid} × ≤120 s`
      : `1 × ${number(Math.min(120, Number($('length').value) || 0), 0)} s`;
  $('cost-note').textContent = local
    ? 'Stays on this Mac.'
    : !state.keyReady
      ? 'Add OPENAI_API_KEY to .env to enable. Never paste it into chat.'
      : 'Audio leaves this Mac.';
  const blocked = !state.track || state.loading || running;
  $('analyze').disabled = blocked || (!local && !state.keyReady);
  $('analyze').className = `btn ${local ? 'btn-ok' : 'btn-paid'}`;
  $('analyze').querySelector('span').textContent = running
    ? 'Listening…'
    : local
      ? 'Run free scan'
      : `$ Send ${paid} paid request${paid > 1 ? 's' : ''}`;
  $('run-local').hidden = local;
  $('run-local').disabled = blocked;
}
function renderJobs() {
  const active = state.jobs.find(job => ['queued', 'running'].includes(job.status)),
    recent = active || state.jobs[0];
  $('job-status').hidden = !recent;
  $('job-status').classList.toggle('running', !!active);
  if (recent)
    $('job-status').textContent = active
      ? 'Listening… keep using the player'
      : recent.status === 'complete'
        ? 'Report saved'
        : recent.error || 'Interrupted · finished excerpts kept';
  updateForm();
}
async function submitJob(mode) {
  if (!state.track || busy()) return;
  const excerpt = mode !== 'whole';
  try {
    const job = await request('/api/jobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        track_id: state.track.id,
        mode,
        start: excerpt ? Number($('start').value) : 0,
        duration: excerpt ? Number($('length').value) : 60,
      }),
    });
    state.jobs.unshift(job);
    renderJobs();
    toast(mode === 'local' ? 'Local scan running' : 'Paid listening started', mode === 'local' ? 'ok' : 'paid');
  } catch (error) {
    toast(error.message, 'err');
    updateForm();
  }
}
async function pollJobs() {
  try {
    const {jobs} = await request('/api/jobs');
    const previousJobs = state.jobs;
    const wasRunning = job => {
      const previous = previousJobs.find(old => old.id === job.id);
      return previous && ['queued', 'running'].includes(previous.status) && !['queued', 'running'].includes(job.status);
    };
    const finished = jobs.filter(wasRunning);
    state.jobs = jobs;
    renderJobs();
    if (finished.length && state.track) {
      await loadTrack(state.track.id, true);
      const newest = jobs.find(job => job.track_id === state.track.id && job.status === 'complete');
      if (newest) {
        state.session = state.track.sessions.find(session => session.id === newest.report_id) || state.session;
        state.view = 'report';
        renderAI();
      }
      const failed = finished.find(job => job.status !== 'complete');
      toast(failed ? failed.error || 'Interrupted · finished excerpts kept' : 'Report saved', failed ? 'err' : 'ok');
    }
  } catch {
    /* A server restart should not destroy the current listening view. */
  }
  setTimeout(pollJobs, 2200);
}
for (const card of document.querySelectorAll('.mode-card'))
  card.addEventListener('click', () => {
    state.mode = card.dataset.mode;
    updateForm();
  });
document.querySelector('.mode-cards').addEventListener('keydown', event => {
  const order = ['whole', 'excerpt', 'local'],
    step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
  if (!step) return;
  event.preventDefault();
  state.mode = order[(order.indexOf(state.mode) + step + 3) % 3];
  updateForm();
  document.querySelector(`.mode-card[data-mode="${state.mode}"]`).focus();
});
$('use-loop').addEventListener('click', () => {
  if (!loopReady()) return;
  $('start').value = Math.round(state.loopA * 10) / 10;
  $('length').value = Math.min(120, Math.round((state.loopB - state.loopA) * 100) / 100);
  updateForm();
});
$('length').addEventListener('input', updateForm);
$('analysis-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('analyze').disabled) submitJob(state.mode);
});
$('run-local').addEventListener('click', () => submitJob('local'));
$('ai-new').addEventListener('click', () => {
  state.view = 'setup';
  if (loopReady()) {
    state.mode = 'excerpt';
    $('use-loop').click();
  }
  renderAI();
});

/* ── import / export ───────────────────────────────────────── */
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    toast('Choose a file under 100 MB', 'err');
    event.target.value = '';
    return;
  }
  $('import').disabled = true;
  toast('Importing locally…');
  try {
    const data = await request('/api/tracks', {
      method: 'POST',
      headers: {'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name)},
      body: file,
    });
    const library = await request('/api/library');
    state.tracks = library.tracks;
    await loadTrack(data.id);
    toast('Recording added');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    $('import').disabled = false;
    event.target.value = '';
  }
});
$('export').addEventListener('click', () => {
  if (!state.track) return;
  const blob = new Blob(
    [
      JSON.stringify(
        {
          track: {
            id: state.track.id,
            title: state.track.title,
            artist: state.track.artist,
            duration: state.track.duration,
          },
          summary: state.track.summary,
          session: state.session,
          live_effects: effects.snapshot(),
        },
        null,
        2,
      ),
    ],
    {type: 'application/json'},
  );
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url;
  anchor.download = `afterhours-${state.track.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ── live effects ──────────────────────────────────────────── */
const effectNames = {
  cutoff: 'Cutoff',
  resonance: 'Resonance',
  bass: 'Bass',
  treble: 'Treble',
  drive: 'Distortion',
  delay: 'Echo time',
  echo: 'Echo mix',
};
function effectLabel(key, value) {
  if (key === 'cutoff') {
    const hz = LiveEffects.frequency(value);
    return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
  }
  if (key === 'bass' || key === 'treble') return `${value > 0 ? '+' : ''}${value}dB`;
  if (key === 'delay') return `${value}ms`;
  return key === 'resonance' ? value.toFixed(1) : `${Math.round(value)}%`;
}
function renderEffects() {
  for (const [key, knob] of Object.entries(effectKnobs)) knob.set(effects.values[key]);
  $('fx-dot').style.left = `${effects.values.cutoff}%`;
  $('fx-dot').style.top = `${100 - (effects.values.echo / 65) * 100}%`;
  $('fx-bypass').setAttribute('aria-pressed', String(effects.bypassed));
  $('fx-pad').classList.toggle('bypassed', effects.bypassed);
  for (const button of document.querySelectorAll('[data-preset]'))
    button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset));
  const available = effects.context?.state === 'running';
  $('fx-status').textContent = effects.bypassed
    ? 'Original signal'
    : !audio.paused && available
      ? 'Live · effects on'
      : 'Press play. Move anything.';
}
for (const [key, control] of Object.entries(LiveEffects.controls)) {
  const knob = AfterhoursShell.knob({
    label: control.label,
    name: effectNames[key],
    min: control.min,
    max: control.max,
    step: control.step,
    value: control.initial,
    bipolar: key === 'bass' || key === 'treble',
    format: v => effectLabel(key, v),
    onInput: v => {
      state.preset = null;
      effects.set(key, v);
    },
  });
  effectKnobs[key] = knob;
  $('fx-controls').append(knob.el);
}
$('fx-bypass').addEventListener('click', () => {
  effects.bypassed = !effects.bypassed;
  effects.apply();
});
$('fx-reset').addEventListener('click', () => {
  state.preset = null;
  effects.reset();
});
const effectPresets = {
  dark: {cutoff: 63, resonance: 1.4, bass: 3, treble: -3, drive: 15, echo: 12, delay: 360},
  echo: {cutoff: 84, resonance: 0.9, bass: 1, treble: -2, drive: 12, echo: 45, delay: 420},
  crush: {cutoff: 85, resonance: 0.7, bass: 2, treble: -4, drive: 70, echo: 15, delay: 160},
};
for (const button of document.querySelectorAll('[data-preset]'))
  button.addEventListener('click', () => {
    effects.bypassed = false;
    state.preset = button.dataset.preset;
    for (const [key, value] of Object.entries(effectPresets[button.dataset.preset])) effects.set(key, value);
    toast(`Preset · ${button.textContent}`);
  });
const effectPad = $('fx-pad');
let padPointer = null;
function moveEffectPad(event) {
  const rect = effectPad.getBoundingClientRect();
  state.preset = null;
  effects.set('cutoff', ((event.clientX - rect.left) / rect.width) * 100);
  effects.set('echo', (1 - (event.clientY - rect.top) / rect.height) * 65);
}
effectPad.addEventListener('pointerdown', event => {
  if (event.button !== 0 || padPointer !== null) return;
  event.preventDefault();
  effectPad.focus();
  padPointer = event.pointerId;
  effectPad.setPointerCapture(event.pointerId);
  moveEffectPad(event);
});
effectPad.addEventListener('pointermove', event => {
  if (event.pointerId === padPointer) moveEffectPad(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  effectPad.addEventListener(name, () => {
    padPointer = null;
  });
effectPad.addEventListener('keydown', event => {
  const direction = {
    ArrowLeft: ['cutoff', -2],
    ArrowRight: ['cutoff', 2],
    ArrowUp: ['echo', 2],
    ArrowDown: ['echo', -2],
  }[event.key];
  if (!direction) return;
  event.preventDefault();
  state.preset = null;
  effects.set(direction[0], effects.values[direction[0]] + direction[1]);
});
function meterFrame() {
  if (document.hidden || document.querySelector('[data-ws-panel="listen"]').hidden) return;
  const raw = Math.min(1, effects.level()),
    level = Math.round(raw * 100) / 100;
  if ($('fx-meter').value !== level) $('fx-meter').value = level;
  const db = raw > 0.0001 ? (20 * Math.log10(raw)).toFixed(1) : '−∞';
  if ($('fx-meter-db').textContent !== db) $('fx-meter-db').textContent = db;
}
renderEffects();
setInterval(meterFrame, 50);

(async function init() {
  try {
    const data = await request('/api/library');
    state.tracks = data.tracks;
    state.keyReady = data.key_ready;
    state.jobs = data.jobs;
    $('key-status').textContent = state.keyReady ? 'API key ready' : 'No API key · local only';
    $('key-dot').classList.toggle('ready', state.keyReady);
    if (!state.keyReady) state.mode = 'local';
    renderLibrary();
    renderJobs();
    renderAI();
    if (state.tracks.length) await loadTrack(state.tracks[0].id);
    else $('loading').textContent = 'Import a recording to start.';
    pollJobs();
  } catch (error) {
    $('loading').textContent = 'Local server unavailable · run bash start.sh';
    toast(error.message, 'err');
  }
})();

AfterhoursShell.register('recording', {
  source: () => (state.track && !state.loading ? {id: state.track.id, title: state.track.title, media: audio} : null),
  label: 'Recording',
  available: () => !!state.track,
  playing: () => !!state.track && !audio.paused,
  state: () =>
    !state.track
      ? {text: 'Empty', dot: 'idle'}
      : !audio.paused
        ? {text: 'Playing', dot: 'live'}
        : audio.currentTime > 0
          ? {text: 'Paused', dot: 'ok'}
          : {text: 'Idle', dot: 'idle'},
  play: playRecording,
  stop: pauseRecording,
  start: () => seek(state.loopOn && loopReady() ? state.loopA : 0),
  position: () => ({label: `Recording · of ${time(state.track?.duration)}`, text: time(audio.currentTime)}),
  tempo: () => ({label: 'Speed', text: `${audio.playbackRate.toFixed(2)}×`}),
});
