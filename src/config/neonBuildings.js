// Neon Metropolis towers (#695): the one table both NeonCity's meshes and its collision
// records come from, and the wind comparison sites laid out along the canyon flight.
// World metres, +X east, +Y up, +Z south. Pure data and geometry: no THREE, no DOM.
//
// Each tower stands on the street (y = 0) at its centre [x, z]: local width `w` along X
// and depth `d` along Z before rotating `rot` radians about +Y (THREE's rotateY), roof
// `h` metres up. `type` picks the silhouette and `facade` the material. Spires, wedge
// roofs and observation discs rise above `h`; the collision record pads every roof by
// ROOF_MARGIN instead of modelling them.

export const ROOF_MARGIN = 8;

const tower = (id, x, z, w, d, h, type, facade, rot) => Object.freeze({ id, x, z, w, d, h, type, facade, rot });

// Organic, varied architectural table. Intentionally breaks Cartesian alignment and
// mirror symmetry.
export const NEON_TOWERS = Object.freeze([
  // === Iconic central megatowers ===
  // The Grand Art Deco spire (stepped pyramid, 440 m with a 40 m needle)
  tower('mega-deco', 1950, 165, 75, 75, 440, 'stepped-spire', 'fin', -0.08),
  // The Chrysler-style crown tower on the east quay (420 m)
  tower('mega-crown', 2500, -175, 70, 70, 420, 'stepped-spire', 'ribbon', 0.12),
  // Chiseled wedge tower (45° angled roof, 380 m)
  tower('mega-wedge', 1420, -160, 68, 68, 380, 'wedge-chisel', 'monolith', -0.18),
  // Cylindrical landmark with a glowing observation ring (370 m)
  tower('mega-ring', 2850, 185, 65, 65, 370, 'cylinder', 'ribbon', 0),
  // Asymmetric gateway towers flanking the canyon entrance
  tower('gate-south', 920, 135, 55, 50, 320, 'blade-slab', 'ribbon', 0.15),
  tower('gate-north', 860, -140, 58, 52, 350, 'wedge-chisel', 'fin', -0.22),

  // === South midtown cluster (z = 120 to 480) ===
  tower('south-1', 650, 145, 48, 48, 220, 'blade-slab', 'monolith', 0.05),
  tower('south-2', 790, 280, 65, 55, 290, 'wedge-chisel', 'ribbon', -0.25),
  tower('south-3', 1140, 210, 70, 65, 340, 'stepped-spire', 'fin', 0.18),
  tower('south-4', 1290, 390, 55, 75, 260, 'blade-slab', 'monolith', -0.10),
  tower('south-5', 1620, 230, 65, 65, 360, 'cylinder', 'ribbon', 0),
  tower('south-6', 1780, 380, 75, 60, 310, 'wedge-chisel', 'fin', 0.32),
  tower('south-7', 2080, 240, 60, 70, 350, 'blade-slab', 'ribbon', -0.15),
  tower('south-8', 2560, 430, 70, 65, 280, 'stepped-spire', 'monolith', 0.22),
  tower('south-9', 2620, 225, 68, 60, 340, 'wedge-chisel', 'ribbon', -0.12),
  tower('south-10', 2790, 400, 58, 68, 290, 'cylinder', 'fin', 0),
  tower('south-11', 3100, 210, 62, 62, 330, 'stepped-spire', 'ribbon', 0.16),
  tower('south-12', 3280, 360, 70, 58, 270, 'blade-slab', 'monolith', -0.20),
  tower('south-13', 3550, 220, 60, 60, 300, 'wedge-chisel', 'fin', 0.1),

  // === North waterfront cluster (z = -130 to -480) ===
  tower('north-1', 580, -170, 52, 50, 200, 'cylinder', 'ribbon', 0),
  tower('north-2', 740, -310, 68, 60, 280, 'stepped-spire', 'monolith', 0.25),
  tower('north-3', 1080, -210, 60, 72, 330, 'blade-slab', 'fin', -0.18),
  tower('north-4', 1240, -410, 75, 58, 270, 'wedge-chisel', 'ribbon', 0.28),
  tower('north-5', 1650, -220, 68, 62, 360, 'stepped-spire', 'ribbon', -0.14),
  tower('north-6', 1820, -380, 62, 72, 310, 'cylinder', 'monolith', 0),
  tower('north-7', 2060, -235, 72, 62, 350, 'wedge-chisel', 'fin', 0.19),
  tower('north-8', 2560, -440, 58, 68, 290, 'blade-slab', 'ribbon', -0.24),
  tower('north-9', 2650, -215, 65, 65, 330, 'stepped-spire', 'monolith', 0.15),
  tower('north-10', 2820, -370, 72, 58, 280, 'blade-slab', 'fin', -0.12),
  tower('north-11', 3150, -220, 68, 68, 320, 'cylinder', 'ribbon', 0),
  tower('north-12', 3320, -390, 62, 62, 270, 'wedge-chisel', 'monolith', 0.22),
  tower('north-13', 3600, -210, 58, 58, 310, 'stepped-spire', 'ribbon', -0.08),

  // === Deep background skyline, far south (z = 580 to 1150) ===
  tower('far-south-1', 800, 650, 90, 80, 250, 'blade-slab', 'monolith', 0.12),
  tower('far-south-2', 1200, 720, 75, 75, 290, 'stepped-spire', 'ribbon', -0.22),
  tower('far-south-3', 1600, 640, 80, 85, 310, 'cylinder', 'monolith', 0),
  tower('far-south-4', 2050, 730, 95, 75, 320, 'wedge-chisel', 'fin', 0.18),
  tower('far-south-5', 2600, 760, 85, 80, 290, 'stepped-spire', 'monolith', -0.14),
  tower('far-south-6', 2880, 740, 80, 90, 280, 'blade-slab', 'ribbon', 0.25),
  tower('far-south-7', 3280, 670, 85, 75, 260, 'cylinder', 'monolith', 0),
  tower('far-south-8', 1050, 980, 110, 90, 220, 'blade-slab', 'monolith', 0),
  tower('far-south-9', 1550, 1020, 90, 95, 240, 'stepped-spire', 'ribbon', 0.28),
  tower('far-south-10', 2080, 990, 105, 85, 260, 'wedge-chisel', 'monolith', -0.16),
  tower('far-south-11', 2580, 1040, 95, 100, 230, 'cylinder', 'monolith', 0),
  tower('far-south-12', 3080, 1000, 100, 85, 210, 'blade-slab', 'fin', 0.12),

  // === Deep background skyline, far north (z = -580 to -1150) ===
  tower('far-north-1', 820, -660, 85, 80, 260, 'cylinder', 'monolith', 0),
  tower('far-north-2', 1220, -730, 90, 75, 300, 'wedge-chisel', 'fin', 0.22),
  tower('far-north-3', 1620, -650, 80, 85, 320, 'stepped-spire', 'monolith', -0.18),
  tower('far-north-4', 2080, -740, 95, 80, 310, 'blade-slab', 'ribbon', 0.12),
  // Set back from the light bridge's east approach (#579)
  tower('far-north-5', 2560, -760, 85, 90, 290, 'cylinder', 'monolith', 0),
  tower('far-north-6', 2910, -750, 90, 75, 280, 'stepped-spire', 'ribbon', -0.22),
  tower('far-north-7', 3310, -680, 80, 85, 250, 'wedge-chisel', 'monolith', 0.14),
  tower('far-north-8', 1080, -990, 105, 90, 230, 'blade-slab', 'fin', 0),
  tower('far-north-9', 1580, -1030, 95, 100, 250, 'cylinder', 'monolith', 0),
  tower('far-north-10', 2050, -1000, 100, 85, 260, 'stepped-spire', 'ribbon', 0.22),
  tower('far-north-11', 2610, -1050, 90, 95, 220, 'wedge-chisel', 'monolith', -0.18),
  tower('far-north-12', 3110, -1010, 110, 85, 210, 'blade-slab', 'monolith', 0.1),

  // === Podiums and terraces beside the canyon (plazas and setbacks) ===
  tower('podium-1', 420, 160, 42, 40, 75, 'podium', 'monolith', 0.12),
  tower('podium-2', 580, -175, 46, 42, 95, 'podium', 'ribbon', -0.18),
  tower('podium-3', 1020, 145, 50, 38, 105, 'podium', 'fin', -0.08),
  tower('podium-4', 1150, -150, 45, 44, 115, 'podium', 'monolith', 0.15),
  // Street-canyon slot (#695): two long walls replace the podiums that stood at
  // (1460, 155) and (1580, -140), narrowing the canyon to 124 m between them for 240 m.
  tower('slot-south', 1560, 80, 240, 36, 150, 'blade-slab', 'ribbon', 0),
  tower('slot-north', 1560, -80, 240, 36, 170, 'blade-slab', 'monolith', 0),
  tower('podium-7', 1980, 140, 50, 42, 145, 'podium', 'fin', -0.16),
  tower('podium-8', 2120, -155, 54, 40, 130, 'podium', 'ribbon', 0.14),
  tower('podium-9', 2490, 190, 44, 46, 115, 'podium', 'monolith', 0.08),
  tower('podium-10', 2580, -145, 48, 42, 125, 'podium', 'fin', -0.20),
  // Rooftop terrace (#695): drawn in to the avenue from (2880, 135) at 95 m and
  // (3020, -150) at 105 m, so the canyon flight passes 30 m above one roof and 35 m
  // below the other.
  tower('terrace-south', 2900, 72, 46, 40, 80, 'podium', 'ribbon', 0.18),
  tower('terrace-north', 3040, -75, 50, 44, 145, 'podium', 'monolith', -0.15),
]);

