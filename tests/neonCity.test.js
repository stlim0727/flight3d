import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NeonCity } from '../src/environment/NeonCity.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { APPROACH_DATA, approachDeviation } from '../src/config/approachData.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, scenariosForAirport } from '../src/config/scenarioRegistry.js';
import { setLanguage, t } from '../src/i18n/index.js';

test('NeonCity initializes ground, runway, retro sun, and skyscraper clusters', () => {
  const city = new NeonCity();

  assert.ok(city.group instanceof THREE.Group);
  assert.equal(city.elevation, 0.0);
  assert.ok(city.buildingData.length > 50, 'City should have substantial skyscraper buildings');

  // Verify terrain interface
  assert.equal(city.terrain.getHeight(0, 0), 0.0);
  assert.equal(city.terrain.getHeight(1000, 500), 0.0);
  assert.equal(city.terrain.isLoaded, true);

  // Verify airport interface
  assert.equal(city.airport.elevation, 0.0);
  assert.equal(typeof city.airport.isOnRunway, 'function');
  assert.equal(typeof city.airport.update, 'function');
  assert.ok(city.airport.controlTowerData.height >= 200, 'Control tower / viewing deck should be elevated');

  // Verify retro sun exists in group
  const sun = city.group.getObjectByName('retro-synthwave-sun');
  assert.ok(sun, 'Retro synthwave sun must be present in group');
  assert.ok(sun.position.x > 5000, 'Sun should be placed on horizon in distance');
});

test('NeonCity skyscrapers are large/tall with a central canyon wide enough for Cessna', () => {
  const city = new NeonCity();

  // Find maximum skyscraper height
  const maxHeight = Math.max(...city.buildingData.map(b => b.height));
  assert.ok(maxHeight >= 350, `Max skyscraper height (${maxHeight}m) should be tall (> 350m)`);

  // Verify central canyon clearance along Z = 0. The canal's arch bridge crosses the
  // canyon axis (#551), well below the canyon flight's 110 m.
  for (const b of city.buildingData.filter(b => b.bridge)) assert.ok(b.y + b.height < 90, `${b.bridge} ${b.part} below the canyon flight`);
  for (const b of city.buildingData.filter(b => !b.bridge)) {
    const halfD = b.depth / 2;
    const minZ = b.z - halfD;
    const maxZ = b.z + halfD;
    // Buildings must not block the central flight canyon (-60 to +60)
    const blocksCenter = (minZ < 45 && maxZ > -45);
    assert.equal(blocksCenter, false, `Building at X=${b.x}, Z=${b.z} must not block central canyon`);
  }
});

test('CollisionDetector indexes NeonCity buildings and detects collision', () => {
  const city = new NeonCity();
  const detector = new CollisionDetector(city.terrain, city.airport, city);

  // Load Cessna 172 config
  detector.loadAircraftConfig({ id: 'C172' });

  // Pick a building from NeonCity
  const target = city.buildingData[0];
  const insidePos = new THREE.Vector3(target.x, target.y + target.height * 0.5, target.z);
  const quat = new THREE.Quaternion();
  const vel = new THREE.Vector3(45, 0, 0);

  // Flight inside a skyscraper must trigger a collision
  const hit = detector.checkCollision(insidePos, quat, vel, 1.0, 0, 0);
  assert.ok(hit !== null, 'CollisionDetector must detect collision when aircraft penetrates skyscraper');

  // Flight through the clear central canyon at 120m altitude should not collide
  const clearPos = new THREE.Vector3(500, 120, 0);
  const clearHit = detector.checkCollision(clearPos, quat, vel, 1.0, 0, 0);
  assert.equal(clearHit, null, 'Cessna flying through central canyon should have zero collisions');
});

test('Neon scenario registry and approach deviation resolve properly in all locales', () => {
  assert.ok(APPROACH_DATA.neon, 'APPROACH_DATA.neon must be defined');
  const dev = approachDeviation('neon', { x: -2500, z: 0, altitudeFt: 500, tasKnots: 90 });
  assert.ok(dev, 'Approach deviation should be calculable');
  assert.equal(dev.courseDeg, 90);

  assert.ok(scenariosForAirport('neon').includes('runway'));
  assert.ok(scenariosForAirport('neon').includes('approach'));
  assert.ok(scenariosForAirport('neon').includes('cruise'));

  for (const locale of ['en', 'ko']) {
    setLanguage(locale);
    assert.notEqual(t('neon.metropolis'), 'neon.metropolis');
    assert.notEqual(t('neon.runway'), 'neon.runway');
    assert.notEqual(t('neon.canyon'), 'neon.canyon');
    assert.notEqual(t('neon.cruise'), 'neon.cruise');
  }
  setLanguage('en');
});
