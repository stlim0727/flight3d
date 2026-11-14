import { NEON_RIVER } from './neonRiver.js';
import { CANYON_FLIGHT, DESIGN_WIND_FROM_DEG, NEON_TOWERS } from './neonBuildings.js';

// Stage 3 (#696): the light background field (#694) plus a mean wind that the towers
// shelter. The heading is a fixed world basis (east) for the background modes, not the
// aircraft heading. The mean comes from the layout's design direction (north) at 4 m/s
// at the canyon flight height; UrbanWindField derives wakes from the tower table.
export const NEON_WIND = Object.freeze({
  profile: 'light-turbulence-v1',
  seed: 'neon-background-v1',
  runwayHeadingDeg: 90,
  meanFromDeg: DESIGN_WIND_FROM_DEG,
  meanSpeed: 4,
  referenceHeight: CANYON_FLIGHT.altitude,
  streetY: 0,
  waterY: NEON_RIVER.waterLevel,
  obstacles: NEON_TOWERS,
});
