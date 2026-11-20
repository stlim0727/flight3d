/**
 * CorridorFlightSurface.js
 *
 * Continuous analytical flight surface across the 451.2km Incheon ↔ Jeju flight corridor.
 * Guarantees continuous ground, coastal, and oceanic elevation queries (getHeight, getWaterLevel, getNormal)
 * independent of tile streaming, network drops, or LOD switches.
 *
 * Surface Datums:
 * - Incheon Int'l Airport (RKSI): Pavement 7.0m MSL, runway 15R/33L, 16L/34R
 * - Jeju Int'l Airport (RKPC): Pavement 36.0m MSL, runway 07/25
 * - Chuja Islands (추자도): Coastal island ridges up to 154m MSL (Bonggusan)
 * - Open Marine Waters: Mean Sea Level 0.0m MSL (Yellow Sea, Dadohae, Korea Strait)
 */

import * as THREE from 'three';
import {
  CHUJA_EMERGENCY_STRIP,
  getCorridorDistanceM,
  INCHEON_ORIGIN,
  INCHEON_SCENERY_ORIGIN,
  isWithinChujaEmergencyStrip,
  JEJU_ORIGIN,
  MEAN_SEA_LEVEL_M,
  wgs84ToIncheonLocal,
  wgs84ToIncheonSceneryLocal,
  wgs84ToJejuLocal,
} from '../geospatial/CorridorCoordinateSystem.js';
import { localToWgs84, wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';

// Chuja archipelago center and radius
const CHUJA_CENTER = { latitude: 33.9600, longitude: 126.3000 };
const CHUJA_MAX_ELEVATION_M = 154.0;
const CHUJA_RADIUS_M = 3500.0;

export class CorridorFlightSurface {
  /**
   * @param {Object} [options]
   * @param {Object} [options.activeOrigin] - Active reference origin (default: JEJU_ORIGIN)
   * @param {Object} [options.incheonSurface] - IncheonFlightSurface instance
   * @param {Object} [options.jejuSurface] - JejuFlightSurface instance
   */
  constructor(options = {}) {
    this.activeOrigin = options.activeOrigin || JEJU_ORIGIN;
    this.incheonSurface = options.incheonSurface || null;
    this.jejuSurface = options.jejuSurface || null;
    this.isLoaded = true;
  }

  get corridorLengthM() {
    return Math.round(getCorridorDistanceM());
  }

  wgs84ToLocal(latitude, longitude) {
    const [x, z] = wgs84ToLocal(latitude, longitude, this.activeOrigin);
    return { x, z };
  }

  localToWgs84(x, z) {
    return localToWgs84(x, z, this.activeOrigin);
  }

  setActiveOrigin(origin) {
    if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
      throw new Error('Invalid origin provided to CorridorFlightSurface');
    }
    this.activeOrigin = origin;
  }

  /**
   * Query surface elevation at local tangent coordinates [x, z].
   * @param {number} x - East meters relative to activeOrigin
   * @param {number} z - South meters relative to activeOrigin
   * @returns {number} Elevation in meters above Mean Sea Level
   */
  getHeight(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error('Invalid flight terrain coordinate');
    }

    const streamed = this.openWorld?.sample(x, z);
    if (streamed) return streamed.height;
    const { latitude, longitude } = localToWgs84(x, z, this.activeOrigin);
    return this.getHeightAtWgs84(latitude, longitude);
  }

  /**
   * Analytical surface elevation at WGS84 latitude and longitude.
   * @param {number} latitude
   * @param {number} longitude
   * @returns {number}
   */
  getHeightAtWgs84(latitude, longitude) {
    // 1. Jeju Island Region (lat 33.15 ~ 33.58, lon 126.15 ~ 126.98)
    if (latitude >= 33.15 && latitude <= 33.58 && longitude >= 126.15 && longitude <= 126.98) {
      if (this.jejuSurface && typeof this.jejuSurface.getHeight === 'function') {
        const [jx, jz] = wgs84ToJejuLocal(latitude, longitude);
        return this.jejuSurface.getHeight(jx, jz);
      }
      // Analytical fallback for Jeju: Hallasan volcanic cone + runway 07
      const dLat = latitude - JEJU_ORIGIN.latitude;
      const dLon = longitude - JEJU_ORIGIN.longitude;
      const distFromJejuArpM = Math.hypot(dLon * 88000, dLat * 111000);
      if (distFromJejuArpM < 2500) {
        return JEJU_ORIGIN.elevationM; // 36m on airport pavement
      }
      // Hallasan summit cone at (33.3617, 126.5332)
      const distHallasanM = Math.hypot((longitude - 126.5332) * 88000, (latitude - 33.3617) * 111000);
      if (distHallasanM < 25000) {
        const profile = Math.max(0, 1 - distHallasanM / 25000);
        return profile ** 1.8 * 1947.0;
      }
      return 0.0;
    }

    // 2. Incheon Airport Region (lat 37.38 ~ 37.55, lon 126.35 ~ 126.55)
    if (latitude >= 37.38 && latitude <= 37.55 && longitude >= 126.35 && longitude <= 126.55) {
      if (this.incheonSurface && typeof this.incheonSurface.getHeight === 'function') {
        const [ix, iz] = wgs84ToIncheonSceneryLocal(latitude, longitude);
        return this.incheonSurface.getHeight(ix, iz);
      }
      const distIncheonArpM = Math.hypot((longitude - INCHEON_ORIGIN.longitude) * 88000, (latitude - INCHEON_ORIGIN.latitude) * 111000);
      if (distIncheonArpM < 3500) {
        return INCHEON_ORIGIN.elevationM; // 7.0m on runway
      }
      return 0.0;
    }

    // 3. Chuja Archipelago (상추자도 / 하추자도)
    const distChujaM = Math.hypot(
      (longitude - CHUJA_CENTER.longitude) * 88000,
      (latitude - CHUJA_CENTER.latitude) * 111000
    );
    if (distChujaM < CHUJA_RADIUS_M) {
      const u = 1 - distChujaM / CHUJA_RADIUS_M;
      const naturalHeight = (u * u * (3 - 2 * u)) * CHUJA_MAX_ELEVATION_M;

      // 3A. Leveled Chuja Emergency Diversion Strip (Runway 05/23 at 12m MSL)
      if (isWithinChujaEmergencyStrip(latitude, longitude, false)) {
        return CHUJA_EMERGENCY_STRIP.elevationM;
      }

      // 3B. Coastal Valley Corridor & Runway Safety Area
      const [dx, dz] = wgs84ToLocal(latitude, longitude, CHUJA_EMERGENCY_STRIP.center);
      const along = (dx - dz) * Math.SQRT1_2;
      const across = (dx + dz) * Math.SQRT1_2;

      if (isWithinChujaEmergencyStrip(latitude, longitude, true)) {
        // Smoothly blend from 12.0m runway grade to safety area grade
        const dAlong = Math.max(0, Math.abs(along) - CHUJA_EMERGENCY_STRIP.lengthM * 0.5) / 100.0;
        const dAcross = Math.max(0, Math.abs(across) - CHUJA_EMERGENCY_STRIP.widthM * 0.5) / 17.5;
        const blend = Math.min(1, Math.max(dAlong, dAcross));
        const smooth = blend * blend * (3 - 2 * blend);
        return CHUJA_EMERGENCY_STRIP.elevationM * (1 - smooth) + (CHUJA_EMERGENCY_STRIP.elevationM + 2.0) * smooth;
      }

      const valleyAcross = Math.abs(across);
      const valleyAlong = Math.abs(along);
      if (valleyAcross < 400 && valleyAlong < 1200) {
        const valleyFloor = CHUJA_EMERGENCY_STRIP.elevationM + Math.min(6.0, (valleyAlong / 1200) * 6.0);
        const t = Math.max(0, valleyAcross - 40) / 360;
        const smooth = t * t * (3 - 2 * t);
        return valleyFloor * (1 - smooth) + naturalHeight * smooth;
      }

      return naturalHeight;
    }

    // 4. Yellow Sea, Dadohae, and open marine waters: Mean Sea Level is 0.0m
    return MEAN_SEA_LEVEL_M;
  }

  /**
   * Water surface elevation in meters MSL.
   */
  getWaterLevel(x, z) {
    const streamed = this.openWorld?.sample(x, z);
    return streamed ? (streamed.water ? streamed.height : -10000) : MEAN_SEA_LEVEL_M;
  }

  /**
   * Whether a given coordinate is over marine waters.
   */
  isWater(x, z) {
    return this.openWorld?.sample(x, z)?.water ?? this.getHeight(x, z) <= 0.05;
  }

  /**
   * Surface normal vector for aerodynamics and contact reflection.
   */
  getNormal(x, z) {
    if (this.isWater(x, z)) {
      return new THREE.Vector3(0, 1, 0);
    }
    const d = 1.0;
    const hL = this.getHeight(x - d, z);
    const hR = this.getHeight(x + d, z);
    const hU = this.getHeight(x, z - d);
    const hD = this.getHeight(x, z + d);
    return new THREE.Vector3(hL - hR, 2 * d, hU - hD).normalize();
  }

  isOnRunway(x, z) {
    const { latitude, longitude } = localToWgs84(x, z, this.activeOrigin);

    // 1. Chuja Emergency Diversion Strip
    if (isWithinChujaEmergencyStrip(latitude, longitude, false)) {
      return true;
    }

    // 2. Jeju Airport
    if (this.jejuSurface && typeof this.jejuSurface.isOnRunway === 'function') {
      const [jx, jz] = wgs84ToJejuLocal(latitude, longitude);
      if (Math.hypot(jx, jz) < 5000 && this.jejuSurface.isOnRunway(jx, jz)) return true;
    }

    // 3. Incheon Airport
    if (this.incheonSurface && typeof this.incheonSurface.isOnRunway === 'function') {
      const [ix, iz] = wgs84ToIncheonSceneryLocal(latitude, longitude);
      if (Math.hypot(ix, iz) < 6000 && this.incheonSurface.isOnRunway(ix, iz)) return true;
    }

    return false;
  }

  isRunwaySafetyArea(x, z) {
    const { latitude, longitude } = localToWgs84(x, z, this.activeOrigin);

    // 1. Chuja Emergency Diversion Strip Safety Area
    if (isWithinChujaEmergencyStrip(latitude, longitude, true)) {
      return true;
    }

    // 2. Jeju Airport
    if (this.jejuSurface && typeof this.jejuSurface.isRunwaySafetyArea === 'function') {
      const [jx, jz] = wgs84ToJejuLocal(latitude, longitude);
      if (Math.hypot(jx, jz) < 5000 && this.jejuSurface.isRunwaySafetyArea(jx, jz)) return true;
    }

    // 3. Incheon Airport
    if (this.incheonSurface && typeof this.incheonSurface.isRunwaySafetyArea === 'function') {
      const [ix, iz] = wgs84ToIncheonSceneryLocal(latitude, longitude);
      if (Math.hypot(ix, iz) < 6000 && this.incheonSurface.isRunwaySafetyArea(ix, iz)) return true;
    }

    return false;
  }
}
