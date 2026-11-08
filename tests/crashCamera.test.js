import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { DebriefOverlay } from '../src/ui/DebriefOverlay.js';

test('crash camera allows exterior modes, rejects cockpit/wing/gear/HUD, and supports POV change', () => {
  const camera = new THREE.PerspectiveCamera(50, 1.0, 0.25, 45000);
  const dom = { addEventListener() {}, style: {} };
  const system = new CameraSystem(camera, dom);

  const wreckage = { target: new THREE.Vector3(100, 10, 200), radius: 20 };
  system.beginCrashView(wreckage);

  // Default crash view mode is CHASE (Wreckage Orbit)
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  assert.equal(system.getViewName(), 'WRECKAGE ORBIT');

  // Reject cockpit (0), wing (2), gear (5), HUD (8)
  assert.equal(system.setMode(CameraSystem.MODES.COCKPIT, true), false);
  assert.equal(system.setMode(CameraSystem.MODES.WING, true), false);
  assert.equal(system.setMode(CameraSystem.MODES.GEAR, true), false);
  assert.equal(system.setMode(CameraSystem.MODES.HUD, true), false);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);

  // Accept exterior spectator views: DRONE (6), FLYBY (4), TOWER (3), CHASE (1)
  assert.equal(system.setMode(CameraSystem.MODES.DRONE, true), true);
  assert.equal(system.mode, CameraSystem.MODES.DRONE);
  assert.equal(system.getViewName(), 'CRASH SCENE DRONE');

  assert.equal(system.setMode(CameraSystem.MODES.FLYBY, true), true);
  assert.equal(system.mode, CameraSystem.MODES.FLYBY);
  assert.equal(system.getViewName(), 'SPECTATOR VIEW');

  assert.equal(system.setMode(CameraSystem.MODES.TOWER, true), true);
  assert.equal(system.mode, CameraSystem.MODES.TOWER);
  assert.equal(system.getViewName(), 'AIRPORT TOWER');

  assert.equal(system.setMode(CameraSystem.MODES.CHASE, true), true);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);

  // Quick cycle loops sequentially through allowed crash modes
  // [CHASE (1), DRONE (6), FLYBY (4), TOWER (3)]
  assert.equal(system.cycleMode(), 'CRASH SCENE DRONE');
  assert.equal(system.mode, CameraSystem.MODES.DRONE);

  assert.equal(system.cycleMode(), 'SPECTATOR VIEW');
  assert.equal(system.mode, CameraSystem.MODES.FLYBY);

  assert.equal(system.cycleMode(), 'AIRPORT TOWER');
  assert.equal(system.mode, CameraSystem.MODES.TOWER);

  assert.equal(system.cycleMode(), 'WRECKAGE ORBIT');
  assert.equal(system.mode, CameraSystem.MODES.CHASE);

  // POV change via mouse/touch drag in CHASE mode
  assert.equal(system.isPovModified(), false);
  system.applyMouseDelta(20, 15);
  assert.equal(system.isPovModified(), true);
  assert.notEqual(system.getPovIndicatorAngle(), 0);

  // Camera update updates camera position reflecting dragged orbit
  system.update(0.016, new THREE.Group());
  assert.ok(camera.position.distanceTo(wreckage.target) > 30);

  // resetLook centers POV back to default
  system.resetLook();
  assert.equal(system.isPovModified(), false);
  assert.equal(system.getPovIndicatorAngle(), 0);

  // Switch to DRONE and test POV change
  system.setMode(CameraSystem.MODES.DRONE, true);
  assert.equal(system.isPovModified(), false);
  system.applyMouseDelta(30, 20);
  assert.equal(system.isPovModified(), true);
  system.update(0.016, new THREE.Group());
  assert.ok(camera.position.y > wreckage.target.y);
  system.resetLook();
  assert.equal(system.isPovModified(), false);

  // End crash view restores pre-crash state
  system.endCrashView();
  assert.equal(system.crashView, null);
});

