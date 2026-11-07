#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runCli } from './runner.mjs';
await runCli({ readAsset: (name, encoding) => readFile(new URL(name, import.meta.url), encoding) });
