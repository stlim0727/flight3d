/**
 * Experimental F16 valley slalom SDK pilot; not real-aircraft flight software.
 *
 * Passage guidance through ordered procedural valley gates:
 * - Steers a line that crosses the corridor over the length of each leg, so the
 *   lateral manoeuvre is spread out instead of stacking onto the bend it flies
 *   through.
 * - Carries cross-track forward by the reconstructed ground track and blends the gate
 *   beacon back into it: the fix is worth tens of metres at the range a leg opens at
 *   and sharpens exactly as the gate it points to is reached, so a fast blend would
 *   steer on the error and a slow one would not. The leftover drift is learned as a
 *   bias instead of being flown out as a turn.
 * - Fixes cross-track against the valley walls the forward terrain instrument ranges,
 *   which is worth a few metres anywhere in a leg; the beacon remains the fallback
 *   when the instrument sees no wall.
 * - Feeds the arc the line is actually on into bank a second and a third ahead, and
 *   closes a damped loop on the cross-track and heading error left over, because
 *   feedforward is only as good as the chart and the speed the aircraft reports.
 * - Commands the load factor the bend will need when the pitch has finished arriving
 *   rather than the one the wing is in now, and closes the vertical channel on
 *   measured rate, so a feedforward error is a transient instead of a climb.
 */

