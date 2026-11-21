'use strict';
// MPK mini Plus II DAW protocol. Reference: Bitwig's official akai/mpkmk4 driver.
(function (root) {
  const command = (id, payload = []) => [
    0xf0,
    0x47,
    0,
    3,
    id,
    payload.length >> 7,
    payload.length & 127,
    ...payload,
    0xf7,
  ];
  const uk = Object.fromEntries(
    Array.from('абвгґдеєжзиіїйклмнопрстуфхцчшщьюя').map((c, i) => [
      c,
      [
        'a',
        'b',
        'v',
        'h',
        'g',
        'd',
        'e',
        'ye',
        'zh',
        'z',
        'y',
        'i',
        'yi',
        'y',
        'k',
        'l',
        'm',
        'n',
        'o',
        'p',
        'r',
        's',
        't',
        'u',
        'f',
        'kh',
        'ts',
        'ch',
        'sh',
        'shch',
        '',
        'yu',
        'ya',
      ][i],
    ]),
  );
  const ascii = text =>
    String(text)
      .replace(/[А-Яа-яІіЇїЄєҐґ]/g, c => {
        const v = uk[c.toLowerCase()] || '';
        return c === c.toUpperCase() ? v.toUpperCase() : v;
      })
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20);
  const api = {
    command,
    inquiry: [0xf0, 0x7e, 0x7f, 6, 1, 0xf7],
    identity: b =>
      b.length >= 10 &&
      b[0] === 0xf0 &&
      b[1] === 0x7e &&
      b[3] === 6 &&
      b[4] === 2 &&
      b[5] === 0x47 &&
      b[6] === 3 &&
      b[7] === 0 &&
      b[8] === 0x19 &&
      b.at(-1) === 0xf7,
    parse: b =>
      b.length >= 8 &&
      b[0] === 0xf0 &&
      b[1] === 0x47 &&
      b[3] === 3 &&
      b.at(-1) === 0xf7 &&
      b[5] * 128 + b[6] === b.length - 8
        ? {id: b[4], payload: Array.from(b).slice(7, -1)}
        : null,
    // Three 24-point rows use the display height; 16-point rows crowd the top.
    row: line => command(0x14, [2, line, 0, 31, 63, line === 1 ? 0 : 31, 0, 0, 0]),
    text: (line, text) => command(0x10, [2, line, ...Array.from(ascii(text), c => c.charCodeAt(0)), 0]),
    light: (id, color, animation = 6) => [0x90 | animation, id, color],
    daw: port =>
      /mpk[\s_-]*mini[\s_-]*plus[\s_-]*(ii|2)\b/i.test(port?.name || '') && /\bdaw\b/i.test(port?.name || ''),
    relative: v => (v === 64 || v === 0 ? 0 : v < 64 ? v : v - 128),
  };
  if (typeof module === 'object') module.exports = api;
  else root.AfterhoursMPKProtocol = api;
})(typeof window === 'object' ? window : globalThis);
