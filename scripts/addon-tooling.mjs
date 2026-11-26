import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAddonStarter } from '../src/addons/addonStarter.js';

export async function initAddon(options, { outDir = process.cwd() } = {}) {
  const result = buildAddonStarter(options);
  if (!result.ok) throw new Error(result.errors.join('; '));
  for (const [name, content] of Object.entries(result.files)) {
    const target = resolve(outDir, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  return Object.keys(result.files);
}

export async function buildCatalog(manifestPath, baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl) throw new Error('catalog needs a URL or owner/repo');
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(baseUrl.trim())) {
    baseUrl = `https://raw.githubusercontent.com/${baseUrl.trim()}/main`;
  }
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('catalog needs an absolute http(s) base URL');
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  if (!manifest?.id || !manifest?.version) throw new Error('manifest needs id and version');
  const bytes = await readFile(resolve(manifestPath));
  const sha256 = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith('addon.json')) url.pathname = `${url.pathname.replace(/\/$/, '')}/addon.json`;
  return {
    schemaVersion: 1,
    addons: [{ id: manifest.id, version: manifest.version, url: url.toString(), sha256 }],
  };
}

export function usage() {
  console.error('Usage:');
  console.error('  node scripts/addon-dev.mjs init <region|aircraft|scenario> --publisher <id> --name <id> [--version 1.0.0] [--core 1.8.0] [--title "My addon"] [--out DIR]');
  console.error('  node scripts/addon-dev.mjs catalog <addon.json> <https://host/path|owner/repo> [--out catalog.json]');
  process.exitCode = 2;
}
