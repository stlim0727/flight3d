/** v6 training rules. These are explicit candidates, not calibrated aircraft performance. */
const common = {
  rulesVersion: '1.0.0', aircraftId: 'B738', airportId: 'coastal', physicsHz: 120,
  decisionPeriodTicks: 24, environmentProfile: 'mild-disturbance-v1',
  runwayHeadingDeg: 90, runwayThreshold: { x: -1350, y: 12, z: 0 },
  // Existing operational threshold is 250 m inside the physical 3200 m runway.
  runwayStartS: -250, runwayEndS: 2950, runwayWidthM: 60,
  fixedConfiguration: { gearDown: true, spoilers: 0, reverser: false, parkingBrake: false },
  calibration: 'limited-training-suite-v1',
};

export function createMissionManifest(type, overrides = {}) {
  if (!['takeoff', 'landing'].includes(type)) throw new TypeError('Unknown mission type');
  const takeoff = type === 'takeoff';
  const manifest = {
    ...structuredClone(common), type, id: `${type}-basic-v1`,
    timeoutTicks: (takeoff ? 120 : 180) * common.physicsHz,
    ...(takeoff ? {
      stableTicks: 1200, minimumHeightM: 100, maximumHeightM: 200,
      heightReference: 'model-origin-above-terrain',
      minimumIasKnots: 150, maximumIasKnots: 190, maximumRollDeg: 10,
      maximumHeadingErrorDeg: 10, minimumVsiMs: -0.5, maximumVsiMs: 5,
      spawn: { runwayS: 50, centerlineOffsetM: 0, groundSpeedKnots: 0 },
      candidateConfiguration: { massKg: 66000, flapIndex: 2, pitchTrimDeg: 1.6, throttle: 0 },
    } : {
      touchdownStartS: 150, touchdownEndS: 900, maximumSinkRateMs: 3,
      maximumRollDeg: 5, maximumHeadingErrorDeg: 10, maximumBounceTicks: 120,
      stopTicks: 600, stopSpeedKnots: 3, stopCenterlineM: 5,
      approachStartS: -3500, approachHalfWidthM: 300,
      spawn: { runwayS: -3000, centerlineOffsetM: 0,
        heightAboveRunwayM: 15 + 3000 * Math.tan(3 * Math.PI / 180),
        iasKnots: 145, flightPathAngleDeg: -3 },
      candidateConfiguration: { massKg: 66000, flapIndex: 5, pitchTrimDeg: 2.1, throttle: 0.52 },
    }),
    ...structuredClone(overrides),
  };
  validateMissionManifest(manifest);
  return manifest;
}

export function validateMissionManifest(m) {
  const fields = ['physicsHz', 'timeoutTicks', 'runwayHeadingDeg', 'runwayStartS', 'runwayEndS', 'runwayWidthM',
    ...(m.type === 'takeoff' ? ['stableTicks', 'minimumHeightM', 'maximumHeightM', 'minimumIasKnots', 'maximumIasKnots',
      'maximumRollDeg', 'maximumHeadingErrorDeg', 'minimumVsiMs', 'maximumVsiMs']
      : ['touchdownStartS', 'touchdownEndS', 'maximumSinkRateMs', 'maximumRollDeg', 'maximumHeadingErrorDeg',
        'maximumBounceTicks', 'stopTicks', 'stopSpeedKnots', 'stopCenterlineM', 'approachStartS', 'approachHalfWidthM'])];
  if (!['takeoff', 'landing'].includes(m.type) || fields.some(k => !Number.isFinite(m[k])) ||
      m.physicsHz !== 120 || m.decisionPeriodTicks !== 24 ||
      !m.runwayThreshold || !['x', 'y', 'z'].every(k => Number.isFinite(m.runwayThreshold[k])) ||
      !Number.isInteger(m.physicsHz) || m.physicsHz <= 0 || m.runwayWidthM <= 0 || m.runwayEndS <= m.runwayStartS ||
      !Number.isInteger(m.timeoutTicks) || m.timeoutTicks <= 0 ||
      (m.type === 'takeoff' && (m.minimumHeightM > m.maximumHeightM || m.minimumIasKnots > m.maximumIasKnots ||
        m.minimumVsiMs > m.maximumVsiMs || !Number.isInteger(m.stableTicks) || m.stableTicks <= 0)) ||
      (m.type === 'landing' && (m.touchdownStartS < m.runwayStartS || m.touchdownEndS > m.runwayEndS ||
        m.touchdownStartS > m.touchdownEndS || !Number.isInteger(m.stopTicks) || m.stopTicks <= 0 ||
        !Number.isInteger(m.maximumBounceTicks) || m.maximumBounceTicks < 0 || m.maximumSinkRateMs < 0))) {
    throw new TypeError('Invalid mission manifest');
  }
  const nonnegative = ['maximumRollDeg', 'maximumHeadingErrorDeg',
    ...(m.type === 'landing' ? ['stopSpeedKnots', 'stopCenterlineM', 'approachHalfWidthM'] : ['minimumIasKnots'])];
  const config = m.candidateConfiguration;
  if (nonnegative.some(k => m[k] < 0) || !config ||
      !['massKg', 'flapIndex', 'pitchTrimDeg', 'throttle'].every(k => Number.isFinite(config[k])) ||
      config.massKg <= 0 || !Number.isInteger(config.flapIndex) || config.flapIndex < 0 || config.flapIndex > 6 ||
      config.throttle < 0 || config.throttle > 1 || !m.spawn ||
      !['runwayS', 'centerlineOffsetM'].every(k => Number.isFinite(m.spawn[k])) ||
      (m.type === 'landing' && !['heightAboveRunwayM', 'iasKnots', 'flightPathAngleDeg'].every(k => Number.isFinite(m.spawn[k]))) ||
      (m.type === 'takeoff' && !Number.isFinite(m.spawn.groundSpeedKnots))) {
    throw new TypeError('Invalid mission manifest configuration');
  }
  return m;
}
