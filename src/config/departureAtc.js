/** Authored training clearance, not published RKSI procedures or live ATC data.
 * Existing bundled voice exchanges remain intact; additional exchanges are captions.
 */
export const DEPARTURE_ATC = {
  gate: { before: [
    ['pilot', 'Incheon Delivery, Korean Air 123, Boeing 737 at gate G1, request clearance for a local training flight.'],
    ['delivery', 'Korean Air 123, cleared for local training via radar vectors. After departure runway 33L, maintain runway heading, climb altitude 3000 feet. Squawk 4213.'],
    ['pilot', 'Cleared for local training via radar vectors, runway 33L, runway heading, climb 3000 feet, squawk 4213, Korean Air 123.'],
    ['delivery', 'Korean Air 123, readback correct. Contact Incheon Apron for pushback.'],
  ] },
  disconnect: { waitForTug: true, after: [
    ['pilot', 'Incheon Apron, Korean Air 123, pushback complete.'],
    ['apron', 'Korean Air 123, contact Incheon Ground for taxi.'],
    ['pilot', 'Contact Ground, Korean Air 123.'],
  ] },
  hold: { before: [
    ['ground', 'Korean Air 123, contact Incheon Tower.'],
    ['pilot', 'Contact Tower, Korean Air 123.'],
  ] },
  departure: { before: [
    ['tower', 'Korean Air 123, contact Departure.'],
    ['pilot', 'Contact Departure, Korean Air 123.'],
    ['pilot', 'Departure, Korean Air 123, climbing 3000 feet, runway heading.'],
    ['departure', 'Korean Air 123, radar contact. Continue runway heading, climb altitude 3000 feet.'],
    ['pilot', 'Runway heading, climb 3000 feet, Korean Air 123.'],
  ] },
};

export const DEPARTURE_TRAINING_CLEARANCE = { altitudeFt: 3000, squawk: '4213', contactHeightFt: 400, handoffHeightFt: 1500 };
