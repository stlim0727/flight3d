/** Wire major and shared flight-coordinate/data contract evolve independently. */
export const PROTOCOL_VERSION = 2;
export const FLIGHT_REVISION = 1;
// Frozen baseline for peers shipped before compatibility metadata was added.
export const LEGACY_FLIGHT_REVISION = 1;
export const SESSION_CONTRACT = Object.freeze({ flight: FLIGHT_REVISION });

export function compatibilityFailure(message, local = SESSION_CONTRACT) {
  if (message.version !== PROTOCOL_VERSION) return 'protocol';
  if (!Object.hasOwn(message, 'contract')) {
    return local.flight === LEGACY_FLIGHT_REVISION ? null : 'flight';
  }
  const contract = message.contract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)
    || !Number.isSafeInteger(contract.flight) || contract.flight < 1) return 'malformed-contract';
  return contract.flight === local.flight ? null : 'flight';
}
