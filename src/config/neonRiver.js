// Neon Metropolis canal (#551): a river cut through the middle of the skyline at right
// angles to the runway (which runs 090°). It flows along world Z, sunk below the street
// between vertical quay walls, and three bridges sized for the city cross it. The bridge
// flight flies north (-Z) along it under all three. The city stands on an island (#628):
// the canal opens into the sea at both ends, and the runway runs out to sea on the only
// causeway.
// Metres, +Y up. Geometry and collision share these dimensions: bridgeSolids() is both
// what is drawn and what is hit.

export const NEON_RIVER = {
  id: 'neon-canal-v2',
  // Centreline X through the city, half the water width, and the water surface below
  // the street (y = 0), which is also the sea's. The quay walls curve out by `mouth`
  // metres into the island's shore, so the canal widens into the sea.
  x: 2300, halfWidth: 110, waterLevel: -14, mouth: 150,
  // 10 m above the sea south of the island, below the street, flying north into the canal.
  spawn: [2300, -4, 1900], speedMs: 46,
  bridges: [
    // Tram and footbridge: a cable-stayed deck hung from an H pylon on the east bank,
    // its cables lit as a cyan harp.
    { id: 'cable', type: 'cable-stayed', z: 650, width: 14, top: 7, depth: 3, color: 0x1a2a3a, glow: 0x00e5ff },
    // The avenue on the city's canyon axis crosses on a tied arch lit magenta.
    { id: 'arch', type: 'arch', z: 0, width: 30, top: 7, depth: 3, color: 0x2a1030, glow: 0xff2fb3, rise: 40, radius: 1.2, segments: 40 },
    // A low girder light bridge on two piers: the tightest passage, between the piers.
    { id: 'light', type: 'girder', z: -650, width: 18, top: 4, depth: 3, color: 0x1c1430, glow: 0xffb000, piers: [-40, 40] },
  ],
};

// The island (#628): a rectangle with rounded corners around the skyline, its north and
// south shores at z = ±halfZ, and the runway's causeway out to sea west of it. Everything
// else is sea at the canal's water level.
export const NEON_ISLAND = {
  west: 150, east: 4000, halfZ: 1350, corner: 600,
  // Wider than the runway's safety area (|z| <= 50), out past its west end (x = -2500).
  causeway: { west: -2600, halfWidth: 60 },
};

// Approach ramps carry each deck down to the street at this grade, on an embankment.
export const RAMP = { grade: 0.08, step: 10, parapet: 1.1 };
const LED = 0.3;

// Centreline X at z.
export function riverCenter(z, river = NEON_RIVER) {
  return river.x;
}

// Height `over` metres into a quarter circle of `radius`: 0 at its start, `radius` at its end.
const fillet = (over, radius) => (over > 0 ? radius - Math.sqrt(Math.max(0, radius ** 2 - over ** 2)) : 0);

// Half the water width at z: constant through the city, curving out into the shore.
export function riverHalfWidth(z, river = NEON_RIVER, island = NEON_ISLAND) {
  return river.halfWidth + fillet(Math.abs(z) - (island.halfZ - river.mouth), river.mouth);
}

// The island's west (side -1) or east (+1) shore X at z, or null beyond its north and
// south shores.
export function islandShore(z, side, island = NEON_ISLAND) {
  if (Math.abs(z) > island.halfZ) return null;
  const inset = fillet(Math.abs(z) - (island.halfZ - island.corner), island.corner);
  return side < 0 ? island.west + inset : island.east - inset;
}

// World point [x, z] lies on the canal's water, between the quay walls.
export function isRiver(x, z, river = NEON_RIVER, island = NEON_ISLAND) {
  return Math.abs(z) <= island.halfZ && Math.abs(x - riverCenter(z, river)) < riverHalfWidth(z, river, island);
}

