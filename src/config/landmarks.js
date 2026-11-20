import { SIM_CONFIG } from './simConfig.js';
import { NEON_RIVER, bridgeToWorld } from './neonRiver.js';
import { INCHEON_ORIGIN, JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';

// Labels are sightseeing anchors. Peak and tower-top elevations are nominal MSL,
// independent of the resolution of the terrain or building mesh at that location.
const korea = [
  { ko: '롯데월드타워', en: 'Lotte World Tower', latitude: 37.5125, longitude: 127.10278, height: 585 },
  { ko: '남산서울타워', en: 'N Seoul Tower', latitude: 37.55112, longitude: 126.98787, height: 480 },
  { ko: '관악산', en: 'Gwanaksan', latitude: 37.444469, longitude: 126.963897, height: 632.2 },
  { ko: '북한산 백운대', en: 'Bukhansan · Baegundae', latitude: 37.6587, longitude: 126.978, height: 837 },
  { ko: '팔당댐', en: 'Paldang Dam', latitude: 37.5264, longitude: 127.2791, height: 60 },
  { ko: '인천국제공항', en: 'Incheon Airport', ...INCHEON_ORIGIN, height: 28 },
  { ko: '제주국제공항', en: 'Jeju Airport', ...JEJU_ORIGIN, height: 48 },
  { ko: '한라산', en: 'Hallasan', latitude: 33.3617, longitude: 126.5332, height: 1947 },
];

const bridgeNames = {
  cable: ['사장교', 'Cable Bridge'],
  arch: ['아치교', 'Arch Bridge'],
  light: ['라이트 브리지', 'Light Bridge'],
};

function geographicLandmarks(records, project) {
  return records.map(({ latitude, longitude, ...landmark }) => {
    const [x, z] = project(latitude, longitude);
    return { ...landmark, x, z };
  });
}

export function landmarksForMap(map, terrain, airport) {
  if (map === 'incheon') return geographicLandmarks(korea, projectToLocal);
  if (map === 'jeju') return geographicLandmarks(korea, (lat, lon) => wgs84ToLocal(lat, lon, JEJU_ORIGIN));
  if (map === 'neon') return NEON_RIVER.bridges.map(bridge => {
    const [x, z] = bridgeToWorld(bridge, 0);
    const [ko, en] = bridgeNames[bridge.id];
    return { ko, en, x, z, height: bridge.top + (bridge.rise ?? 0) + 7 };
  });
  if (map === 'lukla') {
    const tower = airport?.controlTowerData;
    return [
      { ko: '루클라 공항', en: 'Lukla Airport', x: 0, z: 0, height: 2855 },
      ...(tower ? [{ ko: '루클라 관제탑', en: 'Lukla Control Tower', x: tower.x, z: tower.z, height: tower.y + tower.height }] : []),
    ];
  }
  if (map === 'coastal') {
    const { x, y, z } = SIM_CONFIG.airport.runwayCenter;
    return [{ ko: '해안 공항', en: 'Coastal Airport', x, z, height: y + 18 }];
  }
  if (map === 'valley') {
    const finish = terrain?.terrain?.centerline?.at(-1);
    return finish ? [{ ko: '계곡 코스 종점', en: 'Valley Course Finish', x: finish.x, z: finish.z,
      height: terrain.getHeight(finish.x, finish.z) + 20 }] : [];
  }
  return [];
}
