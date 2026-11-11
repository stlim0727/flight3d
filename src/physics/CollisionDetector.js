import { t } from '../i18n/index.js';
import * as THREE from 'three';

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

export const AIRCRAFT_COLLISION_CONFIG = Object.freeze({
  B738: Object.freeze({
    boundingRadius: 26.0,
    segments: Object.freeze([
      { id: 'fuselage', p1: Object.freeze([0, -0.2, -17.5]), p2: Object.freeze([0, 1.2, 17.5]), radius: 2.1 },
      { id: 'wings', p1: Object.freeze([-17.2, 0.6, 2.8]), p2: Object.freeze([17.2, 0.6, 2.8]), radius: 1.2 },
      { id: 'fin', p1: Object.freeze([0, 1.2, 16.5]), p2: Object.freeze([0, 9.2, 16.0]), radius: 0.9 },
      { id: 'tailplane', p1: Object.freeze([-7.0, 1.5, 17.5]), p2: Object.freeze([7.0, 1.5, 17.5]), radius: 0.8 },
    ]),
    engines: Object.freeze([
      { id: 'engineL', pos: Object.freeze([-5.06, -1.95, -5.22]), radius: 1.2, descKey: 'left.engine' },
      { id: 'engineR', pos: Object.freeze([5.06, -1.95, -5.22]), radius: 1.2, descKey: 'right.engine' },
    ]),
  }),
  C172: Object.freeze({
    boundingRadius: 7.0,
    segments: Object.freeze([
      { id: 'fuselage', p1: Object.freeze([0, 0.0, -2.4]), p2: Object.freeze([0, 0.4, 4.2]), radius: 1.0 },
      { id: 'wings', p1: Object.freeze([-5.5, 0.92, -0.3]), p2: Object.freeze([5.5, 0.92, -0.3]), radius: 0.6 },
      { id: 'fin', p1: Object.freeze([0, 0.4, 3.7]), p2: Object.freeze([0, 2.0, 3.7]), radius: 0.5 },
      { id: 'tailplane', p1: Object.freeze([-1.7, 0.5, 4.2]), p2: Object.freeze([1.7, 0.5, 4.2]), radius: 0.4 },
    ]),
    engines: Object.freeze([]),
  }),
  F16: Object.freeze({
    boundingRadius: 12.0,
    segments: Object.freeze([
      { id: 'fuselage', p1: Object.freeze([0, 0, -7.7]), p2: Object.freeze([0, 0, 7.8]), radius: 1.3 },
      { id: 'wings', p1: Object.freeze([-4.8, 0, 1.8]), p2: Object.freeze([4.8, 0, 1.8]), radius: 0.5 },
      { id: 'fin', p1: Object.freeze([0, 0.5, 7.0]), p2: Object.freeze([0, 3.2, 6.8]), radius: 0.5 },
      { id: 'tailplane', p1: Object.freeze([-2.7, 0.1, 7.8]), p2: Object.freeze([2.7, 0.1, 7.8]), radius: 0.4 },
    ]),
    engines: Object.freeze([]),
  }),
});

