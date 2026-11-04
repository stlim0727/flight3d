import { t } from '../i18n/index.js';
import * as THREE from 'three';
import { createSurfaceModel, surfaceAt, waterContact } from './SurfaceModel.js';

export const B738_COLLISION_PROBES = Object.freeze([
  { id: 'nose', pos: [0, -0.2, -17.5], radius: 1.5, descKey: 'nose.radome' },
  { id: 'tail', pos: [0, 1.2, 17.5], radius: 1.2, descKey: 'tail.empennage' },
  { id: 'fin', pos: [0, 9.2, 16.0], radius: 0.8, descKey: 'vertical.fin' },
  { id: 'wingL', pos: [-17.2, 0.6, 2.8], radius: 1.0, descKey: 'left.wingtip' },
  { id: 'wingR', pos: [17.2, 0.6, 2.8], radius: 1.0, descKey: 'right.wingtip' },
  { id: 'engineL', pos: [-5.06, -1.95, -5.22], radius: 1.0, descKey: 'left.engine' },
  { id: 'engineR', pos: [5.06, -1.95, -5.22], radius: 1.0, descKey: 'right.engine' },
  { id: 'belly', pos: [0, -1.75, 0.0], radius: 1.8, descKey: 'belly.fuselage' }
]);

export const C172_COLLISION_PROBES = Object.freeze([
  { id: 'nose', pos: [0, 0.0, -2.4], radius: 0.6, descKey: 'nose.radome' },
  { id: 'tail', pos: [0, 0.4, 4.2], radius: 0.5, descKey: 'tail.empennage' },
  { id: 'fin', pos: [0, 2.0, 3.7], radius: 0.4, descKey: 'vertical.fin' },
  { id: 'wingL', pos: [-5.5, 0.92, -0.3], radius: 0.5, descKey: 'left.wingtip' },
  { id: 'wingR', pos: [5.5, 0.92, -0.3], radius: 0.5, descKey: 'right.wingtip' },
  { id: 'engineL', pos: [0, 0.15, -2.0], radius: 0.5, descKey: 'left.engine' },
  { id: 'belly', pos: [0, -0.35, 0.0], radius: 0.7, descKey: 'belly.fuselage' }
]);

export const F16_COLLISION_PROBES = Object.freeze([
  { id: 'nose', pos: [0, 0, -7.7], radius: 0.3, descKey: 'nose.radome' },
  { id: 'tail', pos: [0, 0, 7.8], radius: 0.5, descKey: 'tail.empennage' },
  { id: 'fin', pos: [0, 3.2, 6.8], radius: 0.3, descKey: 'vertical.fin' },
  { id: 'wingL', pos: [-4.8, 0, 1.8], radius: 0.3, descKey: 'left.wingtip' },
  { id: 'wingR', pos: [4.8, 0, 1.8], radius: 0.3, descKey: 'right.wingtip' },
  { id: 'belly', pos: [0, -0.7, 0], radius: 0.4, descKey: 'belly.fuselage' },
]);

/**
 * High-Performance Aircraft Collision & Obstacle Detector
 * Checks 6-DOF aircraft collision against:
 * 1. Terrain & Hills (mountain ridges, ground impact, hard landing, wingtip/tail strikes)
 * 2. Water / Ocean (ocean impact & ditching)
 * 3. Airport Control Tower (cylindrical observation tower & mast)
 * 4. Airport Buildings (terminal concourse & hangars)
 * 5. Trees (spatial hash grid of 3,500+ trees)
 * 6. City Buildings & Skyscrapers (spatial hash grid of 550+ structures)
 * 7. Maritime Ships (cargo ships, cruise liners, tankers)
 */
export class CollisionDetector {
  constructor(terrain, airport, foliageAndCities, ships, water) {
    this.terrain = terrain;
    this.airport = airport;
    this.foliage = foliageAndCities;
    this.ships = ships;
    this.water = water;
    this.surfaceModel = terrain?.surfaceModel ?? createSurfaceModel((x, z) => this.terrain?.getHeight(x, z) ?? null);
    this.shipInverse = new THREE.Matrix4();
    this.shipProbe = new THREE.Vector3();
    this.shipClosest = new THREE.Vector3();

    // Aircraft collision probe points in aircraft local body coordinates (meters)
    this.loadAircraftConfig();

    // Spatial hash grids for O(1) broadphase lookups
    this.gridCellSize = 150.0; // meters per cell
    this.treeGrid = new Map();
    this.buildingGrid = new Map();
    this.gridSource = foliageAndCities;

    this.buildSpatialGrids();
  }

