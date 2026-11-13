/**
 * Preceding departure for the Jeju Air 2503 (RKSI → VTBS) scenario: a kinematic Boeing 737
 * that taxis ahead of the player on the same mapped route, holds short, lines up and departs first.
 * Speeds in m/s, accelerations in m/s², angles in degrees, distances in metres.
 */
export const PRECEDING_TRAFFIC = Object.freeze({
  flight: 'KE653',
  callsign: 'Korean Air 653',
  squawk: '5108',
  livery: 'korean',
  aircraft: 'B738',
  /** Arc length ahead of the player's pushback end where KE653 waits at scenario start. */
  headStartMeters: 250,
  taxiSpeed: 6,
  lineupSpeed: 4,
  taxiAcceleration: 0.6,
  taxiDeceleration: 1.2,
  /** Ground turn speed follows v = sqrt(lateralAcceleration / curvature). */
  lateralAcceleration: 0.6,
  minimumTurnSpeed: 1.5,
  /** Delay between the release from hold short and starting to roll onto the runway. */
  lineUpDelaySeconds: 4,
  /** Delay between takeoff clearance and brake release. */
  takeoffDelaySeconds: 2,
  rollAcceleration: 2.0,
  rotateSpeed: 72,
  climbSpeed: 85,
  climbAcceleration: 1.0,
  rotationRateDeg: 3,
  climbPitchDeg: 10,
  liftoffPitchDeg: 6,
  climbAngleDeg: 7,
  climbAngleRateDeg: 1.5,
  gearRetractHeight: 15,
  /** Above this height KE653 is handed off and removed from the scene. */
  vacateHeight: 900,
});

/** Player give-way and spacing gates around the preceding traffic. */
export const TRAFFIC_SPACING = Object.freeze({
  /** The player brakes while on the ground within this distance behind ground traffic. */
  giveWayMeters: 60,
  /** KE653 leaves hold short once the player taxis within this distance of it. */
  releaseMeters: 120,
  /** Seconds after KE653 rotates before the player may begin the takeoff roll. */
  rotationSpacingSeconds: 15,
  /** Upper bound on any wait for traffic so the scenario cannot stall. */
  watchdogSeconds: 120,
});
