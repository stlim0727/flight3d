// Neon Metropolis street network (#579): avenues and streets laid between the towers on
// both banks of the canal, joined across it by the three bridges. Before it the city had
// only the runway highway, which stopped short of the canal, and no road reached a bridge.
// Metres, +Y up. Every street is an axis-aligned rectangle on the ground; a street that
// joins another runs to that street's far edge, so junctions and corners are fully paved.

import { NEON_RIVER, bridgeRamps, riverCenter } from './neonRiver.js';

// The runway highway (NeonCity.isOnRunway), drawn by NeonCity itself.
export const NEON_RUNWAY = { x0: -2400, x1: 1800, z0: -30, z1: 30 };

// Street centrelines: north-south streets at X, east-west streets at Z.
const NORTH_SOUTH = [500, 1350, 1880, 2720, 3212, 3700];
const EAST_WEST = [-870, -540, 540, 870];
const STREET = 20;
// The riverside north-south streets on each bank that the bridges' approaches join.
const WEST_SIDE = 1880, EAST_SIDE = 2720, EAST_END = 3700;

const rect = (id, x0, x1, z0, z1) => ({ id, x0, x1, z0, z1 });

// World X of each bridge's ramp feet, where its deck reaches the street: [west, east].
export function bridgeFeet(bridge, river = NEON_RIVER) {
  const centre = riverCenter(bridge.z, river);
  return bridgeRamps(bridge, river).map(ramp => centre + ramp.start + ramp.side * ramp.length).sort((a, b) => a - b);
}

// The ground each bridge covers from foot to foot, at its deck width: paved, so streets
// meeting a ramp foot need no curb there. It crosses the canal and is not drawn.
export function bridgeFootprints(river = NEON_RIVER) {
  return river.bridges.map(bridge => {
    const [west, east] = bridgeFeet(bridge, river);
    return { ...rect(`bridge-${bridge.id}`, west, east, bridge.z - bridge.width / 2, bridge.z + bridge.width / 2), bridge: bridge.id };
  });
}

// Every street as { id, x0, x1, z0, z1 }.
export function neonStreets(river = NEON_RIVER) {
  const half = STREET / 2, far = Math.max(...EAST_WEST) + half, streets = [];
  for (const x of NORTH_SOUTH) {
    // North-south streets stop at the runway's edges rather than cross it.
    if (x + half > NEON_RUNWAY.x0 && x - half < NEON_RUNWAY.x1) {
      streets.push(rect(`ns-${x}-south`, x - half, x + half, -far, NEON_RUNWAY.z0), rect(`ns-${x}-north`, x - half, x + half, NEON_RUNWAY.z1, far));
    } else {
      streets.push(rect(`ns-${x}`, x - half, x + half, -far, far));
    }
  }
  const west = Math.min(...NORTH_SOUTH) - half;
  for (const z of EAST_WEST) {
    streets.push(rect(`ew-${z}-west`, west, WEST_SIDE + half, z - half, z + half), rect(`ew-${z}-east`, EAST_SIDE - half, EAST_END + half, z - half, z + half));
  }
  // Each bridge's approaches, at its deck width, from the riverside streets to its ramp
  // feet. The arch bridge carries the main avenue: the runway highway runs on to its west
  // foot, and the avenue continues east of it to the city's east edge.
  for (const bridge of river.bridges) {
    const [footWest, footEast] = bridgeFeet(bridge, river), z0 = bridge.z - bridge.width / 2, z1 = bridge.z + bridge.width / 2;
    const avenue = bridge.id === 'arch';
    streets.push(rect(`${bridge.id}-west`, avenue ? NEON_RUNWAY.x1 : WEST_SIDE - half, footWest, z0, z1));
    streets.push(rect(`${bridge.id}-east`, footEast, avenue ? EAST_END + half : EAST_SIDE + half, z0, z1));
  }
  return streets;
}

// Lies on a street: within `pad` metres of one.
export function isStreet(x, z, pad = 0, streets = neonStreets()) {
  return streets.some(s => x >= s.x0 - pad && x <= s.x1 + pad && z >= s.z0 - pad && z <= s.z1 + pad);
}