  loadAircraftConfig(config = {}) {
    const isC172 = config?.id === 'C172';
    const probes = config?.id === 'F16' ? F16_COLLISION_PROBES : isC172 ? C172_COLLISION_PROBES : B738_COLLISION_PROBES;
    this.probePoints = probes.map(p => ({
      id: p.id,
      pos: new THREE.Vector3(...p.pos),
      radius: p.radius,
      get desc() { return t(p.descKey); }
    }));
  }

  getGridKey(x, z) {
    const gx = Math.floor(x / this.gridCellSize);
    const gz = Math.floor(z / this.gridCellSize);
    return `${gx}_${gz}`;
  }

  buildSpatialGrids() {
    // 1. Index trees
    if (this.foliage && this.foliage.treeData) {
      for (const tree of this.foliage.treeData) {
        const key = this.getGridKey(tree.x, tree.z);
        if (!this.treeGrid.has(key)) {
          this.treeGrid.set(key, []);
        }
        this.treeGrid.get(key).push(tree);
      }
    }

    // 2. Index city buildings
    if (this.foliage && this.foliage.buildingData) {
      for (const bldg of this.foliage.buildingData) {
        const minX = bldg.x - bldg.width * 0.5;
        const maxX = bldg.x + bldg.width * 0.5;
        const minZ = bldg.z - bldg.depth * 0.5;
        const maxZ = bldg.z + bldg.depth * 0.5;

        // Add to all intersecting grid cells
        const minGx = Math.floor(minX / this.gridCellSize);
        const maxGx = Math.floor(maxX / this.gridCellSize);
        const minGz = Math.floor(minZ / this.gridCellSize);
        const maxGz = Math.floor(maxZ / this.gridCellSize);

        for (let gx = minGx; gx <= maxGx; gx++) {
          for (let gz = minGz; gz <= maxGz; gz++) {
            const key = `${gx}_${gz}`;
            if (!this.buildingGrid.has(key)) {
              this.buildingGrid.set(key, []);
            }
            this.buildingGrid.get(key).push(bldg);
          }
        }
      }
    }
  }

  setEnvironment(terrain, airport, foliage = null, ships = null, water = null) {
    this.terrain = terrain;
    this.airport = airport;
    this.foliage = foliage;
    this.ships = ships;
    this.water = water;
    this.surfaceModel = terrain?.surfaceModel ?? createSurfaceModel((x, z) => this.terrain?.getHeight(x, z) ?? null);
    // The grids index static foliage/building data, so re-selecting an airport can
    // reuse them instead of re-binning every tree and building on the click thread.
    if (this.gridSource === foliage) return;
    this.gridSource = foliage;
    this.treeGrid.clear();
    this.buildingGrid.clear();
    this.buildSpatialGrids();
  }

