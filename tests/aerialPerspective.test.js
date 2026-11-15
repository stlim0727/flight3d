import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  AERIAL_GLSL, DEFAULT_VISIBILITY_M, EARTH_RADIUS_M, HAZE_HEIGHT_FALLOFF, VISIBILITY_REACH,
  densityForVisibility, erfcx, fogFactor, horizonDrop, installHeightFog, meanDensityRatio,
  seaDistance, seaReach, skyReach, strikesSea,
} from '../src/environment/AerialPerspective.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';
import { Terrain } from '../src/environment/Terrain.js';

const density = y => Math.exp(-HAZE_HEIGHT_FALLOFF * Math.max(y, 0));
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.abs(expected),
  `${label}: ${actual} vs ${expected}`);

// Reach per unit sea-level density, marched over the true sphere rather than the parabola
// the closed forms assume.
function marchedReach(eyeY, dy, length, steps = 200000) {
  const dx = Math.sqrt(1 - dy * dy);
  const step = length / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * step;
    sum += density(Math.hypot(dx * t, EARTH_RADIUS_M + eyeY + dy * t) - EARTH_RADIUS_M);
  }
  return sum * step;
}

test('visibility is the distance at which contrast falls to 2%', () => {
  const reach = densityForVisibility(DEFAULT_VISIBILITY_M) * DEFAULT_VISIBILITY_M;
  assert.equal(reach, VISIBILITY_REACH);
  close(1 - fogFactor(reach), 0.02, 1e-9, 'contrast at the visibility distance');
});

test('mean density along a flat sight line matches the integral in both directions', () => {
  for (const [eye, point] of [[0, 0], [30, 30.5], [3000, 0], [0, 3000], [1828, 400], [12000, 0], [-5, -20]]) {
    const steps = 20000;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += density(eye + (point - eye) * (i + 0.5) / steps);
    close(meanDensityRatio(eye, point) * density(eye), sum / steps, 1e-6, `eye ${eye} point ${point}`);
  }
  assert.ok(Number.isFinite(meanDensityRatio(400000, 0)), 'an eye far above the haze stays finite');
});

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

test('reach to the sea matches a march over the sphere', () => {
  for (const eyeY of [2, 300, 3000, 10000]) {
    const grazing = Math.sqrt(horizonDrop(eyeY));
    for (const dy of [-1, -0.5, -0.1, -grazing * 3, -grazing * 1.2]) {
      const marched = marchedReach(eyeY, dy, seaDistance(eyeY, dy));
      close(seaReach(eyeY, dy), marched, 0.03, `eye ${eyeY} dy ${dy}`);
    }
  }
});

test('reach of a sky line matches a march over the sphere, above and below eye level', () => {
  for (const eyeY of [0, 300, 3000, 10000]) {
    const grazing = Math.sqrt(horizonDrop(eyeY));
    for (const dy of [1, 0.5, 0.1, 0.01, 0, -grazing * 0.5, -grazing * 0.9]) {
      close(skyReach(eyeY, dy), marchedReach(eyeY, dy, 1.2e6), 0.02, `eye ${eyeY} dy ${dy}`);
    }
  }
  close(skyReach(0, 1), 1 / HAZE_HEIGHT_FALLOFF, 0.004, 'zenith column from sea level');
});

test('at the default visibility haze hides the sea horizon from the air but not from a beach', () => {
  const sea = densityForVisibility(DEFAULT_VISIBILITY_M);
  for (const eyeY of [300, 3000, 10000]) {
    const grazing = Math.sqrt(horizonDrop(eyeY));
    assert.ok(fogFactor(sea * seaReach(eyeY, -grazing * 1.01)) > 0.99, `sea at the horizon from ${eyeY} m`);
  }
  // From 2 m the horizon is 5 km off, nearer than the visibility, and stays a line.
  assert.ok(fogFactor(sea * seaReach(2, -Math.sqrt(horizonDrop(2)) * 1.01)) < 0.8);
});

