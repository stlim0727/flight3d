import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { solveTrim } from '../src/physics/TrimSolver.js';
import { BOEING_737_800, CESSNA_172, F16_FALCON } from '../src/config/aircraftConfigs.js';
import { AutopilotController } from '../src/physics/Autopilot.js';

function trimmedAero() {
  return { aero: new Aerodynamics(), engines: new EngineModel() };
}

describe('solveTrim steady level flight', () => {
  it('trims cruise at a small nose-up elevator and positive alpha', () => {
    const { aero, engines } = trimmedAero();
    const t = solveTrim(aero, engines, { iasKnots: 240, altitudeMeters: 10000 });
    assert.equal(t.feasible, true);
    assert.ok(t.alphaDeg > 1 && t.alphaDeg < 6, `alpha ${t.alphaDeg}`);
    assert.ok(t.elevator > 0 && t.elevator < 0.5, `elevator ${t.elevator}`);
    assert.ok(t.throttle > 0.3 && t.throttle < 0.9, `throttle ${t.throttle}`);
  });

  it('required angle of attack decreases with airspeed', () => {
    const { aero, engines } = trimmedAero();
    const slow = solveTrim(aero, engines, { iasKnots: 200, altitudeMeters: 10000 });
    const fast = solveTrim(aero, engines, { iasKnots: 260, altitudeMeters: 10000 });
    assert.ok(slow.feasible && fast.feasible);
    assert.ok(slow.alphaDeg > fast.alphaDeg + 0.5);
    assert.ok(slow.cd > fast.cd);
  });

  it('flaps and gear increase drag and throttle at the same IAS', () => {
    const { aero, engines } = trimmedAero();
    const clean = solveTrim(aero, engines, { iasKnots: 200, altitudeMeters: 400 });
    const dirty = solveTrim(aero, engines, {
      iasKnots: 200, altitudeMeters: 400, flapsIndex: 6, gearState: 1,
    });
    assert.ok(dirty.cd > clean.cd * 1.5);
    assert.ok(dirty.throttle > clean.throttle);
    // This model deploys flaps as a pure lift-curve shift (no flap pitching
    // moment), so at constant speed the wing trims at a lower alpha.
    assert.ok(dirty.alphaDeg < clean.alphaDeg);
  });

  it('rejects conditions beyond the stall margin instead of returning junk', () => {
    const { aero, engines } = trimmedAero();
    const deep = solveTrim(aero, engines, { iasKnots: 110, altitudeMeters: 11000 });
    assert.equal(deep.feasible, false);
    assert.equal(deep.reason, 'stall');
    assert.equal(deep.elevator, 0);
    const zero = solveTrim(aero, engines, { iasKnots: 0, altitudeMeters: 1000 });
    assert.equal(zero.feasible, false);
    assert.equal(zero.reason, 'airspeed');
  });

  it('rejects climb gradients that exceed available thrust', () => {
    const { aero, engines } = trimmedAero();
    const t = solveTrim(aero, engines, {
      iasKnots: 160, altitudeMeters: 8000, flightPathAngleDeg: 12,
    });
    assert.equal(t.feasible, false);
    assert.equal(t.reason, 'thrust');
    assert.equal(t.throttle, 1);
  });

  it('descents that need less than idle thrust clamp to idle and stay feasible', () => {
    const { aero, engines } = trimmedAero();
    const t = solveTrim(aero, engines, {
      iasKnots: 260, altitudeMeters: 400, flightPathAngleDeg: -5,
    });
    assert.equal(t.feasible, true);
    assert.equal(t.throttle, 0);
    assert.equal(t.reason, 'idle');
    assert.equal(t.handsOffFeasible, false, 'idle clamp cannot supply negative thrust equilibrium');
  });

  it('keeps every feasible output inside surface and trim-wheel travel', () => {
    const { aero, engines } = trimmedAero();
    for (const ias of [130, 180, 240, 300]) {
      for (const alt of [0, 5000, 11000]) {
        for (const flapsIndex of [0, 4, 6]) {
          const t = solveTrim(aero, engines, {
            iasKnots: ias, altitudeMeters: alt, flapsIndex,
            gearState: flapsIndex === 6 ? 1 : 0,
          });
          if (!t.feasible) continue;
          assert.ok(Math.abs(t.elevator) <= 1, `elevator ${t.elevator} @${ias}/${alt}/f${flapsIndex}`);
          assert.ok(t.pitchTrimDeg >= -5 && t.pitchTrimDeg <= 12);
          assert.ok(t.throttle >= 0 && t.throttle <= 1);
        }
      }
    }
  });
});

