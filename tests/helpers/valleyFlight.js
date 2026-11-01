import { readFileSync } from 'node:fs';
import { LuklaTerrain } from '../../src/environment/LuklaTerrain.js';
import { LuklaAirport } from '../../src/environment/LuklaAirport.js';
import { ValleyMissionAdapter } from '../../src/arena/ValleyMissionAdapter.js';
import { ValleyMission } from '../../src/arena/ValleyMission.js';
import { PilotPerception } from '../../src/pilot/PilotPerception.js';
import { createBriefing, validateCommand } from '../../src/pilot/PilotProtocol.js';
import { createPilotMissionSimulation } from './pilotMissionFlight.js';

export function createValleySimulation() {
  const bytes = readFileSync(new URL('../../public/terrain/lukla_dem.bin', import.meta.url));
  const terrain = new LuklaTerrain(undefined, 16, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4));
  return createPilotMissionSimulation({ aircraftId: 'F16', airportId: 'lukla', terrain, airport: new LuklaAirport() });
}

/** The same observation and physics path as live play, with rendering omitted. */
export async function flyValley({ createPilot, seed = 1, environmentProfile = 'mild-disturbance-v1',
  noise = true, sampleEveryTicks = 120 } = {}) {
  const sim = createValleySimulation(), adapter = new ValleyMissionAdapter(sim);
  const { manifest } = await adapter.prepare({ seed, environmentProfile, noise });
  const evaluator = new ValleyMission(manifest);
  const perception = new PilotPerception({ sensorSeed: seed, noise, mission: manifest.id,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });
  const pilot = createPilot({ random: () => 0.5, log() {} });
  pilot.reset(createBriefing(manifest)); adapter.acquire();
  let pending = null;
  const trace = [], commands = [];
  try {
    for (let tick = 0; tick < manifest.timeoutTicks; tick++) {
      if (pending?.tick === tick) adapter.apply(pending.command);
      if (tick % 24 === 0) {
        const observation = adapter.observe(perception, adapter.snapshot(tick), tick, evaluator);
        const validated = validateCommand(pilot.onTick(observation));
        if (!validated.ok) throw new Error(validated.error);
        pending = { tick: tick + 24, command: validated.command };
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
