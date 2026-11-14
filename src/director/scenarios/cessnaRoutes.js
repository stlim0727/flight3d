import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

function corridorHeight(terrain, start, direction, length, width = 45) {
  let height = 0;
  for (let along = -350; along <= length + 350; along += 50) {
    for (const cross of [-width, 0, width]) {
      height = Math.max(height, terrain.getHeight(
        start.x + direction.x * along - direction.z * cross,
        start.z + direction.z * along + direction.x * cross));
    }
  }
  return height;
}

/** Conservative horizontal clearance, including each building's entire footprint. */
export function buildingClearance(start, direction, length, altitude, buildings) {
  let clearance = Infinity;
  for (const building of buildings) {
    if (building.y + building.height < altitude - 18) continue;
    const dx = building.x - start.x, dz = building.z - start.z;
    const along = clamp(dx * direction.x + dz * direction.z, -350, length + 350);
    const distance = Math.hypot(dx - along * direction.x, dz - along * direction.z);
    clearance = Math.min(clearance, distance - Math.hypot(building.width, building.depth) / 2);
  }
  return clearance;
}

/**
 * The buildings the collision detector actually tests. At Neon this is the Neon city,
 * while `sim.foliage` still holds the hidden coastal city, so planning against
 * `sim.foliage` there routes through towers it cannot see.
 */
export function collisionBuildings(sim) {
  // Lukla and Incheon index no city buildings, so an environment without them is empty.
  if (sim.collisionDetector) return sim.collisionDetector.foliage?.buildingData ?? [];
  return sim.foliage?.buildingData ?? [];
}

// Corridor search centres. The coastal city sits around (2800, 1400); Neon's street grid
// spans the island (x 150..4000), so three east-west bands cover it within the
// +/-350 m offset sweep.
export const CITY_ROUTE_CENTERS = Object.freeze({
  default: Object.freeze([Object.freeze({ x: 2800, z: 1400 })]),
  neon: Object.freeze([-400, 0, 400].map(z => Object.freeze({ x: 2075, z }))),
});

// After the pass the demo climbs 170 m on the same line for 30 s and then holds level for
// 12 s: about 1.9 km at the Cessna's 82-90 kt. The climb is planned at 0.08 m per metre,
// below the 0.1 m/m it flies, so the planned altitude never runs ahead of the aircraft.
export const CITY_CLIMB_OUT = Object.freeze({ length: 1900, gradient: 0.08, gain: 170, step: 200 });

/** Clearance beyond `end` along `direction` while the altitude rises with the climb-out. */
export function climbOutClearance(end, direction, altitude, buildings, climbOut = CITY_CLIMB_OUT) {
  let clearance = Infinity;
  for (let from = 0; from < climbOut.length; from += climbOut.step) {
    const floor = altitude + Math.min(climbOut.gain, from * climbOut.gradient);
    const to = Math.min(climbOut.length, from + climbOut.step);
    for (const building of buildings) {
      if (building.y + building.height < floor - 18) continue;
      const dx = building.x - end.x, dz = building.z - end.z;
      const along = clamp(dx * direction.x + dz * direction.z, from, to);
      const distance = Math.hypot(dx - along * direction.x, dz - along * direction.z);
      clearance = Math.min(clearance, distance - Math.hypot(building.width, building.depth) / 2);
    }
  }
  return clearance;
}

/**
 * Choose a straight, flyable corridor through the actual generated city, never move
 * buildings. The corridor and the climb-out that follows it must both clear every
 * building the aircraft could reach.
 */
export function cityRoute(terrain, buildings, { centers = CITY_ROUTE_CENTERS.default, climbOut = CITY_CLIMB_OUT } = {}) {
  let best = null;
  for (const center of centers) for (let angle = 0; angle < Math.PI; angle += Math.PI / 12) {
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    for (let offset = -350; offset <= 350; offset += 70) {
      const length = 1600;
      const start = { x: center.x - direction.x * length / 2 - direction.z * offset,
        z: center.z - direction.z * length / 2 + direction.x * offset };
      const floor = corridorHeight(terrain, start, direction, length) + 50;
      for (let altitude = floor; altitude <= floor + 150; altitude += 15) {
        const clearance = buildingClearance(start, direction, length, altitude, buildings);
        if (clearance < 40) continue;
        // The route is flown from the far end back to `start`, then climbs out past it.
        if (climbOut && climbOutClearance(start, { x: -direction.x, z: -direction.z }, altitude, buildings, climbOut) < 40) continue;
        let left = 0, right = 0;
        const neighbors = buildings.filter(b => {
          const along = (b.x - start.x) * direction.x + (b.z - start.z) * direction.z;
          const cross = (b.x - start.x) * direction.z - (b.z - start.z) * direction.x;
          const nearby = b.y + b.height > altitude && along > 200 && along < length - 200 && Math.abs(cross) < 180;
          if (nearby) { if (cross < 0) left++; else right++; }
          return nearby;
        }).length;
        const score = Math.min(left, right) * 20 + neighbors * 2 - (altitude - floor) * 0.4;
        if (!best || score > best.score) best = { start, direction, length, altitude, clearance, score };
        break;
      }
    }
  }
  if (!best) throw new Error('No clear city demo corridor');
  best.start = { x: best.start.x + best.direction.x * best.length,
    z: best.start.z + best.direction.z * best.length };
  best.direction = { x: -best.direction.x, z: -best.direction.z };
  return best;
}

export function canyonRoute(terrain) {
  const direction = { x: -0.848048, z: 0.529919 };
  const start = { x: direction.x * 1100, z: direction.z * 1100 };
  const length = 1600;
  return { start, direction, length, altitude: corridorHeight(terrain, start, direction, length, 80) + 65 };
}
