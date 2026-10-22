import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EngineModel, asymmetricThrustYawMoment } from '../src/physics/EngineModel.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';

describe('EngineModel (Twin CFM56-7B Turbofan Simulation)', () => {
  it('should initialize at ground idle (22% N1, 62% N2)', () => {
    const engines = new EngineModel();
    assert.strictEqual(engines.numEngines, 2);
    assert.strictEqual(engines.throttleCommand, 0.0);
    assert.strictEqual(engines.n1[0], 22.0);
    assert.strictEqual(engines.n1[1], 22.0);
    assert.strictEqual(engines.n2[0], 62.0);
    assert.strictEqual(engines.n2[1], 62.0);
    assert.strictEqual(engines.reverserActive, false);
  });

  it('should model realistic spool-up latency from idle to TOGA', () => {
    const engines = new EngineModel();
    engines.setThrottle(1.0); // TOGA

    // Step 0.5 seconds at sea level
    engines.update(0.5, 0, 0, 1.0);
    assert.ok(engines.n1[0] > 22.0, 'N1 must begin spooling up');
    assert.ok(engines.n1[0] < 80.0, 'N1 should not immediately snap to 100% due to rotor inertia');

    // Step 5 seconds to allow full spool
    for (let t = 0; t < 50; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(engines.n1[0] > 98.0, 'N1 should reach near 100% TOGA after spool time');
    assert.ok(engines.thrust[0] > 110000, 'Each engine should produce near max static thrust (>110 kN)');
  });

  it('should model realistic spool-down latency from TOGA to idle', () => {
    const engines = new EngineModel();
    engines.setThrottle(1.0);
    for (let t = 0; t < 50; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(engines.n1[0] > 98.0);

    // Retard throttle to idle
    engines.setThrottle(0.0);
    engines.update(0.5, 0, 0, 1.0);
    assert.ok(engines.n1[0] < 95.0, 'N1 should begin dropping');
    assert.ok(engines.n1[0] > 25.0, 'N1 should not immediately drop to 22%');

    // Allow full spool down (approx 6 seconds)
    for (let t = 0; t < 60; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(Math.abs(engines.n1[0] - 22.0) < 1.0, 'N1 returns to ~22% idle');
  });

  it('should restrict thrust reversers to ground operation only', () => {
    const engines = new EngineModel();
    // In air (onGround = false)
    engines.setReverser(true, false);
    assert.strictEqual(engines.reverserActive, false, 'Reverser must not engage in flight');

    // On ground (onGround = true)
    engines.setReverser(true, true);
    assert.strictEqual(engines.reverserActive, true, 'Reverser engages on ground');

    // Step to deploy buckets
    for (let t = 0; t < 20; t++) {
      engines.update(0.1, 0, 20, 1.0);
    }
    assert.ok(engines.reverserDeployment > 0.9, 'Reverser sleeves deploy');
    assert.ok(engines.thrust[0] < 0, 'Reverser produces negative (braking) thrust');
  });

  it('should calculate altitude thrust lapse (density drop)', () => {
    const seaEngines = new EngineModel();
    seaEngines.setThrottle(1.0);
    for (let t = 0; t < 50; t++) seaEngines.update(0.1, 0, 100, 1.0);

    const highEngines = new EngineModel();
    highEngines.setThrottle(1.0);
    const highAtmos = Atmosphere.getConditions(10000); // 10,000m (~33,000ft)
    for (let t = 0; t < 50; t++) highEngines.update(0.1, 10000, 100, highAtmos.densityRatio);

    assert.ok(highEngines.thrust[0] < seaEngines.thrust[0] * 0.5, 'Thrust at 10km should be less than 50% of sea level');
    assert.ok(highEngines.fuelFlow[0] < seaEngines.fuelFlow[0], 'Fuel flow decreases with reduced air density');
  });
});

describe('EngineModel failure, windmilling and fuel burn', () => {
  const spoolToToga = (engines) => {
    engines.setThrottle(1.0);
    for (let t = 0; t < 50; t++) engines.update(0.1, 0, 0, 1.0);
  };

  it('spools the failed engine down continuously while the healthy engine holds thrust', () => {
    const engines = new EngineModel();
    spoolToToga(engines);
    const healthyThrustBefore = engines.thrust[1];

    engines.setEngineFailure(0, true);
    let previousN1 = engines.n1[0];
    let data;
    for (let t = 0; t < 60; t++) {
      data = engines.update(0.1, 0, 0, 1.0);
      const step = previousN1 - engines.n1[0];
      assert.ok(step >= 0, 'failed N1 must only fall toward windmilling');
      assert.ok(step < 15, `N1 decay per 0.1s step must stay gradual (got ${step.toFixed(2)})`);
      previousN1 = engines.n1[0];
    }
    assert.ok(engines.n1[0] < 12, 'failed engine settles near the windmilling N1');
    assert.ok(engines.n1[1] > 98, 'healthy engine unaffected');
    assert.ok(engines.thrust[0] < 1000, 'failed engine produces (near) no net thrust');
    assert.ok(Math.abs(engines.thrust[1] - healthyThrustBefore) / healthyThrustBefore < 0.05);
    assert.ok(engines.fuelFlow[0] < 5, 'no fuel metered into a shutdown engine');
    assert.ok(engines.egt[0] < 100, 'an engine without combustion cools toward ambient');

    assert.strictEqual(data.engine1.failed, true);
    assert.strictEqual(data.engine2.failed, false);
    assert.ok(Number.isFinite(data.engine1.thrust));
  });

  it('restarts a failed engine and returns it to the commanded thrust', () => {
    const engines = new EngineModel();
    spoolToToga(engines);
    engines.setEngineFailure(1, true);
    for (let t = 0; t < 60; t++) engines.update(0.1, 0, 0, 1.0);
    assert.ok(engines.n1[1] < 12);

    engines.setEngineFailure(1, false);
    const data = (() => {
      let d;
      for (let t = 0; t < 80; t++) d = engines.update(0.1, 0, 0, 1.0);
      return d;
    })();
    assert.ok(engines.n1[1] > 98, 'restarted engine spools back to TOGA');
    assert.ok(engines.thrust[1] > 110000);
    assert.strictEqual(data.engine2.failed, false);
  });

  it('flames out both engines when the fuel runs dry', () => {
    const engines = new EngineModel();
    spoolToToga(engines);
    engines.fuelKg = 2.0;

    let data;
    for (let t = 0; t < 120; t++) data = engines.update(0.1, 0, 0, 1.0);
    assert.strictEqual(engines.fuelKg, 0, 'fuel never goes negative');
    assert.strictEqual(data.engine1.failed, true, 'starved engines indicate failure');
    assert.strictEqual(data.engine2.failed, true);
    assert.ok(engines.n1[0] < 12 && engines.n1[1] < 12, 'both engines windmill dry');
    assert.ok(engines.thrust[0] < 1000 && engines.thrust[1] < 1000);
    assert.strictEqual(data.totalThrust, engines.thrust[0] + engines.thrust[1]);
  });

  it('burns tank fuel at metered flow and reports it every update', () => {
    const engines = new EngineModel();
    assert.strictEqual(engines.fuelKg, engines.fuelCapacityKg);
    const data = engines.update(0.1, 0, 0, 1.0);
    assert.strictEqual(data.fuelKg, engines.fuelKg);

    // Ground idle burns ~350 kg/h per engine → ~700 kg/h ≈ 0.194 kg/s.
    for (let t = 0; t < 600; t++) engines.update(0.1, 0, 0, 1.0);
    const burned = engines.fuelCapacityKg - engines.fuelKg;
    assert.ok(burned > 5 && burned < 20, `one minute at idle burns ~11.7 kg (got ${burned.toFixed(2)})`);
  });

  it('ignores out-of-range engine indices in setEngineFailure', () => {
    const engines = new EngineModel();
    assert.strictEqual(engines.setEngineFailure(-1, true), false);
    assert.strictEqual(engines.setEngineFailure(2, true), false);
    assert.deepStrictEqual(engines.failed, [false, false]);
  });
});

describe('asymmetricThrustYawMoment', () => {
  it('yaws the nose toward the failed engine (body +Y positive = nose left)', () => {
    // Engine-out on the LEFT: the right engine's forward thrust, acting ahead
    // of the CG, drives a positive (+Y, nose-left) yaw toward the dead side.
    assert.strictEqual(asymmetricThrustYawMoment(0, 100000), 450000);
    assert.strictEqual(asymmetricThrustYawMoment(100000, 0), -450000);
    assert.strictEqual(asymmetricThrustYawMoment(80000, 80000), 0);
    assert.strictEqual(asymmetricThrustYawMoment(0, 50000, 2.0), 100000, 'custom moment arm');
  });
});
