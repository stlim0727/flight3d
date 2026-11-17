// Hardware Chrome acceptance: keep the live camera toolbar through replay and exit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';
import { until } from './lib/cdpClient.mjs';

process.env.GPU_ANGLE = 'vulkan';
process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';
const output = resolve('review-artifacts/replay-camera-toolbar');
await mkdir(output, { recursive: true });
await withBrowserSession({ width: 1280, height: 800, navigate: false }, async ({ origin, cdpPort, send, evaluate: ev, screenshot: captureScreenshot, exceptions, delay }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: `${output}/gpu.json` }, stdio: 'inherit',
  });
  const screenshot = async file => { console.log(`Replay screenshot: ${file}`); return captureScreenshot(file); };
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const click = async selector => {
    const point = await ev(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  await send('Page.navigate', { url: `${origin}/?airport=coastal&aircraft=C172&instant=1` });
  await until(() => ev('!!window.simulator && !document.body.classList.contains("booting")'), 'boot', 90000);
  await ev(`(async()=>{window.s=window.simulator;s.lobby.airport='coastal';s.lobby.aircraft='C172';s.lobby.preset='cruise';await s.fly();s.controls.onSelectCamera(1);})()`);
  const sizes = [[1280, 800, 'desktop'], [390, 844, 'mobile'], [844, 390, 'landscape']];
  const snapshots = {};
  const snapshot = () => ev(`(() => {
    const strip = document.querySelector('#camera-strip');
    return [...strip.querySelectorAll('button')].filter(b => !b.hidden).map(b => {
      const r = b.getBoundingClientRect(), c = getComputedStyle(b);
      return { id:b.id, x:r.x, y:r.y, width:r.width, height:r.height,
        background:c.backgroundColor, border:c.border, radius:c.borderRadius,
        label:getComputedStyle(b,'::after').content, hint:getComputedStyle(b,'::before').content,
        visibility:c.visibility, display:c.display };
    });
  })()`);
  const resize = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<1025});
    await delay(400);
  };
  await ev('window.liveCameraButtons=[...document.querySelectorAll("#camera-strip button")]');
  for (const [width,height,name] of sizes) {
    await resize(width,height);
    snapshots[name] = await snapshot();
    assert.ok(snapshots[name].length > 0);
    await screenshot(`${output}/${name}-live.png`);
  }
  await ev('s.stepSimulation(10);s.gameFlow.pause();s.endFlight()');
  await click('#debrief-watch-replay');
  await until(() => ev('s.replayDirector.active'), 'replay started');
  await ev('s.replayDirector.pause();s.controls.onSelectCamera(1)');
  for (const [width,height,name] of sizes) {
    await resize(width,height);
    assert.deepEqual(await snapshot(), snapshots[name], `${name}: exact live camera geometry and styles`);
    assert.equal(await ev('liveCameraButtons.every((b,i)=>b===document.querySelectorAll("#camera-strip button")[i])'),true);
    assert.equal(await ev('document.querySelectorAll("#replay-panel [data-camera-mode]").length'),0);
    assert.equal(await ev('getComputedStyle(document.querySelector("#btn-gear")).visibility'),'hidden');
    await click('#btn-cam-drone');
    await until(() => ev('s.cameraSystem.mode===6 && document.querySelector("#btn-cam-drone").getAttribute("aria-pressed")==="true"'), 'shared camera click');
    await click('#btn-cam-chase');
    await screenshot(`${output}/${name}-replay.png`);
  }
  await click('[data-exit]');
  assert.equal(await ev('s.replayDirector.active'),false);
  await ev('s.gameFlow.returnToLobby(false);s.fly()');
  await until(() => ev('s.gameFlow.state === "flight"'), 'return to live flight');
  assert.equal(await ev('getComputedStyle(document.querySelector("#btn-gear")).visibility'),'visible');
  assert.deepEqual(exceptions,[]);
  await writeFile(`${output}/result.json`,JSON.stringify({passed:true,snapshots,checks:['same DOM nodes','exact live geometry and styles at three sizes','no duplicate cameras','native camera clicks and pressed state','flight controls hidden and restored']},null,2));
});
