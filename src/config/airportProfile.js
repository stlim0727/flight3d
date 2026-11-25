// What a lobby map airport can offer: full scenery, a generated runway only, or
// a cruise start. Pure: no DOM. Used for map pins, start-state locks and the
// short place description under the map.

/** Airports with a dedicated permanent scene (terminal, taxiways, lighting). */
export const FULL_SCENERY_AIRPORTS = Object.freeze(new Set(['RKSI', 'RKPC', 'VNLK']));

/**
 * Korean military airfields without scheduled civil service. OurAirports lists
 * some of them as ordinary airports (RKSW is "Suwon Airport", medium_airport),
 * so the type field alone cannot tell them apart. Joint civil/military
 * airports such as Gimhae, Daegu or Gwangju are deliberately not listed.
 */
export const KOREAN_MILITARY_AIRFIELDS = Object.freeze(new Set([
  'RKSW', 'RKSO', 'RKSM', 'RKSG', 'RKTP', 'RKTY', 'RKJM', 'RKNN', 'RKTI',
  'QJP', 'RK13', 'RK16', 'RK60', 'RK6O', 'RKRA', 'RKUC',
]));

const MILITARY_NAME = /\b(air\s*base|AFB|AB|army\s*air\s*field|army\s*airfield|naval\s*air\s*station|NAS|RAF)\b/i;
// OurAirports surface codes that are explicitly not pavement. A blank or
// unrecognised surface is treated as paved: missing data must not lock a start.
const UNPAVED_SURFACE = /^(GRE|GRS|GRASS|TURF|DIRT|GVL|GRAVEL|SAN|SAND|CLA|CLAY|SOIL|EARTH|WATER|WAT|SNOW|ICE|COR|LAT|UNPAVED)/i;

/**
 * Shortest usable runway for a normal takeoff and landing, in metres. This
 * gates lobby start states only; it is not a performance model. Curated
 * full-scenery airports (e.g. Lukla) keep their own scenarios and are exempt.
 */
export const MIN_RUNWAY_M = Object.freeze({ B738: 1800, F16: 1200, C172: 500 });

/** Korean display names; OurAirports names stay as the English label. */
export const KOREAN_AIRPORT_NAMES = Object.freeze({
  RKSI: '인천국제공항',
  RKSS: '김포국제공항',
  RKPC: '제주국제공항',
  RKPK: '김해국제공항',
  RKTN: '대구국제공항',
  RKTU: '청주국제공항',
  RKNY: '양양국제공항',
  RKJB: '무안국제공항',
  RKJJ: '광주공항',
  RKJY: '여수공항',
  RKPU: '울산공항',
  RKTH: '포항경주공항',
  RKPS: '사천공항',
  RKJK: '군산공항',
  RKNW: '원주공항',
  RKPD: '정석비행장',
  RKTL: '울진비행장',
  RKSW: '수원 공군기지',
  RKSO: '오산 공군기지',
  RKSM: '서울공항 (성남 공군기지)',
  RKSG: '캠프 험프리스 비행장',
  RKTP: '서산 공군기지',
  RKTY: '예천 공군기지',
  RKJM: '목포 해군비행장',
  RKNN: '강릉 공군기지',
  RKTI: '중원 공군기지 (충주)',
  QJP: '포천 육군비행장 (G-217)',
  RK13: '양구 육군비행장 (G-404)',
  RK16: '육군비행장 G-312',
  RK60: '육군비행장 G-712',
  RK6O: '제천 육군비행장 (G-605)',
  RKRA: '가납리 육군비행장 (G-222)',
  RKUC: '조치원 육군비행장 (G-505)',
});

export const isPavedRunway = runway => !UNPAVED_SURFACE.test(String(runway?.surface ?? '').trim());

/** A military airfield: listed Korean base, or an index name that says so without also saying "Airport". */
export function isMilitaryAirfield(airport) {
  const code = String(airport?.code ?? '').toUpperCase();
  if (KOREAN_MILITARY_AIRFIELDS.has(code)) return true;
  const name = String(airport?.name ?? '');
  return MILITARY_NAME.test(name) && !/airport/i.test(name);
}

const longest = runways => runways.reduce((max, runway) => {
  const length = Number(runway?.lengthM);
  return Number.isFinite(length) && length > max ? length : max;
}, 0);

/**
 * Classify an airport place for the lobby.
 * - tier `full`: dedicated scene; `runway`: generated runway only; `cruise`: no takeoff/landing.
 * - reason (cruise only): `noRunway`, `military` or `unpaved`.
 * - tooShort: a `runway` airport whose longest paved runway is below the aircraft's minimum.
 * - landable: takeoff and approach starts are allowed for this aircraft.
 */
export function airportProfile(airport, aircraft = null) {
  const code = String(airport?.code ?? '').toUpperCase();
  const runways = Array.isArray(airport?.runways) ? airport.runways : [];
  const pavedRunways = runways.filter(isPavedRunway);
  let tier = 'runway';
  let reason = null;
  if (!runways.length) {
    tier = 'cruise';
    reason = 'noRunway';
  } else if (FULL_SCENERY_AIRPORTS.has(code)) {
    tier = 'full';
  } else if (isMilitaryAirfield(airport)) {
    tier = 'cruise';
    reason = 'military';
  } else if (!pavedRunways.length) {
    tier = 'cruise';
    reason = 'unpaved';
  }
  const longestRunwayM = Math.round(longest(pavedRunways.length ? pavedRunways : runways));
  const minRunwayM = aircraft && Object.hasOwn(MIN_RUNWAY_M, aircraft) ? MIN_RUNWAY_M[aircraft] : null;
  // An unknown length (0) is not evidence of a short runway.
  const tooShort = tier === 'runway' && minRunwayM !== null && longestRunwayM > 0 && longestRunwayM < minRunwayM;
  return Object.freeze({ code, tier, reason, longestRunwayM, minRunwayM, tooShort, landable: tier !== 'cruise' && !tooShort });
}

/** The airport name to show for a UI language, with the ICAO code appended. */
export function airportDisplayName(airport, language = 'en') {
  const code = String(airport?.code ?? '').toUpperCase();
  const name = (language === 'ko' && KOREAN_AIRPORT_NAMES[code]) || airport?.name || code;
  return code && name !== code ? `${name} (${code})` : name;
}
