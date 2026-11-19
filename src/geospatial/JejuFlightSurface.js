import * as THREE from 'three';
import airfield from '../config/jejuAirfield.json' with { type: 'json' };

export { airfield as JEJU_AIRFIELD };

function segmentDistance(px, pz, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - a[0], pz - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSq));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

export class JejuFlightSurface {
  constructor(airfieldData = airfield) {
    this.airfield = airfieldData;
    this.elevationM = airfieldData.elevationM ?? 36.0;
    this.hallasan = airfieldData.hallasan ?? { x: 3741.4, z: 16591.7, elevationM: 1947.0 };
    this.surfaces = airfieldData.runways.map(r => ({
      ...r,
      bounds: [
        Math.min(r.points[0][0], r.points[1][0]),
        Math.min(r.points[0][1], r.points[1][1]),
        Math.max(r.points[0][0], r.points[1][0]),
        Math.max(r.points[0][1], r.points[1][1]),
      ],
    }));
  }

  distance(surface, x, z) {
    const d = segmentDistance(x, z, surface.points[0], surface.points[1]);
    return Math.max(0, d - surface.width / 2);
  }

  isOnRunway(x, z) {
    return this.surfaces.some(s => this.distance(s, x, z) < 0.001);
  }

  isRunwaySafetyArea(x, z) {
    return this.surfaces.some(s => this.distance(s, x, z) <= 60);
  }

  getHeight(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error('Invalid flight terrain coordinate');
    }

    // Leveled airport grade for runways and safety buffer zone (350m buffer ensures coarse
    // 250m terrain mesh vertices within runway corridors are completely planar at 36m)
    for (const surface of this.surfaces) {
      const d = this.distance(surface, x, z);
      if (d <= 350) {
        return this.elevationM;
      }
    }

    // Elliptical boundary of Jeju Island centered near Hallasan
    const hx = this.hallasan.x;
    const hz = this.hallasan.z;
    const islandDx = (x - hx) / 36000;
    const islandDz = (z - hz) / 24000;
    const islandDistSq = islandDx * islandDx + islandDz * islandDz;

    // Sea level outside island coast
    if (islandDistSq >= 1.0) {
      return 0.0;
    }

    const coastFactor = Math.cos(Math.sqrt(islandDistSq) * (Math.PI * 0.5));

    // Volcanic shield elevation profile peaking at Mount Hallasan (1,947m)
    const distToPeak = Math.hypot(x - hx, z - hz);
    const hallasanShield = this.hallasan.elevationM * Math.exp(-((distToPeak / 7500) ** 1.6));
    const baseSlope = 120.0 * coastFactor;
    const naturalHeight = (hallasanShield + baseSlope) * coastFactor;

    // Smooth blending outside airport precinct (entire airport plateau within 2.4km is leveled at 36m)
    const distToAirport = Math.hypot(x, z);
    if (distToAirport < 2400) {
      return this.elevationM;
    }
    if (distToAirport < 5000) {
      const t = Math.max(0, Math.min(1, (distToAirport - 2400) / 2600));
      const blend = t * t * (3 - 2 * t);
      return this.elevationM * (1 - blend) + naturalHeight * blend;
    }

    return naturalHeight;
  }

  getNormal(x, z) {
    const d = 1.0;
    return new THREE.Vector3(
      this.getHeight(x - d, z) - this.getHeight(x + d, z),
      2 * d,
      this.getHeight(x, z - d) - this.getHeight(x, z + d)
    ).normalize();
  }
}

export function jejuSpawn(type, groundClearance, aircraftId = 'B738') {
  const a = airfield.approach;
  const angle = (a.headingDeg * Math.PI) / 180;
  const dir = { x: Math.sin(angle), z: -Math.cos(angle) };

  const isChallenge = type === 'challenge';
  const isCruise = type === 'cruise';
  const isApproach = type === 'approach';

  if (isCruise) {
    // Hallasan Scenic Cruise: North of Mount Hallasan flying south towards the 1,947m summit at 10,000 ft
    const speed = aircraftId === 'C172' ? 48 : aircraftId === 'F16' ? 180 : 108;
    return {
      x: airfield.hallasan.x,
      z: 7500,
      y: 3048, // 10,000 ft
      yaw: -Math.PI, // Heading South (180°)
      vx: 0,
      vy: 0,
      vz: speed,
    };
  }

  const distance = isChallenge ? -5000 : isApproach ? -5556 : 100;
  const offset = isChallenge ? 350 : 0;
  const interceptAngle = isChallenge ? angle - (20 * Math.PI / 180) : angle;
  const speed = type === 'runway' ? 0
    : aircraftId === 'C172' ? (isChallenge ? 42 : isApproach ? 33 : 48)
    : aircraftId === 'F16' ? (isChallenge ? 105 : isApproach ? 90 : 180)
    : (isChallenge ? 85 : isApproach ? 74.5 : 108);

  const gs = (3.0 * Math.PI) / 180;
  const y = type === 'runway'
    ? airfield.elevationM + groundClearance
    : isChallenge
    ? airfield.elevationM + groundClearance + 5000 * Math.tan(gs) + 60
    : airfield.elevationM + groundClearance + 5556 * Math.tan(gs);

  const vx = speed === 0 ? 0 : (isChallenge ? Math.sin(interceptAngle) * speed : dir.x * speed);
  const vz = speed === 0 ? 0 : (isChallenge ? -Math.cos(interceptAngle) * speed : dir.z * speed);
  const vy = speed === 0 ? 0 : (isChallenge ? -2.5 : isApproach ? -speed * Math.tan(gs) : 0);

  return {
    x: a.threshold.x + dir.x * distance + Math.cos(angle) * offset,
    z: a.threshold.z + dir.z * distance + Math.sin(angle) * offset,
    y,
    yaw: -interceptAngle,
    vx,
    vz,
    vy,
  };
}
