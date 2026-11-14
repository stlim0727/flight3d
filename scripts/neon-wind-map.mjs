// Maps of the Neon urban wind (#696): mean speed and wake turbulence at the canyon
// flight height, and a vertical section of mean speed along the canyon line (z = 0).
// Also prints the wind at each comparison site and the cost of one physics tick's three
// samples. Usage: node scripts/neon-wind-map.mjs <out.svg> [wind from, degrees]
// North (-Z) is up, east (+X) right. Rasterize with any browser.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UrbanWindField } from '../src/physics/UrbanWindField.js';
import { NEON_WIND } from '../src/config/neonWind.js';
import { CANYON_FLIGHT, NEON_TOWERS, NEON_WIND_SITES, towerCorners } from '../src/config/neonBuildings.js';

const [out, fromArg] = process.argv.slice(2);
if (!out) throw new Error('usage: node scripts/neon-wind-map.mjs <out.svg> [wind from, degrees]');
const field = new UrbanWindField({ ...NEON_WIND, ...(fromArg === undefined ? {} : { meanFromDeg: Number(fromArg) }) });
const X0 = 0, X1 = 4000, Z0 = -1300, Z1 = 1300, Y1 = 520, CELL = 25, LAYER = 10, S = 0.25, SY = 0.5;
const W = (X1 - X0) * S, PLAN = (Z1 - Z0) * S, SECTION = Y1 * SY, GAP = 28;
const y = CANYON_FLIGHT.altitude;
const speed = wind => Math.hypot(wind.x, wind.z);
// Dark blue (0) through teal to yellow (1).
const colour = t => {
  const c = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(20 + 235 * c * c)},${Math.round(30 + 200 * c)},${Math.round(90 + 60 * (1 - c))})`;
};
const svg = [];
function plan(top, title, value, max) {
  svg.push(`<g transform="translate(0,${top})">`);
  for (let x = X0; x < X1; x += CELL) {
    for (let z = Z0; z < Z1; z += CELL) {
      const v = value({ x: x + CELL / 2, y, z: z + CELL / 2 });
      svg.push(`<rect x="${(x - X0) * S}" y="${(z - Z0) * S}" width="${CELL * S}" height="${CELL * S}" fill="${colour(v / max)}"/>`);
    }
  }
  for (const t of NEON_TOWERS) {
    svg.push(`<polygon points="${towerCorners(t).map(([x, z]) => `${((x - X0) * S).toFixed(1)},${((z - Z0) * S).toFixed(1)}`).join(' ')}" fill="${t.h > y ? '#111' : 'none'}" stroke="#fff" stroke-width="0.6"/>`);
  }
  for (const s of NEON_WIND_SITES) {
    svg.push(`<circle cx="${(s.x - X0) * S}" cy="${(CANYON_FLIGHT.z - Z0) * S}" r="${s.region.radius * S}" fill="none" stroke="#ff4fd8" stroke-dasharray="4 3"/>`);
    svg.push(`<text x="${(s.x - X0) * S}" y="${(CANYON_FLIGHT.z - s.region.radius - Z0) * S - 3}" font-size="10" text-anchor="middle" fill="#ff4fd8">${s.id}</text>`);
  }
  svg.push(`<text x="8" y="16" font-size="13" fill="#fff">${title} at ${y} m, 0 to ${max} m/s (dark to yellow)</text></g>`);
}
plan(0, `Mean wind speed, from ${field.meanFromDeg} deg`, p => speed(field.meanAt(p)), 6);
plan(PLAN + GAP, 'Wake turbulence scale', p => field.turbulenceAt(p), 1.5);
svg.push(`<g transform="translate(0,${2 * (PLAN + GAP)})">`);
for (let x = X0; x < X1; x += CELL) {
  for (let h = 0; h < Y1; h += LAYER) {
    const v = speed(field.meanAt({ x: x + CELL / 2, y: h + LAYER / 2, z: CANYON_FLIGHT.z }));
    svg.push(`<rect x="${(x - X0) * S}" y="${(Y1 - h - LAYER) * SY}" width="${CELL * S}" height="${LAYER * SY}" fill="${colour(v / 6)}"/>`);
  }
}
svg.push(`<line x1="0" y1="${(Y1 - y) * SY}" x2="${W}" y2="${(Y1 - y) * SY}" stroke="#ff4fd8" stroke-dasharray="4 3"/>`);
svg.push(`<text x="8" y="16" font-size="13" fill="#fff">Mean wind speed along the canyon line z = ${CANYON_FLIGHT.z}, street to ${Y1} m (flight height dashed)</text></g>`);
const H = 2 * (PLAN + GAP) + SECTION;
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif"><rect width="${W}" height="${H}" fill="#0a1830"/>${svg.join('')}</svg>`);

console.log(`wrote ${out} (wind from ${field.meanFromDeg} deg, ${field.meanSpeed} m/s at ${field.referenceHeight} m)`);
console.log('site          mean m/s  wake turbulence m/s');
for (const s of NEON_WIND_SITES) {
  const p = { x: s.x, y, z: CANYON_FLIGHT.z };
  console.log(`${s.id.padEnd(13)} ${speed(field.meanAt(p)).toFixed(2).padStart(8)}  ${field.turbulenceAt(p).toFixed(2)}`);
}
// One physics tick samples the centre and both half-wing centroids (B738: +/- 8.95 m).
const ticks = [], target = {};
for (let i = 0; i < 12000; i++) {
  const x = CANYON_FLIGHT.x0 + (i % 7200) * 0.5, start = performance.now();
  for (const dz of [0, -8.95, 8.95]) field.sample({ x, y, z: CANYON_FLIGHT.z + dz }, i / 120, target);
  ticks.push(performance.now() - start);
}
ticks.sort((a, b) => a - b);
console.log(`three samples per tick over ${ticks.length} ticks: p50 ${ticks[ticks.length >> 1].toFixed(4)} ms, p95 ${ticks[Math.floor(ticks.length * 0.95)].toFixed(4)} ms`);
