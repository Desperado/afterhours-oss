'use strict';
/* Groove transport: lookahead scheduling on the audio clock, pattern queueing and section jumps. */
(() => {
  const App = AfterhoursGrooveApp,
    {S, LETTERS, status, pattern, ui, recordingSync} = App,
    G = AfterhoursGroove,
    P = AfterhoursPresets;
  let playVersion = 0,
    timer = null,
    sampleResumeFrame = null,
    ladderWarned = false;

  function audibleFrame() {
    const now = S.engine?.context.currentTime;
    return S.visuals.filter(v => !v.finished && v.time <= now).at(-1) || S.shownFrame;
  }
  function cancelPendingWrap() {
    if (!S.running || !S.songMode || S.sync) return;
    const wrap = S.visuals.find(v => v.wrapFrom !== undefined && v.time > S.engine.context.currentTime);
    if (!wrap) return;
    // Restore the current pass and reschedule its end; leave earlier voices/tails alone.
    S.engine.cancelFromTick?.(wrap.absolute);
    S.visuals = S.visuals.filter(v => v.absolute < wrap.absolute);
    S.hits = S.hits.filter(h => h.planTick < wrap.absolute);
    S.tick = wrap.absolute;
    S.nextTime = wrap.time;
    S.songOffset = wrap.wrapFrom;
  }
  async function audio(patterns = S.data.patterns) {
    const a = S.engine || (S.engine = new FMGrooveAudio(AfterhoursAudio.context(), S.data.bpm));
    if (!(await AfterhoursLadder.prepare(a.context)) && !ladderWarned) {
      ladderWarned = true;
      status('Ladder β filter unavailable · using Biquad', 'err');
    }
    const voiceReady = await AfterhoursVoice.prepare(a.context);
    if (!voiceReady && patterns.some(p => p.tracks.some(t => t.machine === 'Analog')))
      throw AfterhoursVoice.unavailable('reload the app and try again');
    await AfterhoursSamples.prepare(patterns);
    if (patterns.some(p => p.tracks.some(t => t.machine === 'Instrument'))) status('Loading sampled instruments…');
    await AfterhoursInstruments.prepare(patterns);
    await a.context.resume();
    a.bpm = S.data.bpm;
    a.setMix?.(S.data.mix);
    if (a.context.state !== 'running') throw new Error('Browser audio suspended · press Play');
    return a;
  }
  async function auditionLane(lane) {
    try {
      const settings = {...pattern().tracks[lane]},
        a = await audio([{tracks: [settings]}]);
      a.hit({lane, settings, velocity: 0.8, gate: 0.5}, a.context.currentTime + 0.01);
      status(`Audition · ${settings.machine}`);
    } catch (e) {
      status(e.message, 'err');
    }
  }
  function stop(
    message = 'Groove stopped',
    pauseTrack = true,
    tone = message === 'Groove stopped' ? 'ok' : 'err',
    tails = false,
  ) {
    window.AfterhoursDemo?.stop();
    if (S.running || S.starting) AfterhoursPerformance.event('transport', 'stop');
    ++playVersion;
    S.starting = false;
    S.running = false;
    S.resumePosition = null;
    sampleResumeFrame = null;
    clearInterval(timer);
    timer = null;
    S.visuals = [];
    S.hits = [];
    S.queued = null;
    S.transition = null;
    S.sectionJump = null;
    S.shownTick = null;
    S.shownFrame = null;
    if (!tails) S.engine?.stop();
    S.syncTick = null;
    if (S.sync && pauseTrack) recordingSync.recording().stop();
    for (const b of document.querySelectorAll('#groove-grid .playing, #perform-steps .playing'))
      b.classList.remove('playing');
    ui.renderPatterns();
    ui.renderTrack();
    status(message, tone);
  }
  async function play() {
    if (S.running || S.starting) return;
    const version = ++playVersion;
    S.starting = true;
    try {
      const a = await audio();
      if (version !== playVersion) return;
      if (S.sync) {
        await recordingSync.recording().play();
        if (version !== playVersion) return;
        if (S.sync.media.paused) throw new Error('Recording could not start · press Play to retry');
        S.syncTick = null;
        S.loopOrigin = 0;
      }
      a.stop();
      const resume = S.resumePosition;
      S.resumePosition = null;
      const origin = a.context.currentTime + 0.25;
      a.started = origin - ((resume?.offsetTicks || 0) / 8) * (60 / S.data.bpm);
      S.tick = Math.ceil(resume?.offsetTicks || 0);
      S.sampleResume = true;
      S.nextTime = origin + ((S.tick - (resume?.offsetTicks || 0)) / 8) * (60 / S.data.bpm);
      S.loopOrigin = resume?.loopOrigin || 0;
      S.shownFrame = null;
      S.visuals = [];
      S.hits = [];
      S.playing = S.data.active;
      S.transition = null;
      S.songOffset = resume?.songOffset ?? S.songStart;
      S.sectionJump = null;
      S.running = true;
      timer = setInterval(schedule, 20);
      schedule();
      ui.renderPatterns();
      ui.renderTrack();
      AfterhoursPerformance.event('transport', 'play');
      status(S.sync ? 'Groove synced to recording' : 'Groove playing', 'live');
    } catch (e) {
      if (version === playVersion) stop(e.message);
    } finally {
      if (version === playVersion) S.starting = false;
    }
  }
  // Start: restart Groove's own clock from the top of the song or pattern.
  function restart() {
    window.AfterhoursDemo?.stop();
    S.resumePosition = null;
    sampleResumeFrame = null;
    S.songStart = S.songOffset = 0;
    S.sectionJump = null;
    S.queued = null;
    if (S.running && S.engine) {
      S.engine.stop();
      S.tick = 0;
      S.loopOrigin = 0;
      S.playing = S.data.active;
      S.transition = null;
      S.shownFrame = null;
      S.queuedAt = 32;
      S.visuals = [];
      S.hits = [];
      S.engine.started = S.nextTime = S.engine.context.currentTime + 0.05;
    }
    S.shownTick = null;
    ui.renderTrack();
  }
  function queuePattern(index) {
    const absolute = Math.max(32, (Math.floor((audibleFrame()?.absolute ?? -1) / 32) + 1) * 32);
    const first = S.visuals.find(v => v.absolute >= absolute);
    // Replace notes already scheduled for the upcoming audible bar.
    if (first) {
      S.engine.cancelFromTick?.(absolute);
      S.visuals = S.visuals.filter(v => v.absolute < absolute);
      S.hits = S.hits.filter(h => h.planTick < absolute);
      if (S.sync) S.syncTick = absolute;
      else {
        S.tick = absolute;
        S.nextTime = first.time;
      }
      if (S.transition && S.transition.absolute >= absolute) {
        S.playing = S.transition.playing;
        S.loopOrigin = S.transition.loopOrigin;
        S.transition = null;
      }
    }
    S.queued = index === S.playing ? null : index;
    S.queuedAt = absolute;
    status(S.queued === null ? 'Pattern change cancelled' : `Pattern ${LETTERS[index]} queued · next bar`, 'live');
    ui.renderPatterns();
    ui.renderPages();
  }
  function jumpToSection(index) {
    if (!S.data.arrangement?.[index]) return;
    AfterhoursPerformance.event('section', index);
    if (S.sync || S.syncRequest) return;
    const target = S.data.arrangement.slice(0, index).reduce((n, s) => n + s.bars * 32, 0);
    if (!S.running) {
      S.resumePosition = null;
      S.songStart = S.songOffset = target;
      S.songMode = true;
      S.data.active = S.data.arrangement[index].pattern;
      App.save();
      ui.renderAll();
      status(`${S.data.arrangement[index].name} selected · press Play`);
      return;
    }
    const absolute = Math.floor((S.shownFrame?.absolute ?? -1) / 32 + 1) * 32;
    // Remove only future scheduled notes at/after this bar; prior tails keep ringing.
    const first = S.visuals.find(v => v.absolute >= absolute || v.finished);
    if (first) {
      S.engine.cancelFromTick?.(absolute);
      S.visuals = S.visuals.filter(v => !v.finished && v.absolute < absolute);
      S.hits = S.hits.filter(h => h.planTick < absolute);
      S.tick = absolute;
      S.nextTime = first.time;
    }
    S.queued = null;
    S.sectionJump = {index, target, absolute};
    ui.renderTrack();
    status(`${S.data.arrangement[index].name} queued · next bar`);
  }
  // Scheduling may run ahead; the editor follows only frames whose audio time has arrived.
  function frameAt(absolute, time) {
    const jump = S.sectionJump;
    if (jump && !jump.applied && absolute >= jump.absolute) {
      S.songOffset = jump.target - absolute;
      S.songStart = jump.target;
      jump.applied = true;
      S.songMode = true;
    }
    if (S.songMode) {
      const total = S.data.arrangement.reduce((n, s) => n + s.bars * 32, 0);
      let wrapFrom;
      if (S.data.continuous && !S.sync && total && absolute + S.songOffset >= total) {
        wrapFrom = S.songOffset;
        S.songOffset -= total * Math.floor((absolute + S.songOffset) / total);
      }
      const section = P.sectionAt(S.data, absolute + S.songOffset);
      return section
        ? {
            pattern: section.pattern,
            tick: section.localTick,
            origin: absolute - section.localTick,
            section: section.index,
            songOffset: S.songOffset,
            wrapFrom,
          }
        : null;
    }
    if (S.queued !== null && absolute >= S.queuedAt) {
      S.transition = {absolute, time, playing: S.playing, loopOrigin: S.loopOrigin};
      S.playing = S.queued;
      S.queued = null;
      S.loopOrigin = absolute;
    }
    return {pattern: S.playing, tick: absolute - S.loopOrigin, origin: S.loopOrigin};
  }
  function frameEvents(frame) {
    const section = S.songMode ? S.data.arrangement[frame.section] : null;
    if (S.sampleResume) sampleResumeFrame = frame;
    else if (
      sampleResumeFrame &&
      (sampleResumeFrame.pattern !== frame.pattern ||
        sampleResumeFrame.origin !== frame.origin ||
        frame.tick < sampleResumeFrame.tick)
    )
      sampleResumeFrame = null;
    S.sampleResume = false;
    const events = G.events(S.data.patterns[frame.pattern], frame.tick, {
      swing: S.data.swing,
      fill: S.fill,
      sampleResumeTick: sampleResumeFrame?.tick ?? null,
    })
      .filter(e => !section || section.lanes.includes(e.lane))
      .map(e => ({
        ...e,
        planTick: frame.origin + frame.tick,
        beat: Math.max(frame.origin / 8, e.beat + frame.origin / 8),
      }));
    return window.AfterhoursDemo?.events(events, frame.origin + frame.tick) || events;
  }
  function schedule() {
    if (!S.running) return;
    try {
      const now = S.engine.context.currentTime;
      // Audio and song completion must not depend on requestAnimationFrame. Keep
      // the latest audible frame for the UI when a hidden window returns.
      if (S.visuals.some(v => v.finished && v.time <= now)) {
        stop('Song finished · tails ringing', true, 'ok', true);
        return;
      }
      while (S.visuals.length > 1 && S.visuals[1].time <= now) S.visuals.shift();
      S.hits = S.hits.filter(h => h.end > now || h.time > now - 0.5);
      scheduleRunning();
    } catch (error) {
      stop(error.message);
    }
  }
  function scheduleRunning() {
    if (S.sync) {
      scheduleSynced();
      return;
    }
    const a = S.engine,
      now = a.context.currentTime;
    if (a.context.state !== 'running' || S.nextTime < now - 2) {
      stop('Audio clock paused · press Play');
      return;
    }
    if (S.nextTime < now - 0.05) {
      if (S.tick === 0) a.started = S.nextTime = now + 0.1;
      else
        while (S.nextTime < now) {
          S.nextTime += 60 / S.data.bpm / 8;
          S.tick++;
        }
    }
    const secondsPerBeat = 60 / S.data.bpm;
    // Include the earliest half-speed microtiming, even at 40 BPM.
    while (S.nextTime < now + 0.12 + 0.2 * secondsPerBeat) {
      const frame = frameAt(S.tick, S.nextTime);
      if (!frame) {
        if (!S.visuals.some(v => v.finished)) S.visuals.push({time: S.nextTime, finished: true});
        return;
      }
      for (const e of frameEvents(frame)) {
        const when = S.nextTime + (e.beat - S.tick / 8) * secondsPerBeat;
        const voice = a.hit(e, when);
        window.AfterhoursDemo?.observe(voice, e, when);
        if (voice !== null) rememberHit(e, when, secondsPerBeat);
      }
      S.visuals.push({...frame, absolute: S.tick, time: S.nextTime, secondsPerBeat});
      S.nextTime += secondsPerBeat / 8;
      S.tick++;
    }
    S.hits.sort((a, b) => a.time - b.time);
  }
  function scheduleSynced() {
    const {media, beats} = S.sync,
      a = S.engine,
      now = a.context.currentTime;
    if (a.context.state !== 'running') {
      stop('Audio clock paused · press Play');
      return;
    }
    if (media.paused || media.ended || media.seeking) return;
    const position = media.currentTime,
      rate = media.playbackRate;
    if (S.syncTick === null) {
      S.syncTick = Math.max(0, Math.ceil(AfterhoursBeatGrid.beatAt(beats, position + 0.035 * rate) * 8));
      S.loopOrigin = 0;
      S.sampleResume = true;
    }
    if (AfterhoursBeatGrid.timeAt(beats, S.syncTick / 8) < position - 0.05 * rate)
      S.syncTick = Math.max(0, Math.ceil(AfterhoursBeatGrid.beatAt(beats, position + 0.035 * rate) * 8));
    const horizon = AfterhoursBeatGrid.beatAt(beats, position + 0.12 * rate) + 0.2;
    while (S.syncTick / 8 < horizon) {
      const beat = S.syncTick / 8;
      const time = now + (AfterhoursBeatGrid.timeAt(beats, beat) - position) / rate;
      const frame = frameAt(S.syncTick, time);
      if (!frame) {
        if (!S.visuals.some(v => v.finished)) S.visuals.push({time, finished: true});
        return;
      }
      const secondsPerBeat =
        (AfterhoursBeatGrid.timeAt(beats, beat + 1) - AfterhoursBeatGrid.timeAt(beats, beat)) / rate;
      const bpm = 60 / secondsPerBeat;
      if (Math.abs(a.bpm - bpm) > 0.000001) {
        a.bpm = bpm;
        a.setMix?.(S.data.mix);
      }
      for (const e of frameEvents(frame)) {
        const when = now + (AfterhoursBeatGrid.timeAt(beats, e.beat) - position) / rate;
        if (when >= now + 0.005) {
          const voice = a.hit(e, when);
          window.AfterhoursDemo?.observe(voice, e, when);
          if (voice !== null) rememberHit(e, when, secondsPerBeat);
        }
      }
      S.visuals.push({...frame, absolute: S.syncTick, time, secondsPerBeat});
      S.syncTick++;
    }
    S.hits.sort((a, b) => a.time - b.time);
  }

  function rememberHit(e, time, secondsPerBeat) {
    S.hits.push({
      time,
      end: time + e.gate * secondsPerBeat,
      lane: e.lane,
      v: e.velocity,
      planTick: e.planTick,
      settings: e.settings,
    });
  }

  Object.assign(App.transport, {
    schedule,
    audibleFrame,
    cancelPendingWrap,
    auditionLane,
    stop,
    play,
    restart,
    queuePattern,
    jumpToSection,
  });
})();
