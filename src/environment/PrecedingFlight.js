import { PRECEDING_TRAFFIC, TRAFFIC_SPACING } from '../config/precedingTraffic.js';
import { buildDepartureTakeoffPath, sampleOpenPose, samplePathCurvature } from '../geospatial/departureRoutePath.js';

export const TRAFFIC_PHASES = Object.freeze({
  STANDBY: 'standby', TAXI: 'taxi', HOLD_SHORT: 'hold-short', LINEUP: 'lineup', ROLL: 'roll', CLIMB: 'climb', VACATED: 'vacated',
});
const ORDER = Object.values(TRAFFIC_PHASES);
const DEG = Math.PI / 180;
const approach = (value, target, step) => value < target ? Math.min(target, value + step) : Math.max(target, value - step);

/**
 * Kinematic departure traffic. It is not integrated by the aircraft physics; its pose follows
 * arc length along the mapped departure path, so it can be queried like a remote aircraft.
 * The scenario releases it from hold short and clears it for takeoff; everything else follows
 * from its own speed, acceleration and distance-to-stop state.
 */
export class PrecedingFlight {
  constructor({ path = buildDepartureTakeoffPath(), config = PRECEDING_TRAFFIC } = {}) {
    this.path = path; this.config = config;
    this.id = config.flight; this.callsign = config.callsign;
    this.visuals = null;
    this.reset();
  }

  reset() {
    this.phase = TRAFFIC_PHASES.STANDBY;
    this.s = Math.min(this.path.holdShort, this.config.headStartMeters);
    this.speed = 0; this.height = 0; this.pitch = 0; this.climbAngle = 0;
    this.released = false; this.cleared = false;
    this.waitTimer = 0; this.rotationElapsed = 0; this.rotationStarted = false;
    this.pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0 };
    this.updatePose();
  }

  start() { if (this.phase === TRAFFIC_PHASES.STANDBY) this.phase = TRAFFIC_PHASES.TAXI; }
  /** Permit leaving hold short (the player has queued up behind). */
  release() { this.released = true; }
  /** Permit the takeoff roll once lined up. */
  clearForTakeoff() { this.released = true; this.cleared = true; }

  phaseAtLeast(phase) { return ORDER.indexOf(this.phase) >= ORDER.indexOf(phase); }
  get onGround() { return this.height <= 0; }
  get gearDown() { return this.height < this.config.gearRetractHeight; }
  get hasRotated() { return this.rotationStarted; }
  get runwayVacated() { return this.phase === TRAFFIC_PHASES.VACATED || (!this.onGround && this.s > this.path.runwayEnd); }
  hasSpacedForPlayer(seconds = TRAFFIC_SPACING.rotationSpacingSeconds) {
    return this.runwayVacated || (this.hasRotated && this.rotationElapsed >= seconds);
  }
  /** Horizontal and 3D distance from a world position (y measured from the airfield surface). */
  separationFrom(position, groundY = 0) {
    const horizontal = Math.hypot(position.x - this.pose.x, position.z - this.pose.z);
    return { horizontal, distance: Math.hypot(horizontal, (position.y ?? groundY) - groundY - this.height) };
  }
  /** Whether this traffic is in front of an observer facing `heading` (simulator convention). */
  isAheadOf(position, heading) {
    return (this.pose.x - position.x) * Math.sin(heading) - (this.pose.z - position.z) * Math.cos(heading) > 0;
  }

  /** Speed that still stops at arc length `stop` with the configured deceleration. */
  stoppingSpeed(stop) {
    return Math.sqrt(2 * this.config.taxiDeceleration * Math.max(0, stop - this.s));
  }

  groundTarget(cruise, stop) {
    const curvature = Math.abs(samplePathCurvature(this.path, this.s + this.speed * 2, 16));
    const turn = curvature > 1e-4 ? Math.sqrt(this.config.lateralAcceleration / curvature) : cruise;
    return Math.min(cruise, Math.max(this.config.minimumTurnSpeed, turn), this.stoppingSpeed(stop));
  }

  advanceGround(dt, cruise, stop) {
    const c = this.config, target = this.groundTarget(cruise, stop);
    this.speed = approach(this.speed, target, (target > this.speed ? c.taxiAcceleration : c.taxiDeceleration) * dt);
    this.s = Math.min(stop, this.s + this.speed * dt);
    return stop - this.s < 0.05 && this.speed < 0.05;
  }

  update(dt) {
    const c = this.config, P = TRAFFIC_PHASES;
    dt = Math.max(0, dt);
    if (this.phase === P.TAXI && this.advanceGround(dt, c.taxiSpeed, this.path.holdShort)) {
      this.speed = 0; this.phase = P.HOLD_SHORT; this.waitTimer = 0;
    } else if (this.phase === P.HOLD_SHORT) {
      if (this.released) this.waitTimer += dt;
      if (this.waitTimer >= c.lineUpDelaySeconds) { this.phase = P.LINEUP; this.waitTimer = 0; }
    } else if (this.phase === P.LINEUP) {
      if (this.advanceGround(dt, c.lineupSpeed, this.path.lineUp)) {
        this.speed = 0;
        if (this.cleared) this.waitTimer += dt;
        if (this.waitTimer >= c.takeoffDelaySeconds) { this.phase = P.ROLL; this.waitTimer = 0; }
      }
    } else if (this.phase === P.ROLL || this.phase === P.CLIMB) this.fly(dt);
    this.updatePose();
  }

  fly(dt) {
    const c = this.config;
    if (this.speed >= c.rotateSpeed) this.rotationStarted = true;
    if (this.rotationStarted) {
      this.rotationElapsed += dt;
      this.pitch = approach(this.pitch, c.climbPitchDeg * DEG, c.rotationRateDeg * DEG * dt);
    }
    const airborne = this.rotationStarted && this.pitch >= c.liftoffPitchDeg * DEG;
    if (airborne) {
      this.phase = TRAFFIC_PHASES.CLIMB;
      this.climbAngle = approach(this.climbAngle, c.climbAngleDeg * DEG, c.climbAngleRateDeg * DEG * dt);
    }
    this.speed = this.phase === TRAFFIC_PHASES.CLIMB
      ? approach(this.speed, c.climbSpeed, c.climbAcceleration * dt)
      : this.speed + c.rollAcceleration * dt;
    this.s = Math.min(this.path.length, this.s + this.speed * Math.cos(this.climbAngle) * dt);
    this.height += this.speed * Math.sin(this.climbAngle) * dt;
    if (this.height >= c.vacateHeight || this.s >= this.path.length) this.phase = TRAFFIC_PHASES.VACATED;
  }

  updatePose() {
    const pose = sampleOpenPose(this.path, this.s);
    this.pose.x = pose.x; this.pose.z = pose.z; this.pose.heading = pose.heading;
    this.pose.y = this.height; this.pose.pitch = this.pitch;
    this.visuals?.update(this);
  }

  attachVisuals(visuals) { this.visuals = visuals; visuals?.update(this); }
  /** Detaches visuals only; shared parked-airliner geometry and materials stay owned by the airport. */
  dispose() { this.visuals?.dispose(); this.visuals = null; }
}
