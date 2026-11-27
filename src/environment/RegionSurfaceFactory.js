import { CorridorFlightSurface } from './CorridorFlightSurface.js';
import { OpenWorldRegionSurface } from './OpenWorldRegionSurface.js';

/** Build any configured open-world region surface from declarative region data. */
export async function createConfiguredRegionSurface(config, { flightSurface = null } = {}) {
  const fallback = new CorridorFlightSurface({ activeOrigin: config.origin, incheonSurface: flightSurface });
  const surface = new OpenWorldRegionSurface({
    ...config,
    fallback,
  });
  return { surface, flightSurface };
}

/** Build the common airport facade for a configured region, when it has one. */
export function createRegionAirportFacade({ config, world, airportStreamer, airport, flightSurface }) {
  if (!config.airportCode || !airport) return null;
  const streamed = () => airportStreamer?.regionFor?.(config.airportCode)?.airport ?? null;
  const local = (x, z) => world.local(config.airportCode, x, z);
  return {
    isOnRunway: (x, z) => Boolean(streamed()?.isOnRunway?.(...local(x, z)))
      || Boolean(flightSurface?.isOnRunway?.(x, z) ?? airport.isOnRunway?.(x, z)),
    isRunwaySafetyArea: (x, z) => Boolean(streamed()?.isRunwaySafetyArea?.(...local(x, z)))
      || Boolean(flightSurface?.isRunwaySafetyArea?.(x, z) ?? airport.isRunwaySafetyArea?.(x, z)),
    hasModeledBuilding: (x, z) => airport.hasModeledBuilding(x, z),
    checkBuildingCollision: probes => airport.checkBuildingCollision(probes),
    getGazeTargets: () => airport.getGazeTargets(),
    nightLighting: airport.nightLighting,
    parked: airport.parked,
    resetTraffic: () => airport.resetTraffic(),
    update: (dt, position, time, options) => airport.update(dt, position, time, options),
  };
}
