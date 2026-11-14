// Integrated Neon urban wind measurements (#697) with production physics, headless.
// Records the wind each path meets (mean/RMS/limits), the aerodynamic force and
// moment, IAS, G, attitude, the 120 Hz cost of the wind's three samples and of a
// whole physics tick, and the same path in still air as the control. A test pilot
// sets only ordinary virtual control inputs; nothing teleports, forces or poses the
// aircraft after the preset. Usage:
//   node scripts/neon-urban-wind-report.mjs [out.json]
// Default output: review-artifacts/neon-urban-wind/headless/report.json. Tower collision is not
// simulated headless; the minimum gap to tower walls beside the path is reported.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { NEON_RIVER, riverCenter, riverGroundHeight } from '../src/config/neonRiver.js';
import { NEON_WIND } from '../src/config/neonWind.js';
import { CANYON_FLIGHT, NEON_TOWERS, NEON_WIND_SITES, towerCorners } from '../src/config/neonBuildings.js';
import { UrbanWindField } from '../src/physics/UrbanWindField.js';
import { setSimulationWind } from '../src/physics/WindField.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { flyBank, flyVerticalPath } from '../src/director/PilotControlLaws.js';

const out = process.argv[2] || 'review-artifacts/neon-urban-wind/headless/report.json';
const HZ = 120, CONTROL_TICKS = 6; // the pilot updates every 0.05 s, as the browser scripts do
const KT = 1.943844, DEG = 180 / Math.PI;
const round = (v, d = 2) => Number.isFinite(v) ? +v.toFixed(d) : v;

