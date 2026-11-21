'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  Q = require('../web/mpk-protocol');
test('Plus II protocol accepts its identity, bounds text and rejects other models or malformed packets', () => {
  assert.equal(Q.identity([240, 126, 127, 6, 2, 71, 3, 0, 25, 0, 247]), true);
  assert.equal(Q.identity([240, 126, 127, 6, 2, 71, 93, 0, 25, 0, 247]), false);
  assert.deepEqual(Q.command(0x1c, [2]), [240, 71, 0, 3, 28, 0, 1, 2, 247]);
  assert.deepEqual(Q.parse([240, 71, 0, 3, 45, 0, 1, 0, 247]), {id: 45, payload: [0]});
  assert.equal(Q.parse([240, 71, 0, 3, 45, 0, 2, 0, 247]), null);
  const text = Q.text(1, 'Мій інструмент 🎹'.repeat(10));
  assert.deepEqual(text.slice(7, 9), [2, 1]);
  assert.deepEqual(Q.parse(Q.row(0)), {id: 20, payload: [2, 0, 0, 31, 63, 31, 0, 0, 0]});
  assert.deepEqual(Q.parse(Q.row(1)), {id: 20, payload: [2, 1, 0, 31, 63, 0, 0, 0, 0]});
  assert.equal(text.length <= 31, true);
  assert.equal(
    text.slice(1, -1).every(b => b >= 0 && b < 128),
    true,
  );
  assert.match(String.fromCharCode(...text.slice(9, -2)), /Miy instrument/);
  assert.deepEqual(Q.light(36, 13, 9), [153, 36, 13]);
  assert.equal(Q.daw({name: 'MPK mini Plus II DAW Port'}), true);
  assert.equal(Q.daw({name: 'MPK mini Plus II Plugin Port'}), false);
  assert.equal(Q.relative(1), 1);
  assert.equal(Q.relative(127), -1);
  assert.equal(Q.relative(0), 0);
});
