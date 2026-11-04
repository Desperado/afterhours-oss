'use strict';
const G = require('../../web/groove-core');
const Performance = require('../../web/performance-core');
// Two isolated pitches test register matching without depending on a song transcription.
module.exports = function song() {
  const p = G.project();
  p.title = 'Register test';
  p.arrangement = [{name: 'Test phrase', pattern: 0, bars: 4, lanes: [4, 9]}];
  p.tonality = {root: 7, scale: 'minor'};
  p.performance = Performance.validate();
  for (const pattern of p.patterns) {
    for (const track of pattern.tracks) for (const step of track.steps) step.on = false;
    for (const [lane, note, name] of [
      [4, 31, 'Warm bass'],
      [9, 67, 'Guide'],
    ]) {
      const t = pattern.tracks[lane];
      Object.assign(t, {machine: 'Analog', name, note, cutoff: 620});
      Object.assign(t.steps[0], {on: true, gate: 1, locks: {note}});
      if (lane === 9) {
        Object.assign(t.steps[1], {on: true, gate: 1, locks: {note: 66}});
        Object.assign(t.steps[2], {on: true, gate: 1, locks: {note: 67}});
      }
    }
  }
  return G.validate(p);
};