describe('trim wheel hands-off authority', () => {
  // The wheel exists to neutralize whatever elevator deflection steady flight
  // needs. Any state whose demand sits outside the wheel's travel cannot be
  // flown hands-off, and installing the clamped value pretends otherwise.
  const grids = [
    { id: 'B738', config: BOEING_737_800, speeds: [120, 135, 145, 160, 180, 210, 250, 290, 320] },
    { id: 'C172', config: CESSNA_172, speeds: [50, 60, 70, 85, 100, 115, 130] },
  ];

  it('reports hands-off only when wheel, surface and available thrust permit equilibrium', () => {
    for (const { id, config, speeds } of grids) {
      const aero = new Aerodynamics(config), engines = new EngineModel(config);
      for (let flapsIndex = 0; flapsIndex < aero.flapAngles.length; flapsIndex++) {
        for (const gearState of [0, 1]) {
          // The last flap detents are landing-only, so gear-up combinations
          // there are not states the aircraft can actually be in.
          if (gearState === 0 && flapsIndex > aero.flapAngles.length - 3) continue;
          for (const iasKnots of speeds) {
            for (const altitudeMeters of [0, 300, 900, 3000, 6000, 11000]) {
              for (const flightPathAngleDeg of [-6, -3, 0, 2]) {
                const t = solveTrim(aero, engines, {
                  iasKnots, altitudeMeters, flightPathAngleDeg, flapsIndex, gearState,
                });
                if (!t.feasible) continue;
                const expected = t.handsOffTrimDegRaw >= -5 && t.handsOffTrimDegRaw <= 12
                  && !t.surfaceLimited && t.reason !== 'idle';
                assert.equal(t.handsOffFeasible, expected,
                  `${id} ${iasKnots} kt/${altitudeMeters} m/flaps${aero.flapAngles[flapsIndex]}°` +
                  `/gear${gearState}/γ${flightPathAngleDeg}° needs ` +
                  `${t.handsOffTrimDegRaw?.toFixed(2)}° of wheel`);
              }
            }
          }
        }
      }
    }
  });

  it('reports a wheel out of travel instead of hiding the clamp', () => {
    const { aero, engines } = trimmedAero();
    const t = solveTrim(aero, engines, {
      iasKnots: 180, altitudeMeters: 0, flapsIndex: 0, gearState: 0,
      cgBody: { x: 0, y: 0, z: 1 },
    });
    assert.equal(t.feasible, true);
    assert.equal(t.handsOffFeasible, false);
    assert.ok(t.handsOffTrimDegRaw < -5, `raw wheel ${t.handsOffTrimDegRaw}`);
    assert.equal(t.handsOffTrimDeg, -5); // the clamped value callers must not install
  });
});

