import { Quaternion, Vector3 } from 'three';
import { AirToAirMissileSystem, BanditTarget } from '../../src/weapons/AirToAirMissileSystem.js';

/** A synthetic ridge appears after release. Permanent masking also affects
 * physical terrain impact: its miss must not be attributed to sensing alone.
 */
export function runSeekerTerrainEngagement(type, masking) {
  const dt = 1 / 120;
  let time = 0;
  const masked = () => masking !== 'open' && time >= 0.3 && (masking === 'permanent' || time < 0.65);
  const world = { active: true, onGround: false, position: new Vector3(0, 3000, 0),
    velocity: new Vector3(0, 0, -250), quaternion: new Quaternion(),
    terrainHeight: (x, z) => masked() && z < -1800 && z > -2200 ? 3500 : 0 };
  const combat = new AirToAirMissileSystem({ stations: [{ id: 'TEST', type, position: [-5.04, 0.04, 2.45] }] });
  const target = new BanditTarget({ callsign: 'FIXTURE', position: new Vector3(0, 3000, -4000), velocity: new Vector3(60, 0, 0) });
  combat.addTarget(target);
  for (let i = 0; i < 100; i++) combat.update(dt, world);
  if (!combat.lockedTarget) throw new Error('Exposed rail lock required');
  const missile = combat.fire(world);
  const phases = [missile.seeker.state];
  let terminal = 'timeout', memoryPose = null;
  for (let i = 0; i < 26 * 120; i++) {
    time = i * dt;
    const events = combat.update(dt, world);
    if (phases.at(-1) !== missile.seeker.state) phases.push(missile.seeker.state);
    if (!memoryPose && missile.seeker.state === 'memory') {
      memoryPose = { position: missile.position.toArray(), quaternion: missile.quaternion.toArray() };
    }
    if (events.some(e => e.type === 'kill' && e.target === target)) { terminal = 'hit'; break; }
    if (!missile.alive) {
      terminal = events.some(e => e.type === 'expire') ? 'miss-expired' : 'miss-terrain';
      break;
    }
  }
  return { type, masking, phases, terminal, seconds: time + dt, memoryPose };
}

export function compareSeekerTerrainEngagements() {
  return ['AIM9X', 'AIM120C'].flatMap(type => ['open', 'brief', 'permanent']
    .map(masking => runSeekerTerrainEngagement(type, masking)));
}

/** Browser-only model-level visual check; deliberately avoids the simulator's
 * heavy startup scene. Draw the production missile mesh at a real memory pose.
 */
export async function renderSeekerPose(pose) {
  const THREE = await import('three');
  const { createMissileMesh } = await import('../../src/weapons/missileGeometry.js');
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(640, 480); renderer.setClearColor(0x101820);
  document.body.replaceChildren(renderer.domElement);
  const mesh = createMissileMesh('AIM9X');
  mesh.position.fromArray(pose.position); mesh.quaternion.fromArray(pose.quaternion);
  scene.add(mesh, new THREE.AmbientLight(0xffffff, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 640 / 480, 0.1, 100);
  camera.position.copy(mesh.position).add(new THREE.Vector3(4, 2, 4)); camera.lookAt(mesh.position);
  renderer.render(scene, camera);
  const gl = renderer.getContext(), pixels = new Uint8Array(640 * 480 * 4);
  gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let drawnPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) drawnPixels++;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
    drawnPixels, error: gl.getError(), quaternion: mesh.quaternion.toArray() };
}
