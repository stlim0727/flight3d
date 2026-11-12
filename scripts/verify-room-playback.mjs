// Real WebRTC peers in isolated storage contexts, installed hardware Chrome only.
// Collisions are injected through the simulator's crash entry point; flight and recording
// use the production frame loop. Timeout uses an expired heartbeat, not a 20-second sleep.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { getFreePort, withBrowserSession } from './lib/browserHarness.mjs';
import { connectCdp, until, delay } from './lib/cdpClient.mjs';

process.env.GPU_ANGLE = process.platform === 'win32' ? 'd3d11' : 'vulkan';
process.env.CHROME_PATH ||= process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome-stable';
const output = resolve('review-artifacts/room-playback');
await mkdir(output, { recursive: true });
const signalPort = await getFreePort();
process.env.VITE_MULTIPLAYER_SIGNAL_URL = `http://127.0.0.1:${signalPort}/flight3d`;
process.env.VITE_MULTIPLAYER_ICE_SERVERS = '[]';
const signal = spawn(process.execPath, ['--input-type=module', '-e',
  `import {PeerServer} from 'peer'; PeerServer({host:'127.0.0.1',port:${signalPort},path:'/flight3d'});`],
{ stdio: 'inherit', windowsHide: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, hmr: false, watch: null } });
const results = {};
try {
  await vite.listen();
  await until(async () => { try { return (await fetch(`${process.env.VITE_MULTIPLAYER_SIGNAL_URL}/`)).ok; } catch { return false; } }, 'signaling');
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  await withBrowserSession({ origin }, async ({ cdpPort }) => {
    const endpoint = `http://127.0.0.1:${cdpPort}`;
    execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', endpoint], {
      env: { ...process.env, GPU_REPORT: `${output}/gpu.json` }, stdio: 'inherit', windowsHide: true,
    });
    const browser = await connectCdp((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl);
    const clients = [];
    async function page(context) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
      const target = (await (await fetch(`${endpoint}/json/list`)).json()).find(t => t.id === targetId);
      const client = await connectCdp(target.webSocketDebuggerUrl);
      Object.assign(client, { targetId, context }); clients.push(client);
      await client.send('Runtime.enable'); await client.send('Page.enable');
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__FLIGHT3D_DIRECTORY_URL__ = '';" });
      await client.send('Page.navigate', { url: `${origin}/?airport=coastal&aircraft=C172&instant=1` });
      await until(() => client.evaluate('!!window.simulator && !document.body.classList.contains("booting") && !window.simulator.airportLoading'), 'boot', 90000);
      await client.evaluate('window.sim = window.simulator; sim.setRenderQuality("ultraLow"); sim.setBrowserActive(true)');
      return client;
    }
    async function capture(client, name) {
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${output}/${name}.png`, Buffer.from(data, 'base64'));
    }
    async function room(host, guest) {
      await host.evaluate(`sim.multiplayer.openDialog('host'); document.getElementById('mp-airport').value='coastal'; document.getElementById('mp-aircraft').value='C172'; document.getElementById('mp-scenario').value='cruise'; document.getElementById('mp-name').value='Lead'; document.getElementById('mp-create').click()`);
      await until(() => host.evaluate('sim.multiplayer.room?.registered'), 'host registered');
      const code = await host.evaluate('sim.multiplayer.room.room');
      await guest.evaluate(`sim.multiplayer.openDialog('join'); document.getElementById('mp-name').value='Wing'; sim.multiplayer.connectInvite(${JSON.stringify(code)})`);
      for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "connected"'), 'connected');
      await start(host, guest);
    }
    async function start(host, guest) {
      await host.evaluate('sim.multiplayer.openDialog(); document.getElementById("mp-start").click()');
      for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "flying" && sim.multiplayer.remote?.group.visible && sim.multiplayer.roomReplay.active'), 'flying', 90000);
    }
    async function waitRecording(c, seconds = 6) {
      await until(() => c.evaluate(`sim.multiplayer.roomReplay.recorder.validDuration > ${seconds}`), 'recorded flight', 30000);
    }
    async function saved(c) {
      return until(() => c.evaluate(`sim.replayStore.list().find(e => e.autoSlot === 'room')`), 'saved room');
    }
    try {
      const hostContext = (await browser.send('Target.createBrowserContext')).browserContextId;
      const guestContext = (await browser.send('Target.createBrowserContext')).browserContextId;
      const host = await page(hostContext), guest = await page(guestContext);
      console.log('Both independent storage contexts ready.');
      await room(host, guest); await waitRecording(host);
      console.log('Recorded initial flight; testing menu hold and impact.');
      await host.evaluate('sim.multiplayer.openDialog()');
      await until(() => guest.evaluate('sim.multiplayer.room.session.track.sample(performance.now())?.held'), 'menu hold');
      await delay(1200);
      await host.evaluate('document.getElementById("mp-dialog-close").click()');
      // Production collision handling including debrief, network crash flag and personal reset.
      await guest.evaluate(`sim.triggerCrash({type:'WATER',point:sim.position.clone(),speedKnots:100})`);
      console.log('Injected first impact.');
      await until(() => host.evaluate('sim.multiplayer.room.session.track.sample(performance.now())?.crashed'), 'remote impact');
      await until(() => guest.evaluate('sim.gameFlow.state === "debrief"'), 'crash debrief', 15000);
      await delay(800);
      const oldEpoch = await guest.evaluate('sim.multiplayer.room.session.epoch');
      await guest.evaluate('sim.multiplayer.respawnLocal()');
      await until(() => host.evaluate(`sim.multiplayer.room.session.track.sample(performance.now())?.epoch > ${oldEpoch} && !sim.multiplayer.room.session.track.sample(performance.now())?.crashed`), 'personal respawn');
      await delay(1000);
      await start(host, guest); await delay(1500);
      await guest.evaluate(`sim.triggerCrash({type:'TERRAIN',point:sim.position.clone(),speedKnots:90})`);
      await until(() => host.evaluate('sim.multiplayer.room.session.track.sample(performance.now())?.crashed'), 'second impact');
      await delay(1000);
      await guest.evaluate('sim.multiplayer.openDialog(); document.getElementById("mp-leave").click()');
      await until(() => host.evaluate('sim.multiplayer.room.closed'), 'peer departure');
      for (const [name, c] of [['host', host], ['guest', guest]]) {
        const entry = await saved(c);
        const json = await c.evaluate(`sim.replayStore.exportJson(${JSON.stringify(entry.id)})`);
        await writeFile(`${output}/${name}.sortie.json`, json);
        results[name] = await c.evaluate(`(async () => {
          if (sim.multiplayer.modalOpen) document.getElementById('mp-dialog-close').click();
          const stored = sim.replayStore.get(${JSON.stringify(entry.id)}).track;
          const imported = sim.replayStore.importJson(sim.replayStore.exportJson(${JSON.stringify(entry.id)}));
          if (!imported.entry) throw Error('import failed');
          const track = sim.replayStore.get(imported.entry.id).track;
          if (JSON.stringify(stored.metadata.room) !== JSON.stringify(track.metadata.room)) throw Error('metadata roundtrip');
          if (!await sim.replayPanel.watch(track, imported.entry.id)) throw Error('watch failed');
          const d = sim.replayDirector; d.pause();
          const timeline = track.metadata.room.timeline;
          const normal = timeline.find(e => e.states.every(s => s.visible && !s.crashed));
          d.seek(normal.timeSec + .05);
          window.normalTime = d.progressSec;
          window.impacts = [...d.roomEvents.map(e => ({pilot:0,time:e.timeSec,type:e.type})), ...d.remotes[0].events.map(e => ({pilot:1,time:e.timeSec,type:e.type}))];
          return {duration:d.durationSec, actors:d.remotes.length+1, bothVisible:sim.aircraft.group.visible && d.remotes[0].visual.group.visible,
            impacts, held:timeline.some(e => e.states.some(s => s.held)), segments:[...new Set(timeline.flatMap(e => e.states.map(s=>s.segment)))],
            reason:track.metadata.room.endReason, autoCount:sim.replayStore.list().filter(e=>e.autoSlot==='room').length};
        })()`);
        assert.equal(results[name].actors, 2); assert.equal(results[name].bothVisible, true);
        assert.equal(results[name].autoCount, 1); assert.ok(results[name].impacts.length >= 2);
        assert.ok(results[name].segments.length >= 3); assert.equal(results[name].held, true);
        // Existing drone camera, widened only for evidence; target switching is a later task.
        await c.evaluate('sim.cameraSystem.setMode(6,true); sim.cameraSystem.userLookOverridden=false; sim.cameraSystem.resetDroneOrbit(1.8,160,65); sim.replayDirector.reseed()');
        await delay(200); await capture(c, `${name}-two-aircraft`);
        const check = await c.evaluate(`(async () => {
          const {sampleTrack,sampleRemote}=await import('/src/replay/TrackSampler.js');
          const d=sim.replayDirector, first=impacts[0], effects=first.pilot===0?d.roomEffects:d.remotes[0].effects;
          // Cold shaders can create a genuine observation gap at impact. Seek into the
          // observed crash, not into the interval the recorder intentionally hid.
          const crashSample=d.track.samples.find(s=>{
            if(s.timeSec<first.time+.1)return false;
            const p=first.pilot===0?sampleTrack(d.track,s.timeSec):sampleRemote(d.track,0,s.timeSec);
            return p.visible&&p.crashed;
          });
          if(!crashSample)throw Error('No observed crash interval');
          const impactTime=crashSample.timeSec;
          d.seek(impactTime); const fragments=effects.breakup.pieces.length;
          const pausedAge=effects.age; d.update(.5); const pauseStable=effects.age===pausedAge;
          d.setSpeed(3); d.play(); const t=d.progressSec; d.update(.1); d.pause();
          const triple=Math.abs(d.progressSec-t-.3)<1e-6;
          d.seek(normalTime); const cleared=effects.breakup.pieces.length===0 && !effects.event;
          d.seek(impactTime); const rebuilt=effects.breakup.pieces.length===fragments && fragments>0;
          const after=d.track.metadata.room.timeline.find(e=>e.timeSec>impactTime && e.states.every(s=>s.visible&&!s.crashed));
          d.seek(after.timeSec+.05); const respawned=sim.aircraft.group.visible&&d.remotes[0].visual.group.visible&&!effects.event;
          d.seek(impactTime); return {fragments,pauseStable,triple,cleared,rebuilt,respawned};
        })()`);
        assert.ok(check.fragments > 0); for (const key of ['pauseStable','triple','cleared','rebuilt','respawned']) assert.equal(check[key], true, `${name}: ${key}`);
        results[name].playback = check; await capture(c, `${name}-impact`);
        assert.equal(await c.evaluate(`(() => { const d=sim.replayDirector, remote=d.remotes[0], effects=remote.effects; sim.replayPanel.exit(); return remote.visual.disposed&&!remote.visual.group.parent&&!effects.event&&d.remotes.length===0&&d.roomEffects===null; })()`), true);
        assert.deepEqual(c.errors, []);
      }
      console.log('Both saved tracks: two actors, repeated impacts, seek, pause, 3x, respawn and disposal passed.');
      // Closing a real page saves that user's independent localStorage before reopening it.
      await room(host, guest); await waitRecording(host);
      await browser.send('Target.closeTarget', { targetId: guest.targetId }); guest.close();
      await until(() => host.evaluate('sim.multiplayer.room.closed'), 'tab departure', 30000);
      const reopened = await page(guestContext);
      results.tabClose = { host: (await saved(host)).id, guest: (await saved(reopened)).id,
        guestReason: await reopened.evaluate('sim.replayStore.get(sim.replayStore.list().find(e=>e.autoSlot==="room").id).track.metadata.room.endReason') };
      assert.equal(results.tabClose.guestReason, 'pagehide');
      if (await host.evaluate('sim.multiplayer.modalOpen')) await host.evaluate('document.getElementById("mp-dialog-close").click()');
      await room(host, reopened); await waitRecording(host);
      await host.evaluate('sim.multiplayer.room.session.lastSeen=performance.now()-20001; sim.multiplayer.room.session.tick()');
      await until(() => host.evaluate('sim.multiplayer.room.closed'), 'heartbeat timeout');
      results.timeout = await host.evaluate('sim.replayStore.get(sim.replayStore.list().find(e=>e.autoSlot==="room").id).track.metadata.room.endReason');
      assert.equal(results.timeout, 'timeout');
      for (const c of [host,reopened]) assert.deepEqual(c.errors, []);
      await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2));
      console.log('Real tab close/pagehide, independent storage persistence and expired-heartbeat timeout passed.');
    } catch (error) {
      for (const [i, c] of clients.entries()) {
        try {
          const state = await c.evaluate(`({flow:sim.gameFlow.state,crashed:sim.isCrashed,active:sim.multiplayer.active,message:sim.multiplayer.message,
            state:sim.multiplayer.room?.session.state,lastSeen:sim.multiplayer.room?.session.lastSeen,now:performance.now(),
            remote:sim.multiplayer.room?.session.track.sample(performance.now()),recorder:sim.multiplayer.roomReplay.recorder.elapsed,
            background:sim.browserBackgrounded,errors:[]})`);
          console.error('Failure state', i, JSON.stringify({ ...state, errors:c.errors }));
          await capture(c, `failure-${i}`);
        } catch { /* The closed-tab client has no execution context. */ }
      }
      throw error;
    } finally { for (const c of clients) c.close(); browser.close(); }
  });
} finally { await vite.close(); signal.kill(); }
