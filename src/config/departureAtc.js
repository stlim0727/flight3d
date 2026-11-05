/** Authored training clearance, not published RKSI procedures or live ATC data.
 * Existing bundled voice exchanges remain intact; additional exchanges are captions.
 */
export const DEPARTURE_ATC = {
  gate: { before: [
    ['pilot', 'Incheon Delivery, Jeju Air 1102, Boeing 737 at gate G1, request clearance for a local training flight.'],
    ['delivery', 'Jeju Air 1102, cleared for local training via radar vectors. After departure runway 33L, maintain runway heading, climb altitude 3000 feet. Squawk 4213.'],
    ['pilot', 'Cleared for local training via radar vectors, runway 33L, runway heading, climb 3000 feet, squawk 4213, Jeju Air 1102.'],
    ['delivery', 'Jeju Air 1102, readback correct. Contact Incheon Apron for pushback.'],
  ] },
  disconnect: { waitForTug: true, after: [
    ['pilot', 'Incheon Apron, Jeju Air 1102, pushback complete.'],
    ['apron', 'Jeju Air 1102, contact Incheon Ground for taxi.'],
    ['pilot', 'Contact Ground, Jeju Air 1102.'],
  ] },
  hold: { before: [
    ['ground', 'Jeju Air 1102, contact Incheon Tower.'],
    ['pilot', 'Contact Tower, Jeju Air 1102.'],
  ] },
  departure: { before: [
    ['tower', 'Jeju Air 1102, contact Departure.'],
    ['pilot', 'Contact Departure, Jeju Air 1102.'],
    ['pilot', 'Departure, Jeju Air 1102, climbing 3000 feet, runway heading.'],
    ['departure', 'Jeju Air 1102, radar contact. Continue runway heading, climb altitude 3000 feet.'],
    ['pilot', 'Runway heading, climb 3000 feet, Jeju Air 1102.'],
  ] },
};

export const DEPARTURE_TRAINING_CLEARANCE = { altitudeFt: 3000, squawk: '4213', contactHeightFt: 400, handoffHeightFt: 1500 };
