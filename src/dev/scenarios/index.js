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
};
