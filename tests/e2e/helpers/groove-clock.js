async function clock(page) {
  await page.evaluate(() => {
    window.__clock = {timers: new Map(), next: 50000, events: [], stops: 0, cancelled: []};
    const set = window.setInterval,
      clear = window.clearInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (ms !== 20) return set(fn, ms, ...args);
      const id = ++__clock.next;
      __clock.timers.set(id, fn);
      return id;
    };
    window.clearInterval = id => {
      if (!__clock.timers.delete(id)) clear(id);
    };
    window.AudioContext = class {
      constructor() {
        this.currentTime = 0;
        this.state = 'running';
      }
      resume() {
        return Promise.resolve();
      }
    };
    const context = new AudioContext();
    AfterhoursAudio.context = () => context;
    FMGrooveAudio = class {
      setPerformance() {}
      mixer = {levels: () => Array(16).fill(0)};
      constructor(context, bpm) {
        this.context = context;
        this.bpm = bpm;
        __clock.engine = this;
      }
      hit(e, time) {
        __clock.events.push({time, note: e.settings.note, tick: e.planTick, lane: e.lane});
      }
      cancelFromTick(tick) {
        __clock.cancelled.push(tick);
        __clock.events = __clock.events.filter(e => e.tick < tick);
      }
      stop() {
        __clock.stops++;
        __clock.events = [];
      }
      dispose() {
        this.stop();
      }
    };
  });
}
async function advance(page, target) {
  await page.evaluate(target => {
    const ctx = __clock.engine.context;
    while (ctx.currentTime < target) {
      ctx.currentTime = Math.min(target, ctx.currentTime + 0.08);
      __clock.timers.forEach(fn => fn());
    }
  }, target);
}

module.exports = {clock, advance};
