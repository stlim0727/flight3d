/**
 * Pilot Physiological Model (G-Force, Blackout, Redout, G-LOC, and Control Degradation)
 *
 * Implements:
 * 1. Pilot vertical load factor (G_z) and cerebral perfusion / consciousness buffer (1.0 to 0.0).
 * 2. Positive G ischemic drain (> +5.5 G) and negative G congestion drain (< -1.8 G).
 * 3. G-LOC (Loss of Consciousness) state machine with mandatory lockout and stupor phase.
 * 4. Control responsiveness degradation:
 *    - 1st-order low-pass filtering with increased time constant (1.5x on pitch axis).
 *    - Physical strength / authority attenuation: clamp(C + 0.3, 0.2, 1.0).
 *    - High-G muscle strain jitter when |G_z| > 5.5 G.
 *    - G-LOC input lockout and 1.5s spring return to neutral.
 */

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

export class PilotPhysiology {
  constructor() {
    this.reset();
  }

  reset() {
    this.gZ = 1.0;
    this.consciousness = 1.0;
    this.isGLOC = false;
    this.glocTimer = 0.0;
    this.stuporTimer = 0.0;
    this.effectiveElevator = 0.0;
    this.effectiveAileron = 0.0;
    this.effectiveRudder = 0.0;
    this.responsiveness = 1.0;
    this.glocIncidents = 0;
    this.gFatigueAccumulator = 0.0; // Accumulated seconds where consciousness < 0.8
    this.elapsedTime = 0.0; // Dedicated simulation time advanced strictly by physics dt
  }

  /**
   * Advance the physiological simulation by one timestep.
   *
   * @param {number} dt Simulation timestep in seconds (e.g. 1/120s)
   * @param {number} gZ Vertical load factor along body vertical axis (+1.0 G in level flight)
   * @param {{ elevator: number, aileron: number, rudder: number }} rawInputs Commanded inputs (-1..1)
   * @param {number} [simTime=null] Optional continuous simulation time (defaults to internal dt accumulator)
   */
  update(dt, gZ, rawInputs = {}, simTime = null) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsedTime += dt;
    this.gZ = Number.isFinite(gZ) ? gZ : 1.0;
    const continuousTime = Number.isFinite(simTime) ? simTime : this.elapsedTime;

    const rawElevator = Number.isFinite(rawInputs.elevator) ? rawInputs.elevator : 0.0;
    const rawAileron = Number.isFinite(rawInputs.aileron) ? rawInputs.aileron : 0.0;
    const rawRudder = Number.isFinite(rawInputs.rudder) ? rawInputs.rudder : 0.0;

    // 1. Consciousness Buffer Dynamics
    if (this.gZ > 5.5) {
      // Positive G ischemia (blood pulled away from head into lower body)
      // Drains with time constant ~2.5s scaled by excess G over threshold (+5.5 G)
      const excessG = this.gZ - 5.5;
      const drainRate = excessG / (3.5 * 2.5); // e.g. at +9.0G drains in ~2.5s, at +7.0G drains in ~5.8s
      this.consciousness = Math.max(0.0, this.consciousness - drainRate * dt);
    } else if (this.gZ < -1.8) {
      // Negative G congestion / redout (blood forced into head)
      const excessG = -1.8 - this.gZ;
      const drainRate = excessG / (1.7 * 1.5); // e.g. at -3.5G drains in ~1.5s
      this.consciousness = Math.max(0.0, this.consciousness - drainRate * dt);
    } else {
      // Safe G buffer (-1.8 G <= gZ <= +5.5 G) -> recover consciousness towards 1.0
      if (!this.isGLOC) {
        const recoveryTimeConstant = 1.5; // Fast recovery when unloading G (1.5s)
        const recoveryRate = 1.0 / recoveryTimeConstant;
        this.consciousness = Math.min(1.0, this.consciousness + recoveryRate * dt);
      }
    }

    if (this.consciousness < 0.8) {
      this.gFatigueAccumulator += dt;
    }

    // 2. G-LOC State Machine
    if (this.consciousness <= 0.0 && !this.isGLOC) {
      this.isGLOC = true;
      this.glocTimer = 2.5; // Mandatory lockout: minimum 2~3 seconds
      this.glocIncidents++;
    }

    if (this.isGLOC) {
      this.consciousness = 0.0;
      this.glocTimer -= dt;
      // Waking criteria: mandatory timer elapsed and G-load within safe limits
      if (this.glocTimer <= 0.0 && this.gZ >= -1.8 && this.gZ <= 5.5) {
        this.isGLOC = false;
        this.stuporTimer = 1.5; // 1.5s stupor phase upon regaining consciousness
      }
    }

    // 3. Stupor Phase Dynamics (50% responsiveness blending to 100% over 1.5s)
    let stuporFactor = 1.0;
    if (this.stuporTimer > 0.0) {
      this.stuporTimer = Math.max(0.0, this.stuporTimer - dt);
      stuporFactor = 0.5 + 0.5 * (1.0 - this.stuporTimer / 1.5);
    }

