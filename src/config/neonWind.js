// Stage 1 (#694): reuse the existing light field across the entire Neon region.
// No mean wind: keep the existing spawn/trim assumptions. The heading is a fixed
// world basis (east), not the aircraft heading. No region limits the disturbance.
export const NEON_WIND = Object.freeze({
  profile: 'light-turbulence-v1',
  seed: 'neon-background-v1',
  runwayHeadingDeg: 90,
});