describe('solveTrim against the live force model', () => {
  // Steady-state equivalence: hold the solved attitude, speed and configuration
  // still, spin the engine map to its steady thrust, then evaluate the real
  // computeAero. A correct trim leaves near-zero net world force (level flight:
  // nothing accelerating along or fighting the path) and near-zero pitch moment.
  function evaluateResidual(state) {
    const { aero, engines } = trimmedAero();
    const trim = solveTrim(aero, engines, state);
    assert.equal(trim.feasible, true, `solver rejected ${JSON.stringify(trim)}`);

    const atmos = Atmosphere.getConditions(state.altitudeMeters);
    const mesh = new THREE.Object3D();
    // Level flight (γ=0): pitch attitude equals α; with the model's frame
    // (nose-up velocity entering the body transform as +AoA), Euler.x = +α.
    const alphaRad = THREE.MathUtils.degToRad(trim.alphaDeg);
    mesh.quaternion.setFromEuler(new THREE.Euler(alphaRad, 0, 0));

    // Engine map converges to steady thrust at the solved throttle.
    engines.setThrottle(trim.throttle);
    let engineData;
    for (let i = 0; i < 4000; i++) {
      engineData = engines.update(1 / 60, state.altitudeMeters, trim.tas, atmos.densityRatio);
    }
    assert.ok(Math.abs(engineData.totalThrust - trim.thrustN) / trim.thrustN < 0.02);

    aero.elevator = trim.elevator;
    aero.pitchTrim = 0;
    aero.setFlapPosition(state.flapsIndex ?? 0);
    aero.currentFlapAngle = aero.flapAngles[aero.flapsIndex]; // settled flaps
    aero.spoilers = state.spoilers ?? 0;
    const zeroRates = new THREE.Vector3(0, 0, 0);
    const velocity = new THREE.Vector3(0, 0, -trim.tas);
    let res;
    for (let i = 0; i < 10; i++) {
      res = aero.computeAero(1 / 120, mesh, velocity, zeroRates,
        state.altitudeMeters, 5000, engineData.totalThrust, state.gearState ?? 0);
    }

    const thrustWorld = new THREE.Vector3(0, 0, -engineData.totalThrust)
      .applyQuaternion(mesh.quaternion);
    const netWorld = res.forceWorld.clone()
      .add(thrustWorld)
      .add(new THREE.Vector3(0, -aero.mass * Atmosphere.G0, 0));
    const qSc = res.qDyn * aero.wingArea * aero.meanChord;
    return {
      trim,
      weight: aero.mass * Atmosphere.G0,
      pitchMoment: res.momentBody.x,
      qSc,
      alongPathN: -netWorld.z,
      acrossPathN: netWorld.y,
    };
  }

  it('zeroes pitch moment and path forces in clean cruise', () => {
    const r = evaluateResidual({ iasKnots: 240, altitudeMeters: 10000 });
    assert.ok(Math.abs(r.pitchMoment) < 0.005 * r.qSc,
      `pitch moment ${r.pitchMoment} vs qSc ${r.qSc}`);
    assert.ok(Math.abs(r.alongPathN) < 0.02 * r.trim.thrustN, `along path ${r.alongPathN}`);
    assert.ok(Math.abs(r.acrossPathN) < 0.02 * r.weight, `across path ${r.acrossPathN}`);
  });

  it('zeroes pitch moment and path forces in the landing configuration', () => {
    const r = evaluateResidual({
      iasKnots: 140, altitudeMeters: 300, flapsIndex: 6, gearState: 1,
    });
    assert.ok(Math.abs(r.pitchMoment) < 0.01 * r.qSc,
      `pitch moment ${r.pitchMoment} vs qSc ${r.qSc}`);
    assert.ok(Math.abs(r.alongPathN) < 0.05 * r.trim.thrustN, `along path ${r.alongPathN}`);
    assert.ok(Math.abs(r.acrossPathN) < 0.02 * r.weight, `across path ${r.acrossPathN}`);
  });

  it('lifts the aircraft weight on the solved alpha', () => {
    const r = evaluateResidual({ iasKnots: 260, altitudeMeters: 400 });
    assert.ok(Math.abs(r.acrossPathN) < 0.03 * r.weight);
  });

  it('hands-off trim wheel zeroes the moment with a neutral elevator', () => {
    const { aero, engines } = trimmedAero();
    const trim = solveTrim(aero, engines, { iasKnots: 240, altitudeMeters: 10000 });
    assert.equal(trim.feasible, true);
    assert.ok(trim.handsOffTrimDeg >= -5 && trim.handsOffTrimDeg <= 12);
    const mesh = new THREE.Object3D();
    mesh.quaternion.setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(trim.alphaDeg), 0, 0));
    aero.pitchTrim = trim.handsOffTrimDeg;
    aero.elevator = 0;
    const res = aero.computeAero(1 / 120, mesh,
      new THREE.Vector3(0, 0, -trim.tas), new THREE.Vector3(0, 0, 0),
      10000, 5000, trim.thrustN, 0);
    const qSc = res.qDyn * aero.wingArea * aero.meanChord;
    assert.ok(Math.abs(res.momentBody.x) < 0.005 * qSc,
      `wheel ${trim.handsOffTrimDeg}° leaves moment ${res.momentBody.x} vs qSc ${qSc}`);
  });

  it('inverts thrust curve accurately for aircraft with nonstandard idle N1 (F-16)', () => {
    const aero = new Aerodynamics(F16_FALCON);
    const engines = new EngineModel(F16_FALCON);
    const state = { iasKnots: 300, altitudeMeters: 1000 };
    const trim = solveTrim(aero, engines, state);
    assert.equal(trim.feasible, true);
    engines.setThrottle(trim.throttle);
    const atmos = Atmosphere.getConditions(state.altitudeMeters);
    let engineData;
    for (let i = 0; i < 400; i++) {
      engineData = engines.update(1 / 60, state.altitudeMeters, trim.tas, atmos.densityRatio);
    }
    const diff = Math.abs(engineData.totalThrust - trim.thrustN) / trim.thrustN;
    assert.ok(diff < 0.02, `F-16 solved throttle ${trim.throttle} should reproduce thrust ${trim.thrustN}N (got ${engineData.totalThrust}N)`);
  });
});

