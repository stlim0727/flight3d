/**
 * Shared-frequency exchanges for the preceding Korean Air 653 departure, keyed by voice clip.
 * Speaker 'traffic' is the KE653 crew; controllers reuse the Bangkok scenario roles.
 */
export const TRAFFIC_RADIO = {
  taxi: [
    ['traffic', 'Incheon Ground, Korean Air Six-Five-Three, request taxi.'],
    ['ground', 'Korean Air Six-Five-Three, taxi to holding point runway 34R via taxiway November 2 and Alpha.'],
    ['traffic', 'Holding point runway 34R via November 2 and Alpha, Korean Air Six-Five-Three.'],
  ],
  clearance: [
    ['tower', 'Korean Air Six-Five-Three, wind 290 at 8 knots, runway 34R, cleared for takeoff.'],
    ['traffic', 'Cleared for takeoff runway 34R, Korean Air Six-Five-Three.'],
  ],
  handoff: [
    ['tower', 'Korean Air Six-Five-Three, contact Departure on 125.15. Good day.'],
    ['traffic', 'Departure 125.15, Korean Air Six-Five-Three. Good day.'],
  ],
};

/**
 * Where each traffic exchange sits within the player's departure stages. A block with
 * `waitForTraffic` holds (without counting its reading time) until KE653 reaches that phase
 * or 'rotated'; DepartureAtc bounds the wait so a missing actor cannot stall the scenario.
 */
export const TRAFFIC_DEPARTURE_ATC = {
  taxi: { before: [{ voiceKey: 'taxi' }] },
  hold: { before: [{ voiceKey: 'clearance', waitForTraffic: 'lineup' }] },
  lineup: { before: [{ voiceKey: 'handoff', waitForTraffic: 'rotated' }] },
};
