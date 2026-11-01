import { SimulatorMissionAdapter } from './SimulatorMissionAdapter.js';
import { ValleyMissionAdapter } from './ValleyMissionAdapter.js';

/** Choose a bridge before preparation; all execution still has one owner. */
export class PilotMissionAdapter {
  constructor(sim) { this.sim = sim; this.current = null; }
  async prepare(options) {
    this.current?.release();
    this.current = options.missionId === 'valley-low-v1'
      ? new ValleyMissionAdapter(this.sim) : new SimulatorMissionAdapter(this.sim);
    return this.current.prepare(options);
  }
  acquire(options) { return this.current.acquire(options); }
  apply(command) { return this.current.apply(command); }
  step() { return this.current.step(); }
  snapshot(tick) { return this.current.snapshot(tick); }
  pose() { return this.current.pose(); }
  release() { return this.current?.release(); }
  observe(perception, snapshot, tick, evaluator) {
    return this.current.observe?.(perception, snapshot, tick, evaluator) ?? perception.sample(snapshot, tick);
  }
}
