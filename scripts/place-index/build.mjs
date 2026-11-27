// Refresh GeoNames snapshots and rebuild the versioned offline place index.
// Usage: node scripts/place-index/build.mjs [--refresh] [--source-dir DIR] [--output DIR]
// The generated artifact is committed; normal builds need no network access.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
import { normalizeSearchText } from '../../src/config/airportSearch.js';

const SOURCE_URLS = Object.freeze({
  cities: 'https://download.geonames.org/export/dump/cities15000.zip',
  allCountries: 'https://download.geonames.org/export/dump/allCountries.zip',
});
const SOURCE_MEMBERS = Object.freeze({ cities: 'cities15000.txt', allCountries: 'allCountries.txt' });
const SOURCE_ARCHIVES = Object.freeze({ cities: 'cities15000.zip', allCountries: 'allCountries.zip' });
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/', import.meta.url));
const DEFAULT_OUTPUT = fileURLToPath(new URL('../../public/data/places/', import.meta.url));
const CONFIG = Object.freeze({
  maxCities: 10000,
  maxFeatures: 6000,
  minAlternateNames: 12,
  maxAliases: 10,
});
const FEATURE_KINDS = Object.freeze({
  ISL: 'island',
  MT: 'mountain',
  VOLC: 'volcano',
  LK: 'lake',
  MNMT: 'landmark',
  TOWR: 'tower',
});
const METADATA = Object.freeze({
  attribution: 'GeoNames contributors',
  license: 'Creative Commons Attribution 4.0',
  licenseUrl: 'https://www.geonames.org/export/LICENSE.txt',
  sourceUrl: 'https://www.geonames.org/export/',
});
const USER_AGENT = 'Flight3d-place-index-build/1.0';

