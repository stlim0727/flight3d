import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import metadata from '../public/terrain/lukla_metadata.json' with { type: 'json' };
import * as THREE from 'three';
import { RasterRegionSurface } from '../src/environment/RasterRegionSurface.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';
import { getAirportOverride } from '../src/config/airportOverrides.js';
import { createExternalAirportRegion } from '../src/geospatial/externalAirportSurface.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { LandingGear } from '../src/physics/LandingGear.js';

const config = REGION_SURFACES.lukla;
const airportOverride = getAirportOverride('VNLK');
const headingRad = THREE.MathUtils.degToRad(config.runway.headingDeg);
const sinH = Math.sin(headingRad);
const cosH = Math.cos(headingRad);
const slopeDeg = THREE.MathUtils.radToDeg(Math.atan(config.runway.gradient));

function shippedElevations() {
  const buf = fs.readFileSync('public/terrain/lukla_dem.bin');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function surfaceWith(elevations) {
  return new RasterRegionSurface(config, { elevations, load: false });
}

// The streamed VNLK region is built from the same declarative metadata that the
// common Incheon-framed loader uses in the runtime. The generic surface owns
// the local-frame runway queries used by physics.
function createRegion(surface) {
  const [end06, end24] = airportOverride.runways[0].ends;
  const airport = {
    ident: 'VNLK',
    latitude: (end06.physical.latitude + end24.physical.latitude) / 2,
    longitude: (end06.physical.longitude + end24.physical.longitude) / 2,
    elevationM: airportOverride.elevationM,
    runways: airportOverride.runways.map(runway => ({
      id: runway.ident,
      lengthM: runway.lengthM,
      widthM: runway.widthM,
      ends: runway.ends,
    })),
  };
  const region = createExternalAirportRegion({ airport });
  region.airport.isOnRunway = (x, z) => surface.isOnRunway(x, z);
  region.airport.isRunwaySafetyArea = (x, z) => surface.isRunwaySafetyArea(x, z);
  return region;
}

describe('Nepal Tenzing-Hillary Airport (Lukla VNLK) Real-World Terrain & Systems', () => {
  it('should initialize the declarative surface with accurate specifications', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    assert.strictEqual(surface.config, config);
    assert.strictEqual(surface.size, 44000);
    assert.strictEqual(surface.segments, 255);
    assert.strictEqual(surface.gridSize, 1025);

    assert.strictEqual(surface.runway.lengthM, 527.0);
    assert.strictEqual(surface.runway.widthM, 30.0);
    assert.strictEqual(surface.runway.headingDeg, 58.0);
    assert.strictEqual(surface.runway.gradient, 0.1176);
    assert.strictEqual(config.runway.threshold06ElevationM, 2805.0);
    assert.strictEqual(config.runway.threshold24ElevationM, 2867.0);
    assert.strictEqual(config.runway.midElevationM, 2836.0);
    assert.strictEqual(surface.runway.threshold06ElevationM, config.runway.threshold06ElevationM);
    assert.strictEqual(surface.runway.threshold24ElevationM, config.runway.threshold24ElevationM);
    assert.strictEqual(surface.runway.midElevationM, config.runway.midElevationM);
    surface.dispose();
  });

  it('loads the traceable Copernicus-derived grid and computes Himalayan elevations', () => {
    const binPath = path.resolve(process.cwd(), 'public/terrain/lukla_dem.bin');
    assert.ok(fs.existsSync(binPath), 'lukla_dem.bin must exist in public/terrain');

    const elevations = shippedElevations();
    assert.strictEqual(elevations.length, metadata.gridSize * metadata.gridSize);
    assert.strictEqual(config.gridSize, metadata.gridSize);

    const surface = surfaceWith(elevations);
    assert.strictEqual(surface.isLoaded, true);

    // Height at airport center (0, 0)
    const midH = surface.getHeight(0, 0);
    assert.ok(midH >= 2825 && midH <= 2850, `Midpoint height ${midH} should be around 2836m`);

    // Height at 5km East (Thamserku mountain ridge)
    const eastRidgeH = surface.getHeight(5000, 0);
    assert.ok(eastRidgeH > 4000, `East ridge height ${eastRidgeH} should exceed 4,000m`);
    for (const point of metadata.dem.checkpoints) {
      assert.ok(Math.abs(surface.getNaturalHeight(point.x, point.z) - point.sourceHeightM) < 3.0,
        'Reprojected grid must agree with independent source-tile elevation checkpoints');
    }
    surface.dispose();
  });

  it('should carve an exact 11.7% sloped runway between Threshold 06 and 24', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    const halfLength = config.runway.lengthM / 2;

    // Threshold 06 (s = -263.5m)
    const p06X = -halfLength * sinH;
    const p06Z = halfLength * cosH;
    const h06 = surface.getHeight(p06X, p06Z);
    assert.strictEqual(Math.round(h06), 2805, 'Threshold 06 elevation should be 2,805m');

    // Threshold 24 (s = +263.5m)
    const p24X = halfLength * sinH;
    const p24Z = -halfLength * cosH;
    const h24 = surface.getHeight(p24X, p24Z);
    assert.strictEqual(Math.round(h24), 2867, 'Threshold 24 elevation should be 2,867m');

    // Midpoint (s = 0)
    const hMid = surface.getHeight(0, 0);
    assert.strictEqual(Math.round(hMid), 2836, 'Midpoint elevation should be 2,836m');

    // Check gradient: (2867 - 2805) / 527 = 62 / 527 = 11.76%
    const gradient = (h24 - h06) / config.runway.lengthM;
    assert.ok(Math.abs(gradient - 0.1176) < 0.005, 'Runway gradient must be 11.76%');
    surface.dispose();
  });

  it('preserves measured terrain beyond the airport instead of inventing walls and canyons', () => {
    const buf = fs.readFileSync('public/terrain/lukla_dem.bin');
    assert.strictEqual(createHash('sha256').update(buf).digest('hex'), metadata.dem.outputSha256);
    const surface = surfaceWith(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    for (const s of [-3000, -1000, -500, -330, 330, 400, 500, 1000, 3000]) {
      for (const w of [-150, 0, 150]) {
        const x = s * sinH + w * cosH;
        const z = -s * cosH + w * sinH;
        assert.strictEqual(surface.getHeight(x, z), surface.getNaturalHeight(x, z),
          `Outside airport grading, s=${s}, w=${w} must retain DEM elevation`);
      }
    }
    // Every source-grid sample must retain its position and north/south orientation.
    const mid = (metadata.gridSize - 1) / 2, maxIdx = metadata.gridSize - 1;
    for (const [row, col] of [[0, 0], [80, 300], [mid, mid], [400, 100], [maxIdx, maxIdx]]) {
      const x = (col / (metadata.gridSize - 1) - 0.5) * config.size;
      const z = (row / (metadata.gridSize - 1) - 0.5) * config.size;
      assert.ok(Math.abs(surface.getNaturalHeight(x, z) - surface.elevations[row * config.gridSize + col]) < 0.01);
    }
    // No discontinuity where the former 140 m mountain-wall override ended.
    for (const s of [-313.5, -263.5, 263.5, 313.5, 403.5]) {
      const before = surface.getHeight((s - 0.01) * sinH, -(s - 0.01) * cosH);
      const after = surface.getHeight((s + 0.01) * sinH, -(s + 0.01) * cosH);
      assert.ok(Math.abs(after - before) < 0.1, `Continuous airport transition at s=${s}`);
    }
    surface.dispose();
  });

  it('should compute valid surface normals for physics', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    const norm = surface.getNormal(0, 0);

    // Normal vector must be normalized
    assert.ok(Math.abs(norm.length() - 1.0) < 0.01);
    // Y component must point upwards
    assert.ok(norm.y > 0.85);
    surface.dispose();
  });

  it('should construct streamed 3D facilities, collision bounds, and keep facilities off the runway', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    const region = createRegion(surface);
    const { group, airport } = region;
    try {
      assert.ok(group instanceof THREE.Group);
      assert.strictEqual(surface.runway.lengthM, 527.0);
      assert.strictEqual(surface.runway.widthM, 30.0);

      // Check declarative facility metadata carried by the region facade
      assert.ok(airport.terminalData);
      assert.ok(airport.controlTowerData);
      assert.strictEqual(airport.controlTowerData.height, 16.0);
      assert.strictEqual(airport.controlTowerData.height,
        airportOverride.facilities.find(f => f.id === 'tower').height);

      // Verify terminal and tower are safely clear of the 30m runway centerline (|w| > 25m)
      const termW = airport.terminalData.x * cosH + airport.terminalData.z * sinH;
      const towerW = airport.controlTowerData.x * cosH + airport.controlTowerData.z * sinH;
      assert.ok(Math.abs(termW) > 25.0, `Terminal lateral position (${termW.toFixed(1)}m) must be outside runway clearance`);
      assert.ok(Math.abs(towerW) > 25.0, `Tower lateral position (${towerW.toFixed(1)}m) must be outside runway clearance`);

      // Verify isOnRunway containment
      assert.strictEqual(surface.isOnRunway(0, 0), true, 'Runway midpoint must be recognized as runway');
      assert.strictEqual(surface.isOnRunway(-210 * sinH, 210 * cosH), true, 'Runway 06 threshold must be recognized as runway');
      assert.strictEqual(surface.isOnRunway(500, 200), false, 'Surrounding mountain terrain must NOT be recognized as runway');

      // Preserve the apron and departure-corridor ground contact that the
      // dedicated airport class owned, now declared in REGION_SURFACES.lukla.
      const contact = config.contact;
      const at = (s, w) => [s * sinH + w * cosH, -s * cosH + w * sinH];
      const on = (s, w) => surface.isOnRunway(...at(s, w));
      const safety = (s, w) => surface.isRunwaySafetyArea(...at(s, w));
      const apron = contact.apron;
      const apronS = (apron.s[0] + apron.s[1]) / 2;
      const apronW = (apron.w[0] + apron.w[1]) / 2;
      assert.ok(on(apronS, apronW), 'Declared apron must preserve runway contact');
      const apronSafetyS = (apron.safetyS[0] + apron.s[0]) / 2;
      const apronSafetyW = (config.runway.widthM / 2 + apron.w[1]) / 2;
      assert.ok(!on(apronSafetyS, apronSafetyW), 'Apron safety margin is not full runway contact');
      assert.ok(safety(apronSafetyS, apronSafetyW), 'Apron safety margin must remain a safety area');
      const corridor = contact.departureCorridor;
      const corridorS = (corridor.s[0] + corridor.s[1]) / 2;
      assert.ok(on(corridorS, 0), 'Declared departure corridor must preserve runway contact');
      assert.ok(on(corridorS, corridor.halfWidthM - 1));
      assert.ok(!on(corridorS, corridor.halfWidthM + 1));
      assert.ok(safety(corridorS, corridor.safetyHalfWidthM - 1));
      assert.ok(!safety(corridorS, corridor.safetyHalfWidthM + 1));

      // Dynamic updates support both legacy and streamed signatures without NaN
      const beacons = [];
      const socks = [];
      group.traverse(object => {
        if (object.isPointLight) beacons.push(object);
        if (object.isMesh && object.parent?.name === 'vnlk-windsock') socks.push(object);
      });
      airport.update(0.016, 1.0);
      assert.ok(beacons.length > 0);
      assert.strictEqual(typeof beacons[0].intensity, 'number');
      assert.ok(!Number.isNaN(beacons[0].intensity));

      airport.update(0.016, new THREE.Vector3(0, 2800, 0), 2.5);
      assert.ok(!Number.isNaN(beacons[0].intensity));
      for (const sock of socks) assert.ok(!Number.isNaN(sock.rotation.y));
    } finally {
      region.dispose();
      surface.dispose();
    }
  });

  it('uses an explicitly unloaded neutral surface until real assets arrive', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    assert.strictEqual(surface.isLoaded, false);
    assert.strictEqual(surface.getNaturalHeight(5000, 5000), config.runway.midElevationM);
    assert.strictEqual(surface.getNaturalHeight(-5000, -5000), config.runway.midElevationM);
    surface.dispose();
  });

  it('should detect collisions against the streamed tower and terminal', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    const region = createRegion(surface);
    try {
      const detector = new CollisionDetector(surface, region.airport, null, null, null);

      // 1. Safe on runway 06 threshold with gear down (groundH plus 3.5m wheel geometry)
      const groundH = surface.getHeight(-210 * sinH, 210 * cosH);
      const pos = new THREE.Vector3(-210 * sinH, groundH + 3.5, 210 * cosH);
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(slopeDeg), -headingRad, 0, 'YXZ')
      );
      const vel = new THREE.Vector3(50 * sinH, 0, -50 * cosH);

      const safeResult = detector.checkCollision(pos, quat, vel, 1.0, slopeDeg, 0.0);
      assert.strictEqual(safeResult, null, 'Safe on runway should not trigger crash');

      // 2. Direct hit into the declarative control tower
      const towerData = region.airport.controlTowerData;
      const towerPos = new THREE.Vector3(towerData.x, towerData.y + 6, towerData.z);
      const crashResult = detector.checkCollision(towerPos, quat, vel, 1.0, 0.0, 0.0);
      assert.ok(crashResult !== null, 'Collision with control tower must be detected');
      assert.strictEqual(crashResult.type, 'TOWER');

      // 3. Collision with rotated terminal building corner
      // Local corner of 44x24m terminal rotated by the declarative rotationY
      const terminalData = region.airport.terminalData;
      const rotY = terminalData.rotationY;
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      // Point at local (lx = 18m, lz = 10m) inside rotated building
      const cornerX = terminalData.x + 18 * cosR + 10 * sinR;
      const cornerZ = terminalData.z - 18 * sinR + 10 * cosR;
      const terminalCornerPos = new THREE.Vector3(cornerX, terminalData.y + 5, cornerZ);
      const termCrash = detector.checkCollision(terminalCornerPos, quat, vel, 1.0, 0.0, 0.0);
      assert.ok(termCrash !== null, 'Collision with rotated terminal corner must be detected');
      assert.strictEqual(termCrash.type, 'BUILDING');
    } finally {
      region.dispose();
      surface.dispose();
    }
  });

  it('should construct the upper retaining wall at the Runway 24 threshold with defined elevation and detect collision', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    const region = createRegion(surface);
    try {
      const wallFacility = airportOverride.facilities.find(f => f.id === 'upper-wall');
      assert.strictEqual(wallFacility.position[1], config.runway.threshold24ElevationM);
      assert.strictEqual(region.airport.retainingWallData.y, 2867.0);

      region.group.updateMatrixWorld(true);
      const wallModel = region.group.getObjectByName('vnlk-wall');
      assert.ok(wallModel, 'Upper retaining wall model must be created');
      const wallMesh = wallModel.children.find(m => m.geometry?.type === 'BoxGeometry');
      assert.ok(wallMesh);
      const wallY = wallModel.position.y + wallMesh.position.y;
      assert.strictEqual(wallY, 2870.0, 'Upper wall elevation must equal elevation24 + 3.0m');
      assert.ok(!Number.isNaN(wallY), 'Upper wall elevation must not be NaN');

      const detector = new CollisionDetector(surface, region.airport, null, null, null);

      // Aircraft rolling uphill heading 58° at s = 250m (on runway, gear down)
      // Nose probe extends 17.5m ahead (-Z in aircraft local space, +s along 58°) to s = 267.5m,
      // hitting the wall at s = 265m.
      const centerPos = new THREE.Vector3(250 * sinH, 2868.0, -250 * cosH);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -headingRad, 0, 'YXZ'));
      const vel = new THREE.Vector3(20 * sinH, 0, -20 * cosH);

      const wallCrash = detector.checkCollision(centerPos, quat, vel, 1.0, 0.0, 0.0);
      assert.ok(wallCrash !== null, 'Collision with retaining wall must be detected even with gear down');
      // The streamed region publishes the wall as a facility collider, so the
      // detector classifies it as BUILDING rather than legacy TERRAIN.
      assert.strictEqual(wallCrash.type, 'BUILDING');
      const wallHit = region.airport.checkBuildingCollision([{
        pos: new THREE.Vector3(centerPos.x + 17.5 * sinH, centerPos.y - 0.2, centerPos.z - 17.5 * cosH),
        radius: 1.5,
        desc: 'nose',
      }]);
      assert.strictEqual(wallHit?.id, 'upper-wall');
    } finally {
      region.dispose();
      surface.dispose();
    }
  });

  it('should impart sloped surface normal forces in landing gear physics on Lukla runway', () => {
    const gear = new LandingGear();
    const surface = new RasterRegionSurface(config, { load: false });

    // Position aircraft on Runway 24 facing downhill (heading 238°)
    // Surface slopes downhill at 11.7% (~6.71° pitch)
    const mesh = new THREE.Object3D();
    const groundH = surface.getHeight(0, 0);
    mesh.position.set(0, groundH + 2.1, 0);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(config.runway.headingDeg + 180), 0, 'YXZ'));
    mesh.updateMatrixWorld(true);

    const linearVel = new THREE.Vector3(0, 0, 0);
    const angularVel = new THREE.Vector3(0, 0, 0);

    // Update with terrain height and normal callback
    const res = gear.update(
      0.016,
      mesh,
      linearVel,
      angularVel,
      (x, z) => surface.getHeight(x, z),
      (x, z) => surface.getNormal(x, z)
    );

    assert.strictEqual(res.onGround, true, 'Gear should be compressed on sloped runway');
    assert.ok(res.forces.y > 100000, 'Suspension normal force should support aircraft weight');

    // On an 11.7% sloped runway oriented at 58°/238°, normal force must have a horizontal component
    // that accelerates the aircraft downhill towards Threshold 06 (-s direction)
    const horizForce = Math.sqrt(res.forces.x * res.forces.x + res.forces.z * res.forces.z);
    assert.ok(horizForce > 10000, `Horizontal surface normal force (${horizForce.toFixed(0)}N) should be significant on 11.7% slope`);

    // Force along runway axis s = fx * sin58 - fz * cos58 should push downhill (negative s)
    const forceAlongS = res.forces.x * sinH - res.forces.z * cosH;
    assert.ok(forceAlongS < 0, `Force along runway axis (${forceAlongS.toFixed(0)}N) must be directed downhill (-s toward cliff)`);
    surface.dispose();
  });

  it('should construct local high-resolution terrace mesh to preserve runway surface without coarse DEM bulging', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    assert.ok(surface.localTerraceMesh, 'Local terrace mesh must exist');
    assert.ok(surface.localTerraceGeometry, 'Local terrace geometry must exist');
    assert.strictEqual(surface.mesh.children.includes(surface.localTerraceMesh), true,
      'Terrace mesh must be attached to terrain mesh');

    // Centerline point at s = 200m (x = 200*sin58, z = -200*cos58)
    const analyticalH200 = surface.getHeight(200 * sinH, -200 * cosH);
    assert.strictEqual(Math.round(analyticalH200 * 10) / 10, 2859.5, 'Centerline height at s=200m should be ~2859.5m');

    // Find the closest vertex in localTerraceGeometry to (s = 200, w = 0)
    const lPos = surface.localTerraceGeometry.attributes.position;
    let closestDistSq = Infinity;
    let closestH = null;

    for (let i = 0; i < lPos.count; i++) {
      const x = lPos.getX(i);
      const z = lPos.getZ(i);
      const s = x * sinH - z * cosH;
      const w = x * cosH + z * sinH;
      const distSq = (s - 200) * (s - 200) + w * w;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closestH = lPos.getY(i);
      }
    }

    assert.ok(closestDistSq < 1.0, 'Must have a fine-tessellation vertex right at s=200, w=0');
    assert.ok(Math.abs(closestH - (analyticalH200 - config.terrace.depressionM)) < 0.01,
      'Rendered terrace must sit below the unchanged physical runway height');
    surface.dispose();
  });

  it('keeps the fine terrace above the coarse mesh and below the physical runway across both thresholds after DEM reload', () => {
    const surface = new RasterRegionSurface(config, { load: false });
    surface.mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const checkClearance = () => {
      for (const s of [-261, -250, -10, 0, 10, 250, 261]) {
        for (const w of [-14.9, -10, 0, 10, 14.9]) {
          const x = s * sinH + w * cosH;
          const z = -s * cosH + w * sinH;
          ray.set(new THREE.Vector3(x, 4000, z), new THREE.Vector3(0, -1, 0));
          const terrace = ray.intersectObject(surface.localTerraceMesh, false)[0];
          const ground = ray.intersectObject(surface.mesh, false)[0];
          assert.ok(terrace && ground, `Both surfaces must exist at s=${s}, w=${w}`);
          assert.ok(surface.getHeight(x, z) - terrace.point.y > 0.25,
            `Terrace must clear the physical runway surface at s=${s}, w=${w}`);
          assert.ok(terrace.point.y - ground.point.y > 0.25,
            `Fine terrace must stay above the coarse DEM at s=${s}, w=${w}`);
          // On terrace vertices inside the graded runway the depression is exact;
          // between vertices the generic mesh interpolates from faded vertices.
          if (s % 10 === 0 && w % 10 === 0) {
            assert.ok(Math.abs(surface.getHeight(x, z) - (terrace.point.y + config.terrace.depressionM)) < 0.001,
              'Physical runway height must remain aligned with the fine terrace');
          }
        }
      }
    };
    checkClearance();
    surface.elevations = shippedElevations();
    surface.isLoaded = true;
    surface.updateGeometryElevations();
    checkClearance();
    surface.dispose();
  });
});