test('DebriefOverlay source defines header camera button and folded camera pill', () => {
  const src = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');

  // Must have debrief-camera button in header
  assert.ok(src.includes('id="debrief-camera"'), 'must have debrief-camera button in header');
  assert.ok(src.includes('debrief-camera-icon'), 'must have debrief-camera-icon');

  // Must have debrief-fold-camera pill alongside unfold pill
  assert.ok(src.includes('id="debrief-fold-camera"'), 'must have debrief-fold-camera pill');
  assert.ok(src.includes('id="debrief-fold-camera-label"'), 'must have debrief-fold-camera-label');

  // Must bind cycle handlers
  assert.ok(src.includes("this.el('camera')?.addEventListener('click'"), 'must bind click to camera button');
  assert.ok(src.includes("this.el('fold-camera')?.addEventListener('click'"), 'must bind click to fold-camera pill');
  assert.ok(src.includes('updateFoldCameraLabel'), 'must implement updateFoldCameraLabel');
});

test('index.html menu items have intuitive icons for lobby and pause navigation', () => {
  const html = readFileSync(resolve('index.html'), 'utf8');

  // Lobby menu items have icons
  assert.ok(html.includes('id="mp-open"'), 'must have mp-open');
  assert.ok(html.includes('id="mp-open"') && html.includes('👥'), 'mp-open must have 👥 icon');

  assert.ok(html.includes('id="lobby-tab-scenario"') && html.includes('🎯'), 'scenario tab must have 🎯 icon');
  assert.ok(html.includes('id="lobby-tab-multi"') && html.includes('👥'), 'multi tab must have 👥 icon');
  assert.ok(html.includes('id="lobby-tab-settings"') && html.includes('⚙️'), 'settings tab must have ⚙️ icon');
  assert.ok(html.includes('id="lobby-tab-dev"') && html.includes('🛠️'), 'dev tab must have 🛠️ icon');

  assert.ok(html.includes('id="btn-replays"') && html.includes('📼'), 'replays button must have 📼 icon');
  assert.ok(html.includes('id="btn-fly"') && html.includes('🛫'), 'fly button must have 🛫 icon');
  assert.ok(html.includes('id="btn-lobby-resume"') && html.includes('▶️'), 'lobby resume must have ▶️ icon');
  assert.ok(html.includes('id="btn-lobby-end"') && html.includes('⏹️'), 'lobby end must have ⏹️ icon');

  // Pause menu options have icons
  assert.ok(html.includes('id="btn-pause-resume"') && html.includes('▶️'), 'pause resume must have ▶️ icon');
  assert.ok(html.includes('id="btn-pause-restart"') && html.includes('🔄'), 'pause restart must have 🔄 icon');
  assert.ok(html.includes('id="btn-pause-exit"') && html.includes('🚪'), 'pause exit must have 🚪 icon');
  assert.ok(html.includes('id="btn-pause-end"') && html.includes('⏹️'), 'pause end must have ⏹️ icon');
});

test('screens showcases filter pills define intuitive category icons', () => {
  const desktopHtml = readFileSync(resolve('screens.html'), 'utf8');
  const portraitHtml = readFileSync(resolve('screens-mobile-portrait.html'), 'utf8');
  const landscapeHtml = readFileSync(resolve('screens-mobile-landscape.html'), 'utf8');

  for (const html of [desktopHtml, portraitHtml, landscapeHtml]) {
    assert.ok(html.includes('data-category="all"') && html.includes('✨'), 'all filter must have ✨ icon');
    assert.ok(html.includes('data-category="lobby"') && html.includes('🏠'), 'lobby filter must have 🏠 icon');
    assert.ok(html.includes('data-category="flight"') && html.includes('✈️'), 'flight filter must have ✈️ icon');
    assert.ok(html.includes('data-category="modal"') && html.includes('💬'), 'modals filter must have 💬 icon');
    assert.ok(html.includes('data-category="debrief"') && html.includes('📋'), 'debrief filter must have 📋 icon');
    assert.ok(html.includes('data-category="replay"') && html.includes('📼'), 'replay filter must have 📼 icon');
    assert.ok(html.includes('data-category="pilot"') && html.includes('🏆'), 'pilot filter must have 🏆 icon');
    assert.ok(html.includes('data-category="standalone"') && html.includes('🛠️'), 'standalone filter must have 🛠️ icon');
  }
});
