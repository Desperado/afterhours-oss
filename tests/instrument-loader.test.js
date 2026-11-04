'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('web/groove-instruments.js', 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function loader({count = 12, fail = false, length = 100} = {}) {
  const stats = {active: 0, maximum: 0, samples: 0, manifests: 0, fail};
  const sandbox = {
    window: {},
    AfterhoursInstrumentCatalog: [{id: 'first'}, {id: 'second'}],
    OfflineAudioContext: class {
      async decodeAudioData() {
        stats.active++;
        stats.maximum = Math.max(stats.maximum, stats.active);
        await delay(10);
        stats.active--;
        return {duration: 1, numberOfChannels: 1, length};
      }
    },
    fetch: async url => {
      if (url.endsWith('manifest.json')) {
        stats.manifests++;
        const id = url.split('/')[2];
        const regions = Array.from({length: count}, (_, i) => ({
          sample: `${i.toString(16).padStart(24, '0')}.flac`,
          lo: 0,
          hi: 127,
          root: 60,
          lovel: 0,
          hivel: 127,
          take: 0,
          takes: 1,
          attack: 0,
          release: 0.1,
          volume: 0,
          veltrack: 100,
        }));
        // Repeated regions reference the same recording and must not decode it twice.
        return {ok: true, json: async () => ({id, version: 1, regions: [...regions, regions[0]]})};
      }
      stats.samples++;
      if (stats.fail && url.endsWith('000000000000000000000001.flac')) {
        await delay(2);
        throw new Error('download failed');
      }
      return {ok: true, headers: {get: () => '8'}, arrayBuffer: async () => new ArrayBuffer(8)};
    },
  };
  vm.runInNewContext(source, sandbox);
  return {api: sandbox.window.AfterhoursInstruments, stats};
}
const patterns = (...ids) => [{tracks: ids.map(instrument => ({machine: 'Instrument', instrument}))}];
test('sample workers share one bound across banks and concurrent prepare calls deduplicate recordings', async () => {
  const {api, stats} = loader();
  await Promise.all([api.prepare(patterns('first', 'second')), api.prepare(patterns('second', 'first'))]);
  assert.equal(stats.manifests, 2);
  assert.equal(stats.samples, 24);
  assert.equal(stats.maximum, 16);
  assert.equal(api.decodedBytes, 24 * 100 * 4);
  await api.prepare(patterns('first'));
  assert.equal(stats.samples, 24);
});
test('failed loads drain workers, publish no partial bank, and can be retried', async () => {
  const {api, stats} = loader({count: 20, fail: true});
  await assert.rejects(api.prepare(patterns('first', 'second')), /download failed/);
  assert.equal(stats.active, 0);
  assert.equal(api.decodedBytes, 0);
  stats.fail = false;
  await api.prepare(patterns('first', 'second'));
  assert.equal(api.decodedBytes, 40 * 100 * 4);
  assert.equal(stats.maximum, 16);
});
test('parallel completions enforce the combined decoded memory limit across banks', async () => {
  const {api, stats} = loader({count: 3, length: 100000000});
  await assert.rejects(api.prepare(patterns('first', 'second')), /Instrument memory limit/);
  assert.equal(stats.active, 0);
  assert.equal(api.decodedBytes, 0);
});
