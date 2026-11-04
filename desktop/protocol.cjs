'use strict';
const http = require('node:http');
const {Readable} = require('node:stream');
const ORIGIN = 'afterhours://app';
// A browser normally limits connections per origin. The protocol bridge must
// do the same so a cold load cannot overflow the Python server's accept queue.
const agent = new http.Agent({keepAlive: true, maxSockets: 4});

function isAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'afterhours:' && url.host === 'app' && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function proxyRequest(request, backend) {
  if (!isAppURL(request.url) || (request.initiatorOrigin && request.initiatorOrigin !== ORIGIN))
    return new Response('Forbidden', {status: 403});
  if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', {status: 405});
  const url = new URL(request.url),
    headers = {Origin: backend.origin, 'X-Afterhours-Token': backend.token};
  for (const name of ['range', 'content-type', 'x-filename']) {
    if (request.headers.has(name)) headers[name] = request.headers.get(name);
  }
  let body;
  if (request.method === 'POST') {
    const chunks = [],
      limit = url.pathname === '/api/tracks' ? 100 * 1024 * 1024 : 4096;
    let length = 0;
    if (request.body)
      for await (const chunk of request.body) {
        length += chunk.byteLength;
        if (length > limit) return new Response('Request too large', {status: 413});
        chunks.push(Buffer.from(chunk));
      }
    body = Buffer.concat(chunks, length);
    headers['Content-Length'] = String(length);
  }
  try {
    return await new Promise((resolve, reject) => {
      const upstream = http.request(
        backend.origin + url.pathname + url.search,
        {
          method: request.method,
          headers,
          agent,
          signal: request.signal,
        },
        response => {
          if (response.statusCode >= 300 && response.statusCode < 400) {
            response.resume();
            reject(new Error('Unexpected backend redirect'));
            return;
          }
          resolve(new Response(Readable.toWeb(response), {status: response.statusCode, headers: response.headers}));
        },
      );
      upstream.on('error', reject);
      upstream.setTimeout(130000, () => upstream.destroy(new Error('Backend request timed out')));
      upstream.end(body);
    });
  } catch {
    return new Response('The local audio server is unavailable.', {status: 502});
  }
}

module.exports = {ORIGIN, isAppURL, proxyRequest};
