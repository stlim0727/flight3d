/**
 * Derives the yawing moment (body +Y axis, positive yaws the nose LEFT) produced
 * by asymmetric thrust between the left and right engine.
 *
 * Forces act at each engine's moment arm from the centerline; the differential
 * is the classic engine-out yaw: losing the left engine removes a right-turning
 * moment, so the aircraft yaws toward the dead side (nose left).
 *   moment = arm * (T_right - T_left)
 */
export function asymmetricThrustYawMoment(thrustLeft, thrustRight, armMeters = 4.5) {
  return armMeters * (thrustRight - thrustLeft);
}

/**
 * High-Bypass Turbofan Engine Simulation (Boeing 737 CFM56-7B / LEAP-1B class)
 * Simulates twin jet engines with realistic spool latency, thrust lapse with altitude/speed,
 * EGT, N1%, N2%, Fuel Flow, thrust reversers, engine failure (windmilling) and fuel burn.
 */
export class EngineModel {
  constructor() {
    this.numEngines = 2;
    this.maxStaticThrustPerEngine = 121000; // Newtons (~27,000 lbf each)

    // Current states for Engine 1 (Left) and Engine 2 (Right)
    this.throttleCommand = 0.0; // 0.0 to 1.0 (Idle to TOGA)
    this.reverserActive = false;
    this.reverserDeployment = 0.0; // 0.0 to 1.0

    this.n1 = [22.0, 22.0];       // Fan RPM % (Idle ~22%, TOGA 100%)
    this.targetN1 = [22.0, 22.0];
    this.n2 = [62.0, 62.0];       // Core RPM % (Idle ~62%, TOGA ~98%)
    this.egt = [420.0, 420.0];    // Exhaust Gas Temp (°C)
    this.fuelFlow = [350.0, 350.0];// kg/h per engine
    this.thrust = [0.0, 0.0];     // Newtons per engine

    this.spoolUpTime = 3.2;       // Seconds from idle to TOGA
    this.spoolDownTime = 2.4;     // Seconds from TOGA to idle

    this.failed = [false, false]; // In-flight shutdown: fan windmills, no combustion
    this.windmillingN1 = 9.0;     // Fan % driven by the airstream with the core offline

    this.fuelCapacityKg = 14200;  // Matches the EICAS total fuel readout
    this.fuelKg = this.fuelCapacityKg;
  }

  setThrottle(val) {
    this.throttleCommand = Math.max(0.0, Math.min(1.0, val));
  }

  setEngineFailure(index, on) {
    if (index < 0 || index >= this.numEngines) return false;
    this.failed[index] = !!on;
    return this.failed[index];
  }

  toggleReverser(onGround) {
    if (onGround) {
      this.reverserActive = !this.reverserActive;
    } else {
      this.reverserActive = false;
    }
    return this.reverserActive;
  }

  setReverser(active, onGround) {
    this.reverserActive = onGround && active;
  }

  update(dt, altitudeMeters, tas, densityRatio) {
    // Reverser mechanical deployment rate
    const reverserTarget = this.reverserActive ? 1.0 : 0.0;
    this.reverserDeployment += (reverserTarget - this.reverserDeployment) * Math.min(1.0, dt * 2.5);

    // Target N1 based on throttle and reverser
    let targetN1Value;
    if (this.reverserDeployment > 0.5) {
      // Reverser spool to ~75% N1
      targetN1Value = 22.0 + (this.throttleCommand > 0.1 ? this.throttleCommand : 0.65) * 55.0;
    } else {
      targetN1Value = 22.0 + this.throttleCommand * 78.0; // 22% to 100%
    }

    const altitudeLapse = Math.pow(Math.max(0.1, densityRatio), 0.75);
    // Ram drag / airspeed lapse: slight decrease in net thrust as TAS increases
    const ramLapse = Math.max(0.7, 1.0 - (tas / 300.0) * 0.25);

    const fuelStarved = this.fuelKg <= 0.0;
    let totalThrust = 0;

    for (let i = 0; i < this.numEngines; i++) {
      // A shutdown engine (or any engine when the tanks run dry) windmills:
      // no combustion, and the fan is held down by the airstream.
      const out = this.failed[i] || fuelStarved;
      this.targetN1[i] = out ? this.windmillingN1 : targetN1Value;

      // Realistic non-linear spool inertia
      const diff = this.targetN1[i] - this.n1[i];
      const rate = diff > 0 ? (2.5 / this.spoolUpTime) : (2.2 / this.spoolDownTime);
      this.n1[i] += diff * Math.min(1.0, dt * rate * (0.8 + 0.4 * (this.n1[i] / 100.0)));

      // Core N2 tracks N1 closely with slight lag; with the core offline it
      // decays toward the fraction of fan speed it sees windmilling.
      const targetN2 = out ? this.n1[i] * 0.4 : 60.0 + (this.n1[i] - 22.0) * (38.0 / 78.0);
      this.n2[i] += (targetN2 - this.n2[i]) * Math.min(1.0, dt * 1.5);

      // EGT correlates with fuel burn and compressor load; an engine without
      // combustion cools toward ambient.
      const n1NormEgt = Math.max(0.0, (this.n1[i] - 20.0) / 80.0);
      const targetEgt = out ? 15.0 : 400.0 + Math.pow(n1NormEgt, 1.4) * 450.0;
      this.egt[i] += (targetEgt - this.egt[i]) * Math.min(1.0, dt * 1.8);

      // Fuel Flow (kg/hour per engine); a flamed-out engine eases to zero burn
      const runningFuelFlow = 300.0 + Math.pow(this.n1[i] / 100.0, 2.5) * 2200.0 * altitudeLapse;
      const targetFF = out ? 0.0 : runningFuelFlow;
      this.fuelFlow[i] += (targetFF - this.fuelFlow[i]) * Math.min(1.0, dt * (out ? 2.0 : 12.0));

      // Net Thrust calculation
      // Normalized thrust factor from N1: ~0 at 22% idle, 1.0 at 100% N1
      const n1Norm = Math.max(0.0, (this.n1[i] - 20.0) / 80.0);
      const thrustFactor = Math.pow(n1Norm, 2.1);
      let grossThrust = this.maxStaticThrustPerEngine * thrustFactor * altitudeLapse * ramLapse;

      // Reverse thrust effect
      if (this.reverserDeployment > 0.05) {
        grossThrust = -grossThrust * 0.45 * this.reverserDeployment;
      }

      this.thrust[i] = grossThrust;
      totalThrust += grossThrust;
    }

    // Burn the fuel the running engines metered this step
    this.fuelKg = Math.max(0.0, this.fuelKg - (this.fuelFlow[0] + this.fuelFlow[1]) * dt / 3600.0);

    return {
      totalThrust,
      fuelKg: this.fuelKg,
      engine1: {
        n1: this.n1[0],
        n2: this.n2[0],
        egt: this.egt[0],
        fuelFlow: this.fuelFlow[0],
        thrust: this.thrust[0],
        failed: this.failed[0] || fuelStarved
      },
      engine2: {
        n1: this.n1[1],
        n2: this.n2[1],
        egt: this.egt[1],
        fuelFlow: this.fuelFlow[1],
        thrust: this.thrust[1],
        failed: this.failed[1] || fuelStarved
      },
      reverserActive: this.reverserActive,
      reverserDeployment: this.reverserDeployment
    };
  }
}
