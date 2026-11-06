// Hardware Chrome acceptance: record → save → watch → scrub → export/import → reload.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';
import { until } from './lib/cdpClient.mjs';

process.env.GPU_ANGLE = 'vulkan';
process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';
const output = resolve('review-artifacts/replay');
await mkdir(output, { recursive: true });
await withBrowserSession({ width: 1280, height: 800, navigate: false }, async ({ origin, cdpPort, send, evaluate: ev, screenshot, exceptions, delay }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: `${output}/gpu.json` }, stdio: 'inherit',
  });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const click = async selector => {
    const point = await ev(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  await send('Page.navigate', { url: `${origin}/?airport=coastal&aircraft=C172&instant=1` });
  await until(() => ev('!!window.simulator && !document.body.classList.contains("booting")'), 'boot', 90000);
  await ev(`(async()=>{window.s=window.simulator;(await import('/src/i18n/index.js')).setLanguage('en');s.lobby.airport='coastal';s.lobby.aircraft='C172';s.lobby.preset='cruise';s.setTimeOfDay(12,{persist:false});await s.fly();s.stepSimulation(10);s.gameFlow.pause();s.endFlight();})()`);
  assert.equal(await ev('s.gameFlow.state'), 'debrief');
  assert.ok(await ev('s.debriefReplay?.samples.length > 2'));
  await click('#debrief-tab-share');
  await click('#debrief-save-replay');
  assert.equal(await ev('s.replayStore.list().length'), 1);
  await ev('window.replayExport=s.replayStore.exportJson(s.replayStore.list()[0].id);window.recordedTrack=s.debriefReplay;');
  await click('#debrief-watch-replay');
  await until(() => ev('s.replayDirector.active'), 'watch');
  await click('[data-play]');
  assert.equal(await ev('s.replayDirector.paused'), true);
  await click('[data-speed="3"]');
  assert.equal(await ev('s.replayDirector.speed'), 3);
  const motion = await ev(`(() => {const d=s.replayDirector;d.seek(2);d.play();d.update(.5);d.pause();s.renderPose.apply(s.aircraft.group,s.position,s.quaternion,0);return {time:d.progressSec,render:s.aircraft.group.position.distanceTo(s.position)};})()`);
  assert.equal(motion.time, 3.5); assert.ok(motion.render < 1e-8);
  for (const time of [7, 1, 5, 0]) {
    const error = await ev(`(() => {const el=document.querySelector('[data-seek]');el.value=${time};el.dispatchEvent(new Event('input'));return Math.abs(s.replayDirector.progressSec-${time});})()`);
    assert.ok(error < .001);
  }
  await click('[data-step="1"]');
  assert.ok(await ev('s.replayDirector.progressSec > 0 && s.replayDirector.paused'));
  // Exercise every available camera, including asynchronous cockpit entry.
  for (let mode = 0; mode < 10; mode++) {
    await click(`[data-camera="${mode}"]`);
    await until(() => ev(mode === 7 ? 's.cameraSystem.autoSwitch' : `s.cameraSystem.mode === ${mode}`), `camera ${mode}`, 45000);
    await delay(100);
  }
  await click('[data-camera="1"]');
  await screenshot(`${output}/desktop.png`);
  for (const [width, height, name] of [[390, 844, 'mobile'], [844, 390, 'landscape']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await delay(300);
    assert.equal(await ev(`(() => {const r=document.querySelector('#replay-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), true, `${name} panel fits`);
    await screenshot(`${output}/${name}.png`);
  }
  // Native touch dispatch, rather than a synthetic DOM click, on the mobile speed button.
  const touch = await ev(`(() => {const r=document.querySelector('[data-speed="0.5"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await ev('s.replayDirector.speed'), .5);
  await click('[data-exit]');
  assert.equal(await ev('s.gameFlow.state'), 'lobby');
  assert.equal(await ev('s.replayDirector.active'), false);
  assert.equal(await ev('s.controls.aircraftControlsDisabled'), false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('#btn-replays');
  assert.equal(await ev('document.querySelector("#replay-library").hidden'), false);
  await screenshot(`${output}/library.png`);
  await ev(`document.querySelector('.replay-entry input').value='My approach';document.querySelector('.replay-entry input').dispatchEvent(new Event('change'));`);
  assert.equal(await ev('s.replayStore.list()[0].label'), 'My approach');
  await click('[data-action="delete"]');
  assert.equal(await ev('s.replayStore.list().length'), 0);
  await ev(`(() => {const file=new File([window.replayExport],'replay.json',{type:'application/json'});const files=new DataTransfer();files.items.add(file);const input=document.querySelector('[data-import]');input.files=files.files;input.dispatchEvent(new Event('change'));})()`);
  await until(() => ev('s.replayStore.list().length === 1'), 'import');
  await ev(`(() => {const files=new DataTransfer();files.items.add(new File(['bad json'],'bad.json'));const input=document.querySelector('[data-import]');input.files=files.files;input.dispatchEvent(new Event('change'));})()`);
  await until(() => ev('document.querySelector("[data-status]").textContent.includes("Could not import")'), 'invalid import');
  await click('[data-close]');
  await ev('window.replayReloadMarker=true');
  await send('Page.reload');
  await until(() => ev('!window.replayReloadMarker && !!window.simulator && !document.body.classList.contains("booting")'), 'reload', 90000);
  assert.equal(await ev('window.simulator.replayStore.list().length'), 1, 'library persists across reload');
  // A real Lukla track restores the DEM scene and keeps deterministic replay poses.
  await ev(`(async()=>{window.s=window.simulator;s.lobby.airport='lukla';s.lobby.aircraft='C172';s.lobby.preset='cruise';await s.fly();})()`);
  await until(() => ev('s.currentTerrain.isLoaded'), 'Lukla terrain', 90000);
  await ev('s.gameFlow.enterFlight();s.stepSimulation(8);s.endFlight();');
  assert.ok(await ev('s.debriefReplay?.samples.length > 2'), 'Lukla recorded');
  await ev('(async()=>{await s.replayPanel.watch(s.debriefReplay);s.replayDirector.pause();s.replayDirector.seek(3);})()');
  assert.equal(await ev('s.activeAirport'), 'lukla');
  assert.equal(await ev('s.replayDirector.progressSec'), 3);
  await screenshot(`${output}/lukla.png`);
  await ev(`(async()=>{
    s.replayPanel.exit();
    const {SlalomMissionAdapter}=await import('/src/arena/SlalomMissionAdapter.js');
    const adapter=new SlalomMissionAdapter(s);await adapter.prepare({seed:42,pilotKind:'human'});
    const first={...s.replayStore.get(s.replayStore.list()[0].id).track.samples[0],timeSec:0,x:s.position.x,y:s.position.y,z:s.position.z,quat:s.quaternion.toArray()};
    const fixture={metadata:{airport:'valley',aircraft:'F16',scenario:'valley',seed:42,timeOfDay:12},durationSec:8,intervalSec:.2,samples:[first,{...first,timeSec:8,z:first.z-30}]};
    adapter.release();
    if(!await s.replayPanel.watch(fixture))throw new Error('seeded valley load failed');
    s.replayDirector.pause();s.replayDirector.seek(4);
  })()`);
  assert.equal(await ev('s.activeAirport'), 'generated-valley');
  assert.equal(await ev('s.replayDirector._scenarioAdapter.activeSeed'), 42);
  await screenshot(`${output}/valley-seed.png`);
  await click('[data-exit]');
  assert.equal(await ev('s.activeAirport'), 'lukla', 'exiting restores the terrain replaced by the valley');
  assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, checks: ['record/save/watch', '3x clock and rendered pose', 'backwards scrub', 'frame step', '10 cameras', 'desktop/mobile/landscape', 'native touch', 'exit', 'rename/delete/import/invalid import', 'reload persistence', 'Lukla DEM replay', 'seeded valley terrain restore/exit'] }, null, 2));
  console.log('Replay acceptance passed');
});
