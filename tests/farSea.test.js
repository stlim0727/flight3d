import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EARTH_RADIUS_M, HAZE_HEIGHT_FALLOFF, erfcx, horizonDrop, meanDensityRatio, seaDistance, seaReach, strikesSea,
} from '../src/environment/AerialPerspective.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';

const density = y => Math.exp(-HAZE_HEIGHT_FALLOFF * Math.max(y, 0));
const fogFactor = reach => 1 - Math.exp(-reach * reach);
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.abs(expected),
  `${label}: ${actual} vs ${expected}`);

test('erfcx stays within 0.4% of exp(x^2) erfc(x)', () => {
  // 2/sqrt(pi) * integral of exp(-t^2 - 2xt) over t >= 0.
  const reference = x => {
    const steps = 40000, span = 12, step = span / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) { const t = (i + 0.5) * step; sum += Math.exp(-t * t - 2 * x * t); }
    return 2 / Math.sqrt(Math.PI) * sum * step;
  };
  for (const x of [0, 0.1, 0.5, 1, 1.75, 3, 8, 20, 46, 60]) close(erfcx(x), reference(x), 0.004, `erfcx(${x})`);
});

test('horizon dips and recedes with altitude as on a 6,371 km sphere', () => {
  for (const [eyeY, dipDeg, distanceKm] of [[300, 0.556, 61.8], [1000, 1.015, 112.9], [3000, 1.758, 195.5], [10000, 3.21, 357]]) {
    const dip = Math.asin(Math.sqrt(horizonDrop(eyeY)));
    close(THREE.MathUtils.radToDeg(dip), dipDeg, 0.005, `dip at ${eyeY} m`);
    assert.equal(strikesSea(eyeY, -Math.sin(dip) * 1.001), true);
    assert.equal(strikesSea(eyeY, -Math.sin(dip) * 0.999), false);
    close(seaDistance(eyeY, -Math.sin(dip) * 1.0000001) / 1000, distanceKm, 0.01, `horizon distance at ${eyeY} m`);
  }
  close(seaDistance(2500, -1), 2500, 1e-3, 'straight down is the altitude');
});

test('haze crossed on the way to the sea matches a march over the sphere', () => {
  // Marched over the true sphere rather than the parabola the closed form assumes.
  const marched = (eyeY, dy, length, steps = 200000) => {
    const dx = Math.sqrt(1 - dy * dy), step = length / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * step;
      sum += density(Math.hypot(dx * t, EARTH_RADIUS_M + eyeY + dy * t) - EARTH_RADIUS_M);
    }
    return sum * step;
  };
  for (const eyeY of [2, 300, 3000, 10000]) {
    const grazing = Math.sqrt(horizonDrop(eyeY));
    for (const dy of [-1, -0.5, -0.1, -grazing * 3, -grazing * 1.2]) {
      close(seaReach(eyeY, dy), marched(eyeY, dy, seaDistance(eyeY, dy)), 0.03, `eye ${eyeY} dy ${dy}`);
    }
  }
});

test('the tuned haze hides the sea horizon from the air but not from a beach', () => {
  const seaLevel = 0.0002;
  for (const eyeY of [300, 3000, 10000]) {
    const grazing = Math.sqrt(horizonDrop(eyeY));
    assert.ok(fogFactor(seaLevel * seaReach(eyeY, -grazing * 1.01)) > 0.99, `sea at the horizon from ${eyeY} m`);
  }
  // From 2 m the horizon is 5 km off, nearer than the visibility, and stays a line.
  assert.ok(fogFactor(seaLevel * seaReach(2, -Math.sqrt(horizonDrop(2)) * 1.01)) < 0.8);
});

test('atmosphere hands the sky pass the haze, the sea colours and where the sea mesh ends', () => {
  const water = new WaterOcean(36000, 8);
  const sky = new SkyAtmosphere(new THREE.Scene(), null, water);
  const eye = new THREE.Vector3(0, 1000, 0);
  sky.setTimeOfDay(12, eye, eye);
  const uniforms = sky.sky.material.uniforms;
  assert.equal(uniforms.uHazeDensity.value, sky.baseDensity, 'sea-level density, not the density at the eye');
  assert.ok(uniforms.uHazeColor.value.equals(sky.fogColor));
  assert.ok(uniforms.uSunColor.value.equals(sky.sunLight.color));
  assert.equal(uniforms.uSeaRim.value, water.material.uniforms.uEdgeFadeEnd.value);
  assert.ok(uniforms.uDeepColor.value.equals(water.material.uniforms.uDeepColor.value));
  assert.equal(uniforms.uSeaBelow.value, 1);
});

test('inland regions, which hide the sea mesh, get land beyond their terrain', () => {
  const water = new WaterOcean(36000, 8);
  const sky = new SkyAtmosphere(new THREE.Scene(), null, water);
  water.mesh.visible = false;
  sky.updateSun();
  assert.equal(sky.sky.material.uniforms.uSeaBelow.value, 0);
  water.mesh.visible = true;
  sky.updateSun();
  assert.equal(sky.sky.material.uniforms.uSeaBelow.value, 1);
});