    // 4. Control Responsiveness Degradation
    if (this.consciousness >= 0.999 && Math.abs(this.gZ) <= 5.5 && !this.isGLOC && this.stuporTimer <= 0) {
      this.effectiveElevator = rawElevator;
      this.effectiveAileron = rawAileron;
      this.effectiveRudder = rawRudder;
      this.responsiveness = 1.0;
      return;
    }

    if (this.isGLOC) {
      // Pilot completely unconscious: raw inputs blocked.
      // Controls return to neutral with gentle spring restoration (~1.5s full return)
      const springRate = 1.0 / 1.5; // return per second
      this.effectiveElevator += Math.sign(-this.effectiveElevator) * Math.min(Math.abs(this.effectiveElevator), springRate * dt);
      this.effectiveAileron += Math.sign(-this.effectiveAileron) * Math.min(Math.abs(this.effectiveAileron), springRate * dt);
      this.effectiveRudder += Math.sign(-this.effectiveRudder) * Math.min(Math.abs(this.effectiveRudder), springRate * dt);
      this.responsiveness = 0.0;
    } else {
      const targetElevator = rawElevator * stuporFactor;
      const targetAileron = rawAileron * stuporFactor;
      const targetRudder = rawRudder * stuporFactor;

      // ① 1st-Order Low-Pass Filter (Sluggish Response)
      const tauBase = 0.05; // 0.05s instant response when C = 1.0
      const tauEffective = tauBase + (1.0 - this.consciousness) * 0.6; // increases as C drops

      // Pitch axis prior degradation: human arms struggle more with pulling/pushing under high G
      const tauPitch = 1.5 * tauEffective;
      const tauRoll = tauEffective;
      const tauYaw = tauEffective;

      const alphaPitch = Math.min(1.0, dt / Math.max(0.001, tauPitch));
      const alphaRoll = Math.min(1.0, dt / Math.max(0.001, tauRoll));
      const alphaYaw = Math.min(1.0, dt / Math.max(0.001, tauYaw));

      this.effectiveElevator += (targetElevator - this.effectiveElevator) * alphaPitch;
      this.effectiveAileron += (targetAileron - this.effectiveAileron) * alphaRoll;
      this.effectiveRudder += (targetRudder - this.effectiveRudder) * alphaYaw;

      // ② Maximum Authority Limitation (Physical Strength Attenuation)
      // At high G, pilot cannot deflect controls to full mechanical limits
      const maxAuthority = clamp(this.consciousness + 0.3, 0.2, 1.0) * stuporFactor;
      this.effectiveElevator = clamp(this.effectiveElevator, -maxAuthority, maxAuthority);
      this.effectiveAileron = clamp(this.effectiveAileron, -maxAuthority, maxAuthority);
      this.effectiveRudder = clamp(this.effectiveRudder, -maxAuthority, maxAuthority);

      // ③ High-G Muscle Strain Jitter (|G_z| > 5.5 G)
      if (Math.abs(this.gZ) > 5.5 && this.consciousness > 0.0) {
        const jitter = Math.sin(continuousTime * 35.0) * (Math.abs(this.gZ) - 5.5) * 0.02;
        this.effectiveElevator = clamp(this.effectiveElevator + jitter, -maxAuthority, maxAuthority);
        this.effectiveAileron = clamp(this.effectiveAileron + jitter, -maxAuthority, maxAuthority);
      }

      this.responsiveness = clamp(maxAuthority * (tauBase / tauEffective), 0.0, 1.0);
    }
  }

  // Visual FX Factors
  get blackout() {
    if (this.isGLOC) return 1.0;
    if (this.consciousness >= 0.25) return 0.0;
    return clamp((0.25 - this.consciousness) / 0.25, 0.0, 1.0);
  }

  get grayout() {
    if (this.consciousness >= 0.8) return 0.0;
    return clamp((0.8 - this.consciousness) / 0.5, 0.0, 1.0);
  }

  get tunnelVision() {
    if (this.consciousness >= 1.0) return 0.0;
    return clamp((1.0 - this.consciousness) * 1.4, 0.0, 1.0);
  }

  get redout() {
    if (this.gZ >= -1.8) return 0.0;
    const gFactor = clamp((-this.gZ - 1.8) / 1.5, 0.0, 1.0);
    const cFactor = (1.0 - this.consciousness) * 0.6;
    return clamp(gFactor + cFactor, 0.0, 1.0);
  }

  get blur() {
    return this.redout * 0.8;
  }

  getSnapshot() {
    return {
      gZ: this.gZ,
      consciousness: this.consciousness,
      responsiveness: this.responsiveness,
      isGLOC: this.isGLOC,
      blackout: this.blackout,
      redout: this.redout,
      tunnelVision: this.tunnelVision,
      grayout: this.grayout,
      blur: this.blur,
      glocIncidents: this.glocIncidents,
      gFatigueSeconds: this.gFatigueAccumulator,
    };
  }
}
