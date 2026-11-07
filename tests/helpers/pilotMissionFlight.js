import { SimulatorMissionAdapter } from '../../src/arena/SimulatorMissionAdapter.js';
import { TakeoffMission } from '../../src/arena/TakeoffMission.js';
import { LandingMission } from '../../src/arena/LandingMission.js';
import { PilotPerception } from '../../src/pilot/PilotPerception.js';
import { createBriefing, validateCommand } from '../../src/pilot/PilotProtocol.js';
import { createHeadlessSimulation as createPilotMissionSimulation } from '../../src/core/HeadlessSimulation.js';
export { createPilotMissionSimulation };

/** Synchronous SDK calibration, not Worker isolation or browser acceptance.
 * Physics and observation implementations are identical to the game bridge.
 * Scheduling applies a decision exactly 24 physics ticks after sampling.
 */
export async function flyPilotMission({ missionId, createPilot, environmentProfile = 'mild-disturbance-v1',
  seed = 1, sensorNoise = true, sampleEveryTicks = 120 } = {}) {
  if (typeof createPilot !== 'function') throw new TypeError('createPilot factory required');
  const sim = createPilotMissionSimulation();
  const adapter = new SimulatorMissionAdapter(sim);
  const prepared = await adapter.prepare({ missionId, environmentProfile, seed, noise: sensorNoise });
  const manifest = prepared.manifest;
  const mission = manifest.type === 'takeoff' ? new TakeoffMission(manifest) : new LandingMission(manifest);
  const perception = new PilotPerception({ sensorSeed: seed, noise: sensorNoise, mission: manifest.type,
    physicsHz: manifest.physicsHz, runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });
  const pilot = createPilot({ random: () => { throw new Error('Calibration examples must not need hidden randomness'); } });
  const briefing = createBriefing({ ...manifest,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y,
      lengthM: manifest.runwayEndS - manifest.runwayStartS, widthM: manifest.runwayWidthM },
    configuration: manifest.fixedConfiguration,
    recommendedSpeeds: { rotationKnots: 140, climbKnots: 165, approachKnots: 145 },
  });
  pilot.reset(briefing);
  adapter.acquire();
  let pending = null, snapshot = prepared.initialSnapshot;
  const trace = [], commands = [];
  let outcome;
  try {
    for (let tick = 0; tick < manifest.timeoutTicks; tick++) {
      if (pending && pending.tick === tick) { adapter.apply(pending.command); pending = null; }
      if (tick % manifest.decisionPeriodTicks === 0) {
        const observation = perception.sample(snapshot, tick);
        const result = validateCommand(pilot.onTick(observation));
        if (!result.ok) throw new Error(`invalid-command: ${result.error}`);
        pending = { tick: tick + manifest.decisionPeriodTicks, command: result.command };
        commands.push({ sampleTick: tick, applyTick: pending.tick, ...pending.command });
      }
      sim.totalSimTime += sim.physicsDt;
      adapter.step();
      snapshot = adapter.snapshot(tick + 1);
      perception.updateContact(snapshot.weightOnWheels, tick + 1);
      outcome = mission.update(snapshot);
      if ((tick + 1) % sampleEveryTicks === 0 || outcome.status !== 'running') trace.push(structuredClone(snapshot));
      if (outcome.status !== 'running') break;
    }
    return { missionId, environmentProfile, seed, sensorNoise, manifest, result: mission.result(), final: snapshot,
      trace, commands, crash: sim.crashResult ?? null };
  } finally { adapter.release(); }
}