// One sight line through the mesh rim must be painted identically by both passes, which
// holds only while they evaluate the same functions of the same inputs.
test('sky pass draws the far sea below the horizon and leaves the sky above it alone', () => {
  const { fragmentShader } = new SkyAtmosphere(new THREE.Scene()).sky.material;
  assert.ok(fragmentShader.includes('vec3 oceanFarColor('));
  assert.ok(fragmentShader.includes('oceanFarColor( direction, grazing2, vSunDirection, uSunColor, uHazeColor, uDeepColor, uShallowColor, uRoughness, uDaylightScale )'));
  assert.ok(fragmentShader.includes('uHazeDensity * aerialSeaReach( eyeY, direction.y, grazing2 )'));
  assert.ok(fragmentShader.includes('float eyeY = max( cameraPosition.y, 0.5 );'));
  assert.ok(fragmentShader.includes('surface.rgb = toneMapping( surface.rgb );'), 'the far surface is tone mapped as the sea mesh is');
  // The haze colour starts as the meshes' exactly where the sea mesh ends.
  assert.ok(fragmentShader.includes('mix( hazeColor, gl_FragColor.rgb,'));
  assert.ok(fragmentShader.includes('smoothstep( rimDistance, max( horizonDistance, rimDistance + 1.0 ), seaDistance )'));
  const composite = fragmentShader.indexOf('if ( sea > 0.0 )');
  assert.ok(fragmentShader.indexOf('#include <colorspace_fragment>') < composite, 'haze goes on in display space, as three fog does');
  assert.equal(fragmentShader.slice(composite).split('gl_FragColor.rgb = mix(').length, 2, 'nothing but the far surface is composited');
  assert.equal(fragmentShader.split('float aerialSeaReach(').length, 2, 'haze functions are defined once');
});

test('sea mesh becomes that same far sea at its rim and paints no fog-coloured ring', () => {
  const ocean = new WaterOcean(36000, 8);
  const { fragmentShader } = ocean.material;
  assert.ok(fragmentShader.includes('float rim = strikes * smoothstep(uEdgeFadeStart, uEdgeFadeEnd, length(vLocalPos));'));
  // The blend is gated on the unclamped discriminant, with the sky pass's one-pixel edge,
  // and the derivative is taken outside the branch that uses it.
  assert.ok(fragmentShader.includes('float grazing2 = viewDir.y * viewDir.y - 2.0 * eyeY / AERIAL_EARTH_RADIUS;'));
  assert.ok(fragmentShader.includes('float strikes = viewDir.y > 0.0 ? clamp(grazing2 / max(fwidth(grazing2), 1e-12), 0.0, 1.0) : 0.0;'));
  assert.ok(fragmentShader.indexOf('fwidth(grazing2)') < fragmentShader.indexOf('if (rim > 0.0) {'));
  assert.ok(fragmentShader.includes('oceanFarColor(-viewDir, grazing2, lightDir, uSunColor, uFogColor, uDeepColor, uShallowColor, uRoughness, uDaylightScale)'));
  assert.ok(fragmentShader.includes('uBaseFogDensity * aerialSeaReach(eyeY, -viewDir.y, grazing2)'));
  assert.ok(fragmentShader.includes('float eyeY = max(cameraPosition.y, 0.5);'));
  assert.ok(fragmentShader.includes('if (length(vLocalPos) > uEdgeFadeEnd) discard;'), 'the sky pass owns everything past the rim');
  assert.ok(!fragmentShader.includes('edgeFade'));
});

// The sea mesh is flat and ends 17.1 km out; the far sea lies on a sphere. Review of #777:
// from 2 m the rim band's sight lines pass over the sphere's horizon (5 km off), and
// feeding them to the far-sea integral cleared the haze from 99% to 3% along the rim.
test('the rim blend never thins the haze the sea mesh already has', () => {
  const seaLevel = 0.00018; // noon
  const band = [12600, 13500, 15000, 16000, 17100];
  const own = (eyeY, d) => {
    const slant = Math.hypot(d, eyeY);
    return fogFactor(seaLevel * density(eyeY) * slant * meanDensityRatio(eyeY, 0));
  };

  // Low down no line through the band strikes the sphere, so the mesh keeps its own fog.
  for (const eyeY of [2, 10, 30, 49]) {
    for (const d of band) assert.equal(strikesSea(eyeY, -eyeY / Math.hypot(d, eyeY)), false, `eye ${eyeY} m, ${d} m`);
  }
  // That fog only thickens with distance. What the unguarded blend produced at 2 m did not.
  for (const eyeY of [2, 10]) {
    for (let i = 1; i < band.length; i++) assert.ok(own(eyeY, band[i]) >= own(eyeY, band[i - 1]));
    const slant = Math.hypot(17100, eyeY);
    assert.ok(fogFactor(seaLevel * seaReach(eyeY, -eyeY / slant)) < 0.5 && own(eyeY, 17100) > 0.99,
      'the integral is not valid for a line that misses the sphere');
  }

  // Where a line does strike, the sphere's sea is farther along it than the flat mesh,
  // so the far sea is at least as hazed and the blend can only thicken.
  let blended = 0;
  for (const eyeY of [50, 70, 92, 150, 300, 1000, 3000, 10000]) {
    for (const d of band) {
      const dy = -eyeY / Math.hypot(d, eyeY);
      if (!strikesSea(eyeY, dy)) continue;
      blended++;
      assert.ok(fogFactor(seaLevel * seaReach(eyeY, dy)) >= own(eyeY, d) - 1e-3, `eye ${eyeY} m, ${d} m`);
    }
  }
  assert.ok(blended >= 25);
  // The whole band strikes from 92 m up, none of it below 50 m.
  assert.equal(strikesSea(92, -92 / Math.hypot(17100, 92)), true);
  assert.equal(strikesSea(91, -91 / Math.hypot(17100, 91)), false);
});
