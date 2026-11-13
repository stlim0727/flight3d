import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NeonCity } from '../src/environment/NeonCity.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { WindField } from '../src/physics/WindField.js';
import { isRiver } from '../src/config/neonRiver.js';
import {
  CANYON_FLIGHT, DESIGN_WIND_FROM_DEG, NEON_TOWERS, NEON_WIND_SITES, ROOF_MARGIN,
  towerCorners, towerExtents, towerRecord,
} from '../src/config/neonBuildings.js';

const byId = new Map(NEON_TOWERS.map(t => [t.id, t]));
// Unit vector the design wind blows toward, in world [x, z]: from 000° blows to +Z (south).
const flow = (() => { const r = DESIGN_WIND_FROM_DEG * Math.PI / 180; return [-Math.sin(r), Math.cos(r)]; })();
const xRange = t => { const [w] = towerExtents(t); return [t.x - w / 2, t.x + w / 2]; };
// Horizontal distance from the canyon flight's line (z = 0) to the tower footprint.
const axisGap = t => Math.min(...towerCorners(t).map(([, z]) => Math.abs(z - CANYON_FLIGHT.z)));
const side = t => Math.sign(t.z - CANYON_FLIGHT.z);
const overlaps = (t, x0, x1) => { const [a, b] = xRange(t); return b > x0 && a < x1; };
const siteSpan = s => [s.x - s.region.radius, s.x + s.region.radius];
// Distance from the site centre (horizontal) to the nearest footprint corner or edge sample.
const siteDistance = (s, t) => {
  const corners = towerCorners(t);
  let best = Infinity;
  corners.forEach(([x0, z0], i) => {
    const [x1, z1] = corners[(i + 1) % 4];
    for (let k = 0; k <= 20; k++) best = Math.min(best, Math.hypot(x0 + (x1 - x0) * k / 20 - s.x, z0 + (z1 - z0) * k / 20 - CANYON_FLIGHT.z));
  });
  return best;
};
// Narrowest clear width across the canyon within [x0, x1], from the towers on each side.
const canyonWidth = (x0, x1) => {
  const near = s => Math.min(...NEON_TOWERS.filter(t => side(t) === s && overlaps(t, x0, x1)).map(axisGap));
  return near(-1) + near(1);
};

test('NeonCity draws and collides the shared tower table, one record per tower in order', () => {
  const ids = NEON_TOWERS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'tower ids are unique');
  const towers = new NeonCity().buildingData.filter(b => !b.bridge);
  assert.deepEqual(towers, NEON_TOWERS.map(towerRecord));
  for (const [i, t] of NEON_TOWERS.entries()) {
    assert.equal(towers[i].roofHeight, t.h);
    assert.equal(towers[i].height, t.h + ROOF_MARGIN, 'collision pads the roof, not the true height');
  }
  // Bridge collision boxes stay separate from the towers.
  assert.ok(NEON_TOWERS.every(t => !('bridge' in t)));
});

