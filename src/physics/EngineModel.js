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
  if (thrustLeft === undefined || thrustRight === undefined || armMeters === 0) return 0;
  return armMeters * (thrustRight - thrustLeft);
}

/**
 * High-Bypass Turbofan and Piston Engine Simulation
 * Simulates 1, 2, or multi-engine configurations with realistic spool latency, thrust lapse with altitude/speed,
 * EGT, N1%, N2%, Fuel Flow, thrust reversers, engine failure (windmilling) and fuel burn.
 */
export class EngineModel {
  constructor(config = null) {
    this.throttleCommand = 0.0; // 0.0 to 1.0 (Idle to TOGA)
    this.reverserActive = false;
    this.reverserDeployment = 0.0; // 0.0 to 1.0

    this.loadConfig(config);
  }

  loadConfig(config = null) {
    const propulsion = config?.propulsion || config || {};
    this.numEngines = propulsion.numEngines ?? 2;
    this.maxStaticThrustPerEngine = propulsion.maxStaticThrustPerEngineN ?? propulsion.maxStaticThrustPerEngine ?? 121000;
    this.idleN1 = propulsion.idleN1Percent ?? 22.0;
    this.togaN1 = propulsion.togaN1Percent ?? 100.0;
    this.spoolUpTime = propulsion.spoolUpTimeSec ?? propulsion.spoolUpTime ?? 3.2;
    this.spoolDownTime = propulsion.spoolDownTimeSec ?? propulsion.spoolDownTime ?? 2.4;
    this.reverseThrustEfficiency = propulsion.reverseThrustEfficiency ?? 0.45;
    this.fuelCapacityKg = propulsion.fuelCapacityKg ?? 14200;
    this.massProperties = null;
    this._fuelKg = this.fuelCapacityKg;
    this.windmillingN1 = propulsion.windmillingN1 ?? 9.0;
    this.momentArmMeters = propulsion.momentArmMeters ?? (this.numEngines > 1 ? 4.5 : 0.0);

    this.baseFuelFlowKgPerHour = propulsion.baseFuelFlowKgPerHour ?? 350.0;
    this.maxFuelFlowKgPerHour = propulsion.maxFuelFlowKgPerHour ?? (this.baseFuelFlowKgPerHour * 7.14);

    this.n1 = new Array(this.numEngines).fill(this.idleN1);
    this.targetN1 = new Array(this.numEngines).fill(this.idleN1);
    this.n2 = new Array(this.numEngines).fill(62.0);
    this.egt = new Array(this.numEngines).fill(420.0);
    this.fuelFlow = new Array(this.numEngines).fill(this.baseFuelFlowKgPerHour);
    this.thrust = new Array(this.numEngines).fill(0.0);
    this.contactDamage = new Array(this.numEngines).fill(0);
    this.failed = new Array(this.numEngines).fill(false);
  }

  setThrottle(val) {
    this.throttleCommand = Math.max(0.0, Math.min(1.0, val));
  }

  get fuelKg() { return this.massProperties?.fuelKg ?? this._fuelKg; }
  set fuelKg(value) {
    if (!Number.isFinite(value) || value < 0 || value > this.fuelCapacityKg) throw new RangeError('fuel load');
    if (this.massProperties) this.massProperties.setLoading({ fuelKg: value });
    else this._fuelKg = value;
  }

  bindMassProperties(model) {
    this.massProperties = model;
    this.fuelCapacityKg = model.capacityKg;
  }

