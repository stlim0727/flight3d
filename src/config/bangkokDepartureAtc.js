/**
 * Additional ATC timing and clearances for Jeju Air flight 2503 (B737-800 RKSI -> VTBS).
 */
export const BANGKOK_DEPARTURE_ATC = {
  gate: {},
  pushback: {},
  disconnect: { waitForTug: true },
  taxi: {},
  hold: {},
  lineup: {},
  clearance: {},
  takeoff: {},
  departure: {}
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
