import { getAsset } from 'node:sea';
import { runCli } from './runner.mjs';
runCli({ readAsset: (name, encoding) => encoding ? getAsset(name, encoding) : Buffer.from(getAsset(name)) })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