  /** A preset restores its own initial loading, not necessarily full tanks. */
  refuel(aero) {
    this.bindMassProperties(aero.massProperties);
    this.massProperties.reset();
    aero.syncMassProperties();
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

  /** Fan speed a steady throttle command converges to, reverser schedule included. */
  commandedN1() {
    if (this.reverserDeployment > 0.5 && this.reverseThrustEfficiency > 0) {
      // Reverser spool to ~75% N1
      return this.idleN1 + (this.throttleCommand > 0.1 ? this.throttleCommand : 0.65) * (this.togaN1 - this.idleN1) * 0.70;
    }
    return this.idleN1 + this.throttleCommand * (this.togaN1 - this.idleN1);
  }

  /** Fan speed engine `index` converges to for the current command and health. */
  fanTarget(index) {
    const out = this.failed[index] || this.fuelKg <= 0.0;
    const commanded = this.commandedN1();
    return out ? this.windmillingN1
      : this.windmillingN1 + (commanded - this.windmillingN1) * (1 - this.contactDamage[index]);
  }

  /**
   * Bring the fan speed to what the commanded throttle holds in steady state.
   * A preset declares a flight state, and N1 is part of that state: leaving it
   * at idle makes the first seconds of every airborne spawn a spool transient
   * instead of the balance the preset describes.
   */
  settleSpool() {
    for (let i = 0; i < this.numEngines; i++) this.n1[i] = this.targetN1[i] = this.fanTarget(i);
  }

  update(dt, altitudeMeters, tas, densityRatio) {
    // Reverser mechanical deployment rate
    const reverserTarget = this.reverserActive ? 1.0 : 0.0;
    this.reverserDeployment += (reverserTarget - this.reverserDeployment) * Math.min(1.0, dt * 2.5);

    const altitudeLapse = Math.pow(Math.max(0.1, densityRatio), 0.75);
    // Ram drag / airspeed lapse: slight decrease in net thrust as TAS increases
    const ramLapse = Math.max(0.7, 1.0 - (tas / 300.0) * 0.25);

    const fuelStarved = this.fuelKg <= 0.0;
    let totalThrust = 0;

    for (let i = 0; i < this.numEngines; i++) {
      // A shutdown engine (or any engine when the tanks run dry) windmills:
      // no combustion, and the fan is held down by the airstream.
      const out = this.failed[i] || fuelStarved;
      const integrity = 1 - this.contactDamage[i];
      this.targetN1[i] = this.fanTarget(i);

      // Realistic non-linear spool inertia
      const diff = this.targetN1[i] - this.n1[i];
      const rate = diff > 0 ? (2.5 / this.spoolUpTime) : (2.2 / this.spoolDownTime);
      this.n1[i] += diff * Math.min(1.0, dt * rate * (0.8 + 0.4 * (this.n1[i] / 100.0)));

      // Core N2 tracks N1 closely with slight lag; with the core offline it
      // decays toward the fraction of fan speed it sees windmilling.
      const runningN2 = 60.0 + (this.n1[i] - 22.0) * (38.0 / 78.0);
      const targetN2 = out ? this.n1[i] * 0.4
        : this.n1[i] * 0.4 + (runningN2 - this.n1[i] * 0.4) * integrity;
      this.n2[i] += (targetN2 - this.n2[i]) * Math.min(1.0, dt * 1.5);

      // EGT correlates with fuel burn and compressor load; an engine without
      // combustion cools toward ambient.
      const n1NormEgt = Math.max(0.0, (this.n1[i] - 20.0) / 80.0);
      const targetEgt = out ? 15.0 : 15.0 + (385.0 + Math.pow(n1NormEgt, 1.4) * 450.0) * integrity;
      this.egt[i] += (targetEgt - this.egt[i]) * Math.min(1.0, dt * 1.8);

      // Fuel Flow (kg/hour per engine); a flamed-out engine eases to zero burn
      const n1Range = Math.max(1.0, this.togaN1 - this.idleN1);
      const n1Fraction = Math.max(0.0, Math.min(1.0, (this.n1[i] - this.idleN1) / n1Range));
      const maxAdditionalFF = Math.max(0, this.maxFuelFlowKgPerHour - this.baseFuelFlowKgPerHour);
      const runningFuelFlow = this.baseFuelFlowKgPerHour + Math.pow(n1Fraction, 2.5) * maxAdditionalFF * altitudeLapse;
      const targetFF = out ? 0.0 : runningFuelFlow * integrity;
      this.fuelFlow[i] += (targetFF - this.fuelFlow[i]) * Math.min(1.0, dt * (out ? 2.0 : 12.0));

      // Net Thrust calculation
      // Normalize N1 between idleN1 (zero thrust) and togaN1 (full thrust).
      // Using the aircraft-specific idleN1 as the floor means throttle=0 always
      // yields ~0 net thrust regardless of where idle N1 sits (e.g. F-16 at 60%).
      // The slight offset of 2% below idleN1 preserves a smooth curve through the
      // idle point rather than clamping exactly at zero.
      const thrustIdleFloor = Math.max(0.0, this.idleN1 - 2.0);
      const thrustN1Range = Math.max(1.0, this.togaN1 - thrustIdleFloor);
      const n1Norm = Math.max(0.0, (this.n1[i] - thrustIdleFloor) / thrustN1Range);
      const thrustFactor = Math.pow(n1Norm, 2.1);
      let grossThrust = this.maxStaticThrustPerEngine * thrustFactor * altitudeLapse * ramLapse;

      // Reverse thrust effect
      if (this.reverserDeployment > 0.05 && this.reverseThrustEfficiency > 0) {
        grossThrust = -grossThrust * this.reverseThrustEfficiency * this.reverserDeployment;
      }

      this.thrust[i] = grossThrust * integrity;
      totalThrust += this.thrust[i];
    }

    // Burn the fuel the running engines metered this step
    let stepFuelBurn = 0;
    for (let i = 0; i < this.numEngines; i++) {
      stepFuelBurn += this.fuelFlow[i];
    }
    const demand = stepFuelBurn * dt / 3600;
    const supplied = this.massProperties ? this.massProperties.consume(demand) : Math.min(this._fuelKg, demand);
    if (!this.massProperties) this._fuelKg -= supplied;
    // A partially supplied tick has proportional combustion thrust. Dry/failed
    // engines may keep windmilling but do not produce positive net thrust.
    const supplyFraction = demand > 0 ? supplied / demand : (fuelStarved ? 0 : 1);
    totalThrust = 0;
    for (let i = 0; i < this.numEngines; i++) {
      this.thrust[i] *= this.failed[i] ? 0 : supplyFraction;
      this.fuelFlow[i] *= supplyFraction;
      totalThrust += this.thrust[i];
    }

    const makeEngineState = (idx) => {
      if (idx >= this.numEngines) {
        return {
          n1: 0,
          n2: 0,
          egt: 15.0,
          fuelFlow: 0,
          thrust: 0,
          failed: true
        };
      }
      return {
        n1: this.n1[idx],
        n2: this.n2[idx],
        egt: this.egt[idx],
        fuelFlow: this.fuelFlow[idx],
        thrust: this.thrust[idx],
        failed: this.failed[idx] || this.fuelKg <= 0 || this.contactDamage[idx] >= 1
      };
    };

    return {
      totalThrust,
      fuelKg: this.fuelKg,
      engine1: makeEngineState(0),
      engine2: makeEngineState(1),
      engines: Array.from({ length: this.numEngines }, (_, i) => makeEngineState(i)),
      reverserActive: this.reverserActive,
      reverserDeployment: this.reverserDeployment
    };
  }
}
