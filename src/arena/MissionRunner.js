import { PilotHost } from '../pilot/PilotHost.js';
import { PilotPerception } from '../pilot/PilotPerception.js';
import { createBriefing } from '../pilot/PilotProtocol.js';
import { TakeoffMission } from './TakeoffMission.js';
import { LandingMission } from './LandingMission.js';
import { ValleyMission } from './ValleyMission.js';

/** Local, unranked evaluator. Only this loop advances physics while active.
 * A computed command waits one full decision period before it can be applied.
 * Worker waiting consumes wall time, never simulation ticks.
 */
export class MissionRunner {
  constructor(adapter, { hostFactory = () => new PilotHost(),
    yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0)),
    onUpdate = () => {}, paceTick = null } = {}) {
    this.adapter = adapter;
    this.hostFactory = hostFactory;
    this.yieldFrame = yieldFrame;
    this.onUpdate = onUpdate;
    this.paceTick = paceTick;
    this.state = 'idle';
    this.generation = 0;
    this.record = null;
  }

  get active() { return this.state === 'preparing' || this.state === 'running'; }

  async start(source, options = {}) {
    if (this.active || this.preparing) throw new Error('A mission is already active or stopping');
    const generation = ++this.generation;
    this.abortPreparation = new AbortController();
    this.state = 'preparing';
    this.record = { status: 'preparing', reason: null, tick: 0, observations: [],
      commands: [], poses: [], result: null };
    const record = this.record;
    this.notify();
    try {
      this.preparing = true;
      let prepared;
      try { prepared = await this.adapter.prepare({ ...options, signal: this.abortPreparation.signal }); }
      finally { this.preparing = false; }
      if (generation !== this.generation) return record;
      const manifest = prepared.manifest;
      if (manifest.physicsHz !== 120) throw new Error('Unsupported physics rate');
      record.manifest = structuredClone(manifest);
      record.source = source;
      record.sensorSeed = options.sensorSeed ?? options.seed ?? 1;
      record.noiseEnabled = options.noise ?? options.environmentProfile !== 'calm-debug-v1';
      const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
      record.sourceHash = await hash(source);
      record.manifestHash = await hash(JSON.stringify(manifest));
      if (generation !== this.generation) return record;
      this.adapter.acquire();
      const evaluator = manifest.type === 'valley' ? new ValleyMission(manifest) : manifest.id.startsWith('landing')
        ? new LandingMission(manifest) : new TakeoffMission(manifest);
      const perception = new PilotPerception({ sensorSeed: options.sensorSeed ?? options.seed ?? 1,
        noise: options.noise ?? options.environmentProfile !== 'calm-debug-v1',
        physicsHz: 120, mission: manifest.id, runway: { headingDeg: manifest.runwayHeadingDeg,
          elevationM: manifest.runwayThreshold.y } });
      const host = this.host = this.hostFactory();
      await host.start(source, createBriefing(manifest));
      if (generation !== this.generation) return record;
      this.state = this.record.status = 'running';
      let tick = 0, pending = null;
      const period = 24;
      while (generation === this.generation) {
        // Order at t: due command, observation, physics, completed-tick judging.
        if (pending) {
          this.adapter.apply(pending.command);
          this.record.commands.push({ ...pending, applyTick: tick });
        }
        const snapshotAtDecision = this.adapter.snapshot(tick);
        const observation = this.adapter.observe?.(perception, snapshotAtDecision, tick, evaluator)
          ?? perception.sample(snapshotAtDecision, tick);
        this.record.observations.push({ sampleTick: tick, observation });
        const command = await host.tick(observation, { sampleTick: tick });
        if (generation !== this.generation) break;
        pending = { command, sampleTick: tick, scheduledTick: tick + period };
        for (let i = 0; i < period; i++) {
          if (this.paceTick) await this.paceTick(tick + 1, manifest.physicsHz);
          if (generation !== this.generation) break;
          this.adapter.step();
          const snapshot = this.adapter.snapshot(++tick);
          perception.updateContact(snapshot.weightOnWheels, tick);
          const result = evaluator.update(snapshot);
          this.record.tick = tick;
          if (tick % period === 0 || result.status !== 'running') {
            this.record.poses.push({ tick, ...this.adapter.pose?.(),
              runwayS: snapshot.runwayS,
              iasKnots: snapshot.iasKnots, heightM: snapshot.heightAboveRunwayM,
              centerlineOffsetM: snapshot.centerlineOffsetM });
          }
          if (result.status !== 'running') {
            this.record.result = result;
            this.state = this.record.status = result.status;
            this.record.reason = result.reason;
            this.notify();
            return this.record;
          }
        }
        this.notify();
        await this.yieldFrame();
      }
    } catch (error) {
      if (generation === this.generation) {
        this.state = this.record.status = 'failed';
        this.record.reason = error.code ?? (/invalid-scenario|infrastructure-error/.exec(error.message)?.[0])
          ?? 'pilot-or-runtime-error';
        this.record.detail = error.message;
        this.notify();
      }
    } finally {
      if (generation === this.generation) {
        this.host?.stop();
        this.host = null;
        this.adapter.release();
      }
    }
    return record;
  }

  stop(reason = 'manual-takeover') {
    if (!this.active) return;
    ++this.generation;
    this.abortPreparation?.abort();
    this.host?.stop(reason);
    this.host = null;
    this.state = this.record.status = 'aborted';
    this.record.reason = reason;
    this.adapter.release();
    this.notify();
  }

  notify() { this.onUpdate(this.record); }
}
