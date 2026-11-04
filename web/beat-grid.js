/* Map musical beats to the recording clock, including between detected beats. */
'use strict';
(function (root) {
  function beatAt(beats, time) {
    let lo = 0,
      hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - beats[lo]) / (beats[lo + 1] - beats[lo]);
  }
  function timeAt(beats, beat) {
    const i = Math.max(0, Math.min(beats.length - 2, Math.floor(beat)));
    return beats[i] + (beat - i) * (beats[i + 1] - beats[i]);
  }
  const api = {beatAt, timeAt};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AfterhoursBeatGrid = api;
})(typeof window === 'undefined' ? globalThis : window);
