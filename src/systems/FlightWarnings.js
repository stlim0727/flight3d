/** Simulator warning envelopes, not certified avionics. See docs/development/flight-warnings.md. */
export const PROFILES = {
  B738: { vne: 340, mach: 0.82, bank: 35, terrain: true, landingFlap: 15 },
  C172: { vne: 163, bank: 60, terrain: false },
  F16: { vne: 800, mach: 2.05, bank: 85, terrain: true, landingFlap: 0 },
};
export class FlightWarnings {
  constructor(config = 'B738') { this.configure(config); }
  configure(config) {
    this.id = typeof config === 'string' ? config : config.id;
    this.profile = PROFILES[this.id] || PROFILES.B738;
    this.numEngines = config.propulsion?.numEngines ?? (this.id === 'C172' || this.id === 'F16' ? 1 : 2);
    this.reset();
  }
  reset() {
    this.result = [];
    this.active = new Map(); this.previous = null; this.closure = 0;
    this.departure = false; this.peakAltitude = null; this.wasGrounded = false;
    this.peakRadioAlt = 0; this.levelTime = 0;
  }
  update(dt, s, terrainAheadSeconds = Infinity) {
    if (!(dt > 0) || !Number.isFinite(dt)) return this.result || [];
    dt = Math.min(dt, 0.25);
    const p = this.profile, candidates = new Map();
    const add = (id, text, priority, voice = text) => candidates.set(id, { id, text, priority, voice });
    const airborne = s.onGround === false;
    const ra = s.radioAltFt, vsi = s.vsiFpm;
    const validHeight = Number.isFinite(ra) && ra >= 0;
    if (validHeight && this.previous !== null) {
      const measured = Math.max(0, (this.previous - ra) / dt);
      this.closure += (measured - this.closure) * (1 - Math.exp(-dt / 0.5));
    } else this.closure = 0;
    this.previous = validHeight ? ra : null;
    if (s.onGround) {
      this.departure = false; this.peakAltitude = null; this.wasGrounded = true;
      this.peakRadioAlt = 0; this.levelTime = 0;
    }
    if (airborne && this.wasGrounded && validHeight && ra > 30) {
      this.departure = true; this.wasGrounded = false;
    }
    if (this.departure && Number.isFinite(s.altitudeFt)) {
      this.peakAltitude = Math.max(this.peakAltitude ?? s.altitudeFt, s.altitudeFt);
      if (validHeight) this.peakRadioAlt = Math.max(this.peakRadioAlt, ra);
      this.levelTime = Math.abs(vsi) <= 100 ? this.levelTime + dt : 0;
      // Keep initial climb-loss protection. A settled circuit or configured
      // descent after climb-out is an approach even below the altitude ceiling.
      const configuredApproach = vsi < -100 && s.gearState > 0.95 && s.flapDegree >= (p.landingFlap ?? 0);
      if (ra > 1500 || this.peakRadioAlt >= 300 && (this.levelTime >= 5 || configuredApproach))
        this.departure = false;
    }
    if (this.id === 'B738' && s.onGround && s.throttle > 0.7 && s.iasKnots > 60 &&
        (s.flapDegree < 1 || s.flapDegree > 25 || s.spoilers > 0.1 || s.parkBrake))
      add('takeoff-config', 'TAKEOFF CONFIG', 80, null);
    if (airborne) {
      const stallWarning = s.isStallWarning ?? (s.isStalled || s.isPreStall);
      if (stallWarning) add('stall', 'STALL', 95, null);
      const overspeed = this.active.has('overspeed');
      if (s.iasKnots > p.vne - (overspeed ? 5 : 0) || s.mach > (p.mach ?? Infinity) - (overspeed ? 0.01 : 0))
        add('overspeed', 'OVERSPEED', 85, this.id === 'F16' ? 'Limit' : null);
      if (Math.abs(s.rollDeg) > p.bank + (validHeight && ra > 1000 ? 10 : 0))
        add('bank', 'BANK ANGLE', 50, this.id === 'B738' ? 'Bank angle, bank angle' : null);
      if (s.engine1?.failed || this.numEngines > 1 && s.engine2?.failed) add('engine', 'ENGINE FAILURE', 70, this.id === 'F16' ? 'Engine' : null);
      if (p.terrain && validHeight && Number.isFinite(vsi)) {
        const landing = s.gearState > 0.95 && s.flapDegree >= p.landingFlap;
        // Mode 1 stays active in landing configuration. Mode 2 is relaxed near a normal landing.
        const sink = Math.max(0, -vsi), impactTime = this.closure > 1 ? ra / this.closure : Infinity;
        if (ra > 10 && ra < 2450 && sink > 1500 + ra * 2 ||
            ra > 10 && impactTime < (landing ? 3 : 8) && (!landing || sink > 1000) || terrainAheadSeconds < 8)
          add('pull-up', 'PULL UP', 100, this.id === 'F16' ? 'Pull up, pull up' : 'Terrain, terrain. Pull up, pull up');
        else if (ra > 30 && ra < 2450 && sink > 1000 + ra * 1.2)
          add('sink-rate', 'SINK RATE', 80, this.id === 'B738' ? 'Sink rate, sink rate' : undefined);
        else if (ra > 30 && impactTime < 15 && !landing || terrainAheadSeconds < 15)
          add('terrain', 'TERRAIN', 90, 'Terrain, terrain');
        if (!this.departure && vsi < -100 && ra > 30) {
          if (ra < 500 && s.gearState < 0.95) add('gear', this.id === 'F16' ? 'GEAR DOWN' : 'TOO LOW GEAR', 65, this.id === 'B738' ? 'Too low gear' : undefined);
          else if (this.id === 'B738' && ra < 200 && s.flapDegree < p.landingFlap) add('flaps', 'TOO LOW FLAPS', 60, 'Too low flaps');
        }
        if (this.departure && ra > 30 && ra < 1500 && vsi < -200 && this.peakAltitude - s.altitudeFt > Math.max(20, ra * 0.1))
          add('dont-sink', "DON'T SINK", 75);
      }
    }
    // Enter quickly; retain an alert through brief sensor fluctuations, then clear.
    for (const [id, value] of candidates) this.active.set(id, { ...value, clearTime: 0 });
    for (const [id, value] of this.active) if (!candidates.has(id)) {
      value.clearTime += dt;
      if (!airborne || value.clearTime >= 0.8) this.active.delete(id);
    }
    this.result = [...this.active.values()].sort((a, b) => b.priority - a.priority);
    return this.result;
  }
}

/** Sample the actual terrain along the current velocity; no airport database assumed. */
export function terrainConflictSeconds(position, velocity, terrain, landing) {
  if (!terrain || Math.hypot(velocity.x, velocity.z) < 15) return Infinity;
  for (let seconds = 2; seconds <= 20; seconds += 2) {
    const height = terrain.getHeight(position.x + velocity.x * seconds, position.z + velocity.z * seconds);
    // Normal runway interception must not trigger predictive terrain warnings.
    const rise = height - terrain.getHeight(position.x, position.z);
    if (landing && rise < 15) continue;
    if (position.y + velocity.y * seconds < height + 10) return seconds;
  }
  return Infinity;
}