test('tower footprints follow THREE.rotateY, so collision boxes cover the drawn mesh', () => {
  for (const t of NEON_TOWERS) {
    const corners = towerCorners(t);
    const [w, d] = towerExtents(t);
    const v = new THREE.Vector3(t.w / 2, 0, t.d / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    assert.ok(corners.some(([x, z]) => Math.hypot(x - t.x - v.x, z - t.z - v.z) < 1e-9), t.id);
    for (const [x, z] of corners) {
      assert.ok(Math.abs(x - t.x) <= w / 2 + 1e-9 && Math.abs(z - t.z) <= d / 2 + 1e-9, t.id);
    }
  }
});

test('wind comparison sites run west to east along the canyon flight, as valid WindField regions', () => {
  assert.deepEqual(NEON_WIND_SITES.map(s => s.kind), ['open', 'wide-canyon', 'narrow-canyon', 'canal', 'lee', 'rooftop']);
  let lastEnd = -Infinity;
  for (const s of NEON_WIND_SITES) {
    const { center, radius, fade } = s.region;
    assert.deepEqual([center.x, center.y, center.z], [s.x, CANYON_FLIGHT.altitude, CANYON_FLIGHT.z], s.id);
    assert.ok(s.x > CANYON_FLIGHT.x0, `${s.id} ahead of the canyon spawn`);
    // Neighbouring envelopes do not overlap, so each site can be flown and judged alone.
    assert.ok(s.x - radius >= lastEnd, `${s.id} overlaps the previous site`);
    lastEnd = s.x + radius;
    assert.ok(fade > 0 && fade <= radius);
    assert.doesNotThrow(() => new WindField({ profile: 'light-turbulence-v1', region: s.region }), s.id);
    for (const id of s.towers) assert.ok(byId.has(id), `${s.id} names unknown tower ${id}`);
  }
});

test('the open site has no tower in its envelope and none upwind of it', () => {
  const s = NEON_WIND_SITES.find(site => site.kind === 'open');
  const [x0, x1] = siteSpan(s);
  for (const t of NEON_TOWERS) {
    assert.ok(siteDistance(s, t) > s.region.radius, `${t.id} inside the open site`);
    if (overlaps(t, x0, x1)) assert.ok((t.z - CANYON_FLIGHT.z) * flow[1] + (t.x - s.x) * flow[0] > 0, `${t.id} upwind of the open site`);
  }
});

test('the slot is a long, deep street canyon far narrower than the wide canyon', () => {
  const slot = NEON_WIND_SITES.find(s => s.kind === 'narrow-canyon');
  const wide = NEON_WIND_SITES.find(s => s.kind === 'wide-canyon');
  const walls = slot.towers.map(id => byId.get(id));
  assert.deepEqual(walls.map(side).sort(), [-1, 1], 'one wall on each side');
  // Continuous over at least 200 m of the flight, both above the flight height.
  const [a0, a1] = xRange(walls[0]), [b0, b1] = xRange(walls[1]);
  assert.ok(Math.min(a1, b1) - Math.max(a0, b0) >= 200);
  for (const w of walls) assert.ok(w.h >= CANYON_FLIGHT.altitude + 40, `${w.id} roof`);
  const slotWidth = canyonWidth(Math.max(a0, b0), Math.min(a1, b1));
  assert.ok(slotWidth >= 110 && slotWidth <= 130, `slot width ${slotWidth}`);
  // Height-to-width above 1 in the slot (deep canyon); the wide canyon's nearest walls
  // stand at least 200 m apart everywhere in its envelope.
  assert.ok(Math.min(...walls.map(w => w.h)) / slotWidth > 1);
  const [x0, x1] = siteSpan(wide);
  for (let x = x0; x < x1; x += 10) assert.ok(canyonWidth(x, x + 10) >= 200, `wide canyon at ${x}`);
  for (const id of wide.towers) assert.ok(overlaps(byId.get(id), x0, x1), `${id} flanks the wide canyon`);
});

test('the canal site is open water between the quays', () => {
  const s = NEON_WIND_SITES.find(site => site.kind === 'canal');
  assert.ok(isRiver(s.x, CANYON_FLIGHT.z));
  for (const t of NEON_TOWERS) assert.ok(siteDistance(s, t) > s.region.radius, `${t.id} inside the canal site`);
});

test('the lee site lies directly downwind of the tallest tower upwind of it', () => {
  const s = NEON_WIND_SITES.find(site => site.kind === 'lee');
  const [tower] = s.towers.map(id => byId.get(id));
  const [x0, x1] = xRange(tower);
  assert.ok(s.x > x0 && s.x < x1, 'the site is in the tower\'s shadow along the wind');
  const downwind = (s.x - tower.x) * flow[0] + (CANYON_FLIGHT.z - tower.z) * flow[1];
  assert.ok(downwind > 0 && downwind < 1.5 * tower.h, `downwind ${downwind}`);
  assert.ok(tower.h >= 3 * CANYON_FLIGHT.altitude, 'the tower towers over the flight');
  // No taller tower stands upwind within the envelope's width.
  for (const t of NEON_TOWERS) {
    if (t === tower || !overlaps(t, s.x - s.region.radius, s.x + s.region.radius)) continue;
    const up = (s.x - t.x) * flow[0] + (CANYON_FLIGHT.z - t.z) * flow[1];
    if (up > 0) assert.ok(t.h < tower.h, `${t.id} upwind and taller`);
  }
});

test('the rooftop site passes above one roof and below another, one on each side', () => {
  const s = NEON_WIND_SITES.find(site => site.kind === 'rooftop');
  const roofs = s.towers.map(id => byId.get(id));
  assert.deepEqual(roofs.map(side).sort(), [-1, 1]);
  const [low, high] = [...roofs].sort((a, b) => a.h - b.h);
  assert.ok(low.h <= CANYON_FLIGHT.altitude - 20 && high.h >= CANYON_FLIGHT.altitude + 20, `${low.h} / ${high.h}`);
  for (const r of roofs) {
    assert.ok(axisGap(r) >= 45 && axisGap(r) <= 60, `${r.id} edge ${axisGap(r)} m from the flight`);
    assert.ok(siteDistance(s, r) < s.region.radius, `${r.id} within the site`);
  }
});

test('C172 and B738 fly the whole canyon line clear at 110 m; the slot walls are solid', () => {
  // B738 half span is 17.9 m; keep 25 m beyond it to every tower along the flight.
  for (const t of NEON_TOWERS) {
    if (t.h + ROOF_MARGIN < CANYON_FLIGHT.altitude - 20 || !overlaps(t, CANYON_FLIGHT.x0, 4000)) continue;
    assert.ok(axisGap(t) >= 43, `${t.id} ${axisGap(t)} m from the canyon line`);
  }
  const city = new NeonCity();
  const detector = new CollisionDetector(city.terrain, city.airport, city);
  detector.loadAircraftConfig({ id: 'C172' });
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'));
  const vel = new THREE.Vector3(46, 0, 0);
  for (let x = CANYON_FLIGHT.x0; x <= 4000; x += 5) {
    const hit = detector.checkCollision(new THREE.Vector3(x, CANYON_FLIGHT.altitude, CANYON_FLIGHT.z), quat, vel, 1 / 120, 0, 0);
    assert.equal(hit, null, `collision at x = ${x}`);
  }
  for (const id of ['slot-north', 'slot-south']) {
    const w = byId.get(id);
    assert.ok(detector.checkCollision(new THREE.Vector3(w.x, CANYON_FLIGHT.altitude, w.z), quat, vel, 1 / 120, 0, 0), id);
  }
});
