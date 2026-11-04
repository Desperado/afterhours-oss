'use strict';
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const path = require('node:path');

async function startBackend({packaged, resourcesPath, appPath, dataDir, onExit, publicContent = false}) {
  const token = randomBytes(32).toString('hex');
  const env = {};
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'OPENAI_API_KEY']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    NUMBA_CACHE_DIR: path.join(dataDir, 'runtime-cache'),
  });
  const command = packaged
    ? path.join(resourcesPath, 'backend', 'afterhours-server')
    : path.join(appPath, '.context', 'music-analysis-venv', 'bin', 'python');
  const child = spawn(command, packaged ? [] : [path.join(appPath, 'desktop', 'server.py')], {
    cwd: dataDir,
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  // The capability travels only over the private pipe, never arguments, logs or the renderer.
  child.stdin.on('error', () => {});
  child.stdin.write(JSON.stringify({token, dataDir, publicContent}) + '\n');
  let stopped = false;
  const closed = new Promise(resolve => child.once('close', resolve));
  async function stop() {
    if (stopped) return closed;
    stopped = true;
    child.stdin.end();
    const terminate = setTimeout(() => child.kill('SIGTERM'), 3000);
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await closed;
    } finally {
      clearTimeout(terminate);
      clearTimeout(force);
    }
  }
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      function finish(error, port) {
        clearTimeout(timeout);
        child.stdout.removeListener('data', read);
        child.removeListener('error', fail);
        child.removeListener('exit', fail);
        if (error) reject(error);
        else resolve(port);
      }
      const fail = () => finish(new Error('The local audio server could not start.'));
      const timeout = setTimeout(fail, 45000);
      const read = chunk => {
        output += chunk.toString('utf8');
        if (output.length > 2048) return fail();
        if (!output.includes('\n')) return;
        try {
          const {port} = JSON.parse(output.split('\n')[0]);
          if (!Number.isInteger(port) || port < 1 || port > 65535) return fail();
          finish(null, port);
        } catch {
          fail();
        }
      };
      child.stdout.on('data', read);
      child.once('error', fail);
      child.once('exit', fail);
    });
    child.stdout.resume();
    child.once('exit', () => {
      if (!stopped) onExit();
    });
    return {origin: `http://127.0.0.1:${port}`, token, child, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = {startBackend};
