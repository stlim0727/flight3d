// Collision proxies for the Seoul landmarks and skyline outside the river corridor (#393).
// World metres, +Y up, like HANGANG_COURSE. Each proxy envelopes the geometry that
// scripts/build-hangang-assets.mjs draws (or SeoulLandmarks.js, for the beacons):
// tests/hangangLandmarks.test.js checks that every shipped triangle lies inside one proxy
// and that every proxy face touches drawn geometry. Proxies are a conservative envelope,
// not triangle-exact contact; detailed per-asset collision belongs to the asset work (#267).
//
// Shapes:
//   box:      axis-aligned, `min` and `max` corners.
//   cylinder: vertical, centred on (x, z), from y0 to y1, radius r0 at y0 to r1 at y1
//             (a cone when r1 is 0). Polygonal meshes are inscribed in the circle.
import { HANGANG_COURSE, bridgeApproaches, bridgeOpening } from './hangangCourse.js';

// Whether a building of footprint `radius` at world (x, z) stays 15 m clear of every
// bridge's approach ramps (#429), tested in bridge-local terms.
function clearOfApproaches(x, z, radius) {
  return HANGANG_COURSE.bridges.every(bridge => {
    const c = Math.cos(bridge.yaw), s = Math.sin(bridge.yaw), dx = x - bridge.x, dz = z - bridge.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c, halfDepth = bridgeOpening(bridge).halfDepth + 15;
    return bridgeApproaches(bridge).every(ramp => {
      const a = Math.min(ramp.start, ramp.start + ramp.side * ramp.length), b = Math.max(ramp.start, ramp.start + ramp.side * ramp.length);
      return lx + radius < a || lx - radius > b || Math.abs(lz) - radius > halfDepth;
    });
  });
}

// Yeouido's generic highrises: footprint centre (x, z), width w (X), depth d (Z), height h.
// The builder draws these boxes; collision uses the same list.
export function yeouidoHighrises() {
  const out = [];
  for (let i = 0; i < 65; i++) {
    const x = 700 + (i % 8) * 55 + ((i * 37) % 35);
    const z = -450 + Math.floor(i / 8) * 90 + ((i * 53) % 45);
    const h = 45 + ((i * 47) % 115), w = 26 + (i % 16), d = 24 + ((i * 7) % 18);
    if (clearOfApproaches(x, z, Math.hypot(w, d) / 2)) out.push({ x, z, w, h, d });
  }
  return out;
}

// Aviation obstruction strobes at the summits, drawn by SeoulLandmarks.js as `size` cubes.
export const HANGANG_BEACONS = {
  size: 4,
  positions: [
    [780, 250, -350],    // 63 Building
    [910, 340, -120],    // Parc.1 Tower A
    [975, 258, -60],     // Parc.1 Tower B
    [1040, 290, -120],   // Three IFC
    [-1550, 480, -2100], // N Seoul Tower spire
    [2200, 570, -6400],  // Lotte World Tower crown
  ],
};

const box = (part, min, max) => ({ kind: 'box', part, min, max });
// A box of half extents (hx, hz) around (x, z), from y0 to y1.
const around = (part, x, z, hx, hz, y0, y1) => box(part, [x - hx, y0, z - hz], [x + hx, y1, z + hz]);
const cylinder = (part, x, z, y0, y1, r0, r1) => ({ kind: 'cylinder', part, x, z, y0, y1, r0, r1 });
// The builder's four-sided crowns are square frustums turned 45°: half side r / √2.
const crownHalf = r => r / Math.SQRT2;

function yeouidoShapes() {
  const shapes = [
    // 63 Building: 48 × 218 × 30 body with a 49 × 12 × 31 observation band, and its crown.
    around('63-building', 780, -350, 24.5, 15.5, 0, 218),
    around('63-building', 780, -350, crownHalf(23), crownHalf(23), 218, 248),
    // Parc.1: towers with corner columns (A 46 m + 3.5 m columns, B 40 m + 3 m columns).
    around('parc1', 910, -120, 25.25, 25.25, 0, 338),
    around('parc1', 975, -60, 22, 22, 0, 256),
    // IFC: three towers whose crowns stay inside their footprints.
    ...[[0, 44, 284], [-70, 38, 186], [-140, 36, 178]].map(([oz, s, h]) => around('ifc', 1040, -120 + oz, s / 2, s / 2, 0, h + 16)),
    // National Assembly: podium, hall and dome.
    around('national-assembly', 780, 520, 65, 47.5, 0, 4),
    around('national-assembly', 780, 520, 55, 37.5, 0, 32),
    around('national-assembly', 780, 520, 15, 15, 32, 47),
    // LG Twin Towers with their crowns.
    ...[-20, 20].map(oz => around('lg-twin-towers', 740, -65 + oz, 14, 14, 0, 150)),
  ];
  for (const { x, z, w, h, d } of yeouidoHighrises()) shapes.push(around('highrise', x, z, w / 2, d / 2, 0, h));
  return shapes;
}

// Namsan: the hill cone, then N Seoul Tower's base, shaft, observation deck and antenna.
const NAMSAN = { x: -1550, z: -2100, hill: 243 };
function namsanShapes() {
  const { x, z, hill } = NAMSAN;
  return [
    { ...cylinder('namsan', x, z, 0, hill, 680, 0), terrain: true },
    cylinder('n-seoul-tower', x, z, hill, hill + 14, 24, 20),
    cylinder('n-seoul-tower', x, z, hill + 14, hill + 109, 7.5, 5.2),
    cylinder('n-seoul-tower', x, z, hill + 109, hill + 125, 13, 15),
    cylinder('n-seoul-tower', x, z, hill + 125, hill + 235, 3.2, 0.8),
  ];
}

// Lotte World Tower: 555 m tapered shaft and its 25 m crown.
const lotteShapes = () => [
  cylinder('lotte-tower', 2200, -6400, 0, 555, 32, 9),
  cylinder('lotte-tower', 2200, -6400, 555, 580, 9, 4),
];

// `asset` names the GLB in hangangAssetManifest.json that draws the landmark; the beacons
// are drawn by SeoulLandmarks.js itself.
export const HANGANG_LANDMARKS = [
  { id: 'yeouido', asset: 'yeouido-landmarks', shapes: yeouidoShapes() },
  { id: 'namsan', asset: 'namsan-tower', shapes: namsanShapes() },
  { id: 'lotte', asset: 'lotte-tower', shapes: lotteShapes() },
  { id: 'beacons', asset: null,
    shapes: HANGANG_BEACONS.positions.map(([x, y, z]) => around('beacon', x, z, HANGANG_BEACONS.size / 2, HANGANG_BEACONS.size / 2, y - HANGANG_BEACONS.size / 2, y + HANGANG_BEACONS.size / 2)) },
];

// World AABB of a shape as [min, max] arrays.
export function shapeBounds(shape) {
  if (shape.kind === 'box') return [shape.min, shape.max];
  const r = Math.max(shape.r0, shape.r1);
  return [[shape.x - r, shape.y0, shape.z - r], [shape.x + r, shape.y1, shape.z + r]];
}
