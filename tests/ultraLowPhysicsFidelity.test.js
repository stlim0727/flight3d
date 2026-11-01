import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RENDER_QUALITY, resolveRenderQuality } from '../src/config/renderQuality.js';
import { Terrain } from '../src/environment/Terrain.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { FoliageAndCities } from '../src/environment/FoliageAndCities.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { stepPhysics, advancePhysicsFrame } from '../src/core/physicsTiming.js';
import { SIM_CONFIG } from '../src/config/simConfig.js';
import { RenderPose } from '../src/core/RenderPose.js';

test('Ultra-Low-Spec Mode Configuration & Resolution', () => {
  assert.equal(resolveRenderQuality('ultraLow'), 'ultraLow');
  const preset = RENDER_QUALITY.ultraLow;
  assert.ok(preset, 'ultraLow preset must be defined');
  assert.equal(preset.terrain, 'ultraLow');
  assert.equal(preset.maxDpr, 0.75);
  assert.equal(preset.shadowMapSize, 0);
  assert.equal(preset.shadows, false);
  assert.equal(preset.ao, false);
  assert.equal(preset.clouds, false);
  assert.equal(preset.terrainSegments, 64);
  assert.equal(preset.waterSegments, 1);
});

test('Physics Invariance: Terrain.getHeight and getTerrainNormal are identical between high and ultraLow', () => {
  const terrainHigh = new Terrain(20000, 256, { quality: 'high' });
  const terrainUltra = new Terrain(20000, 64, { quality: 'ultraLow' });

  // Verify visual geometry polygon counts differ dramatically
  const highTriangles = terrainHigh.geometry.attributes.position.count;
  const ultraTriangles = terrainUltra.geometry.attributes.position.count;
  assert.equal(highTriangles, 257 * 257);
  assert.equal(ultraTriangles, 65 * 65);
  assert.ok(ultraTriangles < highTriangles * 0.1, 'ultraLow has less than 10% the vertices of high');

  // Verify mathematical elevation is bit-for-bit identical across 100 sample coordinates
  const samples = [
    [0, 0], [100, -200], [-1500, 300], [2500, 1400], [-800, -2800],
    [5000, -4000], [-7000, 6000], [8000, 8000], [-9000, -9000], [1200, 0]
  ];

  for (let i = 0; i < 90; i++) {
    const x = ((i * 197) % 18000) - 9000;
    const z = ((i * 389) % 18000) - 9000;
    samples.push([x, z]);
  }

  for (const [x, z] of samples) {
    const hHigh = terrainHigh.getHeight(x, z);
    const hUltra = terrainUltra.getHeight(x, z);
    assert.strictEqual(hHigh, hUltra, `getHeight(${x}, ${z}) must be strictly identical`);

    const nHigh = terrainHigh.getTerrainNormal(x, z);
    const nUltra = terrainUltra.getTerrainNormal(x, z);
    assert.strictEqual(nHigh.x, nUltra.x, `Normal X at (${x}, ${z}) must be strictly identical`);
    assert.strictEqual(nHigh.y, nUltra.y, `Normal Y at (${x}, ${z}) must be strictly identical`);
    assert.strictEqual(nHigh.z, nUltra.z, `Normal Z at (${x}, ${z}) must be strictly identical`);
  }
});

test('Physics Invariance: WaterOcean wave height query is identical across qualities', () => {
  const oceanHigh = new WaterOcean(36000, 180, { quality: 'high' });
  const oceanUltra = new WaterOcean(36000, 1, { quality: 'ultraLow' });

  assert.equal(oceanHigh.segments, 180);
  assert.equal(oceanUltra.segments, 1);
  assert.equal(oceanUltra.geometry.attributes.position.count, 4, 'ultraLow ocean has only 4 vertices (1 quad = 2 triangles)');

  for (let t = 0; t < 10; t += 0.5) {
    for (let x = -5000; x <= 5000; x += 2500) {
      for (let z = -5000; z <= 5000; z += 2500) {
        assert.strictEqual(
          oceanHigh.getWaveHeight(x, z, t),
          oceanUltra.getWaveHeight(x, z, t),
          `Wave elevation at (${x}, ${z}, ${t}) must be bit-for-bit identical`
        );
      }
    }
  }
});

