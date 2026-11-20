import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';

/** Scenic start locations. Altitudes are above mean sea level. */
export const REGIONAL_CRUISES = Object.freeze({
  jamsil: { airport: 'incheon', latitude: 37.5054, longitude: 127.137, altitudeM: 1150, headingDeg: 284, ko: '잠실', en: 'Jamsil' },
  gwacheon: { airport: 'incheon', latitude: 37.413, longitude: 127.027, altitudeM: 1300, headingDeg: 303, ko: '과천', en: 'Gwacheon' },
  suwon: { airport: 'incheon', latitude: 37.253, longitude: 127.044, altitudeM: 1100, headingDeg: 320, ko: '수원', en: 'Suwon' },
  busan: { airport: 'incheon', latitude: 35.142, longitude: 129.075, altitudeM: 1200, headingDeg: 66, ko: '부산', en: 'Busan' },
  'jeju-city': { airport: 'jeju', latitude: 33.51, longitude: 126.57, altitudeM: 1250, headingDeg: 262, ko: '제주시', en: 'Jeju City' },
});

export function regionalCruise(id) {
  return Object.hasOwn(REGIONAL_CRUISES, id) ? REGIONAL_CRUISES[id] : undefined;
}

export function regionalCruiseSpawn(region, aircraftId) {
  const { airport, latitude, longitude, altitudeM, headingDeg } = region;
  const [x, z] = airport === 'jeju' ? wgs84ToLocal(latitude, longitude, JEJU_ORIGIN) : projectToLocal(latitude, longitude);
  const angle = headingDeg * Math.PI / 180;
  const speed = aircraftId === 'C172' ? 48 : aircraftId === 'F16' ? 180 : 108;
  return { x, y: altitudeM, z, vx: speed * Math.sin(angle), vy: 0, vz: -speed * Math.cos(angle), yaw: -angle };
}
