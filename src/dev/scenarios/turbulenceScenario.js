import { WindField, setSimulationWind } from '../../physics/WindField.js';

export const TURBULENCE_SEED = 'coastal-b738-turbulence-1';

function createTurbulenceScenario(profile, key) {
  return {
    airports: ['coastal'], aircraft: ['B738'], kind: 'flight', pilotControlled: true,
    duration: 60, labelKey: `dev.scenario.${key}`, descriptionKey: `dev.expect.${key}`,
    setup(sim) {
      // PresetSpawner resets/reloads the aircraft and installs computed hands-off
      // trim. Apply the field last: both nested presets clear any previous wind.
      sim.setPreset('cruise');
      sim.autopilot.disengage();
      setSimulationWind(sim, new WindField({
        profile, seed: TURBULENCE_SEED, runwayHeadingDeg: 63,
      }));
    },
    observe(sim, observation) {
      observation.stalled ||= Boolean(sim.telemetry.isStalled);
      observation.gloc ||= Boolean(sim.telemetry.pilot?.isGLOC);
      observation.engineFailed ||= sim.engines.failed.some(Boolean);
    },
    verdict: o => !o.crashed && !o.damaged && !o.bodyDamage && !o.bodyContact
      && !o.stalled && !o.gloc && !o.engineFailed,
  };
}

export const turbulenceScenario = createTurbulenceScenario('light-turbulence-v1', 'turbulence');
export const moderateTurbulenceScenario = createTurbulenceScenario('moderate-turbulence-v1', 'turbulence-moderate');
export const strongTurbulenceScenario = createTurbulenceScenario('strong-turbulence-v1', 'turbulence-strong');
