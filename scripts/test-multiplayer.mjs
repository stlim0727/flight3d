// Real WebRTC data + audio, no WebGL or public service. Runs in ordinary hosted CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { getFreePort } from './lib/browserHarness.mjs';
import { connectCdp, until, delay } from './lib/cdpClient.mjs';

const simulatorMode = process.argv.includes('--simulator');
const publicMode = process.argv.includes('--public');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-multiplayer-'));
const signalPort = await getFreePort(), cdpPort = await getFreePort(), vitePort = await getFreePort();
const browsers = []; let chrome, signaling, vite;
let chromeLog = '';
try {
  signaling = spawn(process.execPath, ['--input-type=module', '-e', `import { PeerServer } from 'peer'; PeerServer({host:'127.0.0.1',port:${signalPort},path:'/flight3d',allow_discovery:false});`], { stdio: ['ignore', 'pipe', 'pipe'] });
  signaling.stderr.on('data', b => process.stderr.write(b));
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${signalPort}/flight3d`)).ok; } catch { return false; } }, 'local PeerServer');
  if (!publicMode) process.env.VITE_MULTIPLAYER_SIGNAL_URL = `http://127.0.0.1:${signalPort}/flight3d`;
  vite = await createServer({ server: { host: '127.0.0.1', port: vitePort, strictPort: true }, logLevel: 'error' }); await vite.listen();
  chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
    '--enable-gpu', '--use-gl=angle', '--use-angle=vulkan', '--disable-software-rasterizer',
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    ...(simulatorMode ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : []),
    ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', b => { chromeLog = (chromeLog + b).slice(-8000); });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; } }, 'Chrome CDP');
  async function page(path = `/tests/fixtures/multiplayer.html?signalPort=${signalPort}${publicMode ? "&public=1" : ""}`, ready = 'Boolean(window.fixture)') {
    const tab = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${vitePort}${path}`)}`, { method: 'PUT' })).json();
    const client = await connectCdp(tab.webSocketDebuggerUrl); browsers.push(client); await client.send('Runtime.enable');
    await until(() => client.evaluate(ready), 'page initialization', 90000); return client;
  }
  if (simulatorMode) {
    const { verifyMultiplayerSimulator } = await import('./lib/multiplayerAcceptance.mjs');
    await verifyMultiplayerSimulator({ page, cdpPort, browsers });
  } else {
  const ui = await page('/tests/fixtures/multiplayer-ui.html', 'Boolean(window.uiFixture)');
  for (const [key, code] of [[' ', 'Space'], ['Enter', 'Enter']]) {
    assert.deepEqual(await ui.evaluate(`uiFixture.press(${JSON.stringify(key)}, ${JSON.stringify(code)})`), { talking: true, braking: false }, 'PTT activation must not brake');
    assert.deepEqual(await ui.evaluate(`uiFixture.release(${JSON.stringify(key)}, ${JSON.stringify(code)})`), { talking: false, braking: false }, 'PTT release must not brake');
  }
  // Keyup must still release a brake key pressed before focus moved to PTT.
  await ui.evaluate('uiFixture.controls.keys.Space = true');
  assert.deepEqual(await ui.evaluate('uiFixture.release(" ", "Space")'), { talking: false, braking: false });
  assert.deepEqual(await ui.evaluate('uiFixture.demoShortcut()'), { dialog: false, active: false, manual: true }, 'P cannot start a demo during a shared flight');
  const host = await page(), guest = await page();
  const room = await host.evaluate('fixture.create()');
  await until(() => host.evaluate('fixture.status().registered'), 'host registered');
  await guest.evaluate(`fixture.hold = true; fixture.create(${JSON.stringify(room)})`);
  for (const c of [host, guest]) await until(() => c.evaluate('fixture.status().state === "connected" && fixture.status().remote'), 'data and media connected');
  assert.equal(await guest.evaluate('fixture.room.session.start()'), false, 'guest cannot start');
  await host.evaluate('fixture.room.session.start()');
  await until(() => guest.evaluate('fixture.status().prepared.length === 1'), 'guest preparation');
  assert.equal(await host.evaluate('fixture.flights'), 0, 'host waits for guest');
  await guest.evaluate('fixture.release()');
  for (const c of [host, guest]) await until(() => c.evaluate('fixture.flights === 1'), 'shared go');
  const hp = await host.evaluate('fixture.prepared[0]'), gp = await guest.evaluate('fixture.prepared[0]');
  assert.deepEqual(hp.c, gp.c); assert.equal(hp.slot, 0); assert.equal(gp.slot, 1);
  await host.evaluate('fixture.snapshot(100)'); await guest.evaluate('fixture.snapshot(200)');
  await until(() => guest.evaluate('fixture.room.session.track.sample(performance.now())?.p[0] === 100'), 'host position');
  await until(() => host.evaluate('fixture.room.session.track.sample(performance.now())?.p[0] === 200'), 'guest position');
  await host.evaluate('fixture.room.session.epoch++; fixture.snapshot(5000)');
  await until(() => guest.evaluate('fixture.room.session.track.sample(performance.now())?.p[0] === 5000'), 'respawn without interpolation through terrain');
  const third = await page(); await third.evaluate(`fixture.create(${JSON.stringify(room)})`);
  await until(() => third.evaluate('fixture.ended.includes("full")'), 'third pilot rejected');
  assert.equal(await host.evaluate('fixture.room.session.state'), 'flying');

  // Real oscillator -> production microphone graph -> WebRTC RTP -> remote decoded audio.
  for (const [sender, receiver] of [[host, guest], [guest, host]]) {
    await sender.evaluate('fixture.voice.enableMicrophone()');
    await until(() => receiver.evaluate('fixture.energy() >= 0 && fixture.energy() < .005'), 'listen-only silence');
    await sender.evaluate('fixture.voice.setTalking(true)');
    await until(() => receiver.evaluate('fixture.energy() > .05'), 'audible decoded PTT signal');
    const stats = await receiver.evaluate('fixture.stats()');
    assert.ok(stats.some(s => s.packetsReceived > 0 && s.bytesReceived > 0), 'received real audio RTP');
    await sender.evaluate('fixture.voice.setTalking(false)');
    await until(() => receiver.evaluate('fixture.energy() >= 0 && fixture.energy() < .005'), 'PTT release silence');
  }
  await guest.evaluate('fixture.hold = false'); await host.evaluate('fixture.room.session.start()');
  for (const c of [host, guest]) await until(() => c.evaluate('fixture.flights === 2'), 'shared restart');
  await guest.evaluate('fixture.room.close()');
  await until(() => host.evaluate('fixture.ended.includes("peer-left") && fixture.voice.closed'), 'disconnect and microphone cleanup');
  assert.equal(await guest.evaluate('fixture.voice.stream.getTracks().every(t => t.readyState === "ended")'), true);
  for (const c of browsers) assert.deepEqual(c.errors, [], 'no browser exceptions');
  console.log(`${publicMode ? 'Public PeerJS service' : 'Local signaling'} verified`);
  console.log('PASS Chrome WebRTC: two-pilot config/start barrier, bidirectional snapshots, respawn, third-peer rejection, bidirectional decoded audio/PTT silence + RTP, restart, disconnect/track cleanup. No WebGL tested.');
  }
} catch (error) {
  console.error(error); if (chromeLog) console.error(chromeLog);
  for (const c of browsers) { try { console.error(await c.evaluate('window.fixture?.status() || { flow: window.sim?.gameFlow?.state, multiplayer: window.sim?.multiplayer?.room?.session?.state, status: document.getElementById("mp-status")?.textContent }')); } catch {} }
  process.exitCode = 1;
} finally {
  browsers.forEach(c => c.close()); chrome?.kill('SIGTERM'); signaling?.kill('SIGTERM');
  await vite?.close(); await delay(300); await rm(profile, { recursive: true, force: true, maxRetries: 4 }).catch(() => {});
}
