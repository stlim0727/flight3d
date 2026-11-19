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

    let minRunwayDist = Infinity;
    for (const surface of this.surfaces) {
      const d = this.distance(surface, x, z);
      if (d < minRunwayDist) minRunwayDist = d;
    }

    // Realistic asymmetric elliptical boundary of Jeju Island centered near Hallasan
    // East-West: 72 km (from Gosan west coast to Seongsan Ilchulbong east coast)
    // North: 18.6 km north of Hallasan (coastline meets sea at z ≈ -2,000m north of RKPC)
    // South: 15.0 km south of Hallasan (coastline reaches Seogwipo at z ≈ +31,500m)
    const hx = this.hallasan.x;
    const hz = this.hallasan.z;
    const rx = 36000;
    const rzNorth = 18600;
    const rzSouth = 15000;
    const dx = (x - hx) / rx;
    const dz = z < hz ? (z - hz) / rzNorth : (z - hz) / rzSouth;
    const islandDistSq = dx * dx + dz * dz;

    const coastFactor = islandDistSq >= 1.0 ? 0.0 : Math.cos(Math.sqrt(islandDistSq) * (Math.PI * 0.5));

    // Volcanic shield elevation profile peaking at Mount Hallasan (1,947m)
    const distToPeak = Math.hypot(x - hx, z - hz);
    const hallasanShield = this.hallasan.elevationM * Math.exp(-((distToPeak / 7500) ** 1.6));
    const baseSlope = 90.0 * coastFactor;
    const naturalHeight = Math.max(0.0, (hallasanShield + baseSlope) * coastFactor);

    // Airport precinct & runway safety corridor continuous smooth blending:
    // Core plateau (within 650m of airport center or 150m of runways) is leveled at 36m.
    // Beyond the core, smoothly blends to natural volcanic terrain over a 1,600m transition.
    const distToAirport = Math.hypot(x, z);
    const blendDist = Math.min(distToAirport - 650, minRunwayDist - 150);

    if (blendDist <= 0) {
      return this.elevationM;
    }
    if (blendDist < 1600) {
      const t = blendDist / 1600;
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

  if (isChallenge || type === 'ditching') {
    // Chuja & Corridor Dual Engine-Out Emergency Glide & Ditching Challenge
    // Spawns ~15km North of Chuja Island at 2,400m MSL (~7,870 ft), heading South (180°)
    const speed = aircraftId === 'C172' ? 45 : aircraftId === 'F16' ? 160 : 110;
    return {
      x: -18300,
      z: -65000,
      y: 2400,
      yaw: -Math.PI,
      vx: 0,
      vy: -2.8,
      vz: speed,
    };
  }

  const distance = isApproach ? -5556 : 100;
  const offset = 0;
  const interceptAngle = angle;
  const speed = type === 'runway' ? 0
    : aircraftId === 'C172' ? (isApproach ? 33 : 48)
    : aircraftId === 'F16' ? (isApproach ? 90 : 180)
    : (isApproach ? 74.5 : 108);

  const gs = (3.0 * Math.PI) / 180;
  const y = type === 'runway'
    ? airfield.elevationM + groundClearance
    : airfield.elevationM + groundClearance + 5556 * Math.tan(gs);

  const vx = speed === 0 ? 0 : dir.x * speed;
  const vz = speed === 0 ? 0 : dir.z * speed;
  const vy = speed === 0 ? 0 : (isApproach ? -speed * Math.tan(gs) : 0);

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
