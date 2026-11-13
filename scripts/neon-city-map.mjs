// Top-down SVG map of Neon Metropolis: towers coloured and labelled by roof height, the
// island, canal, streets, bridges, scenario spawns and the wind comparison sites (#695).
// Usage: node scripts/neon-city-map.mjs <out.svg> [title] [repo root to map, default .]
// Mapping another checkout (e.g. origin/main) draws its layout for a before/after pair.
// North (-Z) is up, east (+X) right. Rasterize with any browser, e.g. headless Chrome
// --screenshot, at 1600x1120.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [out, title = 'Neon Metropolis', root = '.'] = process.argv.slice(2);
if (!out) throw new Error('usage: node scripts/neon-city-map.mjs <out.svg> [title] [root]');
const load = file => import(pathToFileURL(path.resolve(root, file)).href);
const { NeonCity } = await load('src/environment/NeonCity.js');
const { NEON_RIVER, landOutline } = await load('src/config/neonRiver.js');
const { neonStreets } = await load('src/config/neonRoads.js');
const sites = await load('src/config/neonBuildings.js').then(m => m.NEON_WIND_SITES, () => []);

const city = new NeonCity();
const X0 = -700, X1 = 4300, Z0 = -1500, Z1 = 2000, S = 0.32; // px per metre
const W = (X1 - X0) * S, H = (Z1 - Z0) * S;
const px = x => ((x - X0) * S).toFixed(1), pz = z => ((z - Z0) * S).toFixed(1), len = m => (m * S).toFixed(1);
const roofColour = h => {
  const t = Math.min(1, Math.max(0, (h - 60) / 400));
  return `rgb(${Math.round(40 + 215 * t)},${Math.round(200 - 150 * t)},${Math.round(255 - 120 * t)})`;
};
const svg = [`<rect width="${W}" height="${H}" fill="#0a1830"/>`];
for (const side of [-1, 1]) {
  svg.push(`<polygon points="${landOutline(side).map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="#1d1730" stroke="#6a4a9a"/>`);
}
for (const s of neonStreets()) svg.push(`<rect x="${px(s.x0)}" y="${pz(s.z0)}" width="${len(s.x1 - s.x0)}" height="${len(s.z1 - s.z0)}" fill="#2c2445"/>`);
svg.push(`<rect x="${px(-2400)}" y="${pz(-30)}" width="${len(4200)}" height="${len(60)}" fill="#3a2a55"/>`);
for (const b of city.buildingData.filter(b => b.bridge && b.part === 'deck')) {
  svg.push(`<rect x="${px(b.x - b.width / 2)}" y="${pz(b.z - b.depth / 2)}" width="${len(b.width)}" height="${len(b.depth)}" fill="#ff2fb3"/>`);
}
for (const b of city.buildingData.filter(b => !b.bridge)) {
  const roof = b.roofHeight ?? b.height - 8;
  // SVG y runs along +Z, so THREE's rotateY(θ) is an SVG rotate(-θ).
  svg.push(`<g transform="translate(${px(b.x)},${pz(b.z)}) rotate(${(-b.rotationY * 180 / Math.PI).toFixed(2)})">`
    + `<rect x="${len(-b.localWidth / 2)}" y="${len(-b.localDepth / 2)}" width="${len(b.localWidth)}" height="${len(b.localDepth)}" fill="${roofColour(roof)}" stroke="#000" stroke-width="0.5"/></g>`);
  svg.push(`<text x="${px(b.x)}" y="${(+pz(b.z) + 3).toFixed(1)}" font-size="8" text-anchor="middle">${Math.round(roof)}</text>`);
  if (b.id) svg.push(`<text x="${px(b.x)}" y="${(+pz(b.z) - 6).toFixed(1)}" font-size="6" text-anchor="middle" fill="#fff">${b.id}</text>`);
}
for (const s of sites) {
  const { center, radius, fade } = s.region;
  svg.push(`<circle cx="${px(center.x)}" cy="${pz(center.z)}" r="${len(radius)}" fill="none" stroke="#ffe066" stroke-dasharray="4 3"/>`);
  svg.push(`<circle cx="${px(center.x)}" cy="${pz(center.z)}" r="${len(radius - fade)}" fill="none" stroke="#ffe066" stroke-width="0.6"/>`);
  svg.push(`<text x="${px(center.x)}" y="${(+pz(center.z - radius) - 3).toFixed(1)}" font-size="11" text-anchor="middle" fill="#ffe066">${s.id}</text>`);
}
// Scenario spawns (PresetSpawner, NEON_RIVER.spawn): heading in degrees clockwise from north.
const arrow = (x, z, heading, length, label, colour) => {
  const r = heading * Math.PI / 180, ex = x + Math.sin(r) * length, ez = z - Math.cos(r) * length;
  svg.push(`<line x1="${px(x)}" y1="${pz(z)}" x2="${px(ex)}" y2="${pz(ez)}" stroke="${colour}" stroke-width="2" marker-end="url(#a)"/>`);
  svg.push(`<circle cx="${px(x)}" cy="${pz(z)}" r="4" fill="${colour}"/><text x="${+px(x) + 6}" y="${+pz(z) - 6}" font-size="11" fill="${colour}">${label}</text>`);
};
arrow(-1800, 0, 90, 500, 'runway', '#00f0ff');
arrow(200, 0, 90, 3600, 'canyon 110 m', '#7cfc00');
arrow(-600, -800, 110, 1500, 'cruise 760 m', '#ffa500');
arrow(NEON_RIVER.spawn[0], NEON_RIVER.spawn[2], 0, 3700, 'bridge -4 m', '#ff66cc');
for (let x = 0; x <= 4000; x += 500) svg.push(`<text x="${px(x)}" y="${H - 4}" font-size="9" fill="#889">x ${x}</text>`);
for (let z = -1000; z <= 1500; z += 500) svg.push(`<text x="2" y="${pz(z)}" font-size="9" fill="#889">z ${z}</text>`);
svg.push(`<text x="10" y="18" font-size="16" fill="#fff">${title}: roof height in m (colour), north up</text>`);
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`
  + `<defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fff"/></marker></defs>${svg.join('')}</svg>`);
console.log(`wrote ${out}: ${city.buildingData.filter(b => !b.bridge).length} towers, ${sites.length} wind sites`);
