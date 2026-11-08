// Neon Metropolis canal (#551): a river cut through the middle of the skyline at right
// angles to the runway (which runs 090°). It flows along world Z, sunk below the street
// between vertical quay walls, and three bridges sized for the city cross it. The bridge
// flight flies north (-Z) along it under all three.
// Metres, +Y up. Geometry and collision share these dimensions: bridgeSolids() is both
// what is drawn and what is hit.

export const NEON_RIVER = {
  id: 'neon-canal-v1',
  // Centreline X through the city, half the water width, and the water surface below
  // the street (y = 0). The canal is straight for |z| <= straight, then eases by `bend`.
  x: 2300, halfWidth: 110, waterLevel: -14, straight: 2000, bend: 200,
  // 10 m above the water south of the city, below the street, flying north.
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

// Approach ramps carry each deck down to the street at this grade, on an embankment.
export const RAMP = { grade: 0.08, step: 10, parapet: 1.1 };
const LED = 0.3;

const smooth = t => t * t * (3 - 2 * t);

// Centreline X at z.
export function riverCenter(z, river = NEON_RIVER) {
  const over = Math.abs(z) - river.straight;
  if (over <= 0) return river.x;
  return river.x + Math.sign(z) * river.bend * smooth(Math.min(1, over / 2500));
}

// World point [x, z] lies on the water, between the quay walls.
export function isRiver(x, z, river = NEON_RIVER) {
  return Math.abs(x - riverCenter(z, river)) < river.halfWidth;
}

// Ground height: the water surface between the quay walls, the street elsewhere.
export function riverGroundHeight(x, z, river = NEON_RIVER) {
  return isRiver(x, z, river) ? river.waterLevel : 0;
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