// World point [x, z] lies on the street: the island beside the canal, or the causeway.
export function isLand(x, z, river = NEON_RIVER, island = NEON_ISLAND) {
  const west = islandShore(z, -1, island);
  if (west !== null && x >= west && x <= islandShore(z, 1, island)) return !isRiver(x, z, river, island);
  const { causeway } = island;
  return x >= causeway.west && x <= island.west && Math.abs(z) <= causeway.halfWidth;
}

// Ground height: the street on land, the water surface of the canal and the sea elsewhere.
export function riverGroundHeight(x, z, river = NEON_RIVER, island = NEON_ISLAND) {
  return isLand(x, z, river, island) ? 0 : river.waterLevel;
}

// Z of the rows the island is drawn in, from south (+Z) to north: every 100 m, finer
// through its rounded corners and the canal mouths, and at the causeway's edges.
export function islandRows(river = NEON_RIVER, island = NEON_ISLAND) {
  const h = island.halfZ, rows = new Set([island.causeway.halfWidth, -island.causeway.halfWidth]);
  for (let z = -h; z <= h; z += 100) rows.add(z);
  for (const [radius, n] of [[island.corner, 32], [river.mouth, 16]]) {
    for (let k = 0; k <= n / 2; k++) {
      const z = h - radius + radius * Math.sin(Math.PI * k / n);
      rows.add(z).add(-z);
    }
  }
  // Rows from both curves less than a metre apart are one row.
  return [...rows].sort((a, b) => b - a).filter((z, i, sorted) => i === 0 || sorted[i - 1] - z > 1);
}

// The closed shore of the land west (side -1) or east (+1) of the canal as [x, z] points,
// counter-clockwise in the x-z plane (the water lies to the right of each step): the quay
// wall, the north shore, the coast, and the south shore back to the canal mouth. The west
// land carries the runway causeway. No step is longer than 100 m.
export function landOutline(side, river = NEON_RIVER, island = NEON_ISLAND) {
  const rows = islandRows(river, island), h = island.halfZ, { causeway } = island, points = [];
  const quay = z => riverCenter(z, river) + side * riverHalfWidth(z, river, island);
  const shore = z => islandShore(z, side, island);
  const add = (x, z) => {
    const last = points.at(-1);
    if (!last || last[0] !== x || last[1] !== z) points.push([x, z]);
  };
  const line = (x0, z0, x1, z1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 100));
    for (let i = 0; i <= n; i++) add(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
  };
  for (const z of rows) add(quay(z), z);
  line(quay(-h), -h, shore(-h), -h);
  for (const z of [...rows].reverse()) {
    if (side < 0 && Math.abs(z) < causeway.halfWidth) continue;
    add(shore(z), z);
    if (side < 0 && z === -causeway.halfWidth) {
      line(island.west, z, causeway.west, z);
      line(causeway.west, z, causeway.west, -z);
      line(causeway.west, -z, island.west, -z);
    }
  }
  line(shore(h), h, quay(h), h);
  const [first, last] = [points[0], points.at(-1)];
  if (first[0] === last[0] && first[1] === last[1]) points.pop();
  let area = 0;
  points.forEach(([x0, z0], i) => { const [x1, z1] = points[(i + 1) % points.length]; area += x0 * z1 - x1 * z0; });
  return area > 0 ? points : points.reverse();
}

// Half the deck length: across the water and 12 m onto each bank.
export const deckHalf = (river = NEON_RIVER) => river.halfWidth + 12;

// World [x, z] of bridge-local [x, z]: local X crosses the river, local Z runs along it.
export function bridgeToWorld(bridge, x, z = 0, river = NEON_RIVER) {
  return [riverCenter(bridge.z, river) + x, bridge.z + z];
}

// Each deck end's ramp along local X: `side` ±1, from the deck end `start` for `length`
// metres down to the street. top(x) is the road surface.
export function bridgeRamps(bridge, river = NEON_RIVER) {
  const length = bridge.top / RAMP.grade;
  return [-1, 1].map(side => {
    const start = side * deckHalf(river);
    return { side, start, length, top: x => bridge.top * (1 - Math.max(0, Math.min(length, side * (x - start))) / length) };
  });
}

