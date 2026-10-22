import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CockpitSunShadow,
  computeDeckSunPose,
  cookieAxes,
  projectPanesForCookie,
  drawCockpitCookie,
  COCKPIT_SUN_GAIN,
  COCKPIT_DAYLIGHT_REFERENCE,
  COOKIE_SIZE,
} from '../src/environment/CockpitSunShadow.js';
import {
  WINDSHIELD_PANES,
  DECK_SUN_ANCHOR,
  DECK_SUN_STANDOFF,
  DECK_SUN_AFT_REACH,
  DECK_SUN_CLIP_T,
} from '../src/aircraft/CockpitAperture.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

const identity = new THREE.Quaternion();
const origin = new THREE.Vector3();

/** Sun toward a given elevation/azimuth in degrees; azimuth 180 is straight ahead (-Z). */
function sunDirectionAt(elevationDeg, azimuthDeg = 180) {
  return new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevationDeg),
    THREE.MathUtils.degToRad(azimuthDeg)
  );
}

/** Sun bearings the windshield actually admits, across a day and a full turn. */
function admittedSuns() {
  const suns = [];
  const pose = {};
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    for (const elevation of [3, 20, 40, 60]) {
      const sunDir = sunDirectionAt(elevation, azimuth);
      computeDeckSunPose({ position: origin, quaternion: identity, sunDir, pose });
      if (pose.facing > 0.5) suns.push(sunDir);
    }
  }
  return suns;
}

function freshAxes() {
  return { x: new THREE.Vector3(), y: new THREE.Vector3() };
}

