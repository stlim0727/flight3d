import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { ReplayDirector } from '../src/director/ReplayDirector.js';
import { t } from '../src/i18n/index.js';
import { HudView } from '../src/ui/HudView.js';

test('replay markers include the host and only live recorded missiles', () => {
  const sim = { position: new Vector3(1, 2, 3), aircraft: { group: { visible: true } } };
  const director = new ReplayDirector(sim);
  director.active = true;
  assert.deepEqual(director.markerState(), [{ kind: 'player', position: sim.position }]);

  const live = { alive: true, typeId: 'AIM120C', position: new Vector3(4, 5, 6) };
  director._combat = { state: { missiles: [live, { alive: false, typeId: 'AIM9X', position: new Vector3() }] } };
  const markers = director.markerState();
  assert.equal(markers.length, 2);
  assert.equal(markers[1].kind, 'missile');
  assert.equal(markers[1].typeId, 'AIM120C');
  assert.equal(markers[1].position, live.position);

  sim.aircraft.group.visible = false;
  assert.ok(!director.markerState().some(marker => marker.kind === 'player'));
  director.active = false;
  assert.equal(director.markerState(), null);
});

test('markers are scoped to an active replay in the DIRECTOR camera', () => {
  const hud = Object.assign(Object.create(HudView.prototype), { sim: {
    replayDirector: { active: true, markerState: () => [{ kind: 'player' }] },
    cameraSystem: { mode: CameraSystem.MODES.CHASE },
  } });
  assert.equal(hud.replayMarkers(), null);
  hud.sim.cameraSystem.mode = CameraSystem.MODES.DIRECTOR;
  assert.deepEqual(hud.replayMarkers(), [{ kind: 'player' }]);
  hud.sim.replayDirector.active = false;
  assert.equal(hud.replayMarkers(), null);
});

test('director replay labels on-screen subjects and locates the off-screen round', () => {
  const labels = [], locators = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText'
    ? (...args) => labels.push(args) : () => {} });
  const camera = new PerspectiveCamera(60, 16 / 9);
  camera.updateMatrixWorld();
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx, sim: { camera, quaternion: new Quaternion(), position: new Vector3() },
    _hudInverse: new Quaternion(), _hudPoint: new Vector3(), _hudForward: new Vector3(),
    drawReplayLocator(screen, width, height, scale, color, label, range) {
      locators.push([label, range, screen]);
    },
  });

  hud.drawReplayMarkers([
    { kind: 'player', position: new Vector3(0, 0, -100) },
    { kind: 'missile', typeId: 'AIM9X', position: new Vector3(0, 0, -50) },
    { kind: 'missile', typeId: 'AIM120C', position: new Vector3(0, 0, 100) },
  ], 1600, 900);

  const texts = labels.map(([text]) => text);
  assert.ok(texts.includes(t('replay.marker.player')));
  assert.ok(texts.includes(t('weapons.aim9x')));
  assert.equal(locators.length, 1);
  assert.equal(locators[0][0], t('weapons.aim120c'));
  assert.match(locators[0][1], /m$/);
});

test('off-screen replay locators keep both label lines inside the frame', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText'
    ? (...args) => calls.push(args) : () => {} });
  const hud = Object.assign(Object.create(HudView.prototype), { ctx });
  const screens = [
    { x: 800, y: -100, behind: false },
    { x: 1700, y: 450, behind: false },
    { x: 800, y: 1000, behind: false },
    { x: -100, y: 450, behind: false },
    { x: 0, y: 0, behind: true, angle: 0 },
  ];
  for (const screen of screens) {
    calls.length = 0;
    hud.drawReplayLocator(screen, 1600, 900, 1, '#b8ff9b', 'AIM-120C', '1.2 km');
    assert.equal(calls.length, 2);
    for (const [, x, y] of calls) {
      assert.ok(x >= 0 && x <= 1600, `x ${x} outside frame`);
      assert.ok(y >= 0 && y <= 900, `y ${y} outside frame`);
    }
  }
});
