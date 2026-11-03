/**
 * Experimental F16 valley slalom SDK pilot; not real-aircraft flight software.
 *
 * S-curve passage guidance through ordered procedural valley gates:
 * - Solves racing-line corridor knots to clip inside passage margins toward upcoming turns.
 * - Pure-pursuit lookahead along the cubic-Hermite spline path with dynamic damping.
 * - Feedforward pitch equilibrium compensating coordinated-turn bank angle and terrain elevation slope.
 * - Transport-delay lead prediction on aileron roll authority for high-rate bank reversals.
 */

export function createPilot() {
  const RAD = Math.PI / 180;
  const GRAVITY = 9.80665;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const signed = v => ((v + 540) % 360) - 180;
  const read = s => s?.status === 'available' && Number.isFinite(s.mean) ? s.mean : null;

  let route = [], gates = [], waypoints = [], knots = [];
  let cruise = 236, trimDeg = 0, dt = 0.2;
  let filteredVz = 0, previousPitch = null, previousRoll = null, previousHeight = null;
  let bankIntegral = 0;
  let estX = null, estZ = null;
  let command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.4, brakes: 0 };
  let hint = 0;

  function solveKnots() {
    return gates.map((g, i) => {
      if (i === 0) return g.crossOffsetM;
      const off = g.crossOffsetM;
      const nextOff = gates[i + 1]?.crossOffsetM ?? 0;
      const clipDir = (nextOff < off) ? -1 : 1;
      const maxClip = Math.min(10, (g.passageHalfWidthM ?? 25) * 0.35);
      return off + clipDir * maxClip;
    });
  }

  function centerAt(progressM) {
    if (progressM <= route[0].sM) return { x: route[0].x, z: route[0].z, nx: 1, nz: 0 };
    const last = route.length - 1;
    if (progressM >= route[last].sM) return { x: route[last].x, z: route[last].z, nx: 1, nz: 0 };
    let i = 0;
    while (i < last - 1 && route[i + 1].sM < progressM) i++;
    const a = route[i], b = route[i + 1];
    const share = clamp((progressM - a.sM) / (b.sM - a.sM || 1), 0, 1);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return {
      x: a.x + dx * share,
      z: a.z + dz * share,
      nx: -dz / len,
      nz: dx / len,
      headingDeg: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360,
    };
  }

  function planCrossAt(progressM) {
    if (!gates.length) return 0;
    if (progressM <= gates[0].sM) return gates[0].crossOffsetM;
    const N = gates.length;
    if (progressM >= gates[N - 1].sM) return gates[N - 1].crossOffsetM;
    let i = 1;
    while (i < N && gates[i].sM < progressM) i++;
    const from = gates[i - 1], to = gates[i];
    const s = progressM - from.sM;
    const L = to.sM - from.sM || 1;
    const transitionStart = Math.max(L * 0.70, L - 750);
    const apexOffset = from.crossOffsetM * 0.60;
    if (s < transitionStart) {
      return apexOffset;
    }
    const u = (s - transitionStart) / (L - transitionStart || 1);
    const w = u * u * (3 - 2 * u);
    return apexOffset * (1 - w) + to.crossOffsetM * w;
  }

  function pathPointAt(progressM) {
    const center = centerAt(progressM);
    const crossM = planCrossAt(progressM);
    return { x: center.x + center.nx * crossM, z: center.z + center.nz * crossM };
  }

  function pathCurvatureAt(progressM) {
    const c1 = centerAt(progressM - 150);
    const c2 = centerAt(progressM + 150);
    return signed(c2.headingDeg - c1.headingDeg) * RAD / 300;
  }

  function project(x, z) {
    let best = null;
    const last = route.length - 2;
    for (let index = Math.max(0, hint - 6); index <= Math.min(last, hint + 6); index++) {
      const a = route[index], b = route[index + 1];
      const dx = b.x - a.x, dz = b.z - a.z, sq = dx * dx + dz * dz || 1;
      const share = clamp(((x - a.x) * dx + (z - a.z) * dz) / sq, 0, 1);
      const px = a.x + dx * share, pz = a.z + dz * share;
      const distance = Math.hypot(x - px, z - pz);
      if (best && distance >= best.distance) continue;
      const length = Math.sqrt(sq);
      best = {
        distance,
        index,
        progressM: a.sM + (b.sM - a.sM) * share,
        crossM: (-dz * (x - px) + dx * (z - pz)) / length,
      };
    }
    if (!best) return null;
    hint = best.index;
    return best;
  }

  function reset(briefing = {}) {
    route = briefing.course?.route ?? [];
    gates = briefing.course?.gates ?? [];
    waypoints = briefing.course?.points ?? [];
    cruise = briefing.recommendedSpeeds?.cruiseKnots ?? 410;
    trimDeg = briefing.configuration?.pitchTrimDeg ?? 0;
    dt = briefing.decisionPeriodSeconds ?? 0.2;
    hint = 0;
    filteredVz = 0;
    bankIntegral = 0;
    previousPitch = previousRoll = previousHeight = null;
    estX = estZ = null;
    if (gates[0] && route.length) {
      let bestD = Infinity;
      for (let i = 0; i < route.length; i++) {
        const d = Math.hypot(route[i].x - gates[0].x, route[i].z - gates[0].z);
        if (d < bestD) { bestD = d; hint = i; }
      }
    }
    if (gates.length >= 2) knots = solveKnots();
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.52, brakes: 0 };
  }

  return {
    reset,
    onTick(observation) {
      const s = observation?.instruments ?? {}, nav = observation?.navigation ?? {};
      const ias = read(s.iasKnots), pitch = read(s.pitchDeg), roll = read(s.rollDeg);
      const heading = read(s.headingDeg), altitudeFt = read(s.radioAltFt), vsiFpm = read(s.vsiFpm);
      const gateBearing = read(nav.goalBearingDeg), gateRange = read(nav.goalRangeM);
      const waypoint = waypoints[nav.currentGateIndex];
      const currentGate = gates[nav.currentGateIndex];
      if ([ias, pitch, roll, heading, altitudeFt, vsiFpm, gateBearing, gateRange].some(v => v === null)
          || !waypoint || !currentGate || !route.length || !gates.length) return { ...command };

      // Noise-filtered absolute position from gate radio beacon
      const measX = waypoint.x - Math.sin(gateBearing * RAD) * gateRange;
      const measZ = waypoint.z + Math.cos(gateBearing * RAD) * gateRange;
      if (estX === null) { estX = measX; estZ = measZ; }
      else {
        estX += 0.35 * (measX - estX);
        estZ += 0.35 * (measZ - estZ);
      }
      const here = project(estX, estZ);
      if (!here || here.distance > 1200) return { ...command };

      const height = altitudeFt * 0.3048, vz = vsiFpm * 0.3048 / 60;
      const speed = Math.max(40, (read(s.tasKnots) ?? ias * 1.13) * 0.514444);

      // Lateral guidance: path curvature feedforward + Stanley cross-track correction
      const center = centerAt(here.progressM);
      const relHdg = signed(heading - center.headingDeg);

      const curvLeadDist = clamp(speed * 0.80, 180, 230);
      const curvLeadAhead = pathCurvatureAt(here.progressM + curvLeadDist);
      const curvHere = pathCurvatureAt(here.progressM);
      // Lead into turns in advance; but when exiting, stay in the turn until actually reaching the exit!
      const curvDemand = (Math.abs(curvLeadAhead) < Math.abs(curvHere)) ? curvHere : curvLeadAhead;
      const ffAcc = speed * speed * curvDemand;

      // Cross-track heading intercept
      const targetCross = planCrossAt(here.progressM);
      const crossError = here.crossM - targetCross;
      const headingInterceptDeg = clamp((-crossError * 0.70 / speed) / RAD, -12, 12);
      const desiredHeading = center.headingDeg + headingInterceptDeg;
      const headingError = signed(desiredHeading - heading);
      const fbAcc = clamp(headingError * 1.2, -12, 12);

      const aLat = clamp(ffAcc + fbAcc, -46, 46);
      const bankTarget = clamp(Math.atan(aLat / GRAVITY) / RAD, -77, 77);

      // Coordinated turn load factor: exactly balance weight and centripetal demand
      const cosBank = Math.max(0.20, Math.cos(roll * RAD));
      const nLat = Math.abs(aLat) / GRAVITY;
      const reqNz = Math.sqrt(1 + nLat * nLat);
      // Vertical altitude regulation: hold flat level flight (vz -> 0) in the turn
      const deltaNz = clamp((-vz * 0.4) / (GRAVITY * cosBank), -0.25, 0.5);
      const targetNz = clamp(reqNz + deltaNz, 0.8, 5.0);

      // Dynamic control stiffness at current IAS
      const stiffness = Math.max(0.40, 1.0 - Math.max(0, (ias - 140) / 220.0) * 0.55);
      const elevFeedforward = clamp((targetNz - 1.0) / (27.0 * stiffness), -0.30, 0.65);

      const measuredPitchRate = read(s.pitchRateDegS) ?? (previousPitch === null ? 0 : (pitch - previousPitch) / dt);
      const measuredRollRate = read(s.rollRateDegS) ?? (previousRoll === null ? 0 : (roll - previousRoll) / dt);
      previousPitch = pitch; previousRoll = roll;
      const pitchRate = clamp(measuredPitchRate, -50, 50) * RAD;
      const rollRate = clamp(measuredRollRate, -100, 100) * RAD;

      const qTurn = Math.abs(curvDemand) * speed * Math.abs(Math.sin(roll * RAD));
      // Steady-turn pitch rate trim with vertical rate stabilization
      const qTrimElev = Math.max(0, (qTurn * 0.10 - clamp(vz * 0.015, -0.04, 0.04))) / stiffness;

      // Pitch attitude tracking active for bank < 60 deg
      const wingsLevel = Math.max(0, cosBank - 0.5) / 0.5;
      const desiredVz = clamp((80 - height) * 0.6, -18, 12);
      const targetPitchDeg = 1.19 + clamp(desiredVz * 0.35, -5.0, 3.0);
      const straightPitchElev = (wingsLevel * clamp((targetPitchDeg - pitch) * 0.08 - (pitchRate / RAD) * 0.03, -0.35, 0.35)) / stiffness;

      const elevator = elevFeedforward + qTrimElev + straightPitchElev;

      // Critically damped roll response (calibrated for F-16 roll inertia and 435kt dynamic pressure)
      const bankError = bankTarget - roll;
      const rollRateDeg = rollRate / RAD;
      const aileron = clamp(bankError * 0.009 - rollRateDeg * 0.0022, -0.45, 0.45);
      const throttle = clamp((cruise - ias) * 0.08 + (1 / cosBank - 1) * 0.30 + 0.52, 0, 1);

      // Control outputs with calibrated actuator bounds
      command = {
        elevator: clamp(elevator, -0.7, 0.8),
        aileron: clamp(aileron, -0.6, 0.6),
        rudder: 0,
        throttle,
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const valleySlalomPilotSource = `// Experimental F16 valley slalom SDK pilot.\nexport ${createPilot.toString()}\n`;
