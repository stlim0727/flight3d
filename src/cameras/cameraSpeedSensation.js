/**
 * Physical speed sensation & vibrations:
 * 1. Dynamic FOV expansion (optical flow peripheral expansion proportional to IAS)
 * 2. Chase camera dynamic inertial lag and breathing distance
 * 3. High-frequency physical vibrations (runway roll rumble & aerodynamic buffet)
 */
export function updateSpeedSensation(cs, dt, flightState) {
  if (cs.motionFrozen) return;
  if (!flightState) {
    cs.speedFov = 0;
    cs.chaseSpeedLag = 0;
    cs.vibrationOffset.set(0, 0, 0);
    cs.chaseVibration.set(0, 0, 0);
    return;
  }

  const safeDt = Math.max(0.001, Math.min(0.1, dt || 0.016));
  const ias = flightState.iasKnots || 0;
  const gs = flightState.groundSpeedKnots || (flightState.groundSpeed ? flightState.groundSpeed * 1.94384 : 0);
  const onGround = !!flightState.onGround;

  // 1. Dynamic Speed FOV Scaling
  const speedRatio = Math.max(0, Math.min(1.0, ias / 360.0));
  let targetFovExpansion = 0;
  if (cs.mode === cs.constructor.MODES.CHASE) {
    targetFovExpansion = speedRatio * 6.5;
  } else if (cs.mode === cs.constructor.MODES.COCKPIT) {
    targetFovExpansion = speedRatio * 3.5;
  } else if (cs.mode === cs.constructor.MODES.WING) {
    targetFovExpansion = speedRatio * 4.0;
  }

  if (cs.opticalZoom > 1.0) {
    targetFovExpansion /= cs.opticalZoom;
  }

  cs.speedFov += (targetFovExpansion - cs.speedFov) * (1.0 - Math.exp(-safeDt * 3.0));

  // 2. Chase Camera Dynamic Inertial Lag & Breathing Distance
  const targetChaseLag = (cs.mode === cs.constructor.MODES.CHASE) ? (speedRatio * 5.5) : 0;
  cs.chaseSpeedLag += (targetChaseLag - cs.chaseSpeedLag) * (1.0 - Math.exp(-safeDt * 2.5));

  // 3. Physical Micro-Vibrations
  cs.speedSensationTime += safeDt;
  const now = cs.speedSensationTime;
  let vibeX = 0, vibeY = 0, vibeZ = 0;
  let chaseVibeY = 0;

  if (onGround && gs > 12.0) {
    const rollIntensity = Math.min(1.0, Math.max(0, (gs - 12.0) / 120.0));
    const r1 = Math.sin(now * 165.0) * Math.cos(now * 255.0);
    const r2 = Math.cos(now * 185.0) * Math.sin(now * 295.0);
    vibeY = r1 * 0.0035 * rollIntensity;
    vibeX = r2 * 0.0020 * rollIntensity;
    chaseVibeY = r1 * 0.035 * rollIntensity;
  } else if (!onGround) {
    const highSpeedBuffet = Math.max(0, Math.min(1.0, (ias - 220.0) / 120.0));
    const spoilerBuffet = (flightState.spoilers || 0) * Math.min(1.0, ias / 150.0);
    const aeroIntensity = highSpeedBuffet * 0.65 + spoilerBuffet * 0.75;
    if (aeroIntensity > 0.005) {
      const a1 = (Math.sin(now * 115.0) + Math.cos(now * 195.0)) * 0.5;
      const a2 = (Math.cos(now * 135.0) + Math.sin(now * 220.0)) * 0.5;
      vibeY = a1 * 0.0025 * aeroIntensity;
      vibeX = a2 * 0.0016 * aeroIntensity;
      chaseVibeY = a1 * 0.025 * aeroIntensity;
    }
  }

  cs.vibrationOffset.set(vibeX, vibeY, vibeZ);
  cs.chaseVibration.set(0, chaseVibeY, 0);
}
