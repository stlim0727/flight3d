import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotPhysiologyFx } from '../src/effects/PilotPhysiologyFx.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

test('pilot physiology fx scales intensity by camera mode (100% cockpit vs 25% exterior)', () => {
  const fx = new PilotPhysiologyFx();

  // Test positive G consciousness loss in cockpit view (both string and numeric CameraSystem mode 0)
  fx.update(CameraSystem.MODES.COCKPIT, { consciousness: 0.2, gZ: 5.0, isGLOC: false });
  assert.equal(fx.viewScale, 1.0, 'Numeric COCKPIT mode (0) must have 100% intensity');
  const cockpitBlackout = fx.blackoutAlpha;
  const cockpitGrayout = fx.grayoutAlpha;

  // HUD numeric mode (8)
  fx.update(CameraSystem.MODES.HUD, { consciousness: 0.2, gZ: 5.0, isGLOC: false });
  assert.equal(fx.viewScale, 1.0, 'Numeric HUD mode (8) must have 100% intensity');

  // Same state in chase numeric mode (1)
  fx.update(CameraSystem.MODES.CHASE, { consciousness: 0.2, gZ: 5.0, isGLOC: false });
  assert.equal(fx.viewScale, 0.25, 'Numeric CHASE mode (1) must have 25% intensity');
  assert.ok(Math.abs(fx.blackoutAlpha - cockpitBlackout * 0.25) < 1e-4, 'Exterior blackout must be 25% of cockpit');
  assert.ok(Math.abs(fx.grayoutAlpha - cockpitGrayout * 0.25) < 1e-4, 'Exterior grayout must be 25% of cockpit');
});

test('positive G progression: tunnel vision -> grayout -> blackout on G-LOC', () => {
  const fx = new PilotPhysiologyFx();

  // Mild high G (C = 0.85): slight tunnel vision, no grayout, no blackout
  fx.update('cockpit', { consciousness: 0.85, gZ: 4.5, isGLOC: false });
  assert.ok(fx.tunnelRatio > 0, 'Tunnel vision should start developing');
  assert.equal(fx.grayoutAlpha, 0.0, 'No grayout yet at C = 0.85');
  assert.equal(fx.blackoutAlpha, 0.0, 'No blackout yet at C = 0.85');

  // Moderate high G (C = 0.5): tunnel vision + grayout, no blackout
  fx.update('cockpit', { consciousness: 0.5, gZ: 5.5, isGLOC: false });
  assert.ok(fx.grayoutAlpha > 0.5, 'Grayout should develop as C drops below 0.8');
  assert.equal(fx.blackoutAlpha, 0.0, 'No blackout yet at C = 0.5');

  // Severe high G / G-LOC: complete blackout
  fx.update('cockpit', { consciousness: 0.0, gZ: 7.0, isGLOC: true });
  assert.equal(fx.blackoutAlpha, 1.0, 'Complete blackout on G-LOC');
  assert.equal(fx.grayoutAlpha, 1.0, 'Complete grayout on G-LOC');
});

test('negative G creates redout and blur', () => {
  const fx = new PilotPhysiologyFx();

  // Negative G: -2.5 G
  fx.update('cockpit', { consciousness: 0.9, gZ: -2.5, isGLOC: false });
  assert.ok(fx.redoutAlpha > 0.4, 'Redout should develop at -2.5 G');
  assert.ok(fx.blurPx > 3.0, 'Peripheral blur should develop during redout');

  // Exterior view has 25% redout intensity
  fx.update('orbit', { consciousness: 0.9, gZ: -2.5, isGLOC: false });
  assert.ok(fx.redoutAlpha <= 0.25, 'Exterior redout should be scaled to 25%');
});

test('reset clears all effect alphas', () => {
  const fx = new PilotPhysiologyFx();
  fx.update('cockpit', { consciousness: 0.0, gZ: 8.0, isGLOC: true });
  assert.ok(fx.blackoutAlpha > 0);

  fx.reset();
  assert.equal(fx.tunnelRatio, 0.0);
  assert.equal(fx.grayoutAlpha, 0.0);
  assert.equal(fx.blackoutAlpha, 0.0);
  assert.equal(fx.redoutAlpha, 0.0);
  assert.equal(fx.blurPx, 0.0);
});

test('exterior view preserves wide visual aperture and low vignette opacity during high G', () => {
  const container = {
    classList: { add() {}, remove() {} },
    style: {
      props: {},
      setProperty(k, v) { this.props[k] = v; },
      removeProperty(k) { delete this.props[k]; }
    }
  };
  const fx = new PilotPhysiologyFx();
  fx.element = container;

  // Cockpit view at C = 0.2: tight tunnel pinhole (e.g. 8.5%)
  fx.update('cockpit', { consciousness: 0.2, gZ: 5.0, isGLOC: false });
  const cockpitInner = parseFloat(container.style.props['--tunnel-inner']);
  const cockpitEdgeAlpha = parseFloat(container.style.props['--blackout-edge']);

  // Chase view at C = 0.2: wide clear center (~65%), attenuated vignette opacity
  fx.update('chase', { consciousness: 0.2, gZ: 5.0, isGLOC: false });
  const chaseInner = parseFloat(container.style.props['--tunnel-inner']);
  const chaseEdgeAlpha = parseFloat(container.style.props['--blackout-edge']);

  assert.ok(chaseInner > cockpitInner * 4, `Chase view inner radius (${chaseInner}%) should be much wider than cockpit (${cockpitInner}%)`);
  assert.ok(chaseEdgeAlpha < cockpitEdgeAlpha * 0.5, `Chase view edge opacity (${chaseEdgeAlpha}) should be much lower than cockpit (${cockpitEdgeAlpha})`);
});
