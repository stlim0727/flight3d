import { MissionState, headingError } from './MissionState.js';

export class TakeoffMission extends MissionState {
  constructor(manifest) {
    super('takeoff', manifest);
    this.liftedOff = false; this.stableTicks = 0; this.groundSamples = 0; this.groundErrorSquared = 0;
    this.metrics = { stableTicks: 0, maximumRollDeg: 0, centerlineRmsM: 0 };
  }
  update(s) {
    if (!this.accept(s)) return this.result();
    const m = this.manifest, grounded = s.gearContacts.some(c => c.grounded);
    if (this.tick === 1 && !grounded) return this.fail('invalid-scenario');
    this.metrics.maximumRollDeg = Math.max(this.metrics.maximumRollDeg, Math.abs(s.rollDeg));
    if (!this.liftedOff && grounded) {
      if (s.gearContacts.some(c => c.grounded && this.outside(c))) return this.fail('runway-excursion');
      this.groundErrorSquared += s.centerlineOffsetM ** 2; this.groundSamples++;
      this.metrics.centerlineRmsM = Math.sqrt(this.groundErrorSquared / this.groundSamples);
    } else if (!this.liftedOff) {
      this.liftedOff = true;
      this.metrics.liftoffTick = this.tick; this.metrics.liftoffIasKnots = s.iasKnots;
    } else if (grounded) return this.fail('recontact');
    if (s.heightAboveRunwayM >= m.minimumHeightM && this.metrics.heightReachedTick === undefined) {
      this.metrics.heightReachedTick = this.tick;
    }
    const stable = !grounded && s.heightAboveRunwayM >= m.minimumHeightM && s.heightAboveRunwayM <= m.maximumHeightM &&
      s.iasKnots >= m.minimumIasKnots && s.iasKnots <= m.maximumIasKnots && Math.abs(s.rollDeg) <= m.maximumRollDeg &&
      Math.abs(headingError(s.headingDeg, m.runwayHeadingDeg)) <= m.maximumHeadingErrorDeg &&
      s.vsiFpm * 0.3048 / 60 >= m.minimumVsiMs && s.vsiFpm * 0.3048 / 60 <= m.maximumVsiMs;
    this.stableTicks = stable ? this.stableTicks + 1 : 0;
    this.metrics.stableTicks = this.stableTicks;
    if (this.stableTicks >= m.stableTicks) return this.finish('succeeded', 'completed');
    return this.result();
  }
}
