'use strict';
// One visible canvas and one stereo tap shared by all six meter faces.
window.AfterhoursVisual = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.last = -1;
    this.dirty = true;
    this.style = 'led';
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.samples = [new Float32Array(1024), new Float32Array(1024)];
    this.levels = [0, 0];
    this.holds = [0, 0];
    this.holdUntil = [0, 0];
    this.clipUntil = [0, 0];
    this.readingAt = 0;
    this.silent = false;
  }
  paint(engine, clock, running, now) {
    const c = this.canvas,
      ctx = this.ctx;
    if (!ctx || !c.clientWidth || document.hidden || now - this.last < (this.reduced.matches ? 0.25 : 1 / 24)) return;
    const dt = Math.min(0.25, Math.max(0, now - this.last));
    this.last = now;
    const w = c.clientWidth,
      h = c.clientHeight,
      dpr = Math.min(1.5, devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.dirty = true;
    }
    const accumulated = window.AfterhoursAudio?.readStereo(this.samples[0], this.samples[1]);
    const peaks = [],
      rms = [];
    for (let ch = 0; ch < 2; ch++) {
      let peak = 0,
        sum = 0;
      for (const x of this.samples[ch]) {
        peak = Math.max(peak, Math.abs(x));
        sum += x * x;
      }
      peaks[ch] = peak;
      rms[ch] = Math.sqrt(sum / this.samples[ch].length);
      this.levels[ch] += (rms[ch] - this.levels[ch]) * (1 - Math.exp(-dt / 0.3));
      const heldPeak = Math.max(peak, accumulated?.[ch] || 0);
      if (heldPeak >= this.holds[ch]) {
        this.holds[ch] = heldPeak;
        this.holdUntil[ch] = now + 1;
      } else if (now > this.holdUntil[ch]) this.holds[ch] = Math.max(heldPeak, this.holds[ch] * Math.exp(-dt * 3));
      if (heldPeak >= 0.999) this.clipUntil[ch] = now + 1.5;
    }
    const silent =
      peaks.every(p => p < 0.00001) &&
      this.holds.every(p => p < 0.00001) &&
      this.levels.every(p => p < 0.00001) &&
      this.clipUntil.every(time => now >= time);
    if (silent && this.silent && !this.dirty) return;
    this.silent = silent;
    this.dirty = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.style === 'vu' ? '#e7d6ad' : '#0b111a';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px monospace';
    ctx.textBaseline = 'middle';
    const db = value => (value > 0.00001 ? 20 * Math.log10(value) : -Infinity);
    const position = value => Math.max(0, Math.min(1, (db(value) + 60) / 60));
    const label = value => (Number.isFinite(db(value)) ? db(value).toFixed(1) : '−∞');
    const color = fraction => (fraction > 0.95 ? '#ff4969' : fraction > 0.8 ? '#ffc05a' : '#50e6b3');
    if (this.style === 'vu') {
      for (let ch = 0; ch < 2; ch++) {
        const cx = w * (ch ? 0.75 : 0.25),
          cy = h - 32,
          radius = Math.min(w / 4 - 18, h - 60);
        const angle = value => Math.PI * (1.18 + Math.max(0, Math.min(1, value)) * 0.64);
        const point = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        ctx.strokeStyle = '#3b3329';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle(0), angle(1));
        ctx.stroke();
        for (let i = 0; i <= 10; i++) {
          const a = angle(i / 10),
            p = point(a, radius),
            q = point(a, radius - 6);
          ctx.strokeStyle = i >= 9 ? '#ae2438' : '#3b3329';
          ctx.beginPath();
          ctx.moveTo(...p);
          ctx.lineTo(...q);
          ctx.stroke();
        }
        const vu = db(this.levels[ch]) + 18,
          a = angle((vu + 20) / 23);
        ctx.strokeStyle = '#b62e37';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(...point(a, radius - 10));
        ctx.stroke();
        ctx.fillStyle = '#3b3329';
        ctx.textAlign = 'center';
        ctx.fillText(`${ch ? 'R' : 'L'} · VU`, cx, 16);
        ctx.fillText('−20   −10    0   +3', cx, 32);
      }
      ctx.fillStyle = '#5a4b39';
      ctx.textAlign = 'center';
      ctx.fillText('0 VU = −18 dBFS · 300 ms', w / 2, h - 25);
    } else if (this.style === 'digital') {
      for (let ch = 0; ch < 2; ch++) {
        const x = w * (ch ? 0.75 : 0.25);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7b91a8';
        ctx.font = '11px monospace';
        ctx.fillText(`${ch ? 'RIGHT' : 'LEFT'} · dBFS`, x, 17);
        ctx.fillStyle = now < this.clipUntil[ch] ? '#ff4969' : '#50e6b3';
        ctx.font = `500 ${Math.min(36, w / 10)}px monospace`;
        ctx.fillText(label(peaks[ch]), x, 57);
        ctx.font = '11px monospace';
        ctx.fillStyle = '#9cb2c9';
        ctx.fillText(`RMS ${label(rms[ch])}`, x, 90);
        ctx.fillText(`HOLD ${label(this.holds[ch])}`, x, 108);
      }
    } else if (this.style === 'scope') {
      const left = 28,
        width = w - left - 12;
      for (let ch = 0; ch < 2; ch++) {
        const y = h * (ch ? 0.64 : 0.24),
          height = h * 0.18;
        ctx.fillStyle = '#9cb2c9';
        ctx.fillText(ch ? 'R' : 'L', 10, y);
        ctx.strokeStyle = '#243047';
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(w - 12, y);
        ctx.stroke();
        ctx.strokeStyle = ch ? '#ffab64' : '#50e6b3';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 256; i++) {
          const x = left + (i / 255) * width,
            v = y - this.samples[ch][i * 4] * height;
          if (i) ctx.lineTo(x, v);
          else ctx.moveTo(x, v);
        }
        ctx.stroke();
      }
    } else if (this.style === 'ppm') {
      const width = Math.min(60, w / 8),
        height = h - 40;
      for (let ch = 0; ch < 2; ch++) {
        const x = w / 2 + (ch ? 16 : -16 - width),
          fraction = position(peaks[ch]);
        ctx.fillStyle = '#172434';
        ctx.fillRect(x, 16, width, height);
        ctx.fillStyle = color(fraction);
        ctx.fillRect(x, 16 + height * (1 - fraction), width, height * fraction);
        ctx.fillStyle = '#e4edf7';
        ctx.fillRect(x, 16 + height * (1 - position(this.holds[ch])), width, 2);
        ctx.textAlign = 'center';
        ctx.fillText(ch ? 'R' : 'L', x + width / 2, h - 12);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9cb2c9';
      for (const d of [-60, -48, -36, -24, -12, 0])
        ctx.fillText(String(d), w / 2 - width - 28, 16 + (height * -d) / 60);
    } else {
      const left = 32,
        width = w - 52;
      for (let ch = 0; ch < 2; ch++) {
        const y = ch ? 82 : 30,
          fraction = position(peaks[ch]),
          hold = position(this.holds[ch]);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#9cb2c9';
        ctx.fillText(ch ? 'R' : 'L', 10, y + 10);
        if (this.style === 'led') {
          for (let i = 0; i < 48; i++) {
            ctx.fillStyle = (i + 1) / 48 <= fraction ? color((i + 1) / 48) : '#182634';
            ctx.fillRect(left + (i / 48) * width, y, Math.max(1, width / 48 - 3), 18);
          }
        } else {
          ctx.fillStyle = '#172434';
          ctx.fillRect(left, y, width, 18);
          ctx.fillStyle = color(fraction);
          ctx.fillRect(left, y, width * fraction, 18);
          ctx.fillStyle = '#b1fff0';
          ctx.fillRect(left, y + 13, width * position(rms[ch]), 5);
        }
        ctx.fillStyle = '#e4edf7';
        ctx.fillRect(left + hold * (width - 2), y - 2, 2, 22);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9cb2c9';
      for (let i = 0; i <= 5; i++) ctx.fillText(String(-60 + i * 12), left + (width * i) / 5, 65);
    }
    if (this.style === 'vu' || this.style === 'scope') {
      ctx.fillStyle = this.style === 'vu' ? '#5a4b39' : '#9cb2c9';
      ctx.textAlign = 'center';
      for (let ch = 0; ch < 2; ch++)
        ctx.fillText(`${ch ? 'R' : 'L'} HOLD ${label(this.holds[ch])} dBFS`, w * (ch ? 0.75 : 0.25), h - 9);
    }
    // Clip is latched independently for each channel, including on the analog face.
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let ch = 0; ch < 2; ch++)
      if (now < this.clipUntil[ch]) {
        ctx.fillStyle = '#ff4969';
        ctx.fillText(`${ch ? 'R' : 'L'} CLIP`, w - 8, 10 + ch * 12);
      }
    if (now >= this.readingAt) {
      this.readingAt = now + 0.1;
      const output = document.getElementById('groove-meter-reading');
      const text = `L ${label(peaks[0])} · R ${label(peaks[1])} dBFS`;
      if (output && output.textContent !== text) output.textContent = text;
    }
  }
};
