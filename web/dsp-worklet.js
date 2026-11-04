'use strict';
// Shared WASM instance for the legacy filter and complete Rust voices in this audio context.
let exports = null;

// Worklet scopes have no atob.
function decodeBase64(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values = new Uint8Array(128);
  for (let i = 0; i < alphabet.length; i++) values[alphabet.charCodeAt(i)] = i;
  const length = (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0),
    bytes = new Uint8Array(length);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const n =
      (values[text.charCodeAt(i)] << 18) |
      (values[text.charCodeAt(i + 1)] << 12) |
      (values[text.charCodeAt(i + 2)] << 6) |
      values[text.charCodeAt(i + 3)];
    if (o < length) bytes[o++] = n >> 16;
    if (o < length) bytes[o++] = (n >> 8) & 255;
    if (o < length) bytes[o++] = n & 255;
  }
  return bytes;
}

export function engine() {
  if (!exports) {
    const module = new WebAssembly.Module(decodeBase64(globalThis.AfterhoursLadderWasm));
    exports = new WebAssembly.Instance(module, {}).exports;
  }
  return exports;
}