describe('AutopilotController trim feedforward', () => {
  const cruise = {
    airportKey: 'default', headingDeg: 0, rollDeg: 0, pitchDeg: 2,
    altitudeFt: 33000, vsiFpm: 0, iasKnots: 240, tasKnots: 415,
    throttle: 0.6, x: 0, z: 0,
  };

  it('without a solver the laws keep the original pure-proportional behavior', () => {
    const ap = new AutopilotController();
    ap.engage('ALT', cruise);
    const cmd = ap.update(cruise, 1 / 120);
    assert.equal(cmd.elevator, 0);
    assert.equal(ap.trim.elevator, 0);
  });

  it('engages ALT bumplessly: at the capture state the command equals the trim', () => {
    const ap = new AutopilotController({
      trimSolver: () => ({ feasible: true, elevator: 0.18, throttle: 0.63 }),
    });
    ap.engage('ALT', cruise);
    const cmd = ap.update(cruise, 1 / 120);
    assert.equal(cmd.elevator, 0.18);
    // Off-nominal state adds the proportional term on top of the feedforward:
    // 100 ft above the captured altitude commands nose-down.
    const drifted = ap.update({ ...cruise, altitudeFt: 33100 }, 1 / 120);
    assert.equal(drifted.elevator, 0.18 - 100 * ap.elevatorPerFtAlt);
  });

  it('SPD capture jumps to the trim throttle once, then integrates error', () => {
    const ap = new AutopilotController({
      trimSolver: () => ({ feasible: true, elevator: 0.1, throttle: 0.7 }),
    });
    ap.engage('SPD', cruise);
    const first = ap.update(cruise, 1 / 120);
    assert.equal(first.throttle, 0.7);
    // The sim feeds the commanded throttle back, so the integrator resumes
    // from the trim value; below-target speed must push it up.
    const second = ap.update({ ...cruise, iasKnots: 230, throttle: 0.7 }, 1 / 120);
    assert.ok(second.throttle > 0.7, `integrator resumed from trim: ${second.throttle}`);
  });

  it('infeasible solutions fall back to zero feedforward', () => {
    const ap = new AutopilotController({
      trimSolver: () => ({ feasible: false, reason: 'stall', elevator: 99, throttle: 99 }),
    });
    ap.engage('MASTER', cruise);
    assert.equal(ap.trim.elevator, 0);
    const cmd = ap.update(cruise, 1 / 120);
    assert.equal(cmd.elevator, 0);
  });

  it('re-engage after a configuration change captures the new trim', () => {
    const { aero, engines } = trimmedAero();
    const ap = new AutopilotController({
      trimSolver: (t, gamma) => solveTrim(aero, engines, {
        iasKnots: t.iasKnots, altitudeMeters: 300, flightPathAngleDeg: gamma,
        flapsIndex: aero.flapsIndex, gearState: 0,
      }),
    });
    ap.engage('ALT', cruise);
    const cleanTrim = ap.trim.elevator;
    assert.ok(cleanTrim > 0 && cleanTrim < 0.5);
    aero.setFlapPosition(6);
    ap.engage('ALT', cruise);
    assert.notEqual(ap.trim.elevator, cleanTrim, 'config change moves the trim point');
  });

  it('disengage zeroes the captured trim', () => {
    const ap = new AutopilotController({
      trimSolver: () => ({ feasible: true, elevator: 0.2, throttle: 0.5 }),
    });
    ap.engage('ALT', cruise);
    ap.disengage();
    assert.equal(ap.trim.elevator, 0);
    assert.equal(ap.trim.throttle, 0);
  });

  it('VS capture feeds trim for the commanded climb angle', () => {
    const { aero, engines } = trimmedAero();
    let lastGamma = null;
    const ap = new AutopilotController({
      trimSolver: (t, gamma) => {
        lastGamma = gamma;
        return solveTrim(aero, engines, {
          iasKnots: t.iasKnots, altitudeMeters: 10000, flightPathAngleDeg: gamma,
        });
      },
    });
    const climbing = { ...cruise, tasKnots: 415, vsiFpm: 600 };
    ap.engage('VS', climbing);
    // 600 fpm (3 m/s climb) at 415 kt TAS is about 2.7 degrees, within the
    // thrust envelope at 10 km; the solver must return a real trim.
    assert.ok(lastGamma > 2 && lastGamma < 3.5, `gamma ${lastGamma}`);
    assert.ok(ap.trim.elevator > 0, `trim ${ap.trim.elevator}`);
  });
});
