'use strict';
// Live keyboard adapter for the exact Groove voice and mixer graph.
class AfterhoursGrooveInstrument {
  static validate(raw) {
    if (!raw?.track || raw.track.machine === 'Sample' || !AfterhoursGroove.machines.includes(raw.track.machine))
      throw new Error('Invalid Groove sound');
    const lane = Number.isFinite(raw.lane) ? Math.max(0, Math.min(15, Math.round(raw.lane))) : 0;
    const performance = AfterhoursPerformanceCore.validate(raw.performance);
    // A sequencer mute/solo is an arrangement choice, not a mute for live playing.
    performance.mixer.lanes.forEach(p => {
      p.mute = false;
      p.solo = false;
    });
    return {
      id: 'groove-part',
      family: 'groove',
      lane,
      track: AfterhoursGroove.sound(raw.track, lane),
      performance,
      mix: {space: Number.isFinite(raw.mix?.space) ? Math.max(0, Math.min(1, raw.mix.space)) : 0, pump: 0},
      gate: Number.isFinite(raw.gate) ? Math.max(0.003125, Math.min(4, raw.gate)) : 0.25,
    };
  }
  constructor(context, patch, bpm) {
    this.context = context;
    this.held = new Map();
    this.patch = patch;
    this.renderer = new FMGrooveAudio(context, bpm, undefined, patch.performance, 'synth');
    this.renderer.setMix(patch.mix);
  }
  noteOn(id, note, velocity = 0.8, when = this.context.currentTime) {
    this.noteOff(id, when);
    while (this.renderer.voices.size >= 16) {
      const voice = this.renderer.voices.values().next().value;
      this.renderer.silence(voice);
      this.renderer.voices.delete(voice);
      for (const [key, held] of this.held) if (held === voice) this.held.delete(key);
    }
    const p = this.patch;
    const voice = this.renderer.hit(
      {
        lane: p.lane,
        settings: {...p.track, note},
        gate: p.gate,
        velocity,
        beat: ((when - this.renderer.started) * this.renderer.bpm) / 60,
      },
      when,
      true,
    );
    if (voice) this.held.set(id, voice);
  }
  noteOff(id, when = this.context.currentTime) {
    const voice = this.held.get(id);
    if (!voice) return;
    this.held.delete(id);
    voice.release(Math.max(this.context.currentTime, when));
  }
  expression(id, type, value) {
    const voice = this.held.get(id);
    if (!voice) return;
    const param = type === 'bend' ? voice.bend.offset : voice.pressure.gain;
    param.setTargetAtTime(type === 'bend' ? value * 100 : 0.4 + 0.6 * value, this.context.currentTime, 0.015);
  }
  setTempo(bpm) {
    if (bpm !== this.renderer.bpm) {
      this.renderer.bpm = bpm;
      this.renderer.setMix(this.patch.mix);
    }
  }
  panic() {
    this.held.clear();
    this.renderer.stop();
  }
  dispose() {
    this.held.clear();
    this.renderer.dispose();
  }
}
window.AfterhoursGrooveInstrument = AfterhoursGrooveInstrument;
