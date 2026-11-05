#!/usr/bin/env node
// Create/update the "Flight3d Overview" dashboard in PostHog. Idempotent: reuses the dashboard
// by name and skips insights already on it.
//   POSTHOG_PERSONAL_API_KEY=phx_... POSTHOG_PROJECT_ID=123 node scripts/setup-posthog-dashboard.mjs [--dry-run]
// Optional: POSTHOG_APP_HOST (default https://eu.posthog.com). Never commit the key.
import { DASHBOARD_NAME, INSIGHTS } from './lib/posthogDashboard.mjs';

const dryRun = process.argv.includes('--dry-run');
const key = process.env.POSTHOG_PERSONAL_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID;
const host = (process.env.POSTHOG_APP_HOST || 'https://eu.posthog.com').replace(/\/$/, '');

if (dryRun) {
  console.log(`[dry-run] dashboard "${DASHBOARD_NAME}"`);
  INSIGHTS.forEach(([name]) => console.log(`[dry-run]   insight: ${name}`));
  process.exit(0);
}
if (!key || !project) {
  console.error('Set POSTHOG_PERSONAL_API_KEY (scopes: dashboard:write, insight:write) and POSTHOG_PROJECT_ID.');
  process.exit(1);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${host}/api/projects/${project}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const list = await api('/dashboards/?limit=200');
let dashboard = list.results.find(d => d.name === DASHBOARD_NAME && !d.deleted);
if (!dashboard) {
  dashboard = await api('/dashboards/', 'POST', { name: DASHBOARD_NAME, description: 'Managed by scripts/setup-posthog-dashboard.mjs' });
  console.log(`Created dashboard ${dashboard.id}`);
}
const detail = await api(`/dashboards/${dashboard.id}/`);
const existing = new Set((detail.tiles || []).map(t => t.insight?.name).filter(Boolean));
for (const [name, query] of INSIGHTS) {
  if (existing.has(name)) { console.log(`skip   ${name}`); continue; }
  await api('/insights/', 'POST', { name, query, dashboards: [dashboard.id] });
  console.log(`added  ${name}`);
}
const refreshed = await api(`/dashboards/${dashboard.id}/`);
const tiles = refreshed.tiles || [];
const updatedTiles = [];
let currentSmY = 0;
let currentXsY = 0;

for (let i = 0; i < tiles.length; i += 2) {
  const pair = tiles.slice(i, i + 2);
  const hasMapOrTable = pair.some(t => {
    const name = (t.insight?.name || '').toLowerCase();
    return name.includes('world map') || name.includes('region and city');
  });
  const rowH = hasMapOrTable ? 4 : 3;

  pair.forEach((t, colIdx) => {
    const layouts = {
      sm: { w: 6, h: rowH, x: colIdx === 0 ? 0 : 6, y: currentSmY },
      xs: { w: 1, h: rowH, x: 0, y: currentXsY },
    };
    currentXsY += rowH;
    updatedTiles.push({ id: t.id, layouts });
  });
  currentSmY += rowH;
}
if (updatedTiles.length > 0) {
  await api(`/dashboards/${dashboard.id}/`, 'PATCH', { tiles: updatedTiles });
  console.log(`applied compact layout (${updatedTiles.length} tiles)`);
}
console.log(`Done: ${host}/project/${project}/dashboard/${dashboard.id}`);
