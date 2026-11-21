'use strict';
/* Timestamped 24 PPQN MIDI clock. Only the explicitly selected output receives it. */
(function (root) {
  class MIDIClock {
    constructor() {
      this.output = null;
      this.running = false;
      this.nextPulse = 0;
    }
    stop() {
      if (this.output && this.running) {
        this.output.clear();
        this.output.send([0xfc]);
      }
      this.running = false;
    }
    select(output) {
      this.stop();
      this.output = output;
    }
    tick(clock, now) {
      if (!this.output) return;
      if (
        !clock.running ||
        clock.ready === false ||
        !Number.isFinite(clock.beat) ||
        !Number.isFinite(clock.bpm) ||
        clock.bpm <= 0
      ) {
        this.stop();
        return;
      }
      const jumped =
        this.running &&
        (clock.run !== this.run ||
          clock.beat < this.lastBeat - 0.01 ||
          clock.beat - this.lastBeat > 2 ||
          now - this.lastTime > 250);
      if (jumped) this.stop();
      if (!this.running) {
        // A run that began at zero is a Start even if this poll arrives a little late: catch up its first
        // pulses at once. Anything else continues from the next sixteenth, where Song Position and the
        // first pulse agree.
        if (!clock.startBeat && clock.beat < 1) {
          this.output.send([0xfa]);
          const due = Math.ceil(clock.beat * 24 - 0.001);
          for (let pulse = 0; pulse < due; pulse++) this.output.send([0xf8], now);
          this.nextPulse = due;
        } else {
          const position = Math.min(16383, Math.ceil(clock.beat * 4 - 0.001));
          this.output.send([0xf2, position & 127, (position >> 7) & 127]);
          this.output.send([0xfb]);
          this.nextPulse = position * 6;
        }
        this.running = true;
        this.run = clock.run;
      } else if (clock.bpm !== this.bpm) {
        this.output.clear();
        this.nextPulse = Math.ceil(clock.beat * 24);
      }
      const msPerBeat = 60000 / clock.bpm;
      // Do not burst stale ticks after the event loop has been delayed.
      this.nextPulse = Math.max(this.nextPulse, Math.ceil(clock.beat * 24 - 0.001));
      while (this.nextPulse / 24 <= clock.beat + (0.05 * clock.bpm) / 60) {
        this.output.send([0xf8], now + Math.max(0, (this.nextPulse / 24 - clock.beat) * msPerBeat));
        this.nextPulse++;
      }
      this.bpm = clock.bpm;
      this.lastBeat = clock.beat;
      this.lastTime = now;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = MIDIClock;
  else root.AfterhoursMIDIClock = MIDIClock;
})(typeof window !== 'undefined' ? window : globalThis);
