/**
 * Paris showcase anchors: Seine riverbank, Pont d'Iéna, Champ de Mars and the
 * Eiffel Tower. Coordinates are WGS84 (Wikipedia: Eiffel Tower 48.858222,
 * 2.294500; Pont d'Iéna 48.85972, 2.29222; Champ de Mars 48.855805, 2.298377).
 *
 * Elevation is deliberately not baked in: the tower, bridge and quays are
 * seated on the same streamed terrain tiles that physics samples. IGN LiDAR HD
 * is a candidate for a future high-resolution ground source, but its tiles are
 * not bundled here (point-cloud volume and redistribution terms need review).
 */
import { haversineDistanceM } from '../geospatial/CorridorCoordinateSystem.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';

export const EIFFEL_TOWER_HEIGHT_M = 330;
export const PARIS_SHOWCASE_ORIGIN = Object.freeze({ latitude: 48.858222, longitude: 2.2945 });

const local = (latitude, longitude) => wgs84ToLocal(latitude, longitude, PARIS_SHOWCASE_ORIGIN);

/** Landmarks and the low-altitude verification route, in metres relative to the tower. */
export const PARIS_SHOWCASE = Object.freeze({
  id: 'paris-showcase',
  origin: PARIS_SHOWCASE_ORIGIN,
  tower: Object.freeze({
    id: 'eiffel-tower',
    latitude: 48.858222,
    longitude: 2.2945,
    heightM: EIFFEL_TOWER_HEIGHT_M,
    footprintRadiusM: 75,
    position: Object.freeze(local(48.858222, 2.2945)),
  }),
  bridge: Object.freeze({
    id: 'pont-iena',
    latitude: 48.85972,
    longitude: 2.29222,
    southEnd: Object.freeze(local(48.85889, 2.29222)),
    northEnd: Object.freeze(local(48.86055, 2.29222)),
    widthM: 20,
    deckThicknessM: 2.4,
    position: Object.freeze(local(48.85972, 2.29222)),
  }),
  champDeMars: Object.freeze({
    id: 'champ-de-mars',
    latitude: 48.855805,
    longitude: 2.298377,
    position: Object.freeze(local(48.855805, 2.298377)),
  }),
  // Downstream → bridge → tower → over the park; altitudes are AGL in metres.
  route: Object.freeze([
    Object.freeze({ latitude: 48.8592, longitude: 2.3022, altitudeM: 90,
      position: Object.freeze(local(48.8592, 2.3022)) }),
    Object.freeze({ latitude: 48.85972, longitude: 2.29222, altitudeM: 55,
      position: Object.freeze(local(48.85972, 2.29222)) }),
    Object.freeze({ latitude: 48.8584, longitude: 2.2949, altitudeM: 120,
      position: Object.freeze(local(48.8584, 2.2949)) }),
    Object.freeze({ latitude: 48.855805, longitude: 2.298377, altitudeM: 95,
      position: Object.freeze(local(48.855805, 2.298377)) }),
  ]),
});

/** Any map start within this distance of the tower activates the showcase. */
export const PARIS_SHOWCASE_RANGE_M = 25000;

export function isParisShowcaseOrigin(origin, rangeM = PARIS_SHOWCASE_RANGE_M) {
  return Boolean(origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
    && haversineDistanceM(origin.latitude, origin.longitude,
      PARIS_SHOWCASE_ORIGIN.latitude, PARIS_SHOWCASE_ORIGIN.longitude) <= rangeM);
}

/** z13/z14 imagery priority for the first verification zone, relative to `origin`. */
export function parisShowcaseInsets(origin) {
  if (!isParisShowcaseOrigin(origin)) return [];
  const [towerX, towerZ] = wgs84ToLocal(
    PARIS_SHOWCASE_ORIGIN.latitude, PARIS_SHOWCASE_ORIGIN.longitude, origin);
  const radius = 1300;
  return [Object.freeze({
    id: 'paris-seine-eiffel',
    region: 'paris',
    name: 'Seine, Pont d’Iéna and Eiffel Tower',
    bounds: Object.freeze([towerX - radius, towerZ - radius, towerX + radius, towerZ + radius]),
    minDetailLevel: 13,
    maxDetailLevel: 14,
    approachDistanceM: 9000,
  })];
}
