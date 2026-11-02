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
  let command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.4, brakes: 0 };
  let hint = 0;

  function solveKnots() {
    return gates.map((g, i) => {
      if (i === 0) return g.crossOffsetM;
      const off = g.crossOffsetM;
      const nextOff = gates[i + 1]?.crossOffsetM ?? 0;
      const clipDir = (nextOff < off) ? -1 : 1;
      const maxClip = Math.min(24, (g.passageHalfWidthM ?? 60) * 0.4);
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
    return { x: a.x + dx * share, z: a.z + dz * share, nx: -dz / len, nz: dx / len };
  }

  function planCrossAt(progressM) {
    if (progressM <= gates[0].sM) return knots[0];
    const N = gates.length;
    if (progressM >= gates[N - 1].sM) return knots[N - 1];
    let i = 1;
    while (i < N - 1 && gates[i].sM < progressM) i++;
    const from = gates[i - 1], to = gates[i];
    const h = to.sM - from.sM || 1;
    const t = clamp((progressM - from.sM) / h, 0, 1);
    const S = t * t * (3 - 2 * t);
    return knots[i - 1] + (knots[i] - knots[i - 1]) * S;
  }

  function pathPointAt(progressM) {
    const center = centerAt(progressM);
    const crossM = planCrossAt(progressM);
    return { x: center.x + center.nx * crossM, z: center.z + center.nz * crossM };
  }

  function pathCurvatureAt(progressM) {
    const ds = 40;
    const p0 = pathPointAt(progressM - ds);
    const p1 = pathPointAt(progressM);
    const p2 = pathPointAt(progressM + ds);
    const h1 = Math.atan2(p1.x - p0.x, -(p1.z - p0.z));
    const h2 = Math.atan2(p2.x - p1.x, -(p2.z - p1.z));
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return dh / ds;
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
    cruise = 236;
    trimDeg = briefing.configuration?.pitchTrimDeg ?? 0;
    dt = briefing.decisionPeriodSeconds ?? 0.2;
    hint = 0;
    filteredVz = 0;
    previousPitch = previousRoll = previousHeight = null;
    if (gates[0] && route.length) {
      let bestD = Infinity;
      for (let i = 0; i < route.length; i++) {
        const d = Math.hypot(route[i].x - gates[0].x, route[i].z - gates[0].z);
        if (d < bestD) { bestD = d; hint = i; }
      }
    }
    if (gates.length >= 2) knots = solveKnots();
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.35, brakes: 0 };
  }

  return {
    reset,
    onTick(observation) {
      const s = observation?.instruments ?? {}, nav = observation?.navigation ?? {};
      const ias = read(s.iasKnots), pitch = read(s.pitchDeg), roll = read(s.rollDeg);
      const heading = read(s.headingDeg), altitudeFt = read(s.radioAltFt), vsiFpm = read(s.vsiFpm);
      const gateBearing = read(nav.goalBearingDeg), gateRange = read(nav.goalRangeM);
      const waypoint = waypoints[nav.currentGateIndex];
      if ([ias, pitch, roll, heading, altitudeFt, vsiFpm, gateBearing, gateRange].some(v => v === null)
          || !waypoint || !route.length || !gates.length) return { ...command };

      const ownX = waypoint.x - Math.sin(gateBearing * RAD) * gateRange;
      const ownZ = waypoint.z + Math.cos(gateBearing * RAD) * gateRange;
      const here = project(ownX, ownZ);
      if (!here || here.distance > 1200) return { ...command };

      const height = altitudeFt * 0.3048, vz = vsiFpm * 0.3048 / 60;
      const speed = Math.max(40, (read(s.tasKnots) ?? ias * 1.13) * 0.514444);

      // Pure pursuit carrot guidance with lookahead and path curvature feedforward
      const lookDist = speed * 2.2;
      const carrot = pathPointAt(here.progressM + lookDist);

      const dx = carrot.x - ownX, dz = carrot.z - ownZ;
      const carrotDist = Math.hypot(dx, dz) || 1;
      const carrotBearing = (Math.atan2(dx, -dz) / RAD + 360) % 360;
      const bearingError = signed(carrotBearing - heading);

      const ffAcc = speed * speed * pathCurvatureAt(here.progressM + speed * 1.4);
      const fbAcc = 2 * speed * speed * Math.sin(bearingError * RAD) / carrotDist;
      const aLat = clamp(ffAcc + fbAcc, -14.5, 14.5);
      const bankTarget = clamp(Math.atan(aLat / GRAVITY) / RAD, -58, 58);

      // Vertical equilibrium with terrain slope feedforward
      const terrainClimbRate = clamp(vz - (height - (previousHeight ?? height)) / dt, -10, 15);
      previousHeight = height;

      const targetHeight = 60;
      let desiredVz = clamp((targetHeight - height) * 0.5 + 0.8 * Math.max(0, terrainClimbRate), -8, 16);
      if (height < 35 && vz < 1) desiredVz = Math.max(desiredVz, (40 - height) * 0.8);
      desiredVz += (Math.abs(bankTarget) / 58) ** 2 * 1.0;
      filteredVz += (desiredVz - filteredVz) * (1 - Math.exp(-dt / 0.35));

      const measuredPitchRate = read(s.pitchRateDegS) ?? (previousPitch === null ? 0 : (pitch - previousPitch) / dt);
      const measuredRollRate = read(s.rollRateDegS) ?? (previousRoll === null ? 0 : (roll - previousRoll) / dt);
      previousPitch = pitch; previousRoll = roll;
      const pitchRate = clamp(measuredPitchRate, -50, 50) * RAD;
      const rollRate = clamp(measuredRollRate, -80, 80) * RAD;
      const q = Math.max(500, 0.5 * 1.225 * (ias * 0.514444) ** 2);
      const flightPath = Math.atan2(vz, speed);

      const cosBank = Math.max(0.42, Math.cos(roll * RAD));
      const turnAlpha = clamp((12000 * GRAVITY / (q * 27.87 * cosBank) - 0.05) / 4.2, 0.02, 0.23);
      const alphaEstimate = pitch * RAD - flightPath;
      const pitchTarget = clamp((Math.atan2(filteredVz, speed) + turnAlpha + (turnAlpha - alphaEstimate)) / RAD, -20, 32) * RAD;
      const desiredPitchRate = clamp((pitchTarget - pitch * RAD) * 1.8, -0.35, 0.35);
      const requiredCm = 75000 * (desiredPitchRate - pitchRate) * 2.5 / (q * 27.87 * 3.45);
      const qHat = pitchRate * 3.45 / (2 * speed);
      const elevator = ((requiredCm + 0.45 * alphaEstimate + 12 * qHat) / 1.8 - trimDeg * RAD) / (20 * RAD);

      // High-authority bank response with 0.32s transport-delay prediction
      const rollLead = roll + (rollRate / RAD) * 0.32;
      const desiredRollRate = clamp((bankTarget - rollLead) * 1.6, -70, 70) * RAD;
      const requiredCl = 12800 * (desiredRollRate - rollRate) * 3 / (q * 27.87 * 9.96);
      const aileron = (requiredCl + 0.45 * rollRate * 9.96 / (2 * speed)) / (0.35 * 1.05 * 20 * RAD);
      const throttle = clamp((cruise - ias) * 0.04 + Math.max(0, filteredVz) * 0.005 + 0.30, 0, 1);

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
