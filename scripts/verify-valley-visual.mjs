import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const outDir = path.resolve(process.argv[2] || '.playwright-mcp');

async function run() {
  await withBrowserSession({ width: 1600, height: 1000 }, async ({ origin, evaluate, screenshot, delay }) => {
    for (const view of ['cruise', 'cliff', 'crest']) {
      try {
        await evaluate(`location.href = '${origin}/scripts/valley-visual.html?seed=2&view=${view}'`);
      } catch { /* the navigation tears down the execution context */ }
      let ready = null;
      for (let i = 0; i < 60 && !ready; i++) {
        await delay(1000);
        ready = await evaluate('window.__valleyReady || null');
      }
      if (!ready) throw new Error(`valley visual harness never ready for view ${view}`);
      console.log(`${view}:`, JSON.stringify(ready));
      if (!ready.nonBlank) throw new Error(`view ${view} rendered a blank frame`);
      await screenshot(path.join(outDir, `valley-${view}.png`));
    }
    console.log('captured to', outDir);
  });
}
run().catch(error => { console.error(error); process.exitCode = 1; });