test('fog veils the sky from the horizon upward and thins with altitude', () => {
  const fog = densityForVisibility(1000) - densityForVisibility(DEFAULT_VISIBILITY_M);
  assert.ok(fogFactor(fog * skyReach(0, 0.05)) > 0.99, 'low sky in 1 km fog');
  assert.ok(fogFactor(fog * skyReach(0, 1)) > 0.9, 'zenith in 1 km fog');
  assert.ok(fogFactor(fog * skyReach(6000, 1)) < 0.01, 'zenith from above the fog');
  for (const dy of [0.02, 0.1, 0.5]) {
    assert.ok(skyReach(0, dy) > skyReach(0, dy * 2), 'reach falls as the line steepens');
    assert.ok(skyReach(0, dy) > skyReach(2000, dy), 'reach falls as the eye climbs');
  }
});

test('fog chunks integrate the sight line and leave linear fog usable', () => {
  installHeightFog();
  installHeightFog(); // idempotent
  const { fog_vertex, fog_pars_vertex, fog_fragment, fog_pars_fragment } = THREE.ShaderChunk;
  assert.match(fog_vertex, /vFogOffset = transpose\( mat3\( viewMatrix \) \) \* mvPosition\.xyz;/);
  assert.match(fog_pars_vertex, /varying vec3 vFogOffset;/);
  assert.match(fog_pars_fragment, /aerialMeanDensityRatio/);
  assert.match(fog_fragment, /aerialMeanDensityRatio\( cameraPosition\.y, cameraPosition\.y \+ vFogOffset\.y \)/);
  assert.match(fog_fragment, /smoothstep\( fogNear, fogFar, length\( vFogOffset \) \)/);
  for (const chunk of [fog_vertex, fog_pars_vertex, fog_fragment, fog_pars_fragment]) {
    assert.doesNotMatch(chunk, /vFogDepth/);
  }
  assert.match(AERIAL_GLSL, /const float AERIAL_FALLOFF = 0\.000680000000;/);
  assert.match(AERIAL_GLSL, /const float AERIAL_EARTH_RADIUS = 6371000\.00;/);
});

