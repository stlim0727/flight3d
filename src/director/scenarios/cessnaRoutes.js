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

/** Choose a straight, flyable corridor through the actual generated city, never move buildings. */
export function cityRoute(terrain, buildings) {
  let best = null;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 12) {
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    for (let offset = -350; offset <= 350; offset += 70) {
      const length = 1600;
      const start = { x: 2800 - direction.x * length / 2 - direction.z * offset,
        z: 1400 - direction.z * length / 2 + direction.x * offset };
      const floor = corridorHeight(terrain, start, direction, length) + 50;
      for (let altitude = floor; altitude <= floor + 150; altitude += 15) {
        const clearance = buildingClearance(start, direction, length, altitude, buildings);
        if (clearance < 40) continue;
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
