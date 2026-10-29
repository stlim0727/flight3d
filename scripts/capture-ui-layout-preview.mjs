import { withBrowserSession } from './lib/browserHarness.mjs';
import path from 'node:path';

const outDir = path.resolve('docs/development/assets');

async function run() {
  console.log('Capturing Desktop UI previews (1440x900)...');
  await withBrowserSession({
    width: 1440,
    height: 900,
    path: '/?airport=coastal&aircraft=B738&scenario=runway',
  }, async ({ evaluate, screenshot, delay }) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
      await delay(500);
    }
    await delay(1000);

    // Enter flight mode
    await evaluate(`(() => {
      window.simulator.demoDirector.stop();
      window.simulator.gameFlow.enterFlight();
      window.simulator.integratePhysics = () => {};
    })()`);
    await delay(1000);

    // 1. Desktop Cockpit View
    await screenshot(`${outDir}/ui-code-preview-desktop-cockpit.png`);
    console.log('Captured ui-code-preview-desktop-cockpit.png');

    // 2. Desktop HUD View
    await evaluate(`window.simulator.cameraSystem.setMode(8)`);
    await delay(500);
    await screenshot(`${outDir}/ui-code-preview-desktop-hud.png`);
    console.log('Captured ui-code-preview-desktop-hud.png');

    // 3. Desktop with Demo Banner in top-center notification slot
    await evaluate(`(() => {
      window.simulator.cameraSystem.setMode(0);
      document.getElementById('demo-banner').style.display = 'flex';
    })()`);
    await delay(500);
    await screenshot(`${outDir}/ui-code-preview-desktop-demo.png`);
    console.log('Captured ui-code-preview-desktop-demo.png');
  });

  console.log('Capturing Mobile Landscape preview (926x428)...');
  await withBrowserSession({
    width: 926,
    height: 428,
    mobile: true,
    path: '/?airport=coastal&aircraft=B738&scenario=runway',
  }, async ({ evaluate, screenshot, delay }) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
      await delay(500);
    }
    await delay(1000);

    await evaluate(`(() => {
      window.simulator.demoDirector.stop();
      window.simulator.gameFlow.enterFlight();
      window.simulator.integratePhysics = () => {};
      window.simulator.cameraSystem.setMode(8);
      document.body.classList.add('touch-mode');
    })()`);
    await delay(1000);

    await screenshot(`${outDir}/ui-code-preview-mobile-landscape.png`);
    console.log('Captured ui-code-preview-mobile-landscape.png');
  });

  console.log('Capturing Mobile Portrait preview (390x844)...');
  await withBrowserSession({
    width: 390,
    height: 844,
    mobile: true,
    path: '/?airport=coastal&aircraft=B738&scenario=runway',
  }, async ({ evaluate, screenshot, delay }) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
      await delay(500);
    }
    await delay(1000);

    await evaluate(`(() => {
      window.simulator.demoDirector.stop();
      window.simulator.gameFlow.enterFlight();
      window.simulator.integratePhysics = () => {};
      window.simulator.cameraSystem.setMode(8);
      document.body.classList.add('touch-mode');
    })()`);
    await delay(1000);

    await screenshot(`${outDir}/ui-code-preview-mobile-portrait.png`);
    console.log('Captured ui-code-preview-mobile-portrait.png');
  });

  console.log('All code-based previews successfully captured!');
}

run().catch(err => {
  console.error('Failed to capture previews:', err);
  process.exit(1);
});
