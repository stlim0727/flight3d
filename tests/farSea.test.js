import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EARTH_RADIUS_M, HAZE_HEIGHT_FALLOFF, erfcx, horizonDrop, seaDistance, seaReach, strikesSea,
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
  assert.ok(fragmentShader.includes('oceanFarColor( direction, grazing2, vSunDirection, uSunColor, uHazeColor, uDeepColor, uShallowColor )'));
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
  assert.ok(fragmentShader.includes('float rim = smoothstep(uEdgeFadeStart, uEdgeFadeEnd, length(vLocalPos));'));
  assert.ok(fragmentShader.includes('oceanFarColor(-viewDir, grazing2, lightDir, uSunColor, uFogColor, uDeepColor, uShallowColor)'));
  assert.ok(fragmentShader.includes('uBaseFogDensity * aerialSeaReach(eyeY, -viewDir.y, grazing2)'));
  assert.ok(fragmentShader.includes('float eyeY = max(cameraPosition.y, 0.5);'));
  assert.ok(fragmentShader.includes('if (length(vLocalPos) > uEdgeFadeEnd) discard;'), 'the sky pass owns everything past the rim');
  assert.ok(!fragmentShader.includes('edgeFade'));
});
