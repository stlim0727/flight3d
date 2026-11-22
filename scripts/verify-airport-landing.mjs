// Hardware-Chrome evidence for issue #922 step 2: Incheon -> streamed RKSS.
// Run with GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';
const artifacts = path.resolve('.cache/airport-landing');
const results = { checks: [] };
await mkdir(artifacts, { recursive: true });
const record = (name, value) => { results.checks.push({ name, value }); return value; };

function checkGpu(cdpPort) {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: path.join(artifacts, 'gpu.json') },
    stdio: 'inherit',
    timeout: 180000,
  });
}

async function waitFor(page, expression, tries = 300, delayMs = 100) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(expression)) return true;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

await withBrowserSession({ path: '/index.html', timeoutMs: 120000 }, async session => {
  const { evaluate, screenshot, cdpPort, gpuAngle, exceptions } = session;
  checkGpu(cdpPort);
  results.browser = { gpuAngle, renderer: 'see .cache/airport-landing/gpu.json' };
  assert.ok(await waitFor(session, 'Boolean(window.sim?.gameFlow?.state)'), 'simulator did not boot');

  await evaluate(`(() => {
    document.getElementById('lobby-airport-incheon')?.click();
    const select = document.getElementById('lobby-destination');
    select.value = 'RKSS';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await evaluate('sim.fly()');
  assert.ok(await waitFor(session, "sim.airportStreamer?.status?.state === 'ready'"), 'RKSS did not become ready');
  assert.ok(await waitFor(session, 'sim.gameFlow.state === "flight" && !sim.startingFlight'), 'flight did not start');

  const mounted = record('mounted', await evaluate(`(() => {
    const region = sim.world.regions.get('RKSS');
    return {
      code: sim.destinationAirport,
      state: sim.airportStreamer.status.state,
      offset: sim.world.offsets.get('RKSS'),
      runways: region?.terrain?.runways?.length ?? 0,
      meshChildren: region?.group?.children?.length ?? 0,
      inScene: Boolean(region?.group?.parent),
    };
  })()`));
  assert.equal(mounted.code, 'RKSS');
  assert.equal(mounted.state, 'ready');
  assert.equal(mounted.runways, 2);
  assert.ok(mounted.meshChildren > 0 && mounted.inScene);

  const contact = record('contact', await evaluate(`(() => {
    const region = sim.world.regions.get('RKSS');
    const [ox, oz] = sim.world.offsets.get('RKSS');
    const end = region.terrain.runways[0].ends[0].threshold;
    const x = end.x + ox, z = end.z + oz;
    const mesh = region.group.children[0];
    return {
      x, z,
      expectedM: end.elevationM,
      contactM: sim.currentTerrain.getHeight(x, z),
      runway: sim.currentAirport.isOnRunway(x, z),
      meshY: mesh?.geometry?.attributes?.position?.getY?.(0) ?? null,
    };
  })()`));
  assert.equal(contact.runway, true);
  assert.ok(Math.abs(contact.contactM - contact.expectedM) < 0.1, 'contact height differs from indexed elevation');
  assert.ok(Math.abs(contact.meshY - contact.expectedM - 0.015) < 0.05, 'mesh height differs from contact');

  await screenshot(path.join(artifacts, 'rkss-ready.png'));

  const landing = record('onRunway', await evaluate(`(() => {
    sim.setPreset('runway');
    const region = sim.world.regions.get('RKSS');
    const [ox, oz] = sim.world.offsets.get('RKSS');
    const runway = region.terrain.runways[0];
    const a = runway.ends[0].threshold, b = runway.ends[1].threshold;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const ux = dx / length, uz = dz / length;
    const x = a.x + ox + ux * 120, z = a.z + oz + uz * 120;
    sim.position.set(x, sim.currentTerrain.getHeight(x, z) + 3, z);
    sim.linearVelocity.set(0, 0, 0);
    sim.angularVelocity.set(0, 0, 0);
    sim.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.atan2(ux, -uz));
    sim.autopilot.master = false;
    sim.controls.brakes = 1;
    sim.engines.setThrottle(0);
    for (let frame = 0; frame < 8; frame++) sim.stepSimulation(1 / 60);
    const px = sim.position.x - ox, pz = sim.position.z - oz;
    const pa = runway.ends[0].physical, pb = runway.ends[1].physical;
    const sdx = pb.x - pa.x, sdz = pb.z - pa.z, slen = Math.hypot(sdx, sdz);
    const t = Math.max(0, Math.min(1, ((px - pa.x) * sdx + (pz - pa.z) * sdz) / (slen * slen)));
    return {
      onGround: sim.telemetry.onGround, crashed: sim.isCrashed, incident: sim.landingIncident,
      speed: sim.telemetry.groundSpeedKnots, region: sim.world.regionAt(sim.position.x, sim.position.z)?.id ?? null,
      runway: sim.currentAirport.isOnRunway(sim.position.x, sim.position.z),
      offsetFromCentrelineM: Math.hypot(px - (pa.x + t * sdx), pz - (pa.z + t * sdz)),
    };
  })()`));

  assert.equal(landing.crashed, false);
  assert.equal(landing.onGround, true, 'aircraft is not supported by the streamed runway');
  assert.equal(landing.runway, true);
  assert.ok(landing.offsetFromCentrelineM < 5);

  const stopped = record('stopped', await evaluate(`(() => ({
    frames: 0,
    speed: sim.telemetry.groundSpeedKnots,
    onGround: sim.telemetry.onGround,
    crashed: sim.isCrashed,
    runway: sim.currentAirport.isOnRunway(sim.position.x, sim.position.z),
  }))()`));
  assert.equal(stopped.crashed, false);
  assert.ok(stopped.speed <= 3, 'aircraft did not stop on the runway');
  await screenshot(path.join(artifacts, 'rkss-stopped.png'));

  const takeoff = record('takeoff', await evaluate(`(() => {
    sim.controls.setParkingBrake?.(false);
    sim.controls.clearVirtualInputs?.();
    sim.controls.virtualBrakes = null;
    sim.controls.touchBrakes = 0;
    sim.controls.hotasBrakes = 0;
    sim.controls.brakes = 0;
    sim.controls.throttle = 1;
    sim.engines.setReverser(false, true);
    sim.engines.setThrottle(1);
    sim.engines.settleSpool?.();
    sim.aero.setFlapPosition(2);
    let frames = 0;
    do {
      sim.stepSimulation(1 / 60);
      frames++;
    } while (frames < 1200 && (frames < 4 || sim.telemetry.onGround || sim.telemetry.groundSpeedKnots < 80) && !sim.isCrashed);
    return { frames, onGround: sim.telemetry.onGround, speed: sim.telemetry.groundSpeedKnots, altitude: sim.position.y, crashed: sim.isCrashed, throttle: sim.controls.throttle, engineCommand: sim.engines.throttleCommand, n1: sim.engines.n1, thrust: sim.engines.thrust, brakes: sim.controls.brakes, parking: sim.controls.parkingBrake, velocity: sim.linearVelocity.length(), fuel: sim.engines.fuelKg };
  })()`));
  assert.equal(takeoff.crashed, false);
  results.limitation = 'The CDP-injected takeoff did not accelerate beyond taxi speed; full re-takeoff is not claimed.';
  await screenshot(path.join(artifacts, 'rkss-takeoff.png'));

  assert.deepEqual(exceptions, [], 'browser exceptions during landing check');
});

console.log(JSON.stringify(results, null, 2));
