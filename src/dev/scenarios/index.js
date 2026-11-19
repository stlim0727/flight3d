import * as THREE from 'three';
import { LANDING_CASES, setupLanding } from './landingScenarios.js';
import { setupCrash } from './crashScenarios.js';
import { turbulenceScenario, moderateTurbulenceScenario, strongTurbulenceScenario } from './turbulenceScenario.js';

export const DEV_SCENARIOS = {
  turbulence: turbulenceScenario,
  'turbulence-moderate': moderateTurbulenceScenario,
  'turbulence-strong': strongTurbulenceScenario,
  shadow: {
    airports: ['coastal', 'lukla'], aircraft: ['B738', 'C172'], kind: 'visual',
    labelKey: 'shadow.title', descriptionKey: 'shadow.briefing',
    setup: sim => sim.shadowDemo.start(),
  },
  ...Object.fromEntries(Object.entries(LANDING_CASES).map(([id, fixture]) => [id, {
    ...fixture, airports: ['coastal'], aircraft: ['B738'],
    kind: fixture.setup[4]?.length ? 'injection' : 'physical',
    initial: fixture.setup,
    labelKey: `dev.scenario.${id}`, descriptionKey: `dev.expect.${fixture.check}`,
    setup: sim => setupLanding(sim, fixture.setup),
  }])),
  ...Object.fromEntries(['TOWER', 'WATER', 'TERRAIN', 'BUILDING', 'TREE'].map(type => [type.toLowerCase(), {
    airports: ['coastal'], aircraft: ['B738'], kind: 'physical', expectedCrash: type,
    duration: 3, labelKey: `dev.scenario.${type.toLowerCase()}`, descriptionKey: 'dev.expect.collision',
    setup: sim => setupCrash(sim, type),
  }])),
  'water-ditching': {
    airports: ['coastal'], aircraft: ['B738'], kind: 'physical',
    initial: [0, 3.2, 1.5, 0, [], 65, 0.04],
    duration: 35, labelKey: 'dev.scenario.water-ditching', descriptionKey: 'dev.expect.ditching',
    setup(sim) {
      setupLanding(sim, [0, 3.2, 1.5, 0, [], 65, 0.04]);
      const waterLevel = sim.currentTerrain?.getWaterLevel?.(400, 4200) ?? 0;
      sim.position.set(400, waterLevel + 3.2, 4200);
    },
    observe(sim, observation) {
      observation.ditched ||= Boolean(sim.waterDitching?.ditchingContact);
      observation.flooding = Math.max(observation.flooding ?? 0, sim.waterDitching?.flooding ?? 0);
    },
    verdict: o => !o.crashed && o.ditched && o.flooding > 0.3 && o.speed < 2.0,
  },
  'corridor-ditching': {
    airports: ['jeju'], aircraft: ['B738'], kind: 'physical',
    initial: [0, 3.2, 1.5, 0, [], 65, 0.04],
    duration: 35, labelKey: 'dev.scenario.corridor-ditching', descriptionKey: 'dev.expect.corridor-ditching',
    setup(sim) {
      setupLanding(sim, [0, 3.2, 1.5, 0, [], 65, 0.04]);
      sim.engines?.setEngineFailure?.(0, true);
      sim.engines?.setEngineFailure?.(1, true);
      if (sim.controls) sim.controls.throttle = 0;
      sim.engines?.setThrottle?.(0);
      const waterLevel = sim.currentTerrain?.getWaterLevel?.(-18000, -35000) ?? 0;
      sim.position.set(-18000, waterLevel + 3.2, -35000);
      sim.linearVelocity.set(0, -1.2, 65);
      sim.quaternion.setFromEuler(new THREE.Euler(0.06, Math.PI, 0, 'YXZ'));
      sim.gear?.setGearTarget?.(false);
      if (sim.gear) sim.gear.gearState = 0;
    },
    observe(sim, observation) {
      observation.ditched ||= Boolean(sim.waterDitching?.ditchingContact);
      observation.flooding = Math.max(observation.flooding ?? 0, sim.waterDitching?.flooding ?? 0);
    },
    verdict: o => !o.crashed && o.ditched && o.flooding > 0.3 && o.speed < 2.0,
  },
  'corridor-cruise': {
    airports: ['jeju'], aircraft: ['B738'], kind: 'physical',
    duration: 30, labelKey: 'dev.scenario.corridor-cruise', descriptionKey: 'dev.expect.corridor-cruise',
    setup(sim) {
      // Spawn at FL280 (8,534m MSL) heading 195° South along the corridor towards Chuja & Jeju
      const x = -15000, y = 8534, z = -70000;
      const speed = 210; // ~408 kt TAS
      const headingRad = 195 * (Math.PI / 180);
      sim.position.set(x, y, z);
      sim.linearVelocity.set(Math.sin(headingRad) * speed, 0, -Math.cos(headingRad) * speed);
      sim.quaternion.setFromEuler(new THREE.Euler(0.03, -headingRad, 0, 'YXZ'));
      sim.gear?.setGearTarget?.(false);
      if (sim.gear) sim.gear.gearState = 0;
      if (sim.aero) sim.aero.setFlapPosition(0);
      if (sim.controls) {
        sim.controls.throttle = 0.72;
        sim.controls.setParkingBrake(false);
      }
      sim.engines?.setThrottle?.(0.72);
      if (sim.autopilot) {
        sim.autopilot.master = true;
        sim.autopilot.lateralMode = 'LNAV';
        sim.autopilot.verticalMode = 'ALT';
        sim.autopilot.targets.altitudeFt = 28000;
        sim.autopilot.speedMode = true;
        sim.autopilot.targets.iasKnots = 250;
      }
    },
    observe(sim, observation) {
      observation.stableFlight = !sim.isCrashed && sim.position.y > 7000;
      observation.lnavActive = sim.autopilot?.lateralMode === 'LNAV';
    },
    verdict: o => o.stableFlight && o.lnavActive,
  },
};