// The ramp in `step` lengths, x0 at the deck end side, with road heights top0/top1.
export function rampSegments(ramp) {
  const segments = [];
  for (let s = 0; s < ramp.length - 1e-6; s += RAMP.step) {
    const x0 = ramp.start + ramp.side * s, x1 = ramp.start + ramp.side * Math.min(ramp.length, s + RAMP.step);
    segments.push({ x0, x1, top0: ramp.top(x0), top1: ramp.top(x1) });
  }
  return segments;
}

// Clear passage under the deck: between the quay walls (or the girder bridge's piers),
// below the soffit and its LED strips, across the whole deck width.
export function bridgeOpening(bridge, river = NEON_RIVER) {
  const halfWidth = bridge.type === 'girder' ? Math.min(...bridge.piers.map(Math.abs)) - 2 : river.halfWidth;
  return { halfWidth, soffit: bridge.top - bridge.depth - LED, halfDepth: bridge.width / 2 + 1, water: river.waterLevel };
}

// Bridge-local [x, y, z] of an arch rib's centreline, t = 0..1 from foot to foot. Ribs
// stand 1.5 m inside the deck edges and land just beyond the quay walls.
export function archCentre(bridge, edge, t, river = NEON_RIVER) {
  const span = river.halfWidth + 5;
  return [-span + 2 * span * t, bridge.top + bridge.rise * Math.sin(Math.PI * t), edge * (bridge.width / 2 - 1.5)];
}

// The cable-stayed bridge's cables as [from, to] pairs of bridge-local points: a harp of
// stays from both pylon legs to the deck edges, and back-stays anchored on the east bank.
export function bridgeCables(bridge, river = NEON_RIVER) {
  if (bridge.type !== 'cable-stayed') return [];
  const legX = pylonX(river), legZ = bridge.width / 2 + 2, cables = [];
  for (const edge of [-1, 1]) {
    for (let i = 0; i < 16; i++) cables.push([[legX, bridge.top + 10 + 4 * i, edge * legZ], [100 - 13 * i, bridge.top, edge * (bridge.width / 2 - 0.5)]]);
    for (let j = 0; j < 4; j++) cables.push([[legX, bridge.top + 50 + 5 * j, edge * legZ], [legX + 35 + 15 * j, 0, edge * legZ]]);
  }
  return cables;
}
const pylonX = river => river.halfWidth + 8;
const PYLON = 77;

// Splits the segment a-b into pieces no longer than `max`.
function chords(a, b, max) {
  const n = Math.max(1, Math.ceil(Math.hypot(...a.map((v, k) => b[k] - v)) / max));
  return Array.from({ length: n }, (_, i) => [a.map((v, k) => v + (b[k] - v) * i / n), a.map((v, k) => v + (b[k] - v) * (i + 1) / n)]);
}
// A box bounding the straight tube a-b of radius r, padded on every axis.
const tubeBox = (part, a, b, r, material) => ({ part, material, tube: { a, b, r },
  center: a.map((v, k) => (v + b[k]) / 2), size: a.map((v, k) => Math.abs(b[k] - v) + 2 * r) });

// A streetlight standing on the road at `base`: a pole and a lamp head.
const lampBoxes = (x, base, z) => [
  { part: 'lamp', material: 'concrete', center: [x, base + 2.5, z], size: [0.3, 5, 0.3] },
  { part: 'lamp', material: 'light', center: [x, base + 5.15, z], size: [0.8, 0.3, 0.8] },
];