  /**
   * Main collision evaluation called every physics step
   * Returns null if no collision, or a collision result object
   */
  checkCollision(position, quaternion, linearVelocity, gearState, pitchDeg, rollDeg, groundContact = null) {
    const speedMs = linearVelocity.length();
    const speedKnots = speedMs * 1.94384;
    const vsiMs = linearVelocity.y;

    // Transform all probes to world coordinates
    const worldProbes = this.probePoints.map(p => {
      const worldPos = p.pos.clone().applyQuaternion(quaternion).add(position);
      return {
        id: p.id,
        pos: worldPos,
        radius: p.radius,
        get desc() { return p.desc; }
      };
    });

    // 1. Airport Control Tower Check
    const towerResult = this.checkControlTower(position, worldProbes);
    if (towerResult) {
      return {
        collided: true,
        type: 'TOWER',
        get name() { return t('control.tower.collision'); },
        point: towerResult.point,
        speedKnots,
        get description() { return t('the.value.struck.the.airport.control.tower', { value: towerResult.part }); }
      };
    }

    // 2. Airport Buildings Check (Terminal, Hangars & Upper Retaining Wall)
    const airportBldgResult = this.checkAirportBuildings(position, worldProbes);
    if (airportBldgResult) {
      const isWall = airportBldgResult.isWall;
      return {
        collided: true,
        type: isWall ? 'TERRAIN' : 'BUILDING',
        get name() { return isWall ? t('rock.wall.collision') : t('airport.structure.collision'); },
        point: airportBldgResult.point,
        speedKnots,
        get description() { return isWall
          ? t('the.value.struck.the.rock.barrier.at', { value: airportBldgResult.part })
          : t('the.value.struck.an.airport.terminal.or', { value: airportBldgResult.part }); }
      };
    }

    // 3. City Skyscraper / Buildings Check (Broadphase via spatial grid)
    const cityBldgResult = this.checkCityBuildings(position, worldProbes);
    if (cityBldgResult) {
      return {
        collided: true,
        type: 'BUILDING',
        get name() { return t('skyscraper.collision'); },
        point: cityBldgResult.point,
        speedKnots,
        get description() { return t('the.value.struck.a.city.high.rise', { value: cityBldgResult.part }); }
      };
    }

    // 4. Tree / Foliage Collision Check (Broadphase via spatial grid)
    const treeResult = this.checkTrees(position, worldProbes);
    if (treeResult) {
      return {
        collided: true,
        type: 'TREE',
        get name() { return t('tree.collision'); },
        point: treeResult.point,
        speedKnots,
        get description() { return t('the.value.struck.dense.trees', { value: treeResult.part }); }
      };
    }

    // 5. Maritime Ship Collision Check
    const shipResult = this.checkShips(position, worldProbes);
    if (shipResult) {
      return {
        collided: true,
        type: 'SHIP',
        get name() { return t('maritime.vessel.collision'); },
        point: shipResult.point,
        speedKnots,
        get description() { return t('the.value.struck.a.vessel', { value: shipResult.part }); }
      };
    }

    // 6. Water / Ocean Impact Check
    const waterResult = this.checkWater(position, worldProbes, speedMs, vsiMs);
    if (waterResult) {
      return {
        collided: true,
        type: 'WATER',
        get name() { return t('ocean.water.impact'); },
        point: waterResult.point,
        speedKnots,
        get description() { return t('the.aircraft.hit.the.ocean.surface.at'); }
      };
    }

    // 7. Terrain & Hills Collision Check
    const terrainResult = this.checkTerrain(position, worldProbes, gearState, pitchDeg, rollDeg, speedMs, vsiMs, linearVelocity, groundContact);
    if (terrainResult) {
      return {
        collided: true,
        type: 'TERRAIN',
        get name() { return terrainResult.name; },
        point: terrainResult.point,
        speedKnots,
        get description() { return terrainResult.description; }
      };
    }

    return null;
  }

  checkControlTower(aircraftPos, worldProbes) {
    if (!this.airport || !this.airport.controlTowerData) return null;
    const t = this.airport.controlTowerData;

    // Check cylinder boundary
    const tBaseY = t.y;
    const tTopY = t.y + t.height;

    for (const probe of worldProbes) {
      const dx = probe.pos.x - t.x;
      const dz = probe.pos.z - t.z;
      const distSq = dx * dx + dz * dz;
      const effectiveRadius = t.radius + probe.radius;

      if (distSq < effectiveRadius * effectiveRadius) {
        if (probe.pos.y >= tBaseY && probe.pos.y <= tTopY) {
          return { point: probe.pos.clone(), get part() { return probe.desc; } };
        }
      }
    }
    return null;
  }

