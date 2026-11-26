#!/usr/bin/env node
import { buildCatalog, initAddon, usage } from './addon-tooling.mjs';

function option(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const [command, ...args] = process.argv.slice(2);

if (command === 'init') {
  const [kind, ...rest] = args;
  if (!['region', 'aircraft', 'scenario'].includes(kind)) {
    usage();
  } else {
    try {
      const files = await initAddon({
        kind,
        publisher: option(rest, 'publisher'),
        name: option(rest, 'name'),
        version: option(rest, 'version', '1.0.0'),
        coreVersion: option(rest, 'core', '1.8.0'),
        title: option(rest, 'title', option(rest, 'name')),
      }, { outDir: option(rest, 'out', process.cwd()) });
      console.log(`Created: ${files.join(', ')}`);
    } catch (error) {
      console.error(`FAIL: ${error.message}`);
      process.exitCode = 1;
    }
  }
} else if (command === 'catalog') {
  const [manifest, baseUrl, ...rest] = args;
  if (!manifest || !baseUrl) {
    usage();
  } else {
    try {
      const catalog = await buildCatalog(manifest, baseUrl);
      const target = option(rest, 'out', 'catalog.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(target, JSON.stringify(catalog, null, 2) + '\n');
      console.log(`Wrote ${target} (sha256 ${catalog.addons[0].sha256})`);
    } catch (error) {
      console.error(`FAIL: ${error.message}`);
      process.exitCode = 1;
    }
  }
} else {
  usage();
}