describe('Cockpit deck sun rig (issue #90)', () => {
  it('uses a falloff-free spot so the cone, not the whole scene, carries the deck sun', () => {
    const scene = new THREE.Scene();
    const rig = new CockpitSunShadow(scene);

    assert.equal(rig.light.isSpotLight, true);
    // decay 0 removes inverse-square falloff; distance 0 stops SpotLightShadow from
    // overwriting the shadow slab far plane we set per frame.
    assert.equal(rig.light.decay, 0);
    assert.equal(rig.light.distance, 0);
    assert.equal(rig.light.castShadow, true);
    assert.equal(rig.light.shadow.autoUpdate, false);
    assert.equal(rig.light.intensity, 0);
    assert.ok(scene.children.includes(rig.light), 'Rig must exist from construction, never added late');
    assert.ok(scene.children.includes(rig.light.target), 'Shadow direction needs the target in the scene');
  });

  it('masks the windshield with a light cookie instead of shadow casters', () => {
    const scene = new THREE.Scene();
    const rig = new CockpitSunShadow(scene);

    // The pattern is multiplied onto the light, so nothing extra is inserted into the
    // scene graph. A caster plane would also throw a 5 m shadow across the airport in
    // the main sun map, which is exactly what this rig must not do.
    assert.equal(scene.children.length, 2);
    assert.equal(rig.light.shadow.camera.near > 0, true);
    if (typeof document === 'undefined') {
      // Canvas is a browser API; the headless rig still lights the deck, just unpatterned.
      assert.equal(rig.light.map, null);
    } else {
      assert.equal(rig.light.map.isTexture, true);
      assert.equal(rig.light.map.generateMipmaps, false);
    }
  });

  it('holds a thin body-fixed shadow slab so a frozen map stays valid', () => {
    for (const sunDir of admittedSuns()) {
      const pose = computeDeckSunPose({ position: origin, quaternion: identity, sunDir });
      assert.ok(Math.abs(pose.near - (DECK_SUN_STANDOFF - DECK_SUN_CLIP_T)) < 1e-9,
        'Near plane must include the complete frame regardless of sun bearing');
      assert.ok(Math.abs((pose.far - pose.near) - (DECK_SUN_CLIP_T + DECK_SUN_AFT_REACH)) < 1e-9,
        'Slab depth is the deck depth only; texel density depends on it');
      assert.ok(pose.far - pose.near < 8, 'Deck sun must not reach the rest of the airframe');
      assert.ok(pose.angle > 0 && pose.angle < Math.PI / 2);
    }
  });

  it('includes window corners, side consoles and the interior in the shadow slab', () => {
    const receivers = [
      new THREE.Vector3(0, 0.95, -12.9),   // panel face, ahead of the anchor
      new THREE.Vector3(0, 0.66, -12.12),  // floor
      new THREE.Vector3(-0.4, 0.9, -11.9), // captain seat back
      new THREE.Vector3(0, 1.25, -12.5),   // overhead panel
      new THREE.Vector3(0.85, 0.6, -12.2), // copilot console
      new THREE.Vector3(-1.05, 1.25, -13), // left window frame
      new THREE.Vector3(1.05, 1.25, -13),  // right window frame
    ];
    const pose = {};
    for (const sunDir of admittedSuns()) {
      for (const point of receivers) {
        computeDeckSunPose({ position: origin, quaternion: identity, sunDir, pose });
        const depth = DECK_SUN_STANDOFF - point.clone().sub(pose.anchorWorld).dot(sunDir);
        assert.ok(depth <= pose.far,
          `receiver ${point.toArray()} at depth ${depth.toFixed(2)} leaves the slab at ${pose.far.toFixed(2)}`);
        assert.ok(depth >= pose.near,
            `interior point ${point.toArray()} at depth ${depth.toFixed(2)} must stay shadow-tested`);
      }
    }
  });

  it('opens on sun ahead, closes on sun astern, and never jumps', () => {
    const pose = {};
    computeDeckSunPose({ position: origin, quaternion: identity, sunDir: sunDirectionAt(30, 180), pose });
    assert.ok(pose.facing > 0.9, `Sun ahead must open the deck, got ${pose.facing}`);
    computeDeckSunPose({ position: origin, quaternion: identity, sunDir: sunDirectionAt(30, 0), pose });
    assert.equal(pose.facing, 0, 'Sun straight astern must admit nothing');

    let previous = null;
    for (let azimuth = 180; azimuth <= 420; azimuth += 1) {
      computeDeckSunPose({ position: origin, quaternion: identity, sunDir: sunDirectionAt(12, azimuth), pose });
      if (previous !== null) {
        assert.ok(Math.abs(pose.facing - previous) < 0.08,
          `facing stepped from ${previous.toFixed(3)} to ${pose.facing.toFixed(3)} at azimuth ${azimuth}`);
      }
      previous = pose.facing;
    }
  });

  it('keeps the projected windshield pattern inside the cookie and off the texture edges', () => {
    const pose = {};
    for (const sunDir of admittedSuns()) {
      computeDeckSunPose({ position: origin, quaternion: identity, sunDir, pose });
      const axes = cookieAxes(pose.sunDirLocal, null, freshAxes());
      const quads = projectPanesForCookie({ sunDirLocal: pose.sunDirLocal, axes, angle: pose.angle });
      assert.equal(quads.length, WINDSHIELD_PANES.length);
      for (const quad of quads) {
        assert.equal(quad.length, 8, 'Every admitted pane must project a full quad');
        for (const value of quad) {
          assert.ok(Number.isFinite(value) && value > 0 && value < 1,
            `cookie coordinate ${value.toFixed(3)} must stay on the texture`);
        }
      }
      // A beam crossing the deck must land where the geometry is, not wrap around.
      assert.ok(quads[0][0] !== quads[1][0], 'The two front panes must not collapse together');
    }
  });

  it('paints an opaque cookie with one opening per admitted pane', () => {
    const strokes = [];
    const fills = [];
    let background = null;
    const ctx = {
      setTransform() {}, globalCompositeOperation: '',
      set fillStyle(value) { this._style = value; }, get fillStyle() { return this._style; },
      fillRect(x, y, w, h) { background = [x, y, w, h]; },
      beginPath() {}, moveTo(x, y) { strokes.push([x, y]); }, lineTo(x, y) { strokes.push([x, y]); },
      closePath() {}, stroke() {},
      set strokeStyle(value) { this._stroke = value; }, get strokeStyle() { return this._stroke; },
      set lineWidth(value) {}, set lineJoin(value) {},
      fill() { fills.push(strokes.length); },
    };
    drawCockpitCookie(ctx, [[0.2, 0.2, 0.4, 0.2, 0.4, 0.4, 0.2, 0.4], []], COOKIE_SIZE);

    assert.deepEqual(background, [0, 0, COOKIE_SIZE, COOKIE_SIZE], 'Cookie starts fully opaque');
    assert.equal(fills.length, 1, 'Empty quads must not be painted');
    assert.equal(strokes.length, 4, 'A quad is painted from its four corners');
  });

  it('locks the shadow image to the deck so attitude cannot roll the pattern', () => {
    const scene = new THREE.Scene();
    const rig = new CockpitSunShadow(scene);
    const deckSun = sunDirectionAt(25, 150);
    const state = {
      sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3.5,
      cockpitActive: true, dt: 1, position: origin,
    };

    rig.update({ ...state, sunDir: deckSun, quaternion: identity });
    rig.light.shadow.needsUpdate = false; // A renderer consumes the pending depth pass.
    const pattern = projectPanesForCookie({
      sunDirLocal: rig.pose.sunDirLocal, axes: rig.axes, angle: rig.pose.angle,
    }).map((quad) => quad.slice());

    // Same sun bearing in deck coordinates, different attitude: the openings and the shadow
    // map are unchanged because the shadow camera carries the deck frame instead of world up.
    for (const euler of [[0, 0.6, 0.5], [-0.4, 1.9, -0.3], [0.5, -1.2, 0.9]]) {
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
      const worldSun = deckSun.clone().applyQuaternion(quaternion);
      rig.update({ ...state, sunDir: worldSun, quaternion });
      assert.equal(rig.light.shadow.needsUpdate, false, 'Attitude alone must not repaint');
      const relit = projectPanesForCookie({
        sunDirLocal: rig.pose.sunDirLocal, axes: rig.axes, angle: rig.pose.angle,
      });
      relit.forEach((quad, i) => quad.forEach((value, j) => {
        assert.ok(Math.abs(value - pattern[i][j]) < 1e-5, 'Pattern must be deck-fixed');
      }));
      const upInDeck = rig.light.shadow.camera.up.clone()
        .applyQuaternion(new THREE.Quaternion().copy(quaternion).invert());
      assert.ok(upInDeck.distanceTo(rig.axes.y) < 1e-5, 'Shadow camera up must be the deck frame');
    }
  });

  it('rolls the cookie axis through a sun overhead instead of snapping it', () => {
    let previous = null;
    let largest = 0;
    const carry = freshAxes();
    for (let elevation = 60; elevation <= 89.5; elevation += 0.5) {
      // Walk the sun up the deck with the rig carrying its own previous axis.
      const sunDir = sunDirectionAt(elevation, 175);
      cookieAxes(sunDir, previous, carry);
      if (previous) largest = Math.max(largest, carry.x.angleTo(previous));
      previous = carry.x.clone();
      assert.ok(Math.abs(carry.x.dot(sunDir)) < 1e-6, 'Cookie axis must stay perpendicular to the sun');
      assert.ok(Math.abs(carry.x.y) < 1e-9, 'Cookie axis stays horizontal in the deck');
      assert.ok(Number.isFinite(carry.y.x) && carry.y.length() > 0.5);
    }
    assert.ok(largest < 0.05, `Near-vertical sun rolled the pattern by ${largest.toFixed(3)} rad`);
  });

  it('ramps the deck sun in and out with the camera mode instead of switching it', () => {
    const scene = new THREE.Scene();
    const rig = new CockpitSunShadow(scene);
    const base = {
      position: origin, quaternion: identity, sunDir: sunDirectionAt(45),
      sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3.5, dt: 1 / 60,
    };

    const samples = [];
    for (let frame = 0; frame < 120; frame++) {
      samples.push(rig.update({ ...base, cockpitActive: true }));
    }
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], 'Ramp-up must be monotonic');
    }
    assert.ok(samples[0] < 0.2 * samples[samples.length - 1], 'Ramp must start soft to avoid a flash');
    assert.ok(rig.daylight > 0.9, `Full sun settles at ${rig.daylight}`);
    assert.equal(rig.light.intensity,
      3.5 * rig.pose.facing * rig.modeFactor * COCKPIT_SUN_GAIN);
    assert.ok(rig.light.intensity <= 3.5 * COCKPIT_SUN_GAIN + 1e-9,
      'Deck sun must never exceed its share of the ambient sun');

    let previous = rig.light.intensity;
    rig.light.shadow.needsUpdate = false;
    for (let frame = 0; frame < 240; frame++) {
      rig.update({ ...base, cockpitActive: false });
      assert.ok(rig.light.intensity <= previous + 1e-9, 'Ramp-down must be monotonic');
      previous = rig.light.intensity;
    }
    assert.ok(previous < 0.01, 'Exterior views must end with no deck sun');
    assert.equal(rig.light.shadow.needsUpdate, false, 'Frozen shadow map when the deck sun is out');
  });

  it('repaints only when the sun moves in the deck frame', () => {
    const scene = new THREE.Scene();
    const rig = new CockpitSunShadow(scene);
    const base = {
      position: origin, sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3.5,
      cockpitActive: true, dt: 1 / 60, quaternion: identity,
    };
    rig.update({ ...base, sunDir: sunDirectionAt(30, 180) });
    rig.light.shadow.needsUpdate = false;
    rig.update({ ...base, sunDir: sunDirectionAt(30, 180) });
    assert.equal(rig.light.shadow.needsUpdate, false, 'The map drawn on entry stays frozen');

    rig.update({ ...base, sunDir: sunDirectionAt(30, 180.01) });
    assert.equal(rig.light.shadow.needsUpdate, false, 'A sub-arcminute sun move is below the redraw gate');

    rig.update({ ...base, sunDir: sunDirectionAt(30, 186) });
    assert.equal(rig.light.shadow.needsUpdate, true, 'A 6 degree turn of the sun must repaint');

    rig.light.shadow.needsUpdate = false;
    rig.update({ ...base, sunDir: sunDirectionAt(30, 186) });
    assert.equal(rig.light.shadow.needsUpdate, false, 'The map stays frozen once repainted');
  });

  it('retains pending caster changes through substeps until a render consumes them', () => {
    const rig = new CockpitSunShadow(new THREE.Scene());
    const state = { position: origin, quaternion: identity, sunDir: sunDirectionAt(30),
      sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3.5, cockpitActive: true, dt: 1 / 60 };
    rig.update({ ...state, casterState: 'loaded,neutral' });
    rig.light.shadow.needsUpdate = false;
    rig.update({ ...state, casterState: 'loaded,banked-yoke' });
    rig.update({ ...state, casterState: 'loaded,banked-yoke' });
    assert.equal(rig.light.shadow.needsUpdate, true);
    rig.light.shadow.needsUpdate = false;
    rig.update({ ...state, casterState: 'loaded,banked-yoke' });
    assert.equal(rig.light.shadow.needsUpdate, false);
    rig.update({ ...state, casterState: 'hidden-yoke' });
    assert.equal(rig.light.shadow.needsUpdate, true);
  });

  it('moves a frozen shadow projection with the aircraft without repainting', () => {
    const rig = new CockpitSunShadow(new THREE.Scene());
    const state = { position: origin, quaternion: identity, sunDir: sunDirectionAt(30),
      sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3.5, cockpitActive: true, dt: 1 };
    rig.update(state);
    rig.light.shadow.needsUpdate = false;
    const localPoint = new THREE.Vector3(0, 0.6, -12.5);
    const before = localPoint.clone().applyMatrix4(rig.light.shadow.matrix);
    const position = new THREE.Vector3(300, 900, -100);
    rig.update({ ...state, position });
    const after = localPoint.clone().add(position).applyMatrix4(rig.light.shadow.matrix);
    assert.ok(before.distanceTo(after) < 1e-6, 'Same deck point retains its shadow UV/depth');
    assert.equal(rig.light.shadow.needsUpdate, false);
  });
});

