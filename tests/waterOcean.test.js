import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterOcean } from '../src/environment/WaterOcean.js';

test('WaterOcean (Camera Anchoring, Grid Snapping & Gerstner Waves)', async (t) => {
  await t.test('initializes geometry, uniforms and grid snapping step correctly', () => {
    const ocean = new WaterOcean(36000, 180);

    assert.equal(ocean.size, 36000, 'Ocean size should be 36,000m');
    assert.equal(ocean.segments, 180, 'Ocean segments should be 180');
    assert.equal(ocean.snapStep, 200, 'Snap step should be 200m (36000 / 180)');
    assert.equal(ocean.waterLevel, 0.0, 'Default water level should be 0.0m');
    assert.ok(ocean.mesh instanceof THREE.Mesh, 'Ocean mesh should be an instance of THREE.Mesh');

    const uniforms = ocean.material.uniforms;
    assert.ok(uniforms.uEdgeFadeStart, 'uEdgeFadeStart uniform must exist');
    assert.ok(uniforms.uEdgeFadeEnd, 'uEdgeFadeEnd uniform must exist');

    // 70% and 95% of half-size (18,000m)
    assert.equal(uniforms.uEdgeFadeStart.value, 18000 * 0.70, 'uEdgeFadeStart should be 12,600m');
    assert.equal(uniforms.uEdgeFadeEnd.value, 18000 * 0.95, 'uEdgeFadeEnd should be 17,100m');
  });

  await t.test('anchors mesh position to camera focusPos snapped to grid lattice', () => {
    const ocean = new WaterOcean(36000, 180);
    assert.equal(ocean.mesh.position.x, 0);
    assert.equal(ocean.mesh.position.z, 0);

    // Minor displacement below half-step should snap to 0
    ocean.update(0.016, new THREE.Vector3(80, 500, 95));
    assert.equal(ocean.mesh.position.x, 0, 'Small offset (80m) should snap to 0m');
    assert.equal(ocean.mesh.position.z, 0, 'Small offset (95m) should snap to 0m');

    // Displacement crossing 100m (half of 200m step) snaps to nearest 200m lattice
    ocean.update(0.016, new THREE.Vector3(120, 500, 310));
    assert.equal(ocean.mesh.position.x, 200, '120m should snap to 200m');
    assert.equal(ocean.mesh.position.z, 400, '310m should snap to 400m');

    // Far offshore flight position (e.g. 25km south, 10km east)
    ocean.update(0.016, new THREE.Vector3(10430, 2000, 24890));
    assert.equal(ocean.mesh.position.x, 10400, '10,430m should snap to 10,400m');
    assert.equal(ocean.mesh.position.z, 24800, '24,890m should snap to 24,800m');
    assert.equal(ocean.mesh.position.y, 0.0, 'Water level Y should remain fixed at 0.0m');

    ocean.update(0.016, new THREE.Vector3(10430, 2000, 24950));
    assert.equal(ocean.mesh.position.z, 25000, '24,950m should snap to 25,000m');

    // When focusPos is null/omitted, mesh position remains unchanged
    ocean.update(0.016);
    assert.equal(ocean.mesh.position.x, 10400);
    assert.equal(ocean.mesh.position.z, 25000);
  });

  await t.test('analytical wave height query is globally invariant to mesh translation', () => {
    const ocean = new WaterOcean(36000, 180);

    const testX = 1500;
    const testZ = 4500;
    const testTime = 12.5;

    // Sample wave height at static origin
    const hInitial = ocean.getWaveHeight(testX, testZ, testTime);

    // Move ocean mesh 30km away
    ocean.update(0.0, new THREE.Vector3(30000, 1000, 30000));
    const hMoved = ocean.getWaveHeight(testX, testZ, testTime);

    assert.equal(hInitial, hMoved, 'getWaveHeight must be invariant to mesh position');
    assert.ok(hInitial >= -1.5 && hInitial <= 1.5, `Wave height ${hInitial} should be within realistic ocean bounds`);
  });

  await t.test('shader code embeds world coordinate evaluation and local edge fade', () => {
    const ocean = new WaterOcean(36000, 180);

    const vs = ocean.material.vertexShader;
    assert.ok(vs.includes('vLocalPos = pos.xz;'), 'Vertex shader must export local mesh position');
    assert.ok(vs.includes('modelMatrix * vec4(pos, 1.0)'), 'Vertex shader must compute baseWorldPos from modelMatrix');
    assert.ok(vs.includes('worldXZ'), 'Vertex shader must sample Gerstner waves in global worldXZ coordinates');

    const fs = ocean.material.fragmentShader;
    assert.ok(fs.includes('uEdgeFadeStart'), 'Fragment shader must declare uEdgeFadeStart uniform');
    assert.ok(fs.includes('uEdgeFadeEnd'), 'Fragment shader must declare uEdgeFadeEnd uniform');
    assert.ok(fs.includes('max(abs(vLocalPos.x), abs(vLocalPos.y))'), 'Fragment shader must compute edgeDist from vLocalPos');
  });

  await t.test('ultraLow quality switches to single quad mesh, keeps decoupled snapStep and sets WATER_FLAT define', () => {
    const ocean = new WaterOcean(36000, 180);
    assert.equal(ocean.segments, 180);
    assert.equal(ocean.snapStep, 200);
    assert.equal(ocean.material.defines?.WATER_FLAT, 0);

    ocean.setQuality('ultraLow');
    assert.equal(ocean.segments, 1);
    assert.equal(ocean.snapStep, 200, 'snapStep must remain 200m even in ultraLow single-quad mode');
    assert.equal(ocean.material.defines.WATER_FLAT, 1);
    assert.equal(ocean.geometry.attributes.position.count, 4);

    ocean.setQuality('high');
    assert.equal(ocean.segments, 180);
    assert.equal(ocean.snapStep, 200);
    assert.equal(ocean.material.defines.WATER_FLAT, 0);

    const directUltraLow = new WaterOcean(36000, 1, { quality: 'ultraLow' });
    assert.equal(directUltraLow.segments, 1);
    assert.equal(directUltraLow.snapStep, 200, 'snapStep must be 200m when constructed directly with ultraLow');
  });
});
