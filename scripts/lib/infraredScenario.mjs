import { Quaternion, Vector3 } from 'three';
import { infraredSignalQuality } from '../../src/weapons/InfraredSignal.js';
import { MissileSeeker } from '../../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../../src/weapons/missileSpecs.js';

/** Held-pose signal/state fixture. Afterburner is explicit test input; the live
 * engine currently has no AB dynamics. Nothing here forces a missile miss.
 */
export function runInfraredScenario() {
  const dt = 1 / 120, world = { terrainHeight: () => 0 };
  const observer = { position: new Vector3(0, 3000, 0), quaternion: new Quaternion() };
  const target = { id: 1, alive: true, position: new Vector3(0, 3000, -6000),
    velocity: new Vector3(), quaternion: new Quaternion(),
    infraredSignature: { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: false } };
  const ir = new MissileSeeker(MISSILE_TYPES.AIM9X), radar = new MissileSeeker(MISSILE_TYPES.AIM120C);
  if (!ir.seed(target, observer, world) || !radar.seed(target, observer, world)) throw new Error('Hot rear track required');
  const snapshots = [];
  const record = label => snapshots.push({ label, quality: infraredSignalQuality(observer, target, 6000), ir: ir.state, radar: radar.state });
  const step = seconds => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      ir.update(dt, observer, [target], world); radar.update(dt, observer, [target], world);
    }
  };
  record('hot-rear');
  target.infraredSignature.enginePower = 0; target.infraredSignature.heat = 0.3;
  step(0.1); record('weak-memory');
  step(0.7); record('weak-lost');
  target.infraredSignature.enginePower = 1; target.infraredSignature.heat = 1;
  target.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  step(0.3); record('hot-front-untracked');
  target.infraredSignature.afterburner = 1;
  step(dt); record('bright-confirming');
  step(0.2); record('bright-reacquired');
  target.quaternion.identity(); target.infraredSignature.afterburner = 0;
  const ranges = [2000, 4000, 8000].map(rangeM => {
    target.position.z = -rangeM;
    const sample = {}; infraredSignalQuality(observer, target, rangeM, sample);
    return { rangeM, ...sample };
  });
  return { snapshots, ranges };
}