export function createPilot() {
  const RAD = Math.PI / 180;
  const GRAVITY = 9.80665;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const signed = v => ((v + 540) % 360) - 180;
  const read = s => s?.status === 'available' && Number.isFinite(s.mean) ? s.mean : null;

  /** Measured from the production F16 in this altitude and speed band: vertical
   * acceleration per unit elevator and roll rate per unit aileron. A decision
   * period plus the command delay is 0.4 s of pure lag and the wing needs another
   * half second to reach the bank asked of it, so the lateral loop can only be
   * closed at well under 1 rad/s and the rest of the turn is carried by
   * feedforward. */
  const G_PER_ELEVATOR = 12;
  const DEGREES_PER_S_PER_AILERON = 290;
  /** The lateral loop is closed slowly on purpose. Feedforward carries the turn: the
   * chart states the arc and the airframe reports its own speed to better than a
   * metre a second, so the bank the line needs is known to a tenth of a degree, and
   * what is left for feedback is the initial condition and the wind. Anything faster
   * than this spends the corridor on the beacon's own wander: a fifteen metre error
   * in the estimate is a dozen metres a second of bank asked for and not made. */
  const OMEGA = 0.30;
  const DAMPING = 1.0;
  /** How fast the cross-track carried by the reconstructed track can be wrong outright,
   * in metres a second: the vertical speed that pins the track is read to a few
   * tenths of a degree, and the reconstruction assumes the aircraft is not slipping. */
  const RATE_UNCERTAINTY = 4;
  /** How fast the bias in that rate itself moves, in metres a second each second. A
   * roll transient takes the angle of attack with it and the track reconstruction
   * feels it over about a second, which is a decision period and a half - the filter
   * has to be willing to learn that much or it steers on a phantom drift. */
  const BIAS_WANDER = 8;
  const PROGRESS_FILTER_SECONDS = 9;
  /** The valley-slalom-v1 wall: it rises 200-300 m over one half-width beyond the
   * floor edge with a 0.75-1.0 exponent. Between the foot and a few hundred metres up
   * the middle of those ranges puts the rock within three metres of where any of them
   * would, and the wall itself wanders sideways by about as much. */
  const WALL_RISE_M = 250;
  const WALL_EXPONENT = 0.875;
  const WALL_FOOT_M = 25;
  const WALL_TOP_M = 240;
  const WALL_RAY_MAX_M = 900;
  /** What one wall fix is trusted to. The rays share a second of correlated range
   * noise and the same stretch of wandering rock, so their consensus is worth about
   * one good hit and no more: trusted harder, the filter chases that wander. */
  const WALL_SIGMA_M = 5;

  let route = [], gates = [], waypoints = [];
  let cruise = 435, dt = 0.2;
  let previousPitch = null, previousRoll = null;
  let progress = 0, crossTrack = 0, rateBias = 0;
  let pCross = 0, pCrossBias = 0, pBias = 0, lastGateIndex = 1;
  let command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.4, brakes: 0 };

  function centerAt(progressM) {
    if (!route.length) return { x: 0, z: 0, headingDeg: 0 };
    const last = route.length - 1;
    if (progressM <= route[0].sM) return { ...route[0], headingDeg: 0 };
    if (progressM >= route[last].sM) return { ...route[last], headingDeg: 0 };
    let i = 0;
    while (i < last - 1 && route[i + 1].sM < progressM) i++;
    const a = route[i], b = route[i + 1];
    const share = clamp((progressM - a.sM) / (b.sM - a.sM || 1), 0, 1);
    const dx = b.x - a.x, dz = b.z - a.z;
    return {
      x: a.x + dx * share,
      z: a.z + dz * share,
      // A chord of a smooth arc points where the tangent it averages does: the
      // segment's own midpoint, which is the place this heading is applied at.
      headingDeg: (Math.atan2(dx, -dz) / RAD + 360) % 360,
    };
  }

  /** Cross-track of the line to fly at an along-track position. A gate sits on the
   * inside of the bend it hands the pilot into, so the line runs from one inside
   * offset to the other across the whole leg: the crossing then adds its curvature
   * to the valley's instead of stacking onto the apex, reaches the gate plane
   * parallel to the centreline, and asks for no net bank bias over a leg. */
  function planCrossAt(progressM) {
    if (!gates.length) return 0;
    if (progressM <= gates[0].sM) return gates[0].crossOffsetM;
    const N = gates.length;
    if (progressM >= gates[N - 1].sM) return gates[N - 1].crossOffsetM;
    let i = 1;
    while (i < N && gates[i].sM < progressM) i++;
    const from = gates[i - 1], to = gates[i];
    const share = clamp((progressM - from.sM) / (to.sM - from.sM || 1), 0, 1);
    return from.crossOffsetM + (to.crossOffsetM - from.crossOffsetM) * share * share * (3 - 2 * share);
  }

  /** The passage band the pilot is credited against, read from the chart and
   * interpolated between the gate either side of an along-track position. */
  function passageAglAt(progressM) {
    if (!gates.length) return { minAglM: 50, maxAglM: 90 };
    const band = (gate) => ({ minAglM: gate.passageAglM[0], maxAglM: gate.passageAglM[1] });
    const N = gates.length;
    if (progressM <= gates[0].sM) return band(gates[0]);
    if (progressM >= gates[N - 1].sM) return band(gates[N - 1]);
    let i = 1;
    while (i < N && gates[i].sM < progressM) i++;
    const from = gates[i - 1], to = gates[i];
    const share = clamp((progressM - from.sM) / (to.sM - from.sM || 1), 0, 1);
    const mix = (a, b) => a + (b - a) * share;
    return { minAglM: mix(from.passageAglM[0], to.passageAglM[0]),
      maxAglM: mix(from.passageAglM[1], to.passageAglM[1]) };
  }

  function pathPointAt(progressM) {
    const center = centerAt(progressM);
    const offset = planCrossAt(progressM);
    return { x: center.x + Math.cos(center.headingDeg * RAD) * offset,
      z: center.z + Math.sin(center.headingDeg * RAD) * offset };
  }

  /** Tangent of the line: the centreline heading plus the crab angle the crossing
   * is carrying at that point. */
  function tangentDegAt(progressM) {
    const step = 40;
    const slope = (planCrossAt(progressM + step) - planCrossAt(progressM - step)) / (2 * step);
    return centerAt(progressM).headingDeg + Math.atan(slope) / RAD;
  }

  /** Curvature of the line the pilot is asked to fly, not of the centreline: the
   * crossing over a leg is a lateral manoeuvre of its own, and feeding only the
   * valley's arc leaves that to the feedback loop, which is a decision period and
   * a bank establishment behind. */
  function pathCurvatureAt(progressM) {
    const a = pathPointAt(progressM - 120), b = pathPointAt(progressM), c = pathPointAt(progressM + 120);
    const dx1 = b.x - a.x, dz1 = b.z - a.z, dx2 = c.x - b.x, dz2 = c.z - b.z;
    const len1 = Math.hypot(dx1, dz1), len2 = Math.hypot(dx2, dz2);
    if (!len1 || !len2) return 0;
    // Cross-track is positive to the right, so a right turn has a positive sweep.
    return Math.atan2(dx1 * dz2 - dz1 * dx2, dx1 * dx2 + dz1 * dz2) / ((len1 + len2) / 2);
  }

  /** Nearest point of the centreline to a world position, searched along the stretch
   * of route either side of an along-track guess: progress, signed cross-track and
   * the half-width the chart states there. */
  function projectRoute(x, z, nearM, reachM) {
    let best = null;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      if (b.sM < nearM - reachM || a.sM > nearM + reachM) continue;
      const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz || 1;
      const share = clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1);
      const px = a.x + dx * share, pz = a.z + dz * share;
      const distanceSquared = (x - px) ** 2 + (z - pz) ** 2;
      if (best && distanceSquared >= best.distanceSquared) continue;
      const length = Math.sqrt(lengthSquared);
      best = { distanceSquared, sM: a.sM + (b.sM - a.sM) * share,
        crossM: ((x - px) * -dz + (z - pz) * dx) / length,
        halfWidthM: (a.halfWidthM ?? 70) + ((b.halfWidthM ?? 70) - (a.halfWidthM ?? 70)) * share };
    }
    return best;
  }

  /** A body-frame direction (+X right, +Y up, -Z forward) in the world, from the
   * attitude the instruments report: roll about the nose, then pitch, then heading. */
  function bodyToWorld(d, headingDeg, pitchDeg, rollDeg) {
    const r = -rollDeg * RAD, p = pitchDeg * RAD, h = -headingDeg * RAD;
    const x1 = d.x * Math.cos(r) - d.y * Math.sin(r), y1 = d.x * Math.sin(r) + d.y * Math.cos(r);
    const y2 = y1 * Math.cos(p) - d.z * Math.sin(p), z2 = y1 * Math.sin(p) + d.z * Math.cos(p);
    return { x: x1 * Math.cos(h) + z2 * Math.sin(h), y: y2, z: -x1 * Math.sin(h) + z2 * Math.cos(h) };
  }

  /** Cross-track of the aircraft as the valley walls place it. Each range the forward
   * terrain instrument returns off a wall puts a point of rock somewhere relative to
   * the aircraft; the course contract says how far outside the half-width rock that
   * high above the floor stands, so the point says where across the corridor the
   * aircraft must be. A wall hit is a few metres wrong where the beacon is tens of
   * them, and it does not get worse with the distance left to the gate. Hits low on
   * the wall foot cannot be told from the floor and are left out, as are long rays
   * whose range error lands across the corridor. Many rays see the same rock, so the
   * answer is the consensus around their median, not a mean that one stray can pull. */
  function wallCross(terrain, aircraft, height, headingDeg, pitchDeg, rollDeg) {
    const fixes = [];
    for (const cell of terrain?.cells ?? []) {
      if (cell.status !== 'available' || !Number.isFinite(cell.rangeM?.mean)) continue;
      const rangeM = cell.rangeM.mean;
      if (rangeM > WALL_RAY_MAX_M) continue;
      const az = cell.azimuthDeg * RAD, el = cell.elevationDeg * RAD;
      const ray = bodyToWorld({ x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) },
        headingDeg, pitchDeg, rollDeg);
      const rise = height + ray.y * rangeM;
      if (rise < WALL_FOOT_M || rise > WALL_TOP_M) continue;
      const hit = projectRoute(aircraft.x + ray.x * rangeM, aircraft.z + ray.z * rangeM, progress, rangeM + 300);
      if (!hit) continue;
      const wall = hit.halfWidthM * (1 + (rise / WALL_RISE_M) ** (1 / WALL_EXPONENT));
      fixes.push(Math.sign(hit.crossM) * wall - (hit.crossM - crossTrack));
    }
    if (fixes.length < 3) return null;
    fixes.sort((a, b) => a - b);
    const median = fixes[fixes.length >> 1];
    const near = fixes.filter(v => Math.abs(v - median) < 10);
    return near.reduce((sum, v) => sum + v, 0) / near.length;
  }

  /** Azimuth of the direction of travel, from an attitude the pilot is briefed and a
   * vertical speed it measures. Coordinated flight keeps the airflow inside the
   * symmetry plane, so that plane's own azimuth - fixed by the wing line - and the
   * angle it must be tipped by to reach the measured climb rate together pin the
   * track. The sine has a second solution pointing aft; the nose chooses between
   * them. Only the cross product of the wing line with the heading carries the
   * information, so the answer degrades to the heading itself wings level. */
  function groundTrackDeg(headingDeg, pitchDeg, rollDeg, gamma) {
    const h = headingDeg * RAD, p = pitchDeg * RAD, b = rollDeg * RAD;
    const x = Math.cos(b) * Math.cos(h) - Math.sin(b) * Math.sin(p) * Math.sin(h);
    const y = -Math.sin(b) * Math.cos(p);
    const z = Math.cos(b) * Math.sin(h) - Math.sin(b) * Math.sin(p) * Math.cos(h);
    const horizontal = Math.hypot(x, z);
    if (horizontal < 0.05) return (headingDeg + 360) % 360;
    const tilt = Math.asin(clamp(-Math.tan(gamma) * y / horizontal, -1, 1)) / RAD;
    const wingAzimuth = Math.atan2(z, x) / RAD;
    const ahead = wingAzimuth + tilt, astern = wingAzimuth + 180 - tilt;
    // A shallow sine reaches the same vertical speed from either side of the plane,
    // and only the flight-path angle itself says which; the nose is within the
    // ten degrees of the answer here, the aft solution is not.
    return ((Math.abs(signed(ahead - headingDeg)) <= Math.abs(signed(astern - headingDeg))
      ? ahead : astern) + 360) % 360;
  }

  function reset(briefing = {}) {
    route = briefing.course?.route ?? [];
    gates = briefing.course?.gates ?? [];
    waypoints = briefing.course?.points ?? [];
    cruise = briefing.recommendedSpeeds?.cruiseKnots ?? 435;
    dt = briefing.decisionPeriodSeconds ?? 0.2;
    previousPitch = previousRoll = null;
    lastGateIndex = 1;
    // The chart states the first passage space and the briefing states where the
    // aircraft was dispatched, so the along-track state starts on the chart rather
    // than waiting for a measurement to place it there.
    progress = gates.length ? gates[0].sM : 0;
    const start = briefing.departure, first = waypoints[0];
    const atSpawn = Boolean(gates.length && start && first &&
      Math.hypot(start.x - first.x, start.z - first.z) < 1);
    crossTrack = atSpawn ? gates[0].crossOffsetM : 0;
    // A pilot put inside the first passage space starts knowing exactly where across
    // the corridor it is; one put anywhere else has to let the beacon find it, and
    // says so in the variance it hands the first fix. Either way the track it is
    // carrying itself by is unproven until the beacon has a slope to judge it by.
    rateBias = 0;
    pCross = atSpawn ? 0 : 900;
    pCrossBias = 0;
    pBias = 36;
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.52, brakes: 0 };
  }

  return {
    reset,
    onTick(observation) {
      const s = observation?.instruments ?? {}, nav = observation?.navigation ?? {};
      const ias = read(s.iasKnots), pitch = read(s.pitchDeg), roll = read(s.rollDeg);
      const heading = read(s.headingDeg), altitudeFt = read(s.radioAltFt), vsiFpm = read(s.vsiFpm);
      const gateBearing = read(nav.goalBearingDeg), gateRange = read(nav.goalRangeM);
      const gateIndex = nav.currentGateIndex;
      const waypoint = waypoints[gateIndex];
      if ([ias, pitch, roll, heading, altitudeFt, vsiFpm, gateBearing, gateRange].some(v => v === null)
          || !Number.isInteger(gateIndex) || !waypoint || !route.length || !gates.length) return { ...command };

      const height = altitudeFt * 0.3048, vz = vsiFpm * 0.3048 / 60;
      const track = Math.max(40, (read(s.groundSpeedKnots) ?? ias) * 0.514444);
      // The nose is not the direction of travel. Holding this much bank takes this
      // much angle of attack, and a body rolled over points its nose inside the turn
      // by close to ten degrees here - forty metres a second of apparent lateral
      // motion that is not happening, which is the whole corridor in two seconds.
      // Reconstruct the track instead of guessing at the angle of attack that would
      // explain it: the aircraft reports a vertical speed and an attitude, and
      // coordinated flight turns those into the direction it is actually going.
      const air = (read(s.tasKnots) ?? ias * 1.07) * 0.514444;
      const trackAngle = groundTrackDeg(heading, pitch, roll,
        Math.asin(clamp(vz / Math.max(40, air), -0.5, 0.5)));

      // Where the beacon says the aircraft is, in the corridor's own frame: the
      // range error runs along the line of sight, which is nearly the corridor
      // direction all the way down a leg, so it lands on progress and leaves the
      // cross-track to the bearing.
      const course0 = centerAt(progress);
      const courseHeading = course0.headingDeg * RAD;
      const right = { x: Math.cos(courseHeading), z: Math.sin(courseHeading) };
      const along = { x: Math.sin(courseHeading), z: -Math.cos(courseHeading) };
      const fixed = { x: waypoint.x - Math.sin(gateBearing * RAD) * gateRange,
        z: waypoint.z + Math.cos(gateBearing * RAD) * gateRange };
      const measuredCross = (fixed.x - course0.x) * right.x + (fixed.z - course0.z) * right.z;
      const measuredProgress = progress + (fixed.x - course0.x) * along.x + (fixed.z - course0.z) * along.z;

      // Crossing a gate plane is the one position the pilot learns without
      // measuring it, so the along-track state is re-tied to the chart there and
      // only drifted between two of them.
      if (gateIndex !== lastGateIndex && gates[Math.min(gates.length - 1, gateIndex - 1)]) {
        progress = gates[Math.min(gates.length - 1, gateIndex - 1)].sM;
      }
      lastGateIndex = gateIndex;
      const advance = track * dt;
      progress += advance + (1 - Math.exp(-dt / PROGRESS_FILTER_SECONDS))
        * (measuredProgress - progress - advance);

      // The cross-track is carried by the reconstructed track and corrected by the
      // beacon, and what the beacon really buys is the *rate*: a reconstruction that
      // is three degrees wrong for as long as a roll transient lasts is fifteen metres
      // a second of phantom lateral motion, and a position correction alone takes
      // seconds of it to show up. So the filter carries the bias too, and the bias is
      // what the beacon's slope says about it. The beacon's cross-track error is its
      // bearing error times the range and the range runs out exactly as the gate it
      // points at is reached, so the trust in each fix moves with the leg instead of
      // on a stopwatch.
      const trackDeg = trackAngle + rateBias / track / RAD;
      crossTrack += (track * Math.sin((trackDeg - course0.headingDeg) * RAD)) * dt;
      pCross += (2 * dt * pCrossBias) + dt * dt * pBias + (RATE_UNCERTAINTY * dt) ** 2;
      pCrossBias += dt * pBias;
      pBias += (BIAS_WANDER * dt) ** 2;
      const sigma = Math.hypot(gateRange * 0.0087, 2);
      const share = pCross + sigma * sigma;
      const fixCross = pCross / share, fixBias = pCrossBias / share;
      const correction = measuredCross - crossTrack;
      crossTrack += fixCross * correction;
      rateBias += fixBias * correction;
      pBias -= fixBias * pCrossBias;
      pCross *= 1 - fixCross;
      pCrossBias *= 1 - fixCross;

      // The walls are the better fix wherever the instrument can see them, and folding
      // them in the same way keeps the bias learning from both.
      const here = centerAt(progress);
      const aircraft = { x: here.x + Math.cos(here.headingDeg * RAD) * crossTrack,
        z: here.z + Math.sin(here.headingDeg * RAD) * crossTrack };
      const walled = wallCross(observation.terrain, aircraft, height, heading, pitch, roll);
      if (walled !== null) {
        const wallShare = pCross + WALL_SIGMA_M * WALL_SIGMA_M;
        const wallFix = pCross / wallShare, wallBias = pCrossBias / wallShare;
        const wallCorrection = walled - crossTrack;
        crossTrack += wallFix * wallCorrection;
        rateBias += wallBias * wallCorrection;
        pBias -= wallBias * pCrossBias;
        pCross *= 1 - wallFix;
        pCrossBias *= 1 - wallFix;
      }

      // Lateral: feed the arc the line is on, then close a damped loop on what the
      // feedforward missed. The lead is the lag the loop cannot see through: a
      // decision period, the command delay and the time the wing takes to arrive. It
      // belongs on the curvature and on the predicted error, not on the tangent the
      // heading is compared with: pointing the track at a tangent ahead of the
      // aircraft makes a path follower cut the corner by a constant offset, a few
      // metres down a long easy leg and tens of them through a concentrated bend.
      const leadM = clamp(track * 0.75, 150, 240);
      const headingError = signed(tangentDegAt(progress) - trackDeg);
      const crossError = crossTrack - planCrossAt(progress)
        - leadM * Math.sin(headingError * RAD);
      // Feed the arc a second and a third ahead, not three quarters. Rolling in takes
      // half a second and the wing holds it; the load factor that actually turns the
      // aircraft is carried by the pitch, and the angle of attack takes another
      // second and a half to arrive. Banked for the bend it is standing in, the
      // aircraft is a whole bend behind, and the corridor is spent trying to catch up
      // with the bank already clamped.
      const ffLeadM = clamp(track * 1.3, 260, 430);
      const arc = track * track * pathCurvatureAt(progress + ffLeadM);
      const position = -OMEGA * OMEGA * crossError;
      const approach = 2 * DAMPING * OMEGA * track * Math.sin(headingError * RAD);
      const aLat = clamp(arc + position + approach, -52, 52);
      const bankTarget = clamp(Math.atan(aLat / GRAVITY) / RAD, -84, 84);

      // Vertical: hold the line in the middle of the passage band the pilot is
      // approaching, and never closer to the ceiling than to the floor.
      const band = passageAglAt(progress + leadM);
      const heightTarget = clamp((band.minAglM + band.maxAglM) / 2, band.minAglM, band.maxAglM - 25);
      const rateTarget = clamp((heightTarget - height) * 0.30, -14, 14);
      // The bank the ailerons put on the wing is not the turn the aircraft is making.
      // The load factor that makes the turn is carried by the angle of attack, and the
      // pitch takes a second and a half to bring it, so a bend flown on the bank alone
      // is entered at one g and spent falling short of the line. Ask for the load factor
      // against the bank being commanded rather than the bank already held, and let the
      // height error trim that request instead of dividing into it: a share of the turn
      // would be handed back every time the aircraft arrived a few metres high, and
      // fifteen metres of bend flown at one g instead of two costs the corridor a
      // hundred metres of line, while fifteen metres of altitude error is worth a tenth
      // of a g.
      const cosBank = Math.max(0.25, Math.cos(roll * RAD));
      const cosBankCommand = Math.max(0.25, Math.cos(bankTarget * RAD));
      const nz = (1 + clamp(rateTarget - vz, -8, 8) * 0.55 / GRAVITY) / cosBankCommand
        + (1 / cosBank - 1 / cosBankCommand) * 0.5;
      // The instrument labelled pitch rate is a body-axis rate, and a banked aircraft
      // turning at ten degrees a second spins its own pitch axis at nine of them
      // without changing its attitude at all. Difference the pitch the pilot is
      // actually shown instead.
      const measuredPitchRate = previousPitch === null ? 0 : (pitch - previousPitch) / dt;
      const measuredRollRate = read(s.rollRateDegS) ?? (previousRoll === null ? 0 : (roll - previousRoll) / dt);
      previousPitch = pitch; previousRoll = roll;
      const elevator = clamp((nz - 1) / G_PER_ELEVATOR - clamp(measuredPitchRate, -40, 40) * 0.0012, -0.55, 0.6);

      // Roll: aileron produces a roll rate, so command the rate that closes the
      // bank error and trim it against the rate the wing is already carrying.
      const rollRateTarget = clamp((bankTarget - roll) * 3.2, -120, 120);
      const aileron = clamp((rollRateTarget - measuredRollRate) / DEGREES_PER_S_PER_AILERON, -0.45, 0.45);
      const throttle = clamp((cruise - ias) * 0.06 + (1 / cosBank - 1) * 0.10 + 0.45, 0, 1);

      command = { elevator, aileron, rudder: 0, throttle, brakes: 0 };
      return { ...command };
    },
  };
}

export const valleySlalomPilotSource = `// Experimental F16 valley slalom SDK pilot.\nexport ${createPilot.toString()}\n`;