// Bridge-local collision boxes, each { part, center, size }. `material` picks the render
// bucket; `render: false` boxes are envelopes of geometry drawn separately (railings,
// ramps), and `tube` boxes bound a cylinder drawn through them.
export function bridgeSolids(bridge, river = NEON_RIVER) {
  const boxes = [], half = deckHalf(river), { width, top, depth } = bridge, soffit = top - depth;
  boxes.push({ part: 'deck', center: [0, top - depth / 2, 0], size: [2 * half, depth, width] });
  // Neon strips under both deck edges.
  for (const edge of [-1, 1]) boxes.push({ part: 'deck', material: 'neon', center: [0, soffit - LED / 2, edge * (width / 2 - 0.5)], size: [2 * half, LED, 0.6] });
  // Railing envelopes along both edges, and streetlights every 30 m.
  for (const edge of [-1, 1]) boxes.push({ part: 'rail', render: false, center: [0, top + RAMP.parapet / 2, edge * (width / 2 - 0.2)], size: [2 * half, RAMP.parapet, 0.4] });
  for (let x = -90; x <= 90; x += 30) for (const edge of [-1, 1]) boxes.push(...lampBoxes(x, top, edge * (width / 2 - 1)));
  // Ramps down to the street: one box per segment bounds the sloped embankment, road and
  // parapets drawn inside it.
  for (const ramp of bridgeRamps(bridge, river)) {
    for (const s of rampSegments(ramp)) {
      const high = Math.max(s.top0, s.top1) + RAMP.parapet;
      boxes.push({ part: 'ramp', render: false, center: [(s.x0 + s.x1) / 2, (high - 0.5) / 2, 0], size: [Math.abs(s.x1 - s.x0), high + 0.5, width] });
    }
  }
  if (bridge.type === 'girder') {
    for (const x of bridge.piers) boxes.push({ part: 'pier', material: 'concrete', center: [x, (soffit + river.waterLevel - 1) / 2, 0], size: [4, soffit - river.waterLevel + 1, width - 2] });
  }
  if (bridge.type === 'arch') {
    // Ribs as tube segments; hangers every 10 m from the deck up to the ribs.
    for (const edge of [-1, 1]) {
      for (let i = 0; i < bridge.segments; i++) {
        boxes.push(tubeBox('arch', archCentre(bridge, edge, i / bridge.segments, river), archCentre(bridge, edge, (i + 1) / bridge.segments, river), bridge.radius, 'steel'));
      }
      const span = river.halfWidth + 5;
      for (let x = -100; x <= 100; x += 10) {
        const rib = top + bridge.rise * Math.sin(Math.PI * (x + span) / (2 * span)) - bridge.radius;
        boxes.push({ part: 'hanger', material: 'neon', center: [x, (top + rib) / 2, edge * (width / 2 - 1.5)], size: [0.25, rib - top, 0.25] });
      }
    }
  }
  if (bridge.type === 'cable-stayed') {
    const x = pylonX(river), legZ = width / 2 + 2;
    for (const edge of [-1, 1]) boxes.push({ part: 'pylon', material: 'steel', center: [x, PYLON / 2, edge * legZ], size: [4, PYLON, 3] });
    boxes.push({ part: 'pylon', material: 'steel', center: [x, PYLON - 1.5, 0], size: [3, 3, 2 * legZ + 3] });
    for (const [a, b] of bridgeCables(bridge, river)) for (const [p, q] of chords(a, b, 12)) boxes.push(tubeBox('cable', p, q, 0.25, 'neon'));
  }
  return boxes;
}

// Every bridge solid as a world-space box in the city building record shape that
// CollisionDetector indexes, so any aircraft in any Neon Metropolis flight hits the
// bridges. Its probes are points; the bridge flight adds BridgeCollision's swept C172 test.
export function bridgeWorldBoxes(river = NEON_RIVER) {
  return river.bridges.flatMap(bridge => bridgeSolids(bridge, river).map(({ part, center: [x, y, z], size: [w, h, d] }) => {
    const [wx, wz] = bridgeToWorld(bridge, x, z, river);
    return { bridge: bridge.id, part, x: wx, y: y - h / 2, z: wz, height: h, width: w, depth: d, localWidth: w, localDepth: d, rotationY: 0 };
  }));
}
