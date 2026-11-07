// WebRTC runs in installed Chrome; simulation creates no WebGL context or renderer.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { connectCdp, until, delay } from './lib/cdpClient.mjs';
import { getFreePort } from './lib/browserHarness.mjs';
import { newRoom, validRoom, inviteUrl } from '../src/multiplayer/protocol.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = resolve(process.env.GHOST_STATE_DIR || join(root, '.local/ghost-host'));
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const statePath = join(stateDir, 'room.json');
let saved;
try { saved = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const code = process.env.GHOST_ROOM || saved?.room || newRoom();
if (!validRoom(code)) throw new Error('GHOST_ROOM must be a six-character room code');
const invite = inviteUrl(code, process.env.GHOST_PUBLIC_URL || 'https://stlim0727.github.io/flight3d/');
const name = process.env.GHOST_NAME || 'Maverick';
await writeFile(statePath, JSON.stringify({ room: code, invite, name }, null, 2) + '\n', { mode: 0o600 });
const profile = await mkdtemp(join(tmpdir(), 'flight3d-ghost-'));
let browser, vite, client, watchdog;
let stopping = false, chromeLog = '';
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(watchdog);
  client?.close(); browser?.kill('SIGTERM'); await vite?.close();
  await delay(500); await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
try {
  const cdpPort = await getFreePort();
  vite = await createServer({ root, configFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error',
    plugins: [{ name: 'internal-ghost-entry', configureServer(server) {
      server.middlewares.use('/ghost-host.html', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Flight host</title><script type="module" src="/src/multiplayer/ghostHostPage.js"></script>');
      });
    } }],
  });
  await vite.listen();
  const port = vite.httpServer.address().port;
  browser = spawn(process.env.CHROME_PATH || '/usr/bin/google-chrome-stable', [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required',
    // Deliberately unavailable: no software fallback and no dependency on /dev/dri.
    '--disable-webgl', '--disable-software-rasterizer',
    ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', data => { chromeLog = (chromeLog + data).slice(-4000); });
  browser.on('error', error => { console.error(error); process.exitCode = 1; void stop(); });
  browser.on('exit', () => { if (!stopping) { process.exitCode = 1; void stop(); } });
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; }
  }, 'host browser');
  const tab = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/ghost-host.html`)}`, { method: 'PUT' })).json();
  client = await connectCdp(tab.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await until(() => client.evaluate('typeof window.startGhostHost === "function"'), 'host module');
  await client.evaluate(`window.startGhostHost(${JSON.stringify({ room: code, name })})`);
  await until(() => client.evaluate('window.ghostHost?.registered'), 'public signaling registration', 60000);
  console.log(`Host ${name} ready: ${invite}`);
  console.log(`Room state: ${statePath}; browser CDP: http://127.0.0.1:${cdpPort}`);
  let previous = '';
  watchdog = setInterval(async () => {
    try {
      const status = await client.evaluate('JSON.parse(JSON.stringify(window.ghostHost))');
      if (client.errors.length || !status) throw new Error(client.errors.join('\n') || 'missing-host');
      const summary = JSON.stringify({ state: status.state, generation: status.generation, reason: status.reason });
      if (summary !== previous) { console.log(summary); previous = summary; }
    } catch (error) { console.error(error); process.exitCode = 1; await stop(); }
  }, 5000);
} catch (error) {
  console.error(error, chromeLog); process.exitCode = 1; await stop();
}