class Stat {
  constructor() { this.n = 0; this.s = 0; this.q = 0; this.min = Infinity; this.max = -Infinity; }
  add(v) { this.n++; this.s += v; this.q += v * v; if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
  get mean() { return this.s / this.n; }
  get rms() { return Math.sqrt(Math.max(0, this.q / this.n - this.mean ** 2)); }
  json(d = 2) { return this.n ? { mean: round(this.mean, d), rms: round(this.rms, d), min: round(this.min, d), max: round(this.max, d) } : null; }
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

// Quantities recorded each 120 Hz tick. Wind is world east/up/south (m/s); force is
// the aerodynamic world force (kN); moments are body pitch/yaw/roll (kN m).
const QUANTITIES = ['windE', 'windU', 'windS', 'wingDiff', 'forceE', 'forceU', 'forceS',
  'pitchMoment', 'yawMoment', 'rollMoment', 'gustRoll', 'ias', 'g', 'alpha', 'beta', 'roll', 'y'];
function recorder() {
  const all = Object.fromEntries(QUANTITIES.map(k => [k, new Stat()]));
  const sites = {};
  return {
    all, sites,
    add(sim) {
      const w = sim.aero.windWorld, r = sim._aeroResult, t = sim.telemetry;
      const values = {
        windE: w.x, windU: w.y, windS: w.z,
        wingDiff: sim.aero.windRightWorld.distanceTo(sim.aero.windLeftWorld),
        forceE: r.forceWorld.x / 1000, forceU: r.forceWorld.y / 1000, forceS: r.forceWorld.z / 1000,
        pitchMoment: r.momentBody.x / 1000, yawMoment: r.momentBody.y / 1000, rollMoment: r.momentBody.z / 1000,
        gustRoll: (r.wingGustRollMoment ?? 0) / 1000,
        ias: t.iasKnots, g: t.gForce, alpha: sim.aero.alpha * DEG, beta: sim.aero.beta * DEG, roll: t.rollDeg, y: sim.position.y,
      };
      for (const k of QUANTITIES) all[k].add(values[k]);
      for (const site of NEON_WIND_SITES) {
        if (Math.hypot(sim.position.x - site.x, sim.position.z - CANYON_FLIGHT.z) > site.region.radius) continue;
        const s = sites[site.id] ??= Object.fromEntries(QUANTITIES.map(k => [k, new Stat()]));
        for (const k of QUANTITIES) s[k].add(values[k]);
      }
    },
    json() {
      const pick = group => Object.fromEntries(Object.entries(group).map(([k, s]) => [k, s.json()]));
      return { all: pick(all), sites: Object.fromEntries(Object.entries(sites).map(([id, g]) => [id, pick(g)])) };
    },
  };
}

function flight(aircraft, preset, windOn) {
  const sim = createHeadlessSimulation({ aircraftId: aircraft, airportId: 'neon',
    terrain: { getHeight: riverGroundHeight, getWaterLevel: () => NEON_RIVER.waterLevel } });
  // Rendering-only effect the headless host does not stub; the takeoff roll emits it.
  sim.tireSmokeSystem.emitSmokeBurst ??= () => {};
  if (!windOn) {
    // The still-air control is the authored spawn, as a multiplayer room flies it: no
    // field and no re-aim of the spawn into the mean wind.
    sim.multiplayer = { active: true, respawn() {} };
    sim.setPreset(preset);
    delete sim.multiplayer;
    if (sim.windField) throw new Error(`${aircraft}/${preset}: control is not calm`);
    return sim;
  }
  sim.setPreset(preset);
  if (!(sim.windField instanceof UrbanWindField)) throw new Error(`${aircraft}/${preset}: Neon urban wind missing`);
  return sim;
}

// Fly `pilot(sim, tick)` until `done(sim)` or `seconds`. The pilot returns false to hold
// the controls it last set (hands off). Records every tick and the tick costs.
function run(sim, { seconds, pilot, done = () => false, observe = () => {} }) {
  const rec = recorder(), tick = [], wind = [];
  const field = sim.windField;
  let windCost = 0;
  if (field) {
    const sample = field.sample.bind(field);
    field.sample = (p, t, o) => { const a = performance.now(); const r = sample(p, t, o); windCost += performance.now() - a; return r; };
  }
  const near = NEON_TOWERS.filter(t => t.h + 8 > 30);
  let minGap = Infinity, maxAbsZ = 0, minClearance = Infinity, stalls = 0, gloc = 0, i = 0;
  for (; i < seconds * HZ && !sim.isCrashed && !done(sim); i++) {
    if (i % CONTROL_TICKS === 0) pilot(sim, i);
    windCost = 0;
    const a = performance.now();
    stepPhysics(sim);
    tick.push(performance.now() - a);
    if (field) wind.push(windCost);
    rec.add(sim);
    observe(sim);
    const p = sim.position;
    maxAbsZ = Math.max(maxAbsZ, Math.abs(p.z - CANYON_FLIGHT.z));
    minClearance = Math.min(minClearance, p.y - riverGroundHeight(p.x, p.z));
    if (sim.telemetry.isStalled) stalls++;
    if (sim.telemetry.pilot?.isGLOC) gloc++;
    for (const t of near) {
      if (Math.abs(t.x - p.x) > 200 || p.y > t.h + 8) continue;
      const corners = towerCorners(t);
      const xs = corners.map(c => c[0]), zs = corners.map(c => c[1]);
      if (p.x < Math.min(...xs) - 5 || p.x > Math.max(...xs) + 5) continue;
      minGap = Math.min(minGap, ...zs.map(cz => Math.abs(cz - p.z)));
    }
  }
  if (field) delete field.sample;
  return {
    seconds: round(i / HZ, 1), crashed: Boolean(sim.isCrashed), crash: sim.isCrashed ? String(sim.crashResult?.type ?? sim.crashResult?.reason ?? 'crash') : null,
    stalledTicks: stalls, glocTicks: gloc, position: sim.position.toArray().map(v => round(v, 1)),
    maxAbsZ: round(maxAbsZ, 1), minClearance: round(minClearance, 1), minTowerGap: Number.isFinite(minGap) ? round(minGap, 1) : null,
    cost: { tickP50: round(percentile(tick, 0.5), 4), tickP95: round(percentile(tick, 0.95), 4), tickMax: round(Math.max(...tick), 4),
      windP50: wind.length ? round(percentile(wind, 0.5), 4) : null, windP95: wind.length ? round(percentile(wind, 0.95), 4) : null,
      windMax: wind.length ? round(Math.max(...wind), 4) : null, ticks: tick.length },
    ...rec.json(),
  };
}

const wrap = deg => ((deg + 540) % 360) - 180;
const rudder = sim => sim.controls.setVirtualInput('rudder', Math.max(-0.2, Math.min(0.2, -sim.aero.beta * 2)));
// Canyon line z = 0 at 110 m, aiming 250 m ahead, as scripts/verify-neon-canyon.mjs.
const canyonPilot = targetIas => sim => {
  const tel = sim.telemetry;
  const heading = 90 - Math.atan2(sim.position.z - CANYON_FLIGHT.z, 250) * DEG;
  flyBank(sim, Math.max(-15, Math.min(15, wrap(heading - tel.headingDeg) * 1.5)), tel);
  flyVerticalPath(sim, Math.max(-2, Math.min(2, (CANYON_FLIGHT.altitude - sim.position.y) * 0.4)), targetIas, tel);
  rudder(sim);
};
const canyonIas = (aircraft, sim) => aircraft === 'C172' ? sim.linearVelocity.length() * KT : 180;
const reachedEast = sim => sim.position.x >= 4100;

const report = { generated: new Date().toISOString(), node: process.version, wind: { ...NEON_WIND, obstacles: NEON_WIND.obstacles.length },
  points: {}, paths: {} };

// 1. Fixed points: same seed, 120 s of physics time at 120 Hz, north and south wind.
const POINTS = [
  { id: 'sea-west', x: -3000, y: 110, z: 0 },
  ...NEON_WIND_SITES.map(s => ({ id: s.id, x: s.x, y: CANYON_FLIGHT.altitude, z: CANYON_FLIGHT.z })),
  { id: 'slot-street', x: 1560, y: 30, z: 0 },
  { id: 'lee-high', x: 2520, y: 600, z: 0 },
  // 175 m south and north of the 420 m crown tower (2500, -175): the lee side swaps
  // when the wind reverses.
  { id: 'crown-south', x: 2500, y: 110, z: 0 },
  { id: 'crown-north', x: 2500, y: 110, z: -350 },
];
for (const from of [0, 180]) {
  const field = new UrbanWindField({ ...NEON_WIND, meanFromDeg: from });
  const rows = report.points[`from${from}`] = {};
  for (const p of POINTS) {
    const s = { E: new Stat(), U: new Stat(), S: new Stat(), speed: new Stat() }, o = {};
    for (let i = 0; i < 120 * HZ; i++) {
      field.sample(p, i / HZ, o);
      s.E.add(o.x); s.U.add(o.y); s.S.add(o.z); s.speed.add(Math.hypot(o.x, o.y, o.z));
    }
    rows[p.id] = { at: [p.x, p.y, p.z], ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.json()])) };
  }
}