test('Physics Invariance: Deterministic 1000-substep flight physics simulation matches bit-for-bit', () => {
  function createMockSim(quality) {
    const terrain = new Terrain(20000, quality === 'ultraLow' ? 64 : 256, { quality });
    const aero = new Aerodynamics();
    const engines = new EngineModel();
    const gear = new LandingGear();
    const group = new THREE.Group();
    const position = new THREE.Vector3(0, 1500, 0); // 1,500m cruise altitude
    const linearVelocity = new THREE.Vector3(0, 0, -120); // 120 m/s forward speed
    const quaternion = new THREE.Quaternion();
    const angularVelocity = new THREE.Vector3();
    const renderPose = new RenderPose(position, quaternion);

    const controls = {
      elevator: 0.05, // Slight pitch up
      aileron: 0.02,  // Slight roll right
      rudder: 0.0,
      pitchTrim: 0.0,
      throttle: 0.85,
      brakes: 0.0,
      update() {}
    };

    const telemetry = {
      iasKnots: 230,
      mach: 0.4
    };

    return {
      renderQuality: quality,
      currentTerrain: terrain,
      aero,
      engines,
      gear,
      aircraft: { group, update() {} },
      position,
      linearVelocity,
      quaternion,
      angularVelocity,
      renderPose,
      controls,
      telemetry,
      physicsDt: 1 / 120,
      physicsAccumulator: 0,
      isCrashed: false,
      gameFlow: { state: 'flight', isPhysicsFrozen: () => false },
      integratePhysics(dt) {
        // Run full continuous 6-DOF physics equation
        engines.setThrottle(controls.throttle);
        const engineData = engines.update(dt, position.y, linearVelocity.length(), 1.0);
        const groundH = terrain.getHeight(position.x, position.z);
        const heightAboveGround = position.y - groundH;

        const gearResult = gear.update(
          dt,
          group,
          linearVelocity,
          angularVelocity,
          (x, z) => terrain.getHeight(x, z),
          (x, z) => terrain.getTerrainNormal(x, z),
          () => false,
          aero.cg,
          true
        );

        aero.elevator = controls.elevator;
        aero.aileron = controls.aileron;
        aero.rudder = controls.rudder;

        const aeroResult = aero.computeAero(
          dt,
          group,
          linearVelocity,
          angularVelocity,
          position.y,
          heightAboveGround,
          engineData.totalThrust,
          gearResult.gearState,
          undefined,
          true
        );

        // Integrate forces F = m * a
        const thrust = new THREE.Vector3(0, 0, -engineData.totalThrust).applyQuaternion(quaternion);
        const gravity = new THREE.Vector3(0, -aero.mass * 9.80665, 0);
        const netForce = new THREE.Vector3().add(gravity).add(thrust).add(aeroResult.forceWorld).add(gearResult.forces);

        const acc = netForce.divideScalar(aero.mass);
        linearVelocity.addScaledVector(acc, dt);
        position.addScaledVector(linearVelocity, dt);

        // Angular acceleration
        const angAcc = new THREE.Vector3(
          aeroResult.momentBody.x / aero.Ixx,
          aeroResult.momentBody.y / aero.Iyy,
          aeroResult.momentBody.z / aero.Izz
        );
        angularVelocity.addScaledVector(angAcc, dt);

        const rotDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          angularVelocity.x * dt,
          angularVelocity.y * dt,
          angularVelocity.z * dt,
          'YXZ'
        ));
        quaternion.multiply(rotDelta);
      }
    };
  }

  const simHigh = createMockSim('high');
  const simUltra = createMockSim('ultraLow');

  // Step 1,000 physics ticks (approx 8.33 seconds of simulated flight)
  for (let tick = 0; tick < 1000; tick++) {
    stepPhysics(simHigh);
    stepPhysics(simUltra);

    // Assert exact bit-for-bit state preservation at each checkpoint
    if (tick % 100 === 0) {
      assert.strictEqual(simHigh.position.x, simUltra.position.x, `Tick ${tick}: Position X divergence`);
      assert.strictEqual(simHigh.position.y, simUltra.position.y, `Tick ${tick}: Position Y divergence`);
      assert.strictEqual(simHigh.position.z, simUltra.position.z, `Tick ${tick}: Position Z divergence`);
      assert.strictEqual(simHigh.linearVelocity.x, simUltra.linearVelocity.x, `Tick ${tick}: Velocity X divergence`);
      assert.strictEqual(simHigh.linearVelocity.y, simUltra.linearVelocity.y, `Tick ${tick}: Velocity Y divergence`);
      assert.strictEqual(simHigh.linearVelocity.z, simUltra.linearVelocity.z, `Tick ${tick}: Velocity Z divergence`);
      assert.strictEqual(simHigh.quaternion.x, simUltra.quaternion.x, `Tick ${tick}: Quaternion X divergence`);
      assert.strictEqual(simHigh.quaternion.y, simUltra.quaternion.y, `Tick ${tick}: Quaternion Y divergence`);
      assert.strictEqual(simHigh.quaternion.z, simUltra.quaternion.z, `Tick ${tick}: Quaternion Z divergence`);
      assert.strictEqual(simHigh.quaternion.w, simUltra.quaternion.w, `Tick ${tick}: Quaternion W divergence`);
    }
  }

  // Final validation after 1,000 steps
  assert.strictEqual(simHigh.position.x, simUltra.position.x);
  assert.strictEqual(simHigh.position.y, simUltra.position.y);
  assert.strictEqual(simHigh.position.z, simUltra.position.z);
  assert.strictEqual(simHigh.linearVelocity.x, simUltra.linearVelocity.x);
  assert.strictEqual(simHigh.linearVelocity.y, simUltra.linearVelocity.y);
  assert.strictEqual(simHigh.linearVelocity.z, simUltra.linearVelocity.z);
});
