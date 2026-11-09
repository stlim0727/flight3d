// Unpack outside the checkout, then exercise the distributed CLI through real WebRTC.
// The host/guest fixture has no renderer; WebGL is explicitly unavailable.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { getFreePort } from './lib/browserHarness.mjs';
import { connectCdp, until, delay } from './lib/cdpClient.mjs';

const artifactDir = resolve('artifacts/ghost-host');
const native = process.env.GHOST_TEST_EXECUTABLE ? resolve(process.env.GHOST_TEST_EXECUTABLE) : null;
const archive = native ? null : join(artifactDir, (await readdir(artifactDir)).find(name => name.endsWith('.tgz')));
const directory = await mkdtemp(join(tmpdir(), 'flight3d-distribution-'));
const signalPort = await getFreePort();
let signal, vite, hostProcess, hostClient, ready, guest;
let command = process.execPath, commandArgs = [join(directory, 'package/cli.mjs')];
const clients = []; let hostOutput = '', hostError = '';
async function launch() {
  ready = null; hostOutput = ''; hostError = '';
  hostProcess = spawn(command, [...commandArgs,
    '--state-dir', join(directory, 'state'), '--signal-url', `http://127.0.0.1:${signalPort}/flight3d`],
  { cwd: directory, env: { ...process.env, NODE_PATH: '', GHOST_ROOM: '', GHOST_NAME: 'Maverick' }, stdio: ['ignore', 'pipe', 'pipe'] });
  hostProcess.stdout.on('data', bytes => {
    hostOutput += bytes;
    for (const line of hostOutput.split('\n')) try { const item = JSON.parse(line); if (item.event === 'ready') ready = item; } catch { /* Partial line. */ }
  });
  hostProcess.stderr.on('data', bytes => { hostError = (hostError + bytes).slice(-5000); });
  await until(() => {
    if (hostProcess.exitCode !== null) throw new Error(`Packaged host exited: ${hostError}`);
    return ready;
  }, 'packaged host registration', 90000);
  const pages = await (await fetch(`${ready.cdpEndpoint}/json`)).json();
  hostClient = await connectCdp(pages.find(page => page.url === ready.healthUrl.replace('/health', '/')).webSocketDebuggerUrl);
}
async function stopHost() {
  hostClient?.close(); hostClient = null;
  if (!hostProcess || hostProcess.exitCode !== null) return;
  const stoppingProcess = hostProcess;
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Packaged host did not stop cleanly')), 5000);
    stoppingProcess.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  stoppingProcess.kill('SIGTERM');
  await exited;
  assert.equal(hostProcess.exitCode, 0, hostError);
}
async function joinRoom(code, contract) {
  const vitePort = vite.httpServer.address().port;
  const url = `http://127.0.0.1:${vitePort}/tests/fixtures/multiplayer.html?signalPort=${signalPort}`;
  const tab = await (await fetch(`${ready.cdpEndpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  guest = await connectCdp(tab.webSocketDebuggerUrl); clients.push(guest);
  await guest.send('Runtime.enable');
  await until(() => guest.evaluate('Boolean(window.fixture)'), 'ordinary guest fixture');
  await guest.evaluate(`fixture.create(${JSON.stringify(code)}); ${contract === 'legacy'
    ? 'const send = fixture.room.session.send; fixture.room.session.send = packet => { const legacy = {...packet}; delete legacy.contract; send(legacy); };'
    : contract ? `fixture.room.session.contract = ${JSON.stringify(contract)};` : ''}`);
  return guest;
}
try {
  let entries = [];
  if (native) {
    command = join(directory, 'flight3d-ghost-host'); commandArgs = [];
    await copyFile(native, command);
  } else {
    entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(entries.some(path => /node_modules|\/src\/|\/public\//.test(path)), false, 'archive excludes checkout/assets/dependencies');
    execFileSync('tar', ['-xzf', archive, '-C', directory]);
    const packageInfo = JSON.parse(await readFile(join(directory, 'package/package.json'), 'utf8'));
    assert.equal(Object.keys(packageInfo.dependencies || {}).length, 0);
  }
  const version = JSON.parse(execFileSync(command, [...commandArgs, '--version'], { cwd: directory, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
  assert.equal(version.protocolVersion, 2); assert.equal(version.flightRevision, 1);
  const guestCheck = JSON.parse(execFileSync(command, [...commandArgs, '--check', '--join', 'K7M2QX', '--voice'], { cwd: directory, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
  assert.equal(guestCheck.role, 'guest'); assert.ok(guestCheck.chrome);
  signal = spawn(process.execPath, ['--input-type=module', '-e', `import {PeerServer} from 'peer'; PeerServer({host:'127.0.0.1',port:${signalPort},path:'/flight3d',allow_discovery:false});`], { stdio: ['ignore', 'ignore', 'pipe'] });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${signalPort}/flight3d`)).ok; } catch { return false; } }, 'local signaling');
  vite = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' }); await vite.listen();
  await launch();
  const code = ready.room;
  assert.equal(await hostClient.evaluate('document.createElement("canvas").getContext("webgl2") === null'), true);
  assert.equal((await fetch(ready.healthUrl)).status, 200);
  assert.equal((await fetch(ready.healthUrl.replace('/health', '/src/main.js'))).status, 404);
  const peer = await joinRoom(code, 'legacy');
  await until(() => peer.evaluate('fixture.flights === 1 && fixture.room.session.track.samples.length > 2'), 'legacy guest starts and receives snapshots');
  const first = await peer.evaluate('fixture.room.session.track.samples.at(-1).p');
  await until(async () => { const p = await peer.evaluate('fixture.room.session.track.samples.at(-1).p'); return Math.hypot(...p.map((v, i) => v - first[i])) > 50; }, 'packaged AI moves');
  await peer.evaluate('fixture.room.close()');
  await until(() => hostClient.evaluate('ghostHost.generation === 2 && ghostHost.registered'), 'room reopened');
  const mismatch = await joinRoom(code, { flight: 999 });
  await until(() => mismatch.evaluate('fixture.ended.includes("incompatible")'), 'incompatible guest rejected clearly');
  assert.equal(await mismatch.evaluate('fixture.flights'), 0);
  await until(() => hostClient.evaluate('ghostHost.generation === 3 && ghostHost.registered'), 'host recovers after rejection');
  await stopHost();
  await launch(); assert.equal(ready.room, code, 'room survives installing/restarting standalone package');
  const returning = await joinRoom(code);
  await until(() => returning.evaluate('fixture.flights === 1 && fixture.room.session.track.samples.length > 2'), 'current guest reconnects after process restart');
  for (const client of clients.slice(-1)) assert.deepEqual(client.errors, []);
  await hostClient.evaluate('Object.defineProperty(ghostHost, "simSeconds", { get: () => -1, set() {} })');
  await until(() => hostProcess.exitCode !== null, 'stalled simulation exits for supervisor recovery', 25000);
  assert.equal(hostProcess.exitCode, 1); assert.match(hostError, /simulation stalled/);
  hostClient.close(); hostClient = null;
  await launch(); assert.equal(ready.room, code, 'recovery after stall preserves room');
  console.log(`PASS standalone ${native ? "native executable" : `archive (${entries.length} files)`}, no runtime npm dependencies or checkout; GPU-free Chrome WebRTC; legacy/current guest compatibility; explicit flight mismatch rejection before start; AI movement; persistent room across restart; stalled-simulation recovery.`);
} catch (error) {
  console.error(error, hostError, hostOutput); process.exitCode = 1;
} finally {
  clients.forEach(client => client.close());
  await stopHost().catch(error => { console.error(error); process.exitCode = 1; hostProcess?.kill('SIGKILL'); });
  signal?.kill('SIGTERM'); await vite?.close();
  await rm(directory, { recursive: true, force: true });
}
