/**
 * Detailed real-world IFR clearance, pushback, taxi, lineup and departure handoff exchanges
 * for Jeju Air flight 2503 (B737-800 RKSI -> VTBS / Bangkok Suvarnabhumi).
 * Follows authentic pilot readback and ATC frequency transfer protocols.
 */

export const BANGKOK_DEPARTURE_ATC = {
  gate: {
    before: [
      ['pilot', 'Incheon Delivery, Jeju Air Two-Five-Zero-Three, Gate 32, Information Bravo, request IFR clearance to Bangkok.'],
      ['delivery', 'Jeju Air Two-Five-Zero-Three, Incheon Delivery, cleared to Bangkok Airport via SEL1N departure, flight planned route. Climb and maintain flight level 190, squawk 5102.'],
      ['pilot', 'Cleared to Bangkok Airport via SEL1N departure, climb and maintain flight level 190, squawk 5102, Jeju Air Two-Five-Zero-Three.'],
      ['delivery', 'Jeju Air Two-Five-Zero-Three, read-back is correct. Contact Ground on 121.4 for pushback.'],
      ['pilot', 'Incheon Ground, Jeju Air Two-Five-Zero-Three, Gate 32, request pushback and start.'],
      ['ground', 'Jeju Air Two-Five-Zero-Three, Incheon Ground, pushback and start approved, face South, Runway 34R.'],
      ['pilot', 'Pushback and start approved, face South, runway 34R, Jeju Air Two-Five-Zero-Three.'],
    ]
  },
  pushback: {
    before: [
      ['crew', 'Brakes released, commencing pushback.'],
      ['pilot', 'Pushback acknowledged, starting engines.'],
    ]
  },
  disconnect: {
    waitForTug: true,
    waitForTugLines: [
      ['crew', 'Pushback complete. Set parking brake. Stand by for equipment clearance.']
    ],
    after: [
      ['crew', 'Tug disconnected, all equipment clear. Have a good flight to Bangkok!'],
    ]
  },
  taxi: {
    before: [
      ['pilot', 'Incheon Ground, Jeju Air Two-Five-Zero-Three, request taxi.'],
      ['ground', 'Jeju Air Two-Five-Zero-Three, taxi to holding point runway 34R via taxiway November 2 and Alpha, hold short of runway 34R.'],
      ['pilot', 'Taxi to holding point runway 34R via November 2 and Alpha, hold short of runway 34R, Jeju Air Two-Five-Zero-Three.'],
    ],
    after: [
      ['ground', 'Jeju Air Two-Five-Zero-Three, contact Tower on 118.2.'],
      ['pilot', 'Tower on 118.2, Jeju Air Two-Five-Zero-Three.'],
    ]
  },
  hold: {
    before: [
      ['pilot', 'Incheon Tower, Jeju Air Two-Five-Zero-Three, holding short of runway 34R.'],
      ['tower', 'Jeju Air Two-Five-Zero-Three, Incheon Tower, line up and wait runway 34R.'],
      ['pilot', 'Line up and wait runway 34R, Jeju Air Two-Five-Zero-Three.'],
    ]
  },
  lineup: {
    after: [
      ['tower', 'Jeju Air Two-Five-Zero-Three, wind 290 at 8 knots, runway 34R, cleared for takeoff.'],
      ['pilot', 'Cleared for takeoff, runway 34R, Jeju Air Two-Five-Zero-Three.'],
    ]
  },
  clearance: {
    before: [
      ['pilot', 'Takeoff clearance confirmed. 80 knots, V1, rotate, positive rate, gear up.'],
    ]
  },
  takeoff: {
    before: [
      ['tower', 'Jeju Air Two-Five-Zero-Three, contact Departure on 125.15. Good day.'],
      ['pilot', 'Departure 125.15, Jeju Air Two-Five-Zero-Three. Thank you, good day.'],
    ]
  },
  departure: {
    before: [
      ['pilot', 'Incheon Departure, Jeju Air Two-Five-Zero-Three, passing 2,500 for flight level 190.'],
      ['departure', 'Jeju Air Two-Five-Zero-Three, Incheon Departure, radar contact. Climb and maintain flight level 290, turn right heading 210.'],
      ['pilot', 'Climb and maintain flight level 290, turn right heading 210, Jeju Air Two-Five-Zero-Three.'],
    ]
  }
};

export const BANGKOK_CLEARANCE = {
  flight: '7C2503',
  callsign: 'Jeju Air 2503',
  destination: 'VTBS', // Suvarnabhumi Airport, Bangkok
  sid: 'SEL1N',
  initialAltFt: 19000,
  cruiseAltFt: 29000,
  squawk: '5102',
  runway: '34R',
  contactHeightFt: 400,
  handoffHeightFt: 3000,
  turnAltitudeFt: 2500,
  targetHeadingDeg: 210
};
