// Real WebRTC data + audio, no WebGL or public service. Runs in ordinary hosted CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { getFreePort, detectGpuAngle } from './lib/browserHarness.mjs';
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
  const gpuAngle = detectGpuAngle();
  const needsNoSandbox = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.CHROME_NO_SANDBOX === '1' || (typeof process.getuid === 'function' && process.getuid() === 0));

  chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
    '--headless=new', '--window-size=1280,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(needsNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    '--use-gl=angle',
    `--use-angle=${gpuAngle}`,
    ...(gpuAngle === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--disable-software-rasterizer']),
    'about:blank'
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
  assert.deepEqual(await ui.evaluate('uiFixture.modalStatus()'), { open: true, held: true, blocked: true, focusInside: true, outsideClicks: 0 }, 'modal isolates background focus and flight input');
  const outside = await ui.evaluate('(() => { const r=document.getElementById("outside").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...outside });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...outside });
  assert.equal((await ui.evaluate('uiFixture.modalStatus()')).outsideClicks, 0, 'native modal blocks background clicks');
  for (const [key, code] of [[' ', 'Space'], ['Enter', 'Enter']]) {
    assert.deepEqual(await ui.evaluate(`uiFixture.press(${JSON.stringify(key)}, ${JSON.stringify(code)})`), { talking: true, braking: false }, 'Microphone button keydown must not brake');
    assert.deepEqual(await ui.evaluate(`uiFixture.release(${JSON.stringify(key)}, ${JSON.stringify(code)})`), { talking: true, braking: false }, 'Microphone button keyup must not brake');
  }
  // Keyup must still release a brake key pressed before focus moved to the microphone button.
  await ui.evaluate('uiFixture.controls.keys.Space = true');
  assert.deepEqual(await ui.evaluate('uiFixture.release(" ", "Space")'), { talking: true, braking: false });
  assert.deepEqual(await ui.evaluate('uiFixture.demoShortcut()'), { dialog: false, active: false, manual: true }, 'P cannot start a demo during a shared flight');
  await ui.evaluate(`for (const [key,value] of Object.entries({name:'Wing',airport:'neon',aircraft:'F16',scenario:'runway'})) {
    const input=document.getElementById('mp-'+key); input.value=value;
    input.dispatchEvent(new Event(key==='name'?'input':'change'));
  }`);
  const restoredUi = await page('/tests/fixtures/multiplayer-ui.html', 'Boolean(window.uiFixture)');
  assert.deepEqual(await restoredUi.evaluate(`Object.fromEntries(['name','airport','aircraft','scenario'].map(key=>[key,document.getElementById('mp-'+key).value]))`),
    { name: 'Wing', airport: 'neon', aircraft: 'F16', scenario: 'runway' }, 'setup preferences restored in a new page');
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

    await until(() => receiver.evaluate('fixture.energy() > .05'), 'audible voice without push-to-talk');
    const stats = await receiver.evaluate('fixture.stats()');
    assert.ok(stats.some(s => s.packetsReceived > 0 && s.bytesReceived > 0), 'received real audio RTP');
    await sender.evaluate('fixture.voice.setMuted(true)');
    await until(() => receiver.evaluate('fixture.energy() >= 0 && fixture.energy() < .005'), 'Microphone button keyup silence');
  }
  await guest.evaluate('fixture.hold = false'); await host.evaluate('fixture.room.session.start()');
  for (const c of [host, guest]) await until(() => c.evaluate('fixture.flights === 2'), 'shared restart');
  await guest.evaluate('fixture.room.close()');
  await until(() => host.evaluate('fixture.ended.includes("peer-left") && fixture.voice.closed'), 'disconnect and microphone cleanup');
  assert.equal(await guest.evaluate('fixture.voice.stream.getTracks().every(t => t.readyState === "ended")'), true);
  const autoHost = await page();
  const autoCode = await autoHost.evaluate('fixture.create()');
  await until(() => autoHost.evaluate('fixture.room.registered'), 'URL invite host registered');
  const autoGuest = await page(`/tests/fixtures/multiplayer-ui.html?r=${autoCode}`, 'Boolean(window.uiFixture)');
  await until(() => autoGuest.evaluate('uiFixture.controller.room?.session.state === "connected"'), 'URL invite joins without typing or clicking');
  assert.equal(await autoGuest.evaluate('uiFixture.controller.room.session.name'), 'Wing', 'automatic invite joining uses the saved pilot name');
  await until(() => autoGuest.evaluate('uiFixture.controller.modalOpen && uiFixture.controller.voice.talking'), 'invite automatically enables microphone');
  await autoGuest.evaluate('uiFixture.controller.room.close()');
  await autoHost.evaluate('fixture.room.dispose()');
  const invalid = await page('/tests/fixtures/multiplayer-ui.html?r=invalid', 'Boolean(window.uiFixture)');
  assert.equal(await invalid.evaluate('!uiFixture.controller.room && uiFixture.controller.modalOpen && uiFixture.controller.message === "invalid-room"'), true);
  // A friend's arrival ends the creator's waiting deadline: the joined room outlives it and can still start.
  const patientHost = await page(), patientGuest = await page();
  const patientCode = await patientHost.evaluate('fixture.create(undefined, 4000)');
  await until(() => patientHost.evaluate('fixture.room.registered'), 'short-lease room registration');
  await patientGuest.evaluate(`fixture.create(${JSON.stringify(patientCode)})`);
  for (const c of [patientHost, patientGuest]) await until(() => c.evaluate('fixture.status().state === "connected"'), 'friend admitted before lease expiry');
  assert.equal(await patientHost.evaluate('fixture.room.waiting || fixture.room.keepWaiting()'), false, 'admission stops the waiting countdown');
  await delay(5000);
  assert.equal(await patientHost.evaluate('!fixture.room.closed && fixture.ended.length === 0 && fixture.room.session.state === "connected"'), true, 'joined room survives the original deadline');
  assert.equal(await patientHost.evaluate('fixture.room.session.start()'), true, 'creator can still start after the deadline');
  for (const c of [patientHost, patientGuest]) await until(() => c.evaluate('fixture.flights === 1'), 'shared start after the deadline');
  await patientGuest.evaluate('fixture.room.close()');
  await until(() => patientHost.evaluate('fixture.ended.includes("peer-left")'), 'patient room teardown');
  await patientHost.evaluate('fixture.room.dispose()');
  // Expiry is advertised after multiplayer and voice have already been torn down.
  const expiring = await page();
  const cancelledCode = await expiring.evaluate('fixture.create(undefined, 1500)');
  await until(() => expiring.evaluate('fixture.room.registered'), 'expiring room registration');
  assert.equal(await expiring.evaluate('fixture.room.keepWaiting()'), true, 'creator explicitly renews waiting lease');
  await until(() => expiring.evaluate('fixture.ended.includes("cancelled") && fixture.voice.closed'), 'waiting lease cancellation');
  assert.equal(await expiring.evaluate('fixture.room.keepWaiting()'), false, 'cancelled room cannot be revived');
  const late = await page(); await late.evaluate(`fixture.create(${JSON.stringify(cancelledCode)})`);
  await until(() => late.evaluate('fixture.ended.includes("cancelled")'), 'late join receives explicit cancellation');
  assert.equal(await late.evaluate('fixture.flights'), 0);
  const cancelledInvite = await page(`/tests/fixtures/multiplayer-ui.html?r=${cancelledCode}`, 'Boolean(window.uiFixture)');
  await until(() => cancelledInvite.evaluate('uiFixture.controller.message === "cancelled"'), 'URL invite modal cancellation message');
  assert.match(await cancelledInvite.evaluate('document.getElementById("mp-status").textContent'), /cancelled/i);
  assert.equal(await cancelledInvite.evaluate('uiFixture.controller.dialog.matches(":modal")'), true);
  await expiring.evaluate('fixture.room.dispose()');
  const gone = await page(); await gone.evaluate(`fixture.create(${JSON.stringify(cancelledCode)})`);
  await until(() => gone.evaluate('fixture.ended.includes("not-found")'), 'closed creator tab has no live room');
  for (const c of browsers) assert.deepEqual(c.errors, [], 'no browser exceptions');
  console.log(`${publicMode ? 'Public PeerJS service' : 'Local signaling'} verified`);
  console.log('PASS Chrome WebRTC: two-pilot config/start barrier, bidirectional snapshots, respawn, third-peer rejection, bidirectional continuous audio/mute/unmute + RTP, restart, disconnect/track cleanup, modal focus/input isolation, automatic URL joining, invalid/cancelled invites, creator lease expiry, lease ending on admission and late-join cancellation. No WebGL tested.');
  }
} catch (error) {
  console.error(error); if (chromeLog) console.error(chromeLog);
  for (const c of browsers) { try { console.error(await c.evaluate('window.fixture?.status() || { flow: window.sim?.gameFlow?.state, multiplayer: window.sim?.multiplayer?.room?.session?.state, status: document.getElementById("mp-status")?.textContent }')); } catch {} }
  process.exitCode = 1;
} finally {
  browsers.forEach(c => c.close()); chrome?.kill('SIGTERM'); signaling?.kill('SIGTERM');
  await vite?.close(); await delay(300); await rm(profile, { recursive: true, force: true, maxRetries: 4 }).catch(() => {});
}
