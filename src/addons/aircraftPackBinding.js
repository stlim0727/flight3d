import { validateAddonManifest } from './addonContract.js';

const DEFAULT_ANIMATION = {
  azimuth: { node: 'azimuth_node', axis: 'x', input: 'rpm', continuous: true, rpmRange: [700, 2700] },
  elevator: { node: 'elevator_node', axis: 'x', input: 'elevator', rangeDeg: [-20, 20] },
  rudder: { node: 'rudder_node', axis: 'y', input: 'rudder', rangeDeg: [-25, 25] },
  flaps: { node: 'flaps_node', axis: 'x', input: 'flapsIndex', rangeDeg: [0, 40] },
  gear: { node: 'gear_node', axis: 'y', input: 'gearState', rangeDeg: [0, 90] },
};

export function aircraftPackFromProfile(profile, packId, { coreVersion } = {}) {
  const pin = profile?.pins?.find(entry => entry.id === packId);
  if (!pin) throw new Error(`profile does not pin ${packId}`);
  const manifest = pin.manifest;
  const result = validateAddonManifest(manifest, { coreVersion });
  if (!result.ok) throw new Error(`invalid pinned addon: ${result.errors.join('; ')}`);
  if (manifest.id !== packId || manifest.version !== pin.version) {
    throw new Error(`pinned manifest identity mismatch for ${packId}`);
  }
  const aircraft = manifest.aircraft;
  if (!aircraft) throw new Error(`${packId} is not an aircraft addon`);
  for (const resource of [aircraft.model, aircraft.cockpit].filter(Boolean)) {
    if (!/^https?:\/\//.test(resource.url)) throw new Error('aircraft asset URL must be absolute http(s)');
  }
  const controls = { ...DEFAULT_ANIMATION };
  for (const [control, node] of Object.entries(aircraft.controlBindings ?? {})) {
    controls[control] = { ...(controls[control] ?? {}), node };
  }
  if (aircraft.animation?.controls) {
    for (const [control, binding] of Object.entries(aircraft.animation.controls)) {
      controls[control] = { ...(controls[control] ?? {}), ...binding };
    }
  }
  const config = aircraft.physics?.id
    ? aircraft.physics
    : {
      ...aircraft.physics,
      id: aircraft.id.toUpperCase(),
      name: manifest.attribution,
      massProperties: {
        currentMassKg: aircraft.physics.massKg,
        emptyWeightKg: aircraft.physics.massKg,
        maxTakeoffWeightKg: aircraft.physics.massKg,
        Ixx: aircraft.physics.massKg * aircraft.physics.lengthM ** 2 / 12,
        Iyy: aircraft.physics.massKg * aircraft.physics.lengthM ** 2 / 12,
        Izz: aircraft.physics.massKg * aircraft.physics.wingspanM ** 2 / 12,
      },
      aerodynamics: {
        wingspanM: aircraft.physics.wingspanM,
        wingAreaM2: aircraft.physics.wingAreaM2,
      },
    };
  return Object.freeze({
    id: aircraft.id,
    packId,
    version: pin.version,
    sha256: pin.sha256,
    config: Object.freeze(config),
    spec: Object.freeze(config.specs ?? { id: aircraft.id, name: config.name }),
    model: Object.freeze(aircraft.model),
    cockpit: aircraft.cockpit ? Object.freeze(aircraft.cockpit) : null,
    controls: Object.freeze(controls),
    title: config.name ?? packId,
  });
}