function segmentSegmentDistanceSq(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0.0;
  let t = 0.0;

  if (a <= 1e-6 && e <= 1e-6) {
    return {
      distSq: rx * rx + ry * ry + rz * rz,
      c1: { x: p1.x, y: p1.y, z: p1.z },
      c2: { x: p2.x, y: p2.y, z: p2.z },
      s: 0,
      t: 0
    };
  }

  if (a <= 1e-6) {
    s = 0.0;
    t = Math.max(0.0, Math.min(1.0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-6) {
      t = 0.0;
      s = Math.max(0.0, Math.min(1.0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;

      if (denom > 1e-6) {
        s = Math.max(0.0, Math.min(1.0, (b * f - c * e) / denom));
      } else {
        s = 0.0;
      }

      t = (b * s + f) / e;

      if (t < 0.0) {
        t = 0.0;
        s = Math.max(0.0, Math.min(1.0, -c / a));
      } else if (t > 1.0) {
        t = 1.0;
        s = Math.max(0.0, Math.min(1.0, (b - c) / a));
      }
    }
  }

  const c1x = p1.x + s * d1x, c1y = p1.y + s * d1y, c1z = p1.z + s * d1z;
  const c2x = p2.x + t * d2x, c2y = p2.y + t * d2y, c2z = p2.z + t * d2z;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;

  return {
    distSq: dx * dx + dy * dy + dz * dz,
    c1: { x: c1x, y: c1y, z: c1z },
    c2: { x: c2x, y: c2y, z: c2z },
    s,
    t
  };
}

function pointSegmentDistanceSq(pt, p, q) {
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  if (l2 <= 1e-6) {
    const rx = pt.x - p.x, ry = pt.y - p.y, rz = pt.z - p.z;
    return { distSq: rx * rx + ry * ry + rz * rz, c: { x: p.x, y: p.y, z: p.z }, t: 0 };
  }
  const t = Math.max(0.0, Math.min(1.0, ((pt.x - p.x) * dx + (pt.y - p.y) * dy + (pt.z - p.z) * dz) / l2));
  const cx = p.x + t * dx, cy = p.y + t * dy, cz = p.z + t * dz;
  const rx = pt.x - cx, ry = pt.y - cy, rz = pt.z - cz;
  return { distSq: rx * rx + ry * ry + rz * rz, c: { x: cx, y: cy, z: cz }, t };
}

function getAircraftSegmentPartDesc(segmentId, s) {
  if (segmentId === 'fuselage') {
    if (s <= 0.25) return t('nose.radome');
    if (s >= 0.75) return t('tail.empennage');
    return t('belly.fuselage');
  }
  if (segmentId === 'wings') {
    if (s <= 0.35) return t('left.wingtip');
    if (s >= 0.65) return t('right.wingtip');
    return s <= 0.5 ? t('left.wingtip') : t('right.wingtip');
  }
  if (segmentId === 'fin') {
    return t('vertical.fin');
  }
  if (segmentId === 'tailplane') {
    return t('tail.empennage');
  }
  return t('belly.fuselage');
}

const _acSegP1 = new THREE.Vector3();
const _acSegQ1 = new THREE.Vector3();
const _acSegP2 = new THREE.Vector3();
const _acSegQ2 = new THREE.Vector3();
const _acEngPos = new THREE.Vector3();
const _acTargetPos = new THREE.Vector3();
const _acTargetQuat = new THREE.Quaternion();

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
    this.remoteAircraftProvider = null;

    this.buildSpatialGrids();
  }

  setRemoteAircraftProvider(provider) {
    this.remoteAircraftProvider = provider;
  }

  loadAircraftConfig(config = {}) {
    const isC172 = config?.id === 'C172';
    this.aircraftId = config?.id === 'F16' ? 'F16' : isC172 ? 'C172' : 'B738';
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

    // 6. Remote Aircraft Collision Check
    const aircraftResult = this.checkAircraft(position, quaternion, worldProbes, linearVelocity, groundContact);
    if (aircraftResult) {
      const isGround = Boolean(groundContact?.onGround);
      const crashSpeedKnots = aircraftResult.relativeVelocity
        ? Math.max(speedKnots, aircraftResult.relativeVelocity.length() * 1.94384)
        : speedKnots;
      return {
        collided: true,
        type: 'AIRCRAFT',
        get name() { return isGround ? t('aircraft.collision') : t('midair.collision'); },
        point: aircraftResult.point,
        speedKnots: crashSpeedKnots,
        get description() {
          return aircraftResult.remoteName
            ? t('the.value.collided.with.remote.pilot', { value: aircraftResult.part, target: aircraftResult.remoteName })
            : t('the.value.collided.with.another.aircraft', { value: aircraftResult.part });
        }
      };
    }

    // 7. Water / Ocean Impact Check
    const waterResult = this.checkWater(position, worldProbes, speedMs, vsiMs, pitchDeg, rollDeg, groundContact);
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

    // 8. Terrain & Hills Collision Check
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

  checkAircraft(aircraftPos, aircraftQuat, worldProbes, linearVelocity, groundContact = null) {
    if (!this.remoteAircraftProvider) return null;
    const provider = typeof this.remoteAircraftProvider === 'function'
      ? this.remoteAircraftProvider()
      : this.remoteAircraftProvider;
    if (!provider) return null;

    const targets = Array.isArray(provider) ? provider : [provider];
    const localGeom = AIRCRAFT_COLLISION_CONFIG[this.aircraftId] || AIRCRAFT_COLLISION_CONFIG.C172;

    for (const target of targets) {
      if (!target || target.crashed || target.active === false) continue;
      if (!target.position || !target.quaternion) continue;

      if (Array.isArray(target.position)) {
        _acTargetPos.fromArray(target.position);
      } else {
        _acTargetPos.copy(target.position);
      }

      if (Array.isArray(target.quaternion)) {
        _acTargetQuat.fromArray(target.quaternion);
      } else {
        _acTargetQuat.copy(target.quaternion);
      }

      const remoteGeom = AIRCRAFT_COLLISION_CONFIG[target.aircraft] || AIRCRAFT_COLLISION_CONFIG.C172;
      const broadDist = localGeom.boundingRadius + remoteGeom.boundingRadius;
      const dx = aircraftPos.x - _acTargetPos.x;
      const dy = aircraftPos.y - _acTargetPos.y;
      const dz = aircraftPos.z - _acTargetPos.z;
      if (dx * dx + dy * dy + dz * dz > broadDist * broadDist) continue;

      const calcRelVel = () => {
        if (!target.velocity) return null;
        if (target.velocity.isVector3) return linearVelocity.clone().sub(target.velocity);
        if (Array.isArray(target.velocity)) {
          return new THREE.Vector3(
            linearVelocity.x - target.velocity[0],
            linearVelocity.y - target.velocity[1],
            linearVelocity.z - target.velocity[2]
          );
        }
        return new THREE.Vector3(
          linearVelocity.x - target.velocity.x,
          linearVelocity.y - target.velocity.y,
          linearVelocity.z - target.velocity.z
        );
      };

      // 1. Check local segments vs remote segments
      for (const segL of localGeom.segments) {
        _acSegP1.set(segL.p1[0], segL.p1[1], segL.p1[2]).applyQuaternion(aircraftQuat).add(aircraftPos);
        _acSegQ1.set(segL.p2[0], segL.p2[1], segL.p2[2]).applyQuaternion(aircraftQuat).add(aircraftPos);

        for (const segR of remoteGeom.segments) {
          _acSegP2.set(segR.p1[0], segR.p1[1], segR.p1[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
          _acSegQ2.set(segR.p2[0], segR.p2[1], segR.p2[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);

          const { distSq, s, c1, c2 } = segmentSegmentDistanceSq(_acSegP1, _acSegQ1, _acSegP2, _acSegQ2);
          const maxDist = segL.radius + segR.radius;
          if (distSq <= maxDist * maxDist) {
            return {
              point: new THREE.Vector3((c1.x + c2.x) * 0.5, (c1.y + c2.y) * 0.5, (c1.z + c2.z) * 0.5),
              get part() { return getAircraftSegmentPartDesc(segL.id, s); },
              remoteName: target.name || null,
              relativeVelocity: calcRelVel(),
            };
          }
        }
      }

      // 2. Check local engines against remote segments
      if (localGeom.engines && localGeom.engines.length) {
        for (const eng of localGeom.engines) {
          _acEngPos.set(eng.pos[0], eng.pos[1], eng.pos[2]).applyQuaternion(aircraftQuat).add(aircraftPos);
          for (const segR of remoteGeom.segments) {
            _acSegP2.set(segR.p1[0], segR.p1[1], segR.p1[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
            _acSegQ2.set(segR.p2[0], segR.p2[1], segR.p2[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
            const { distSq, c } = pointSegmentDistanceSq(_acEngPos, _acSegP2, _acSegQ2);
            const maxDist = eng.radius + segR.radius;
            if (distSq <= maxDist * maxDist) {
              return {
                point: new THREE.Vector3((_acEngPos.x + c.x) * 0.5, (_acEngPos.y + c.y) * 0.5, (_acEngPos.z + c.z) * 0.5),
                get part() { return t(eng.descKey); },
                remoteName: target.name || null,
                relativeVelocity: calcRelVel(),
              };
            }
          }
        }
      }

      // 3. Check remote engines against local segments
      if (remoteGeom.engines && remoteGeom.engines.length) {
        for (const eng of remoteGeom.engines) {
          _acEngPos.set(eng.pos[0], eng.pos[1], eng.pos[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
          for (const segL of localGeom.segments) {
            _acSegP1.set(segL.p1[0], segL.p1[1], segL.p1[2]).applyQuaternion(aircraftQuat).add(aircraftPos);
            _acSegQ1.set(segL.p2[0], segL.p2[1], segL.p2[2]).applyQuaternion(aircraftQuat).add(aircraftPos);
            const { distSq, s, c } = pointSegmentDistanceSq(_acEngPos, _acSegP1, _acSegQ1);
            const maxDist = eng.radius + segL.radius;
            if (distSq <= maxDist * maxDist) {
              return {
                point: new THREE.Vector3((_acEngPos.x + c.x) * 0.5, (_acEngPos.y + c.y) * 0.5, (_acEngPos.z + c.z) * 0.5),
                get part() { return getAircraftSegmentPartDesc(segL.id, s); },
                remoteName: target.name || null,
                relativeVelocity: calcRelVel(),
              };
            }
          }
        }
      }

      // 4. Check local world probes against remote segments
      if (worldProbes && worldProbes.length) {
        for (const probe of worldProbes) {
          for (const segR of remoteGeom.segments) {
            _acSegP2.set(segR.p1[0], segR.p1[1], segR.p1[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
            _acSegQ2.set(segR.p2[0], segR.p2[1], segR.p2[2]).applyQuaternion(_acTargetQuat).add(_acTargetPos);
            const { distSq, c } = pointSegmentDistanceSq(probe.pos, _acSegP2, _acSegQ2);
            const maxDist = probe.radius + segR.radius;
            if (distSq <= maxDist * maxDist) {
              return {
                point: new THREE.Vector3((probe.pos.x + c.x) * 0.5, (probe.pos.y + c.y) * 0.5, (probe.pos.z + c.z) * 0.5),
                get part() { return probe.desc; },
                remoteName: target.name || null,
                relativeVelocity: calcRelVel(),
              };
            }
          }
        }
      }
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

  checkWater(aircraftPos, worldProbes, speedMs, vsiMs, pitchDeg = 0, rollDeg = 0, groundContact = null) {
    if (!this.terrain) return null;

    const terrainH = this.terrain.getHeight(aircraftPos.x, aircraftPos.z);
    // Sea level unless the terrain has its own water (the Neon Metropolis canal, #551).
    const waterLevel = this.terrain.getWaterLevel?.(aircraftPos.x, aircraftPos.z) ?? 0.0;
    // Water is visible only where the terrain does not rise above its surface. A terrain whose
    // land sits exactly at its water level (Neon Metropolis streets) says where its water is,
    // so a street is never a water impact (#458, #648).
    const isWater = this.terrain.isWater?.(aircraftPos.x, aircraftPos.z) ?? terrainH <= waterLevel;
    if (!isWater) return null;

    let contactPoint = null;
    for (const probe of worldProbes) {
      if (probe.pos.y <= waterLevel + 0.5) {
        contactPoint = probe.pos;
        break;
      }
    }
    if (!contactPoint) return null;

    // Detection-only callers (no contact solver):
    if (!groundContact) {
      // Ditching / crashing into water: speed > 15 m/s (~30 knots) or vertical descent > 3.0 m/s
      if (speedMs < 5.0 && Math.abs(vsiMs) < 1.0) return null; // Stationary boat/seaplane safe state
      return { point: contactPoint.clone() };
    }

    // Active simulation with solver:
    const waterDitching = groundContact.waterDitching;
    if (waterDitching?.catastrophic || groundContact.catastrophicImpact) {
      return { point: contactPoint.clone() };
    }

    // If safe ditching is in progress, do not trigger an explosion crash
    if (waterDitching?.ditchingContact) {
      return null;
    }

    const sinkRate = -vsiMs;
    const isFatal = sinkRate > 4.5 ||
      pitchDeg < -4.0 ||
      pitchDeg > 20.0 ||
      Math.abs(rollDeg) > 16.0 ||
      speedMs > 115.0;

    if (isFatal) {
      return { point: contactPoint.clone() };
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
    // Hull destruction is decided by the contact solver: an excessive first-body
    // impact sink or accumulated structural damage reaching its budgets. This is
    // the only excursion fatality on the runtime path — a gentle drift-off is
    // graded by soft-ground drag and damage instead.
    if (groundContact?.catastrophicImpact) {
      const excursion = !onRunway;
      return {
        get name() { return excursion ? t('runway.excursion') : t('catastrophic.landing.impact'); },
        point: groundContact.bodyContacts[0]?.worldPos.clone() || aircraftPos.clone(),
        get description() { return excursion
          ? t('the.aircraft.departed.the.runway')
          : t('excessive.belly.impact.or.accumulated.structural.damage'); }
      };
    }

    if (!groundContact) {
      // Detection-only callers have no contact solver to integrate drag or damage;
      // they keep the conservative geometric excursion kill.
      const groundH = this.terrain.getHeight(aircraftPos.x, aircraftPos.z);
      const gearHeight = gearState >= 0.5 ? 3.85 : 1.85;
      const isWheelGrounded = aircraftPos.y - groundH <= gearHeight && aircraftPos.y - groundH >= -2.0;
      const isMoving = speedMs > 5.0; // Low-speed taxi into grass halts safely rather than detonating
      const inSafetyArea = this.isPositionInSafetyArea(aircraftPos.x, aircraftPos.z);

      if (isWheelGrounded && isMoving && !onRunway && !inSafetyArea && speedMs > 15.0) {
        return {
          get name() { return t('runway.excursion'); },
          point: aircraftPos.clone(),
          get description() { return t('the.aircraft.departed.the.runway'); }
        };
      }
    }

    // Body contact is evaluated on every surface, including the runway. Gear
    // deployment and nominal attitude never exempt nacelles or wings from contact.
    for (const probe of worldProbes) {
      const probeOnRunway = this.isPositionOnRunway(probe.pos.x, probe.pos.z);
      const ground = this.terrain.getHeight(probe.pos.x, probe.pos.z);
      const radius = probe.id === 'engineL' || probe.id === 'engineR' ? probe.radius : 0;
      if (groundContact) {
        // The contact solver owns supported lower surfaces on every terrain and
        // rates grazing contact into damage budgets. It cannot represent deep
        // volumetric burial (slope or cliff plows) beyond its penetration limit,
        // nor the fin, which sits outside its support envelope on any surface.
        if (onRunway && probeOnRunway && probe.id !== 'fin') continue;
        const depth = ground - (probe.pos.y - radius);
        if (!(depth > 1.0 || (probe.id === 'fin' && probe.pos.y - radius < ground + 0.1))) continue;
      } else if (probe.pos.y - radius >= ground + 0.1) {
        continue;
      }
      return {
        get name() { return gearState < 0.25 ? t('gear.up.belly.crash') : t('terrain.body.strike'); },
        point: probe.pos.clone(),
        get description() { return t('the.value.made.ground.contact', { value: probe.desc }); }
      };
    }
    return null;
  }
}
