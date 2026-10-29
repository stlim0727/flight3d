import { t } from '../i18n/index.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { APPROACH_DATA } from '../config/approachData.js';

/**
 * Menu badge text derived from the aircraft and airfield configuration, so the
 * menu cannot drift from the simulation. DOM-free for node tests.
 */
export function aircraftSpec(aircraftId) {
  const config = AIRCRAFT_REGISTRY[aircraftId];
  if (!config) return '';
  const { numEngines, engineName } = config.propulsion;
  const parts = [`${numEngines}× ${engineName}`];
  parts.push(`MTOW ${Math.round(config.massProperties.maxTakeoffWeightKg).toLocaleString('en-US')} kg`);
  if (config.landingGear.isFixed) parts.push(t('lobby.spec.fixedGear'));
  return parts.join(' · ');
}

export function airportSpec(airportKey) {
  const data = APPROACH_DATA[airportKey];
  if (!data) return airportKey === 'hangang' ? t('lobby.spec.hangang') : '';
  const heading = String(Math.round(data.headingDeg)).padStart(3, '0');
  return `RWY ${heading}° · ${Math.round(data.elevationFt).toLocaleString('en-US')} FT · GS ${data.gsAngleDeg}°`;
}
