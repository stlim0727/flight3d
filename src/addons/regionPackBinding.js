import { validateAddonManifest } from './addonContract.js';

export function regionPackFromProfile(profile, packId, { coreVersion, baseUrl } = {}) {
  const pin = profile?.pins?.find(entry => entry.id === packId);
  if (!pin) throw new Error(`profile does not pin ${packId}`);
  const manifest = pin.manifest;
  const result = validateAddonManifest(manifest, { coreVersion });
  if (!result.ok) throw new Error(`invalid pinned addon: ${result.errors.join('; ')}`);
  if (manifest.id !== packId || manifest.version !== pin.version) {
    throw new Error(`pinned manifest identity mismatch for ${packId}`);
  }
  if (!/^https?:\/\//.test(manifest.region.tiles.url)) {
    throw new Error('addon tile URL must be an absolute http(s) URL');
  }
  let urlTemplate;
  if (manifest.region.tiles.format === 'pmtiles') {
    urlTemplate = manifest.region.tiles.url;
  } else {
    const url = new URL(manifest.region.tiles.url);
    const versionSegment = encodeURIComponent(pin.version);
    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.some(segment => decodeURIComponent(segment) === pin.version)) {
      const firstToken = segments.findIndex(segment => /[{[](?:z|x|y)[}\]]/.test(decodeURIComponent(segment)));
      if (firstToken >= 0) segments.splice(firstToken, 0, versionSegment);
      else segments.push(versionSegment);
    }
    const versionIndex = segments.findIndex(segment => decodeURIComponent(segment) === pin.version);
    const rest = segments.slice(versionIndex + 1);
    if (!rest.some(segment => /[{[](?:z|x|y)[}\]]/.test(decodeURIComponent(segment)))) segments.push('{z}', '{y}', '{x}');
    urlTemplate = `${url.origin}/${segments.join('/')}${url.search}`
      .replaceAll('%7B', '{').replaceAll('%7D', '}');
  }
  const bounds = manifest.region.bounds;
  return Object.freeze({
    id: packId,
    version: pin.version,
    sha256: pin.sha256,
    urlTemplate,
    bounds,
    origin: manifest.region.origin,
    verticalDatum: manifest.region.verticalDatum,
    tileFormat: manifest.region.tiles.format,
    tileChecksum: manifest.region.tiles.checksum,
    cacheOptions: {
      urlTemplate,
      maxConcurrent: 4,
      timeoutMs: 6000,
    },
  });
}

export function profileShareParams(profile, { packId } = {}) {
  const pins = profile?.pins ?? [];
  if (pins.length === 0) throw new Error('empty profile cannot be shared');
  const params = new URLSearchParams();
  params.set('pack', packId ?? pins[0].id);
  params.set('version', packId ? pins.find(pin => pin.id === packId)?.version ?? '' : pins[0].version);
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: profile.schemaVersion,
    coreVersion: profile.coreVersion,
    pins: pins.map(({ id, version, url, sha256 }) => ({ id, version, url, sha256 })),
  }));
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  params.set('profile', btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''));
  return params;
}

export function readProfileShareParams(search) {
  const params = new URLSearchParams(search);
  const encoded = params.get('profile');
  if (!encoded) return null;
  let parsed;
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('malformed share profile');
  }
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.pins) || parsed.pins.length === 0) {
    throw new Error('unsupported share profile');
  }
  return parsed;
}
