/** Observation boundary contract for combat pilot skills.
 * Separates observation-limited pilots from truth-diagnostic baselines and
 * blocks access to hidden target raw state, missile propellant, future paths,
 * and scorer internals.
 */

export const OBSERVATION_MODES = Object.freeze({
  LIMITED: 'observation-limited',
  TRUTH_DIAGNOSTIC: 'truth-diagnostic',
});

const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  'simulator', 'sim', 'combat', 'world', 'targets', 'missiles', 'scorer',
  'groundTruth', 'truth', 'rawTarget', 'futurePath', 'propellant',
]);

const FORBIDDEN_CONTACT_KEYS = new Set([
  'velocity', 'linearVelocity', 'angularVelocity', 'quaternion', 'propellant',
  'futurePath', 'target', 'rawTarget', 'alive', 'health', 'damage',
  'flareStock', 'chaffStock', 'evasionSkill', 'countermeasurePolicy',
]);

const FORBIDDEN_WARNING_KEYS = new Set([
  'propellant', 'futurePath', 'missile', 'rawMissile', 'seeker', 'fuel',
  'speedMps', 'velocity',
]);

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Observation boundary violation: ${label} must be a finite number`);
  }
}

function assertNoForbiddenKeys(obj, forbiddenSet, scope) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of forbiddenSet) {
    if (obj[key] !== undefined) {
      throw new Error(`Observation boundary violation: forbidden ${scope} field "${key}"`);
    }
  }
}

/** Validates that an observation payload respects the pilot boundary contract. */
export function assertObservationBoundary(observation, { expectedMode = OBSERVATION_MODES.LIMITED } = {}) {
  if (!observation || typeof observation !== 'object') {
    throw new Error('Observation boundary violation: observation must be an object');
  }
  const mode = observation.mode ?? OBSERVATION_MODES.LIMITED;
  if (mode !== OBSERVATION_MODES.LIMITED && mode !== OBSERVATION_MODES.TRUTH_DIAGNOSTIC) {
    throw new Error(`Observation boundary violation: unknown mode "${mode}"`);
  }
  if (expectedMode === OBSERVATION_MODES.LIMITED && mode !== OBSERVATION_MODES.LIMITED) {
    throw new Error(`Observation boundary violation: ${mode} is not permitted for observation-limited pilots`);
  }

  if (expectedMode === OBSERVATION_MODES.LIMITED) {
    assertNoForbiddenKeys(observation, FORBIDDEN_TOP_LEVEL_KEYS, 'observation');
  }

  const { own, contact, warnings } = observation;
  if (!own || typeof own !== 'object') {
    throw new Error('Observation boundary violation: own state is required');
  }
  assertFiniteNumber(own.x, 'own.x');
  assertFiniteNumber(own.y, 'own.y');
  assertFiniteNumber(own.z, 'own.z');
  assertFiniteNumber(own.headingRad, 'own.headingRad');

  if (contact !== null && contact !== undefined) {
    if (typeof contact !== 'object') {
      throw new Error('Observation boundary violation: contact must be an object or null');
    }
    if (expectedMode === OBSERVATION_MODES.LIMITED) {
      assertNoForbiddenKeys(contact, FORBIDDEN_CONTACT_KEYS, 'contact');
    }
    assertFiniteNumber(contact.x, 'contact.x');
    assertFiniteNumber(contact.y, 'contact.y');
    assertFiniteNumber(contact.z, 'contact.z');
    assertFiniteNumber(contact.rangeM, 'contact.rangeM');

    if (contact.observedAt !== undefined) {
      assertFiniteNumber(contact.observedAt, 'contact.observedAt');
      assertFiniteNumber(contact.expiresAt, 'contact.expiresAt');
      if (contact.expiresAt < contact.observedAt) {
        throw new Error('Observation boundary violation: contact.expiresAt < contact.observedAt');
      }
      assertFiniteNumber(contact.quality, 'contact.quality');
      if (contact.quality < 0 || contact.quality > 1) {
        throw new Error('Observation boundary violation: contact.quality must be in [0, 1]');
      }
      if (!['active', 'stale', 'lost'].includes(contact.status)) {
        throw new Error(`Observation boundary violation: invalid contact.status "${contact.status}"`);
      }
    }
  }

  if (warnings !== undefined) {
    if (!Array.isArray(warnings)) {
      throw new Error('Observation boundary violation: warnings must be an array');
    }
    for (const warning of warnings) {
      if (!warning || typeof warning !== 'object') {
        throw new Error('Observation boundary violation: warning entry must be an object');
      }
      if (expectedMode === OBSERVATION_MODES.LIMITED) {
        assertNoForbiddenKeys(warning, FORBIDDEN_WARNING_KEYS, 'warning');
      }
      if (warning.channel !== 'optical' && warning.channel !== 'radar') {
        throw new Error(`Observation boundary violation: invalid warning channel "${warning.channel}"`);
      }
      if (warning.channel === 'radar' && warning.sourceSeekerType === 'IR') {
        throw new Error('Observation boundary violation: IR launch cannot be emitted as a radar warning');
      }
      assertFiniteNumber(warning.bearingRad, 'warning.bearingRad');
      assertFiniteNumber(warning.observedAt, 'warning.observedAt');
      assertFiniteNumber(warning.expiresAt, 'warning.expiresAt');
      assertFiniteNumber(warning.quality, 'warning.quality');
    }
  }
  return observation;
}

/** Creates a bounded contact observation with timing, expiration, quality and status. */
export function createContactObservation({
  x, y, z, rangeM, observedAt, ttlSeconds = 0.5, quality = 1, status = 'active',
}) {
  return Object.freeze({
    x,
    y,
    z,
    rangeM,
    observedAt,
    expiresAt: observedAt + ttlSeconds,
    quality: Math.max(0, Math.min(1, quality)),
    status,
  });
}

/** Returns null when a contact is missing, marked lost, or expired at `now`. */
export function resolveContactObservation(contact, now = null) {
  if (!contact || contact.status === 'lost') return null;
  if (now != null && contact.expiresAt != null && now > contact.expiresAt) return null;
  if (contact.status === 'stale') return null;
  return contact;
}

/** Builds observation-only threat warnings without exposing missile propellant or future paths.
 * IR missiles with burning plumes produce only 'optical' warnings; 'radar' warnings require
 * an active radar seeker within RWR coverage.
 */
export function createWarningObservations({
  now,
  aircraft,
  missiles = [],
  terrainVisible = () => true,
  opticalRangeM = 4000,
  rwrRangeM = 8000,
  rwrEnabled = true,
  ttlSeconds = 0.5,
}) {
  const warnings = [];
  for (const missile of missiles) {
    if (!missile?.alive) continue;
    const dx = missile.position.x - aircraft.position.x;
    const dy = missile.position.y - aircraft.position.y;
    const dz = missile.position.z - aircraft.position.z;
    const rangeM = Math.hypot(dx, dy, dz);
    if (rangeM < 1) continue;
    const rvx = missile.velocity.x - aircraft.velocity.x;
    const rvy = missile.velocity.y - aircraft.velocity.y;
    const rvz = missile.velocity.z - aircraft.velocity.z;
    const closing = -(dx * rvx + dy * rvy + dz * rvz) / rangeM;
    if (closing < 50) continue;
    if (!terrainVisible(aircraft.position, missile.position, rangeM)) continue;

    const bearingRad = Math.atan2(dx, -dz);
    const hasPlume = (missile.propellant ?? 0) > 0 && rangeM <= opticalRangeM;
    if (hasPlume) {
      warnings.push(Object.freeze({
        id: `opt-${missile.id ?? warnings.length}`,
        channel: 'optical',
        bearingRad,
        observedAt: now,
        expiresAt: now + ttlSeconds,
        quality: Math.max(0.1, Math.min(1, 1 - rangeM / (opticalRangeM * 1.25))),
        status: 'active',
      }));
    }

    const seekerType = missile.spec?.seekerType;
    if (rwrEnabled && seekerType === 'ACTIVE_RADAR' && rangeM <= rwrRangeM) {
      const mSpeed = Math.hypot(missile.velocity.x, missile.velocity.y, missile.velocity.z);
      if (mSpeed > 1e-3) {
        const dot = (-missile.velocity.x * dx - missile.velocity.y * dy - missile.velocity.z * dz) / (mSpeed * rangeM);
        const gimbalDeg = missile.spec?.gimbalDeg ?? 65;
        if (dot >= Math.cos(gimbalDeg * Math.PI / 180)) {
          warnings.push(Object.freeze({
            id: `rwr-${missile.id ?? warnings.length}`,
            channel: 'radar',
            bearingRad,
            observedAt: now,
            expiresAt: now + ttlSeconds,
            quality: Math.max(0.1, Math.min(1, 1 - rangeM / (rwrRangeM * 1.25))),
            status: 'active',
          }));
        }
      }
    }
  }
  return Object.freeze(warnings);
}

/** Creates and validates an observation-limited pilot snapshot. */
export function createPilotObservation({
  time = 0,
  own,
  contact = null,
  warnings = [],
  locked = false,
  speedMps = 250,
  mode = OBSERVATION_MODES.LIMITED,
}) {
  const observation = Object.freeze({
    mode,
    time,
    own: Object.freeze({ ...own }),
    contact,
    warnings: Object.freeze([...warnings]),
    locked: Boolean(locked),
    speedMps,
  });
  return assertObservationBoundary(observation, { expectedMode: mode });
}