// World-axis extents of a tower's rotated footprint: [width along X, depth along Z].
export function towerExtents(t) {
  const c = Math.abs(Math.cos(t.rot)), s = Math.abs(Math.sin(t.rot));
  return [c * t.w + s * t.d, s * t.w + c * t.d];
}

// The tower's footprint corners [x, z] in world space (rotateY: x' = x cos + z sin,
// z' = -x sin + z cos).
export function towerCorners(t) {
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const x = u * t.w / 2, z = v * t.d / 2;
    return [t.x + x * c + z * s, t.z - x * s + z * c];
  });
}

// The city building record CollisionDetector indexes (NeonCity.buildingData), plus the
// tower's id and its true roof height without the collision margin.
export function towerRecord(t) {
  const [width, depth] = towerExtents(t);
  return {
    id: t.id, x: t.x, y: 0, z: t.z, width, depth, height: t.h + ROOF_MARGIN, roofHeight: t.h,
    visualY: 0, localWidth: t.w, localDepth: t.d, rotationY: t.rot,
  };
}

// The wind the comparison sites are laid out against (#695): from the north (000°),
// blowing toward +Z. It crosses the canyon at right angles, runs along the canal, and is
// a crosswind on the 090° runway. Only a layout assumption: no wind is configured from
// it here, and stage 3 (#696) sets the actual field.
export const DESIGN_WIND_FROM_DEG = 0;

