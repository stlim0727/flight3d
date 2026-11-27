import { CorridorFlightSurface } from './CorridorFlightSurface.js';
import { OpenWorldRegionSurface } from './OpenWorldRegionSurface.js';
import { loadBundledTerrainGrid } from '../geospatial/BundledTerrainGrid.js';
import { terrainGeometry } from '../previews/incheonGeometry.js';

/** Build any configured open-world region surface from declarative region data. */
export async function createConfiguredRegionSurface(config, { baseUrl }) {
  const localTerrain = config.localTerrain;
  let source = null;
  let flightSurface = null;
  let localSurface = null;
  if (localTerrain) {
    source = await loadBundledTerrainGrid(`${baseUrl}${localTerrain.base}`, localTerrain.Terrain);
    flightSurface = localTerrain.createFlightSurface?.(source) ?? null;
    const size = localTerrain.size;
    const segments = localTerrain.segments;
    localSurface = {
      size,
      segments,
      geometry: terrainGeometry(size, segments, (x, z) => source.getNaturalHeight(x, z)),
      getNaturalHeight: (x, z) => source.getNaturalHeight(x, z),
      getHeight: (x, z) => flightSurface?.getHeight(x, z) ?? source.getHeight(x, z),
    };
  }
  const fallback = new CorridorFlightSurface({ activeOrigin: config.origin, incheonSurface: flightSurface });
  const surface = new OpenWorldRegionSurface({
    ...config,
    fallback,
    localSurface,
    localImageryExtent: localTerrain?.localImageryExtent ?? null,
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
      || Boolean(flightSurface?.isOnRunway(x, z)),
    isRunwaySafetyArea: (x, z) => Boolean(streamed()?.isRunwaySafetyArea?.(...local(x, z)))
      || Boolean(flightSurface?.isRunwaySafetyArea(x, z)),
    hasModeledBuilding: (x, z) => airport.hasModeledBuilding(x, z),
    checkBuildingCollision: probes => airport.checkBuildingCollision(probes),
    getGazeTargets: () => airport.getGazeTargets(),
    nightLighting: airport.nightLighting,
    resetTraffic: () => airport.resetTraffic(),
    update: (dt, position, time, options) => airport.update(dt, position, time, options),
  };
}
