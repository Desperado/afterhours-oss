'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {selection} = require('../desktop/content.cjs');

test('explicit public builds bypass all private settings and conflicting selections fail', () => {
  assert.deepEqual(selection(['--public', '--dir']), {pack: undefined, directory: true, flavor: 'public'});
  assert.equal(selection(['--content-pack', '/tmp/afterhours fixture']).flavor, 'private');
  for (const args of [
    ['--public', '--private'],
    ['--public', '--content-pack', '/tmp/private'],
    ['--content-pack'],
    ['--content-pack', '--public'],
    ['--unknown'],
  ]) {
    assert.throws(() => selection(args));
  }
});