  checkAirportBuildings(aircraftPos, worldProbes) {
    if (!this.airport) return null;

    if (this.airport.checkBuildingCollision) return this.airport.checkBuildingCollision(worldProbes);

    // Check terminal concourse box
    const term = this.airport.terminalData;
    if (term) {
      const minY = term.y;
      const maxY = term.y + term.height;

      if (term.rotationY !== undefined) {
        // Oriented bounding box check (local coordinate space of rotated building)
        const cosR = Math.cos(-term.rotationY);
        const sinR = Math.sin(-term.rotationY);
        const halfW = (term.localWidth || term.width) * 0.5;
        const halfD = (term.localDepth || term.depth) * 0.5;

        for (const probe of worldProbes) {
          const dx = probe.pos.x - term.x;
          const dz = probe.pos.z - term.z;
          const lx = dx * cosR - dz * sinR;
          const lz = dx * sinR + dz * cosR;

          if (
            Math.abs(lx) <= halfW + probe.radius &&
            Math.abs(lz) <= halfD + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), get part() { return probe.desc; } };
          }
        }
      } else {
        const minX = term.x - term.width * 0.5;
        const maxX = term.x + term.width * 0.5;
        const minZ = term.z - term.depth * 0.5;
        const maxZ = term.z + term.depth * 0.5;

        for (const probe of worldProbes) {
          if (
            probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
            probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), get part() { return probe.desc; } };
          }
        }
      }
    }

    // Check hangars
    if (this.airport.hangarsData) {
      for (const h of this.airport.hangarsData) {
        const minX = h.x - h.width * 0.5;
        const maxX = h.x + h.width * 0.5;
        const minZ = h.z - h.depth * 0.5;
        const maxZ = h.z + h.depth * 0.5;
        const minY = h.y;
        const maxY = h.y + h.height;

        for (const probe of worldProbes) {
          if (
            probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
            probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), get part() { return probe.desc; } };
          }
        }
      }
    }

    // Check retaining wall (e.g. Lukla upper rock wall at Runway 24 threshold)
    const wall = this.airport.retainingWallData;
    if (wall) {
      const minY = wall.y;
      const maxY = wall.y + wall.height;
      const cosR = Math.cos(-wall.rotationY);
      const sinR = Math.sin(-wall.rotationY);
      const halfW = (wall.localWidth || wall.width) * 0.5;
      const halfD = (wall.localDepth || wall.depth) * 0.5;

      for (const probe of worldProbes) {
        const dx = probe.pos.x - wall.x;
        const dz = probe.pos.z - wall.z;
        const lx = dx * cosR - dz * sinR;
        const lz = dx * sinR + dz * cosR;

        if (
          Math.abs(lx) <= halfW + probe.radius &&
          Math.abs(lz) <= halfD + probe.radius &&
          probe.pos.y >= minY && probe.pos.y <= maxY
        ) {
          return { point: probe.pos.clone(), get part() { return probe.desc; }, isWall: true };
        }
      }
    }

    return null;
  }

  checkCityBuildings(aircraftPos, worldProbes) {
    if (!this.foliage || !this.foliage.buildingData) return null;

    // Spatial hash query of 3x3 surrounding cells
    const curGx = Math.floor(aircraftPos.x / this.gridCellSize);
    const curGz = Math.floor(aircraftPos.z / this.gridCellSize);

    for (let gx = curGx - 1; gx <= curGx + 1; gx++) {
      for (let gz = curGz - 1; gz <= curGz + 1; gz++) {
        const key = `${gx}_${gz}`;
        const bldgs = this.buildingGrid.get(key);
        if (!bldgs) continue;

        for (const b of bldgs) {
          const halfW = b.width * 0.5;
          const halfD = b.depth * 0.5;
          const minX = b.x - halfW;
          const maxX = b.x + halfW;
          const minZ = b.z - halfD;
          const maxZ = b.z + halfD;
          const minY = b.y;
          const maxY = b.y + b.height;
          const oriented = b.localWidth !== undefined && b.localDepth !== undefined;
          const cos = Math.cos(b.rotationY || 0), sin = Math.sin(b.rotationY || 0);

          // Quick bounding box check for aircraft center
          if (aircraftPos.y > maxY + 15 || aircraftPos.y < minY - 5) continue;

          for (const probe of worldProbes) {
            const dx = probe.pos.x - b.x, dz = probe.pos.z - b.z;
            // AABB indexes grid cells; local-space bounds keep rotated plinths
            // from colliding with empty road space at the AABB corners.
            if (oriented && (Math.abs(cos * dx - sin * dz) > b.localWidth / 2 + probe.radius ||
                Math.abs(sin * dx + cos * dz) > b.localDepth / 2 + probe.radius)) continue;
            if (
              probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
              probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
              probe.pos.y >= minY && probe.pos.y <= maxY
            ) {
              return { point: probe.pos.clone(), get part() { return probe.desc; } };
            }
          }
        }
      }
    }
    return null;
  }

  checkTrees(aircraftPos, worldProbes) {
    if (!this.foliage || !this.foliage.treeData) return null;

    const curGx = Math.floor(aircraftPos.x / this.gridCellSize);
    const curGz = Math.floor(aircraftPos.z / this.gridCellSize);

    for (let gx = curGx - 1; gx <= curGx + 1; gx++) {
      for (let gz = curGz - 1; gz <= curGz + 1; gz++) {
        const key = `${gx}_${gz}`;
        const trees = this.treeGrid.get(key);
        if (!trees) continue;

        for (const t of trees) {
          // If aircraft center is far above tree, skip
          if (aircraftPos.y > t.y + t.height + 15) continue;

          for (const probe of worldProbes) {
            const dx = probe.pos.x - t.x;
            const dz = probe.pos.z - t.z;
            const distSq = dx * dx + dz * dz;
            const maxR = t.radius + probe.radius;

            if (distSq < maxR * maxR) {
              if (probe.pos.y >= t.y && probe.pos.y <= t.y + t.height) {
                return { point: probe.pos.clone(), get part() { return probe.desc; } };
              }
            }
          }
        }
      }
    }
    return null;
  }

  checkShips(aircraftPos, worldProbes) {
    if (!this.ships || !this.ships.vessels) return null;

    for (const v of [...this.ships.vessels, ...(this.ships.speedboats || [])]) {
      if (v.bounds && v.mesh.isObject3D) {
        // Bounds belong to the visual, not the wake. Follow all motion axes and
        // wave elevation; yaw-only world boxes miss bows, masts and moving boats.
        v.mesh.updateWorldMatrix(true, false);
        this.shipInverse.copy(v.mesh.matrixWorld).invert();
        for (const probe of worldProbes) {
          this.shipProbe.copy(probe.pos).applyMatrix4(this.shipInverse);
          v.bounds.clampPoint(this.shipProbe, this.shipClosest);
          if (this.shipClosest.distanceToSquared(this.shipProbe) <= probe.radius * probe.radius) {
            return { point: probe.pos.clone(), get part() { return probe.desc; } };
          }
        }
        continue;
      }
      const vPos = v.mesh.position;
      const vRotY = v.mesh.rotation.y;
      const halfL = v.length * 0.5;
      const halfW = v.width * 0.5;
      const height = v.height || 35.0;

      // Transform probe to ship local coordinates
      const cosR = Math.cos(-vRotY);
      const sinR = Math.sin(-vRotY);

      for (const probe of worldProbes) {
        const dx = probe.pos.x - vPos.x;
        const dz = probe.pos.z - vPos.z;
        const localX = cosR * dx - sinR * dz;
        const localZ = sinR * dx + cosR * dz;

        if (
          Math.abs(localX) < halfW + probe.radius &&
          Math.abs(localZ) < halfL + probe.radius &&
          probe.pos.y >= 0 && probe.pos.y <= height
        ) {
          return { point: probe.pos.clone(), get part() { return probe.desc; } };
        }
      }
    }
    return null;
  }

  checkWater(aircraftPos, worldProbes, speedMs, vsiMs) {
    if (!this.terrain) return null;

    // Keep the existing impact-speed gate; surface type is independent of speed.
    if (speedMs < 5.0 && Math.abs(vsiMs) < 1.0) return null; // Stationary boat/seaplane safe state

    for (const probe of worldProbes) {
      if (waterContact(this.surfaceModel, probe.pos)) {
        return { point: probe.pos.clone() };
      }
    }
    return null;
  }

  isPositionOnRunway(x, z) {
    if (this.airport && typeof this.airport.isOnRunway === 'function') {
      return this.airport.isOnRunway(x, z);
    }
    return Math.abs(x) < 1650 && Math.abs(z) < 40;
  }

  isPositionInSafetyArea(x, z) {
    if (this.airport && typeof this.airport.isRunwaySafetyArea === 'function') {
      return this.airport.isRunwaySafetyArea(x, z);
    }
    return Math.abs(x) < 1750 && Math.abs(z) < 60;
  }

  checkTerrain(aircraftPos, worldProbes, gearState, pitchDeg, rollDeg, speedMs, vsiMs, linearVelocity = null, groundContact = null) {
    if (!this.terrain) return null;

    const onRunway = this.isPositionOnRunway(aircraftPos.x, aircraftPos.z);
    if (onRunway && groundContact?.catastrophicImpact) {
      return {
        get name() { return t('catastrophic.landing.impact'); },
        point: groundContact.bodyContacts[0]?.worldPos.clone() || aircraftPos.clone(),
        get description() { return t('excessive.belly.impact.or.accumulated.structural.damage'); }
      };
    }

    // Evaluate off-runway ground excursion: when the aircraft moves on the ground outside the runway
    const centerSurface = surfaceAt(this.surfaceModel, aircraftPos.x, aircraftPos.z);
    const groundH = centerSurface?.height ?? -Infinity;
    const gearHeight = gearState >= 0.5 ? 3.85 : 1.85;
    const isWheelGrounded = groundContact !== null
      ? Boolean(groundContact.contacts?.some(c => c.isGrounded))
      : (aircraftPos.y - groundH <= gearHeight && aircraftPos.y - groundH >= -2.0);

    const isMoving = speedMs > 5.0; // Low-speed taxi into grass halts safely rather than detonating
    const inSafetyArea = this.isPositionInSafetyArea(aircraftPos.x, aircraftPos.z);
    const gearCollapsed = groundContact?.contacts?.some(c => c.damageState === 'collapsed');
    const catastrophicHullLoss = Boolean(groundContact?.catastrophicImpact);
    const wheelOffRunway = groundContact?.contacts?.some(c =>
      c.isGrounded && !this.isPositionOnRunway(c.worldPos.x, c.worldPos.z)
    );

    // Fatal excursion conditions:
    // 1. Structural gear collapse from sustained off-runway stress while moving
    // 2. High-speed deep excursion outside paved runway and airport safety area (> 15 m/s)
    // 3. Catastrophic hull impact while off-runway
    const isExcursionCrash = centerSurface?.type === 'TERRAIN' && isWheelGrounded && isMoving && (
      (gearCollapsed && (!onRunway || wheelOffRunway)) ||
      (!onRunway && !inSafetyArea && speedMs > 15.0) ||
      (catastrophicHullLoss && !onRunway)
    );

    if (isExcursionCrash) {
      return {
        get name() { return t('runway.excursion'); },
        point: aircraftPos.clone(),
        get description() { return t('the.aircraft.departed.the.runway'); }
      };
    }

    // Body contact is evaluated on every surface, including the runway. Gear
    // deployment and nominal attitude never exempt nacelles or wings from contact.
    for (const probe of worldProbes) {
      const probeOnRunway = this.isPositionOnRunway(probe.pos.x, probe.pos.z);
      // The contact solver owns supported lower surfaces on the runway. A fin
      // strike or any probe outside the runway still uses fatal terrain detection.
      if (groundContact && onRunway && probeOnRunway && probe.id !== 'fin') continue;
      const surface = surfaceAt(this.surfaceModel, probe.pos.x, probe.pos.z);
      if (surface?.type !== 'TERRAIN') continue;
      const ground = surface.height;
      const radius = probe.id === 'engineL' || probe.id === 'engineR' ? probe.radius : 0;
      if (probe.pos.y - radius < ground + 0.1) {
        return {
          get name() { return gearState < 0.25 ? t('gear.up.belly.crash') : t('terrain.body.strike'); },
          point: probe.pos.clone(),
          get description() { return t('the.value.made.ground.contact', { value: probe.desc }); }
        };
      }
    }
    return null;
  }
}