describe('Atmospheric weather gate (issue #90)', () => {
  it('dims with cloud cover and softens shadows without a mode switch', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);
    sky.setTimeOfDay(12, origin, origin);
    const clearSun = sky.sunLight.intensity;

    let previous = clearSun;
    for (const cover of [0.1, 0.25, 0.5, 0.75, 1]) {
      sky.setCloudCover(cover);
      sky.updateSun(origin, origin);
      assert.ok(sky.sunLight.intensity < previous, `Overcast ${cover} must reduce direct sun`);
      assert.ok(sky.sunLight.shadow.intensity < 1, 'Shadows must soften as cloud builds');
      assert.ok(sky.ambientLight.intensity > 1, 'Skylight must lift under overcast');
      assert.equal(sky.sunLight.shadow.intensity, sky.shadowSoftening,
        'Shadow darkening tracks the softening ramp');
      previous = sky.sunLight.intensity;
    }
    assert.ok(previous < clearSun * 0.2, 'Full overcast keeps little direct sun');

    sky.setCloudCover(-3);
    assert.equal(sky.cloudCover, 0);
    sky.setCloudCover(9);
    assert.equal(sky.cloudCover, 1);
  });

  it('hands the deck sun weather and time attenuation from the ambient sun', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);
    sky.setTimeOfDay(13, origin, origin);

    sky.setCloudCover(0);
    sky.updateSun(origin, origin);
    sky.updateCockpitSun({ position: origin, quaternion: identity, cockpitActive: true, dt: 1 });
    const clearDeck = sky.cockpitSun.light.intensity;

    sky.setCloudCover(1);
    sky.updateSun(origin, origin);
    sky.updateCockpitSun({ position: origin, quaternion: identity, cockpitActive: true, dt: 1 });
    const overcastDeck = sky.cockpitSun.light.intensity;
    assert.ok(overcastDeck > 0, 'Overcast day still lights the deck');
    assert.ok(overcastDeck < clearDeck * 0.5, `Deck sun must fade with weather, got ${overcastDeck} vs ${clearDeck}`);
    assert.ok(sky.cockpitSun.daylight > 0, 'Daylight factor exposed for the instrument floods');
    assert.equal(sky.cockpitSun.light.shadow.intensity, sky.shadowSoftening,
      'Deck shadows soften with the rest of the scene');

    sky.setTimeOfDay(23, origin, origin);
    sky.updateCockpitSun({ position: origin, quaternion: identity, cockpitActive: true, dt: 1 });
    assert.ok(sky.cockpitSun.light.intensity < 0.3, 'Night leaves the deck to its floods');
    assert.ok(sky.cockpitSun.daylight < 0.1);
  });

  it('never exceeds the sun the airframe itself is lit by', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);
    for (const hour of [6.5, 9, 12.5, 16.8, 19.5, 21]) {
      sky.setTimeOfDay(hour, origin, origin);
      for (const heading of [0, 90, 180, 270]) {
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, THREE.MathUtils.degToRad(heading), 0)
        );
        sky.updateCockpitSun({ position: origin, quaternion, cockpitActive: true, dt: 1 });
        assert.ok(sky.cockpitSun.light.intensity <= sky.sunLight.intensity * COCKPIT_SUN_GAIN + 1e-9,
          `hour ${hour} heading ${heading}: deck sun ${sky.cockpitSun.light.intensity} over ambient ${sky.sunLight.intensity}`);
        assert.ok(sky.cockpitSun.daylight <= 1);
      }
    }
    assert.ok(COCKPIT_DAYLIGHT_REFERENCE > 0);
  });
});
