import { generateValley } from '../../src/arena/generatedValley.js';
import { SlalomMissionAdapter } from '../../src/arena/SlalomMissionAdapter.js';
import { SlalomMission } from '../../src/arena/SlalomMission.js';
import { PilotPerception } from '../../src/pilot/PilotPerception.js';
import { createBriefing, validateCommand } from '../../src/pilot/PilotProtocol.js';
import { createPilotMissionSimulation } from './pilotMissionFlight.js';

/** Production physics on a generated valley, rendering omitted. The terrain the
 * aircraft flies over is the terrain the validity gate accepted for the same
 * seed, so a course cannot be judged on one ground and flown on another. */
export function createSlalomSimulation(seed, rules) {
  const { terrain } = generateValley({ seed, rules });
  return createPilotMissionSimulation({ aircraftId: 'F16', airportId: 'generated-valley', terrain });
}

/** The same 5 Hz decision period, 24-tick command delay and shared navigation
 * sensor model as `flyValley`, so the two score spaces differ only in course. */
export async function flySlalom({ createPilot, seed = 1, environmentProfile = 'mild-disturbance-v1',
  noise = true, sampleEveryTicks = 120, rules } = {}) {
  const sim = createSlalomSimulation(seed, rules), adapter = new SlalomMissionAdapter(sim);
  const { manifest } = await adapter.prepare({ seed, environmentProfile, noise, rules });
  const evaluator = new SlalomMission(manifest);
  const perception = new PilotPerception({ sensorSeed: seed, noise, mission: manifest.id,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });
  const pilot = createPilot({ random: () => 0.5, log() {} });
  pilot.reset(createBriefing(manifest)); adapter.acquire();
  let pending = null;
  const trace = [], commands = [];
  try {
    for (let tick = 0; tick < manifest.timeoutTicks; tick++) {
      if (pending?.tick === tick) adapter.apply(pending.command);
      if (tick % manifest.decisionPeriodTicks === 0) {
        const observation = adapter.observe(perception, adapter.snapshot(tick), tick, evaluator);
        const validated = validateCommand(pilot.onTick(observation));
        if (!validated.ok) throw new Error(validated.error);
        pending = { tick: tick + manifest.commandDelayTicks, command: validated.command };
        commands.push({ tick, ...validated.command });
      }
      adapter.step();
      const snapshot = adapter.snapshot(tick + 1);
      const result = evaluator.update(snapshot);
      if ((tick + 1) % sampleEveryTicks === 0 || result.status !== 'running') trace.push(snapshot);
      if (result.status !== 'running') break;
    }
    return { manifest, result: evaluator.result(), trace, commands, crash: sim.crashResult ?? null };
  } finally { adapter.release(); }
}