// The canyon flight (PresetSpawner 'approach'): east along z = 0 at 110 m from x = 200.
export const CANYON_FLIGHT = Object.freeze({ z: 0, altitude: 110, x0: 200 });

// Urban settings the canyon flight passes in order, west to east, to compare winds on one
// straight line (#695). `x` is where along the flight each site is centred; `towers`
// names the towers that make it. Each `region` is a layout envelope in the shape a
// WindField region takes, not a tuned wind.
const site = (id, kind, x, radius, towers, note) => Object.freeze({
  id, kind, x, towers: Object.freeze(towers), note,
  region: Object.freeze({ center: Object.freeze({ x, y: CANYON_FLIGHT.altitude, z: CANYON_FLIGHT.z }), radius, fade: radius / 2 }),
});

export const NEON_WIND_SITES = Object.freeze([
  site('open', 'open', 300, 140, [], 'West waterfront: no tower within the envelope or upwind to the north shore.'),
  site('wide-canyon', 'wide-canyon', 1050, 160, ['podium-3', 'podium-4', 'gate-south', 'gate-north'],
    'About 250 m between podium walls near the flight height, towers behind them.'),
  site('slot', 'narrow-canyon', 1560, 140, ['slot-south', 'slot-north'],
    '124 m between 150 m and 170 m walls for 240 m: deeper than wide.'),
  site('canal', 'canal', 2300, 120, [],
    'The canal crossing: open water 14 m below the street, along the design wind.'),
  site('lee', 'lee', 2520, 100, ['mega-crown'],
    'Downwind of the 420 m crown tower on the east quay.'),
  site('rooftop', 'rooftop', 2970, 120, ['terrace-south', 'terrace-north'],
    'Between an 80 m roof south of the flight and a 145 m terrace north of it.'),
]);
