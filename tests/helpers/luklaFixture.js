import { readFileSync } from 'node:fs';
import { RasterRegionSurface } from '../../src/environment/RasterRegionSurface.js';
import { REGION_SURFACES } from '../../src/config/regionSurfaces.js';
import { getAirportOverride } from '../../src/config/airportOverrides.js';
import {
  buildExternalFacilityDescriptors,
  createExternalAirportFacilities,
} from '../../src/geospatial/externalAirportSurface.js';

// VNLK facility descriptors are airport-ARP relative; the shipped DEM grid is
// centred 0.12 m west and 7.79 m north of the ARP in the Incheon frame.
const GRID_FROM_ARP = Object.freeze([-0.12, 7.79]);
const { runway } = REGION_SURFACES.lukla;

/** Real DEM samples on the same reduced mesh the headless fixtures have always used. */
export function createLuklaTerrainFixture(segments = 16) {
  const bytes = readFileSync(new URL('../../public/terrain/lukla_dem.bin', import.meta.url));
  const elevations = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return new RasterRegionSurface(
    { ...REGION_SURFACES.lukla, segments },
    { elevations, load: false },
  );
}

/** Physical airport facade: surface queries from the DEM, buildings from VNLK data. */
export function createLuklaAirportFixture(terrain) {
  const descriptors = buildExternalFacilityDescriptors(
    getAirportOverride('VNLK').facilities,
    runway.midElevationM,
  ).map(facility => ({
    ...facility,
    position: [
      facility.position[0] + GRID_FROM_ARP[0],
      facility.position[1],
      facility.position[2] + GRID_FROM_ARP[1],
    ],
  }));
  const facilities = createExternalAirportFacilities(descriptors, runway.midElevationM);
  const tower = descriptors.find(facility => facility.kind === 'tower');

  return {
    group: facilities.group,
    isOnRunway: (x, z) => terrain.isOnRunway(x, z),
    isRunwaySafetyArea: (x, z) => terrain.isRunwaySafetyArea(x, z),
    hasModeledBuilding: facilities.hasModeledBuilding,
    checkBuildingCollision: facilities.checkCollision,
    getGazeTargets: () => facilities.gazeTargets,
    update(dt, aircraftPos, simTime = 0) {
      facilities.update(typeof aircraftPos === 'number' ? aircraftPos : simTime);
    },
    controlTowerData: {
      x: tower.position[0],
      y: tower.position[1],
      z: tower.position[2],
      radius: tower.radius,
      height: tower.height,
    },
  };
}

export function createLuklaFixture() {
  const terrain = createLuklaTerrainFixture();
  return { terrain, airport: createLuklaAirportFixture(terrain) };
}
