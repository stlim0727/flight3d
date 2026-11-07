import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withBrowserSession } from './lib/browserHarness.mjs';
import assert from 'node:assert/strict';
// Reconstructed approach state from the supplied 2026-11-07 F16 replay.
// Pose recording is not a checkpoint: velocities/rates are inferred from samples.
process.env.GPU_ANGLE = 'vulkan';
fs.mkdirSync('review-artifacts/impact', { recursive: true });
const fixture = {
  "previous": {
    "x": 49.89783477783203,
    "y": 14.032660484313965,
    "z": -1311.032470703125,
    "timeSec": 314.2083435058594,
    "quat": [
      -0.07434308908352916,
      -0.2772606585894345,
      0.11487166966765343,
      -0.9510016465873427
    ]
  },
  "sample": {
    "x": 34.40260314941406,
    "y": 12.156115531921387,
    "z": -1333.9853515625,
    "timeSec": 314.60833740234375,
    "quat": [
      -0.08273567918942838,
      -0.27256080813013095,
      0.10251167332987457,
      -0.9530775257509869
    ],
    "vsiFpm": -921,
    "throttle": 0.2901960784313726,
    "pitchTrim": 2.1,
    "elevator": 0.14173228346456693,
    "aileron": -0.03937007874015748,
    "flapIndex": 1,
    "flapDegree": 20,
    "spoilers": 0.8,
    "engine1": {
      "n1": 71.5,
      "n2": 84,
      "egt": 644,
      "ff": 780,
      "failed": false
    }
  }
};
await withBrowserSession({ path: '/', timeoutMs: 120000 }, async ({ evaluate, cdpPort, delay, screenshot, send }) => {
  console.log(execFileSync(process.execPath,
    ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], { encoding: 'utf8' }));
  await send('Page.bringToFront');
  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady && window.THREE)')) break;
    await delay(250);
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup ready');
  await evaluate(async () => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.setAircraft('F16');
    await s.setAirport('incheon');
    s.gameFlow.enterFlight();
    s.gameFlow.pause();
    s.gameFlow.isPhysicsFrozen = () => true;
  });
  const report = await evaluate(({ previous: p, sample: f }) => {
    const s = window.simulator, T = window.THREE;
    s.setPreset('runway');
    s.demoDirector.stop();
    s.clearCrashState();
    s.gear.resetDamage();
    s.gear.resetContacts();
    s.position.set(f.x, f.y, f.z);
    s.quaternion.fromArray(f.quat);
    const interval = f.timeSec - p.timeSec;
    s.linearVelocity.set((f.x - p.x) / interval, f.vsiFpm * .3048 / 60, (f.z - p.z) / interval);
    const delta = new T.Quaternion().fromArray(p.quat).invert().multiply(s.quaternion);
    if (delta.w < 0) { delta.x *= -1; delta.y *= -1; delta.z *= -1; delta.w *= -1; }
    s.angularVelocity.set(delta.x, delta.y, delta.z).multiplyScalar(2 / interval);
    s.controls.setParkingBrake(false);
    s.controls.virtualBrakes = 0;
    s.controls.throttle = f.throttle;
    s.controls.pitchTrim = f.pitchTrim;
    s.controls.virtualElevator = f.elevator;
    s.controls.virtualAileron = f.aileron;
    s.aero.flapsIndex = f.flapIndex;
    s.aero.currentFlapAngle = f.flapDegree;
    s.aero.spoilers = f.spoilers;
    s.gear.gearState = s.gear.targetGearState = 1;
    s.engines.n1[0] = f.engine1.n1;
    s.engines.n2[0] = f.engine1.n2;
    const frames = [], originalUpdate = s.gear.update;
    let contact;
    s.gear.update = function (...args) { contact = originalUpdate.apply(this, args); return contact; };
    try {
      for (let i = 0; i < 600 && !s.isCrashed; i++) {
        s.integratePhysics(1 / 120);
        frames.push({ t: i / 120, g: s.telemetry.gForce, pitch: s.telemetry.pitchDeg,
          vy: s.linearVelocity.y, w: s.angularVelocity.toArray(),
          failure: s.gear.failure && { ...s.gear.failure }, gear: s.telemetry.gearDamage,
          contacts: contact.bodyContacts.map(c => ({ id: c.id, sink: c.sinkRate, load: c.load, depth: c.depth })),
          wheels: s.gear.contacts.map(c => ({ id: c.id, damage: c.damage, sink: c.sinkRateMs, compression: c.compression })) });
      }
    } finally { s.gear.update = originalUpdate; }
    return { fixture: f, frames, crashed: s.isCrashed };
  }, fixture);
  assert.equal(report.crashed, false, 'reconstructed approach must remain recoverable');
  assert.notEqual(report.frames.at(-1).gear.nose, 'collapsed', 'nose gear must survive');
  assert.ok(report.frames.every(f => Number.isFinite(f.g)), 'finite measured loads');
  assert.ok(Math.max(...report.frames.map(f => f.g)) < 10, 'regression: no 47g solver rebound');
  assert.ok(Math.abs(report.frames.at(-1).g - 1) < .1, 'settles back to approximately 1g');
  fs.writeFileSync('review-artifacts/impact/acceptance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ crashed: report.crashed, peak: Math.max(...report.frames.map(f => f.g)),
    last: report.frames.at(-1) }, null, 2));
  await evaluate(() => {
    const s = window.simulator;
    s.gameFlow.resume();
    s.gameFlow.isPhysicsFrozen = () => true;
    s.cameraSystem.setMode(1);
    s.cameraSystem.snapToTarget(s.aircraft.group);
    s.renderer.render(s.scene, s.camera);
  });
  await screenshot('review-artifacts/impact/acceptance.png');
});
