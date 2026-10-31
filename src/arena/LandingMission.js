import { MissionState, headingError } from './MissionState.js';

export class LandingMission extends MissionState {
  constructor(manifest) {
    super('landing', manifest);
    this.previousGrounded = new Set(); this.touchdown = null; this.stopTicks = 0;
    this.metrics = { bounceTicks: 0, stopTicks: 0 };
  }
  update(s) {
    if (!this.accept(s)) return this.result();
    const m = this.manifest, ground = s.gearContacts.filter(c => c.grounded);
    const mains = ground.filter(c => c.id !== 'nose');
    if (this.tick === 1 && ground.length) return this.fail('invalid-scenario');
    const newContacts = ground.filter(c => !this.previousGrounded.has(c.id));
    this.previousGrounded = new Set(ground.map(c => c.id));
    if (!this.touchdown) {
      if (!mains.length && ground.some(c => c.id === 'nose')) return this.fail('nose-first');
      if (mains.length) {
        this.touchdown = { tick: this.tick, runwayS: mains[0].runwayS, cgRunwayS: s.runwayS,
          centerlineOffsetM: mains[0].centerlineOffsetM, sinkRateMs: Math.max(...mains.map(c => c.sinkRateMs)),
          rollDeg: s.rollDeg, headingErrorDeg: headingError(s.headingDeg, m.runwayHeadingDeg) };
        this.metrics.touchdown = { ...this.touchdown };
        if (mains.some(c => c.runwayS < m.touchdownStartS || c.runwayS > m.touchdownEndS || this.outside(c))) {
          return this.fail('touchdown-outside-zone');
        }
        if (Math.abs(s.rollDeg) > m.maximumRollDeg || Math.abs(this.touchdown.headingErrorDeg) > m.maximumHeadingErrorDeg) {
          return this.fail('unstable-touchdown');
        }
      } else if (s.runwayS > m.touchdownEndS) return this.fail('missed-landing');
      else if (s.runwayS < m.approachStartS || Math.abs(s.centerlineOffsetM) > m.approachHalfWidthM) {
        return this.fail('approach-abandoned');
      }
    }
    if (this.touchdown) {
      if (newContacts.some(c => c.sinkRateMs > m.maximumSinkRateMs)) return this.fail('hard-touchdown');
      // Check every gear's projected footprint, including unloaded gear during a bounce.
      if (s.gearContacts.some(c => this.outside(c))) return this.fail('runway-excursion');
      if (!mains.length) this.metrics.bounceTicks++;
      if (this.metrics.bounceTicks > m.maximumBounceTicks) return this.fail('unstable-touchdown');
      const stopped = mains.length === 2 && s.groundSpeedKnots <= m.stopSpeedKnots &&
        Math.abs(s.centerlineOffsetM) <= m.stopCenterlineM;
      this.stopTicks = stopped ? this.stopTicks + 1 : 0;
      this.metrics.stopTicks = this.stopTicks;
      this.metrics.stoppingDistanceM = Math.max(0, s.runwayS - this.touchdown.cgRunwayS);
      this.metrics.finalCenterlineOffsetM = s.centerlineOffsetM;
      if (this.stopTicks >= m.stopTicks) return this.finish('succeeded', 'completed');
    }
    return this.result();
  }
}