// 2. Paths per aircraft, with the urban wind and in still air.
for (const aircraft of ['C172', 'B738', 'F16']) {
  const paths = report.paths[aircraft] = {};
  for (const windOn of [true, false]) {
    const tag = windOn ? 'wind' : 'calm';
    let sim = flight(aircraft, 'approach', windOn);
    const ias = canyonIas(aircraft, sim);
    paths[`canyon-${tag}`] = { targetIas: round(ias, 1), ...run(sim, { seconds: 200, pilot: canyonPilot(ias), done: reachedEast }) };

    sim = flight(aircraft, 'cruise', windOn);
    const cruise = { heading: sim.telemetry.headingDeg, y: sim.position.y, ias: sim.telemetry.iasKnots };
    // Telemetry is fresh only after the first tick.
    stepPhysics(sim); Object.assign(cruise, { heading: sim.telemetry.headingDeg, y: sim.position.y, ias: sim.telemetry.iasKnots });
    paths[`cruise60-${tag}`] = { start: { heading: round(cruise.heading, 1), y: round(cruise.y, 1), ias: round(cruise.ias, 1) }, ...run(sim, { seconds: 60, pilot: s => {
      const tel = s.telemetry;
      flyBank(s, Math.max(-15, Math.min(15, wrap(cruise.heading - tel.headingDeg) * 1.5)), tel);
      flyVerticalPath(s, Math.max(-2, Math.min(2, (cruise.y - s.position.y) * 0.4)), cruise.ias, tel);
      rudder(s);
    } }) };

    sim = flight(aircraft, 'cruise', windOn);
    paths[`cruise60-handsoff-${tag}`] = run(sim, { seconds: 60, pilot: () => {} });

    // The runway ground roll is measured in the browser: the headless host has no Neon
    // runway surface, so its wheels do not roll like the real airport's.
    if (aircraft === 'C172') {
      // Bridge: north along the canal 6 m below the street, under all three bridges.
      // Canal centreline offset (m) is the bridge path's lateral margin.
      sim = flight(aircraft, 'bridge', windOn);
      const lateral = new Stat();
      paths[`bridge-${tag}`] = run(sim, { seconds: 120, done: s => s.position.z <= -1900,
        observe: s => lateral.add(s.position.x - riverCenter(s.position.z)), pilot: s => {
          const tel = s.telemetry, lookZ = s.position.z - 180;
          const heading = Math.atan2(riverCenter(lookZ) - s.position.x, 180) * DEG;
          flyBank(s, Math.max(-18, Math.min(18, wrap(heading - tel.headingDeg) * 1.2)), tel);
          flyVerticalPath(s, Math.max(-1.5, Math.min(1.5, (-6 - s.position.y) * 0.5)), 89, tel);
          rudder(s);
        } });
      paths[`bridge-${tag}`].canalOffset = lateral.json();
    }
  }

  // 3. Hands off for 4 s entering the slot and the lee, then the pilot recovers. The
  // still-air run separates the wind's share from the aircraft's own hands-off motion.
  for (const [site, windOn] of [['slot', true], ['slot', false], ['lee', true], ['lee', false]]) {
    const sim = flight(aircraft, 'approach', windOn), ias = canyonIas(aircraft, sim);
    const x = NEON_WIND_SITES.find(s => s.id === site).x, pilot = canyonPilot(ias);
    for (let i = 0; sim.position.x < x - 150 && i < 200 * HZ && !sim.isCrashed; i++) {
      if (i % CONTROL_TICKS === 0) pilot(sim);
      stepPhysics(sim);
    }
    // Hands off for 4 s: virtual stick and pedals released, throttle left where it is.
    sim.controls.clearVirtualInputs();
    const before = { y: sim.position.y, z: sim.position.z };
    let maxRoll = 0, minY = Infinity, maxZ = 0;
    for (let i = 0; i < 4 * HZ && !sim.isCrashed; i++) {
      stepPhysics(sim);
      maxRoll = Math.max(maxRoll, Math.abs(sim.telemetry.rollDeg));
      minY = Math.min(minY, sim.position.y); maxZ = Math.max(maxZ, Math.abs(sim.position.z));
    }
    const atRelease = { roll: round(sim.telemetry.rollDeg, 1), y: round(sim.position.y, 1), z: round(sim.position.z, 1), ias: round(sim.telemetry.iasKnots, 1) };
    // Wings level (< 3 deg) and back inside 15 m of the line, held to the end of 20 s.
    let wingsLevel = null, minIas = Infinity, stalled = false;
    for (let i = 0; i < 20 * HZ && !sim.isCrashed; i++) {
      if (i % CONTROL_TICKS === 0) pilot(sim);
      stepPhysics(sim);
      maxZ = Math.max(maxZ, Math.abs(sim.position.z)); minY = Math.min(minY, sim.position.y);
      minIas = Math.min(minIas, sim.telemetry.iasKnots); stalled ||= Boolean(sim.telemetry.isStalled);
      const steady = Math.abs(sim.telemetry.rollDeg) < 3 && Math.abs(sim.position.z) < 15;
      if (steady && wingsLevel === null) wingsLevel = round(i / HZ, 2);
      if (!steady) wingsLevel = null;
    }
    paths[`recovery-${site}-${windOn ? 'wind' : 'calm'}`] = { handsOffS: 4, start: { y: round(before.y, 1), z: round(before.z, 1) },
      maxRollHandsOff: round(maxRoll, 1), atRelease, minY: round(minY, 1), maxAbsZ: round(maxZ, 1), minIas: round(minIas, 1),
      steadyAfterS: wingsLevel, end: { y: round(sim.position.y, 1), x: round(sim.position.x), roll: round(sim.telemetry.rollDeg, 1) },
      crashed: Boolean(sim.isCrashed), stalled };
  }
}

mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));

// Console summary.
const f = s => s ? `${s.mean}/${s.rms}/${s.min}..${s.max}` : '-';
console.log(`wrote ${out}`);
console.log('\nfixed points, 120 s (E/U/S rms, speed mean, max |U|):');
for (const [dir, rows] of Object.entries(report.points)) {
  for (const [id, r] of Object.entries(rows)) {
    console.log(`${dir.padEnd(7)} ${id.padEnd(12)} rms ${r.E.rms}/${r.U.rms}/${r.S.rms}  speed ${r.speed.mean} (max ${r.speed.max})  U ${r.U.min}..${r.U.max}`);
  }
}
console.log('\npaths (mean/rms/min..max):');
for (const [aircraft, paths] of Object.entries(report.paths)) {
  for (const [id, p] of Object.entries(paths)) {
    if (id.startsWith('recovery')) { console.log(`${aircraft} ${id}: ${JSON.stringify(p)}`); continue; }
    const a = p.all;
    console.log(`${aircraft} ${id.padEnd(22)} t ${p.seconds}s crash ${p.crashed} stall ${p.stalledTicks} gloc ${p.glocTicks} |z|max ${p.maxAbsZ} gap ${p.minTowerGap}`
      + ` | IAS ${f(a.ias)} | G ${f(a.g)} | roll ${f(a.roll)} | y ${f(a.y)} | wingDiff ${f(a.wingDiff)} | rollM ${f(a.rollMoment)} | gustRoll ${f(a.gustRoll)}`
      + ` | tick p95 ${p.cost.tickP95} ms wind p95 ${p.cost.windP95} ms${p.liftoffS !== undefined ? ` | liftoff ${p.liftoffS}s` : ''}`);
  }
}