function parseArgs(argv) {
  const options = { refresh: false, sourceDir: null, output: DEFAULT_OUTPUT, generatedAt: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--refresh') options.refresh = true;
    else if (arg === '--source-dir') options.sourceDir = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--generated-at') options.generatedAt = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.refresh && options.sourceDir) throw new Error('--refresh and --source-dir are mutually exclusive');
  if (!options.refresh && !options.sourceDir) {
    for (const name of ['cities.tsv.gz', 'features.tsv.gz', 'source-metadata.json']) {
      const file = path.join(SNAPSHOT_DIR, name);
      if (!existsSync(file)) throw new Error(`Missing snapshot: ${file}`);
    }
  }
  return options;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(name) {
  const response = await fetch(SOURCE_URLS[name], { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const destination = path.join(SNAPSHOT_DIR, SOURCE_ARCHIVES[name]);
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return {
    file: destination,
    info: {
      url: SOURCE_URLS[name],
      retrievedAt: new Date().toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z'),
      lastModified: response.headers.get('last-modified'),
      sha256: await sha256File(destination),
      bytes: (await stat(destination)).size,
    },
  };
}

function parseRow(line) {
  if (!line) return null;
  const fields = line.split('\t');
  if (fields.length < 16) return null;
  const latitude = Number(fields[4]);
  const longitude = Number(fields[5]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id: fields[0],
    name: fields[1],
    asciiName: fields[2],
    alternateNames: fields[3] ?? '',
    latitude,
    longitude,
    featureClass: fields[6],
    featureCode: fields[7],
    country: fields[8],
    population: Number(fields[14]) || 0,
    elevationM: Number(fields[15]) || 0,
  };
}

function alternateCount(row) {
  return row.alternateNames ? row.alternateNames.split(',').length : 0;
}

function isCity(row) {
  return row.featureClass === 'P' && row.population >= 15000 && !!row.name;
}

function isNotableFeature(row) {
  return !!FEATURE_KINDS[row.featureCode] && !!row.name
    && alternateCount(row) >= CONFIG.minAlternateNames;
}

async function readGeoNamesRows(file, member, filter) {
  const rows = [];
  const onRow = line => {
    const row = parseRow(line);
    if (row && filter(row)) rows.push(row);
  };
  if (file.endsWith('.txt')) {
    const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) onRow(line);
    return rows;
  }
  const child = spawn('unzip', ['-p', file, member], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) onRow(line);
  const [exitCode] = await once(child, 'close');
  if (exitCode !== 0) throw new Error(`unzip failed for ${file} (${exitCode})`);
  return rows;
}

function snapshotText(rows) {
  const fields = row => [row.id, row.name, row.asciiName, row.alternateNames,
    row.latitude, row.longitude, row.featureClass, row.featureCode, row.country,
    row.population, row.elevationM];
  return rows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(row => fields(row).join('\t'))
    .join('\n') + '\n';
}

function parseSnapshot(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const fields = line.split('\t');
    return {
      id: fields[0], name: fields[1], asciiName: fields[2], alternateNames: fields[3],
      latitude: Number(fields[4]), longitude: Number(fields[5]),
      featureClass: fields[6], featureCode: fields[7], country: fields[8],
      population: Number(fields[9]), elevationM: Number(fields[10]),
    };
  });
}

async function readSources(options) {
  if (options.refresh) {
    const [cities, allCountries] = await Promise.all([download('cities'), download('allCountries')]);
    const sources = { cities: cities.info, allCountries: allCountries.info };
    const metadata = { ...METADATA, retrievedAt: new Date().toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z'), sources };
    const [cityRows, featureRows] = await Promise.all([
      readGeoNamesRows(cities.file, SOURCE_MEMBERS.cities, isCity),
      readGeoNamesRows(allCountries.file, SOURCE_MEMBERS.allCountries, isNotableFeature),
    ]);
    const snapshots = { cities: snapshotText(cityRows), features: snapshotText(featureRows) };
    await Promise.all(Object.entries(snapshots).map(([name, text]) =>
      writeFile(path.join(SNAPSHOT_DIR, `${name}.tsv.gz`), gzipSync(text))));
    await writeFile(path.join(SNAPSHOT_DIR, 'source-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    return { cities: snapshots.cities, features: snapshots.features, sources, metadata };
  }

  if (options.sourceDir) {
    const cities = await readGeoNamesRows(
      path.join(options.sourceDir, SOURCE_MEMBERS.cities), SOURCE_MEMBERS.cities, isCity,
    );
    const allCountries = await readGeoNamesRows(
      path.join(options.sourceDir, SOURCE_MEMBERS.allCountries), SOURCE_MEMBERS.allCountries, isNotableFeature,
    );
    const snapshots = { cities: snapshotText(cities), features: snapshotText(allCountries) };
    const sources = Object.fromEntries(await Promise.all(Object.keys(SOURCE_URLS).map(async name => {
      const archive = path.join(options.sourceDir, SOURCE_ARCHIVES[name]);
      const info = await stat(archive);
      return [name, {
        url: SOURCE_URLS[name],
        retrievedAt: info.mtime.toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z'),
        sha256: await sha256File(archive),
        bytes: info.size,
      }];
    })));
    return { cities: snapshots.cities, features: snapshots.features, sources, metadata: { ...METADATA, sources } };
  }

  const metadata = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, 'source-metadata.json'), 'utf8'));
  const snapshots = Object.fromEntries(await Promise.all(['cities', 'features'].map(async name => {
    const compressed = await readFile(path.join(SNAPSHOT_DIR, `${name}.tsv.gz`));
    const raw = gunzipSync(compressed);
    if (createHash('sha256').update(raw).digest('hex') !== metadata.snapshots?.[name]?.sha256) {
      throw new Error(`${name} snapshot does not match source-metadata.json`);
    }
    return [name, raw.toString('utf8')];
  })));
  return { ...snapshots, sources: metadata.sources, metadata };
}

function versionForSources(sources, snapshots, metadata) {
  const raw = sources.cities.retrievedAt ?? metadata.retrievedAt;
  const stamp = raw ? new Date(raw).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') : 'snapshot';
  const digest = createHash('sha256')
    .update(`${JSON.stringify(CONFIG)}:${createHash('sha256').update(snapshots.cities).digest('hex')}:${createHash('sha256').update(snapshots.features).digest('hex')}`)
    .digest('hex').slice(0, 8);
  return `${stamp}-${digest}`;
}

function aliasesFor(row) {
  const seen = new Set();
  const aliases = [];
  const add = value => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 60) return;
    const key = normalizeSearchText(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    aliases.push(trimmed);
  };
  add(row.name);
  add(row.asciiName);
  const alternates = row.alternateNames ? row.alternateNames.split(',') : [];
  const nameTokens = new Set(normalizeSearchText(row.asciiName || row.name).split(' ')
    .filter(token => token.length >= 4));
  const relevance = value => {
    const tokens = normalizeSearchText(value).split(' ');
    return tokens.filter(token => nameTokens.has(token)).length;
  };
  const latin = [];
  const hangul = [];
  const other = [];
  for (const alternate of alternates) {
    const value = alternate.trim();
    if (!value || value.length < 3 || value.length > 40) continue;
    if (/^[\p{Script=Hangul}\s]+$/u.test(value)) hangul.push(value);
    else if (/^[\p{Script=Latin}\p{N}\s'’.-]+$/u.test(value)) latin.push(value);
    else other.push(value);
  }
  latin.sort((a, b) => relevance(b) - relevance(a) || a.length - b.length || a.localeCompare(b));
  hangul.sort((a, b) => a.length - b.length || a.localeCompare(b));
  other.sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const value of [...latin.slice(0, 6), ...hangul.slice(0, 2), ...other.slice(0, 2)]) add(value);
  return aliases.slice(0, CONFIG.maxAliases);
}

function toEntry(row) {
  const kind = FEATURE_KINDS[row.featureCode] ?? 'city';
  return Object.freeze({
    id: `geonames:${row.id}`,
    label: row.name,
    aliases: aliasesFor(row),
    latitude: row.latitude,
    longitude: row.longitude,
    country: row.country,
    kind,
    detail: `${kind} · ${row.country}`,
    population: row.population,
    elevationM: row.elevationM,
  });
}

function buildIndex({ citiesText, featuresText, version, sources, metadata, generatedAt }) {
  const cities = parseSnapshot(citiesText)
    .sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))
    .slice(0, CONFIG.maxCities);
  const features = parseSnapshot(featuresText)
    .sort((a, b) => alternateCount(b) - alternateCount(a) || b.population - a.population || a.id.localeCompare(b.id))
    .slice(0, CONFIG.maxFeatures);
  const places = [...cities, ...features].map(toEntry).sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    schemaVersion: 1,
    kind: 'flight3d-place-index',
    version,
    generatedAt: generatedAt ?? new Date().toISOString(),
    horizontalDatum: 'WGS84',
    config: CONFIG,
    sources,
    counts: { cities: cities.length, features: features.length, places: places.length },
    searchIndex: { path: `${version}/places.json`, schemaVersion: 1, count: places.length },
    attribution: METADATA.attribution,
    license: METADATA.license,
    licenseUrl: METADATA.licenseUrl,
    sourceUrl: METADATA.sourceUrl,
  };
  return {
    manifest,
    searchIndex: {
      schemaVersion: 1,
      kind: 'flight3d-place-index',
      version,
      places,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const { cities, features, sources, metadata } = await readSources(options);
  metadata.snapshots = Object.fromEntries(Object.entries({ cities, features }).map(([name, text]) =>
    [name, { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }]));
  await writeFile(path.join(SNAPSHOT_DIR, 'source-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await Promise.all(Object.entries({ cities, features }).map(([name, text]) =>
    writeFile(path.join(SNAPSHOT_DIR, `${name}.tsv.gz`), gzipSync(text))));
  const version = versionForSources(sources, { cities, features }, metadata);
  const { manifest, searchIndex } = buildIndex({
    citiesText: cities, featuresText: features, version, sources, metadata, generatedAt: options.generatedAt,
  });
  await mkdir(path.join(options.output, version), { recursive: true });
  await writeFile(path.join(options.output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(options.output, manifest.searchIndex.path), `${JSON.stringify(searchIndex)}\n`);
  console.log(JSON.stringify({ version, ...manifest.counts }));
}

await main();