test('visibility scales haze density everywhere and reaches the sky pass', () => {
  const scene = new THREE.Scene();
  const water = new WaterOcean(36000, 8);
  const sky = new SkyAtmosphere(scene, null, water);
  const eye = new THREE.Vector3(0, 1000, 0);
  sky.setTimeOfDay(12, eye, eye);
  const reference = { base: sky.baseDensity, current: sky.currentDensity };
  assert.equal(sky.visibilityM, DEFAULT_VISIBILITY_M);
  const uniforms = sky.sky.material.uniforms;
  assert.equal(uniforms.uHazeDensity.value, sky.baseDensity);
  assert.ok(uniforms.uHazeColor.value.equals(sky.fogColor));
  assert.equal(uniforms.uSeaBelow.value, 1);
  assert.equal(uniforms.uSeaRim.value, Math.hypot(18000, 18000), 'the haze colour holds out to the sea mesh corners');
  assert.equal(uniforms.uSkyHazeDensity.value, 0, 'the tuned atmosphere leaves the sky model as it is');

  sky.setVisibility(2000);
  sky.updateSun(eye, eye);
  close(sky.baseDensity, reference.base * 5, 1e-12, 'base density at a fifth of the visibility');
  close(scene.fog.density, reference.current * 5, 1e-12, 'scene fog density');
  assert.equal(water.material.uniforms.uBaseFogDensity.value, sky.baseDensity);
  assert.equal(uniforms.uHazeDensity.value, sky.baseDensity);
  close(uniforms.uSkyHazeDensity.value, reference.base * 4, 1e-12, 'only the haze beyond the tuned atmosphere veils the sky');

  sky.setVisibility(50000);
  sky.updateSun(eye, eye);
  close(sky.baseDensity, reference.base / 5, 1e-12, 'clear air thins the haze');
  assert.equal(uniforms.uSkyHazeDensity.value, 0, 'clear air does not alter the sky model');

  sky.setVisibility(DEFAULT_VISIBILITY_M);
  sky.updateSun(eye, eye);
  assert.equal(sky.baseDensity, reference.base, 'restoring visibility restores the tuned haze');

  assert.throws(() => sky.setVisibility(0), RangeError);
  assert.throws(() => sky.setVisibility(NaN), RangeError);
  sky.setVisibility(1);
  assert.equal(sky.visibilityM, 50);
  sky.setVisibility(1e9);
  assert.equal(sky.visibilityM, 300000);
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

// One sight line through the mesh rim must be painted identically by both passes in any
// weather, which holds only while they evaluate the same function of the same inputs.
test('sky pass draws the far sea below the horizon and keeps the tuned sky above it', () => {
  const { fragmentShader } = new SkyAtmosphere(new THREE.Scene()).sky.material;
  assert.ok(fragmentShader.includes('vec3 oceanFarColor('));
  assert.ok(fragmentShader.includes('oceanFarColor( direction, grazing2, vSunDirection, uSunColor, uHazeColor, uDeepColor, uShallowColor )'));
  assert.ok(fragmentShader.includes('uHazeDensity * aerialSeaReach( eyeY, direction.y, grazing2 )'));
  assert.ok(fragmentShader.includes('float eyeY = max( cameraPosition.y, 0.5 );'));
  assert.ok(fragmentShader.includes('uSkyHazeDensity * aerialSkyReach( eyeY, direction.y )'));
  // The haze colour starts as the meshes' exactly where the sea mesh ends.
  assert.ok(fragmentShader.includes('mix( hazeColor, gl_FragColor.rgb,'));
  assert.ok(fragmentShader.includes('smoothstep( rimDistance, max( horizonDistance, rimDistance + 1.0 ), seaDistance )'));
  assert.ok(fragmentShader.includes('surface.rgb = toneMapping( surface.rgb );'), 'the far surface is tone mapped as the sea mesh is');
  assert.ok(fragmentShader.indexOf('#include <colorspace_fragment>') < fragmentShader.indexOf('vec3 hazeColor = linearToOutputTexel( vec4( uHazeColor, 1.0 ) ).rgb;'),
    'haze goes on in display space, as three fog does on the meshes');
  assert.equal(fragmentShader.split('float aerialSeaReach(').length, 2, 'haze functions are defined once');
});

test('sea mesh becomes that same far sea on a circle inside its square and paints no fog rim', () => {
  const ocean = new WaterOcean(36000, 8);
  const { fragmentShader } = ocean.material;
  assert.ok(fragmentShader.includes('float rim = smoothstep(uEdgeFadeStart, uEdgeFadeEnd, length(vLocalPos));'));
  assert.ok(fragmentShader.includes('oceanFarColor(-viewDir, grazing2, lightDir, uSunColor, uFogColor, uDeepColor, uShallowColor)'));
  assert.ok(fragmentShader.includes('uBaseFogDensity * aerialSeaReach(eyeY, -viewDir.y, grazing2)'));
  assert.ok(fragmentShader.indexOf('#include <colorspace_fragment>') < fragmentShader.indexOf('linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, fogFactor)'),
    'haze goes on in display space, as three fog does on the land');
  assert.ok(!fragmentShader.includes('finalColor = mix(finalColor, uFogColor, fogFactor)'));
  assert.ok(fragmentShader.includes('float eyeY = max(cameraPosition.y, 0.5);'));
  assert.ok(!fragmentShader.includes('max(abs(vLocalPos.x), abs(vLocalPos.y))'));
  assert.ok(!fragmentShader.includes('edgeFade'));
  assert.ok(ocean.material.uniforms.uEdgeFadeEnd.value < ocean.size / 2, 'the blend completes inside the square mesh');
});

test('terrain paints no perimeter fade and draws its submerged perimeter below the sea depth bias', () => {
  const terrain = new Terrain(22000, 64);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  terrain.material.onBeforeCompile(shader);
  assert.doesNotMatch(shader.fragmentShader, /tEdge|tFade/);

  const position = terrain.geometry.attributes.position;
  let checkedLand = 0;
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const height = terrain.getHeight(x, z);
    if (edge >= 10800) assert.equal(y, -60, 'outermost seabed sits at the drawn perimeter depth');
    else if (height >= 0 || edge <= 10400) { assert.equal(y, Math.fround(height)); checkedLand++; }
    else assert.ok(y <= Math.fround(height), 'submerged perimeter is only ever drawn deeper');
  }
  assert.ok(checkedLand > 3000);
  assert.equal(terrain.getHeight(10800, 0), -18, 'physics seabed is unchanged');
});
