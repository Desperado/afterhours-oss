const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {startBackend} = require('../desktop/backend.cjs');
const {isAppURL, proxyRequest} = require('../desktop/protocol.cjs');

test('desktop protocol only accepts the local app origin', () => {
  assert.ok(isAppURL('afterhours://app/api/library'));
  for (const url of [
    'https://app/',
    'file:///etc/passwd',
    'afterhours://app.evil/',
    'afterhours://user@app/',
    'afterhours://app:80/',
    'invalid',
  ])
    assert.ok(!isAppURL(url));
});

test('parallel startup assets all arrive from the real Python backend', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterhours startup '));
  let backend;
  try {
    backend = await startBackend({packaged: false, appPath: path.resolve(__dirname, '..'), dataDir, onExit: () => {}});
    const paths = [
      '/shell.js',
      '/controller-audio.js',
      '/controller.js',
      '/effects.js',
      '/app.js',
      '/daw.js',
      '/groove-core.js',
      '/timbres.js',
      '/groove-audio.js',
      '/synth-audio.js',
      '/synth.js',
      '/beat-grid.js',
      '/groove-state.js',
      '/groove-editor.js',
      '/groove-transport.js',
      '/groove-sync.js',
      '/groove-export.js',
      '/groove.js',
      '/style.css',
      '/favicon.svg',
      '/fonts/plex-condensed-600.woff2',
      '/fonts/jetbrains-mono.woff2',
    ];
    for (let round = 0; round < 3; round++) {
      const statuses = await Promise.all(
        paths.map(async file => {
          const response = await proxyRequest(new Request('afterhours://app' + file), backend);
          await response.arrayBuffer();
          return response.status;
        }),
      );
      assert.deepEqual(
        statuses,
        paths.map(() => 200),
      );
    }
  } finally {
    if (backend) await backend.stop();
    await fs.rm(dataDir, {recursive: true, force: true});
  }
});

test('desktop proxy preserves uploads, range responses and server guards without disclosing its capability', async () => {
  const token = randomBytes(32).toString('hex');
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    calls++;
    assert.ok(request.headers['x-afterhours-token'] === token);
    assert.equal(request.headers.origin, backend.origin);
    if (request.url === '/redirect') {
      response.writeHead(302, {Location: 'https://example.com/'});
      response.end();
      return;
    }
    if (request.url === '/audio') {
      assert.equal(request.headers.range, 'bytes=2-4');
      response.writeHead(206, {'Content-Type': 'audio/wav', 'Content-Range': 'bytes 2-4/8'});
      response.end('234');
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({bytes: Buffer.concat(chunks).length, filename: request.headers['x-filename']}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const backend = {origin: `http://127.0.0.1:${server.address().port}`, token};
  try {
    const uploaded = await proxyRequest(
      new Request('afterhours://app/api/tracks', {
        method: 'POST',
        body: new Uint8Array(8192),
        headers: {'X-Filename': 'beat.wav'},
      }),
      backend,
    );
    assert.deepEqual(await uploaded.json(), {bytes: 8192, filename: 'beat.wav'});
    assert.ok(!uploaded.headers.has('X-Afterhours-Token'));
    const ranged = await proxyRequest(new Request('afterhours://app/audio', {headers: {range: 'bytes=2-4'}}), backend);
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('Content-Range'), 'bytes 2-4/8');
    assert.equal(await ranged.text(), '234');
    const before = calls;
    const foreign = new Request('afterhours://app/api/library');
    foreign.initiatorOrigin = 'https://example.com';
    assert.equal((await proxyRequest(foreign, backend)).status, 403);
    assert.equal((await proxyRequest(new Request('afterhours://other/'), backend)).status, 403);
    assert.equal(
      (await proxyRequest(new Request('afterhours://app/api/jobs', {method: 'POST', body: 'x'.repeat(4097)}), backend))
        .status,
      413,
    );
    assert.equal((await proxyRequest(new Request('afterhours://app/', {method: 'DELETE'}), backend)).status, 405);
    assert.equal(calls, before);
    assert.equal((await proxyRequest(new Request('afterhours://app/redirect'), backend)).status, 502);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
