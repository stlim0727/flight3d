// Refresh OurAirports snapshots and rebuild the versioned regional runway index.
// Usage: node scripts/airport-index/build.mjs [--refresh] [--source-dir DIR] [--output DIR]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildIndex, DEFAULT_TILE_DEGREES, versionForSources } from './lib.mjs';

const SOURCE_URLS = Object.freeze({
  airports: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
  runways: 'https://davidmegginson.github.io/ourairports-data/runways.csv',
});
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/', import.meta.url));
const DEFAULT_OUTPUT = fileURLToPath(new URL('../../public/data/airports/', import.meta.url));
const METADATA = {
  attribution: 'OurAirports contributors',
  license: 'Unlicense (public domain)',
  licenseUrl: 'https://github.com/davidmegginson/ourairports-data/blob/main/LICENSE',
  sourceUrl: 'https://ourairports.com/data/',
};

function parseArgs(argv) {
  const options = { refresh: false, sourceDir: null, output: DEFAULT_OUTPUT, tileDegrees: DEFAULT_TILE_DEGREES, generatedAt: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--refresh') options.refresh = true;
    else if (arg === '--source-dir') options.sourceDir = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--tile-degrees') options.tileDegrees = Number(argv[++i]);
    else if (arg === '--generated-at') options.generatedAt = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.tileDegrees) || options.tileDegrees <= 0 || 360 % options.tileDegrees || 180 % options.tileDegrees) {
    throw new Error('--tile-degrees must divide both 180 and 360');
  }
  if (options.refresh && options.sourceDir) throw new Error('--refresh and --source-dir are mutually exclusive');
  return options;
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}



async function download(name) {
  const response = await fetch(SOURCE_URLS[name]);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    info: {
      url: SOURCE_URLS[name],
      retrievedAt: new Date().toISOString(),
      lastModified: response.headers.get('last-modified'),
      etag: response.headers.get('etag'),
      sha256: hash(buffer),
      bytes: buffer.length,
    },
  };
}

function minutePrecision(iso) {
  return iso.replace(/:\d{2}\.\d{3}Z$/, ':00Z');
}

async function readSources(options) {
  if (options.refresh) {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const [airports, runways] = await Promise.all([download('airports'), download('runways')]);
    const sources = { airports: airports.info, runways: runways.info };
    for (const source of Object.values(sources)) source.retrievedAt = minutePrecision(source.retrievedAt);
    const metadata = { ...METADATA, retrievedAt: minutePrecision(new Date().toISOString()), sources };
    await Promise.all(Object.entries({ airports, runways }).map(([name, source]) =>
      writeFile(path.join(SNAPSHOT_DIR, `${name}.csv.gz`), gzipSync(source.buffer))));
    await writeFile(path.join(SNAPSHOT_DIR, 'source-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    return { airportsCsv: airports.buffer.toString('utf8'), runwaysCsv: runways.buffer.toString('utf8'), sources, metadata };
  }

  if (options.sourceDir) {
    const csv = Object.fromEntries(await Promise.all(['airports', 'runways'].map(async name =>
      [name, await readFile(path.join(options.sourceDir, `${name}.csv`), 'utf8')])));
    const info = Object.fromEntries(Object.entries(csv).map(([name, text]) => [name, {
      url: SOURCE_URLS[name],
      sha256: hash(Buffer.from(text)),
      bytes: Buffer.byteLength(text),
    }]));
    return { airportsCsv: csv.airports, runwaysCsv: csv.runways, sources: info, metadata: { ...METADATA, sources: info } };
  }

  const metadata = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, 'source-metadata.json'), 'utf8'));
  const sources = metadata.sources;
  const entries = await Promise.all(['airports', 'runways'].map(name => {
    const gzipped = readFile(path.join(SNAPSHOT_DIR, `${name}.csv.gz`));
    return gzipped.then(data => {
      const raw = gunzipSync(data);
      if (hash(raw) !== sources[name].sha256 || raw.length !== sources[name].bytes) {
        throw new Error(`${name} snapshot does not match source-metadata.json`);
      }
      return [name, raw.toString('utf8')];
    });
  }));
  return {
    airportsCsv: entries.find(([name]) => name === 'airports')[1],
    runwaysCsv: entries.find(([name]) => name === 'runways')[1],
    sources,
    metadata,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { airportsCsv, runwaysCsv, sources } = await readSources(options);
  const version = versionForSources(sources, options.tileDegrees);
  const { manifest, tiles } = buildIndex({
    airportsCsv,
    runwaysCsv,
    sources,
    version,
    tileDegrees: options.tileDegrees,
    generatedAt: options.generatedAt,
  });
  await mkdir(path.join(options.output, version, 'tiles'), { recursive: true });
  await writeFile(path.join(options.output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await Promise.all([...tiles.entries()].map(([tileId, tile]) =>
    writeFile(path.join(options.output, version, 'tiles', `${tileId}.json`), `${JSON.stringify(tile)}\n`)));
  console.log(JSON.stringify({ version, tileCount: tiles.size, ...manifest.counts }));
}

await main();
