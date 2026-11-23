import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { withBrowserSession } from './lib/browserHarness.mjs';

// 3D simulator acceptance needs hardware Vulkan; never select a software fallback.
process.env.GPU_ANGLE = 'vulkan';
const artifacts = 'review-artifacts/feedback';
await mkdir(artifacts, { recursive: true });
await withBrowserSession({ path: '/?telemetry=0', width: 390, height: 844, mobile: true },
  async ({ evaluate, send, cdpPort, delay, screenshot }) => {
    console.log(execFileSync(process.execPath,
      ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], { encoding: 'utf8' }));
    await send('Page.bringToFront');
    for (let i = 0; i < 240; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
      await delay(250);
    }
    assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'simulator loaded');
    await evaluate(() => {
      const sim = window.simulator;
      sim.demoDirector.stop();
      sim.gameFlow.isPhysicsFrozen = () => true;
      sim.flightRecorder.active = false;
      // Synthetic diagnostic fixture, not a physical landing simulation.
      sim.debriefReport = { metadata: { aircraft: 'B738', airport: 'incheon', scenario: 'approach' },
        durationSec: 120, reason: 'crash', peaks: { gForce: { timeSec: 119, gForce: 50.25 } },
        touchdowns: [{ timeSec: 118, sinkRateFpm: 600, contactG: 2.9 }],
        samples: [{ timeSec: 119, gForce: 50.25 }] };
      window.feedbackNativeFetch = window.fetch.bind(window);
      window.feedbackRequests = [];
      window.feedbackMode = 'blocked';
      window.fetch = async (url, options) => {
        if (!String(url).endsWith('/i/v0/e/')) return window.feedbackNativeFetch(url, options);
        window.feedbackRequests.push(JSON.parse(options.body));
        if (window.feedbackMode === 'blocked') throw new TypeError('net::ERR_BLOCKED_BY_CLIENT');
        if (window.feedbackMode === 'waiting') return new Promise(resolve => { window.feedbackAccept = resolve; });
        try {
          const response = await window.feedbackNativeFetch(url, options);
          window.feedbackLiveResponse = { status: response.status, type: response.type, body: await response.clone().text() };
          return response;
        } catch (error) { window.feedbackLiveResponse = { error: String(error) }; throw error; }
      };
      sim.openFeedbackDialog();
    });
    assert.equal(await evaluate('document.querySelector("[data-feedback-include-screenshot]").checked'), true,
      'screenshot is attached by default when the canvas can be captured');
    const cardScroll = () => evaluate("document.querySelector('.feedback-card').scrollTop");
    const touch = (type, y, x = 20) => send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
    assert.equal(await cardScroll(), 0, 'report opens at its heading');
    await touch('touchStart', 650);
    for (const y of [600, 550, 500, 450, 400]) await touch('touchMove', y);
    await touch('touchEnd');
    for (let i = 0; i < 20 && await cardScroll() === 0; i++) await delay(50);
    assert.ok(await cardScroll() > 0, 'touch drag scrolls the card without engaging the camera');
    const input = await evaluate(() => {
      const field = document.querySelector('[data-feedback-text]');
      field.scrollIntoView({ block: 'center' });
      const rect = field.getBoundingClientRect();
      return { x: Math.round(rect.left + 20), y: Math.round(rect.top + 20) };
    });
    await touch('touchStart', input.y, input.x);
    await touch('touchEnd');
    assert.ok(await evaluate("document.activeElement.matches('[data-feedback-text]')"),
      'tapping the textarea focuses it');
    await send('Input.insertText', { text: 'Mobile blocked request test' });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 450, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate(() => {
      const card = document.querySelector('.feedback-card');
      card.scrollTop = card.scrollHeight;
      const actions = document.querySelector('.feedback-actions').getBoundingClientRect();
      return actions.bottom <= window.visualViewport.height && actions.top >= 0;
    }), 'report actions can be scrolled into a reduced viewport');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(() => document.querySelector('[data-feedback-form]').requestSubmit());
    for (let i = 0; i < 40; i++) {
      if (await evaluate('document.querySelector("[data-feedback-status]").dataset.failed === "true"')) break;
      await delay(50);
    }
    const failed = await evaluate(() => ({
      visible: !document.querySelector('#feedback-dialog-overlay').hidden,
      text: document.querySelector('[data-feedback-text]').value,
      status: document.querySelector('[data-feedback-status]').textContent,
      request: window.feedbackRequests[0]?.properties,
      id: window.feedbackRequests[0]?.uuid,
    }));
    assert.ok(failed.visible && failed.status.includes('수신을 확인하지 못했습니다'));
    assert.equal(failed.text, 'Mobile blocked request test');
    assert.equal(failed.request.peakG, 50.25);
    assert.equal(failed.request.touchdowns[0].contactG, 2.9);
    assert.equal(failed.request.flightDurationSec, 120);
    assert.ok(!failed.request.api_key, 'properties contain no API credential');
    assert.ok(failed.request.screenshot?.startsWith('data:image/jpeg;base64,'), 'default screenshot in report');
    assert.ok(Number.isFinite(failed.request.altitudeFt), 'altitude in report');
    assert.ok(Number.isFinite(failed.request.headingDeg), 'heading in report');
    assert.ok('geoPosition' in failed.request && 'renderedTiles' in failed.request,
      'geo and tile diagnostics present even when unavailable');
    await screenshot(`${artifacts}/blocked-mobile.png`);
    await evaluate(() => {
      document.querySelector('[data-feedback-close]').click();
      window.simulator.openFeedbackDialog();
    });
    assert.equal(await evaluate('document.querySelector("[data-feedback-text]").value'), failed.text,
      'closing and reopening preserves a failed draft');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `${process.cwd()}/${artifacts}` });
    await evaluate(() => document.querySelector('[data-feedback-download]').click());
    let downloaded;
    for (let i = 0; i < 40; i++) {
      try {
        downloaded = await readFile(`${artifacts}/flight3d-report-${failed.id}.zip`);
        if (downloaded.length > 0) break;
      } catch { await delay(50); }
    }
    assert.ok(downloaded?.length, 'actual report archive downloaded');
    assert.equal(downloaded.subarray(0, 4).toString('hex'), '504b0304', 'ZIP local header');
    assert.ok(downloaded.includes(Buffer.from('report.json')), 'archive contains report.json');
    assert.ok(downloaded.includes(Buffer.from('screenshot.jpg')), 'archive contains screenshot.jpg');
    await evaluate(() => {
      window.feedbackMode = 'waiting';
      document.querySelector('[data-feedback-form]').requestSubmit();
    });
    assert.equal(await evaluate('document.querySelector("#feedback-dialog-overlay").hidden'), false,
      'must not announce success while server has not replied');
    assert.equal(await evaluate('window.feedbackRequests[1].uuid'), failed.id, 'retry keeps report ID');
    await evaluate(() => window.feedbackAccept(new Response('1', { status: 200 })));
    for (let i = 0; i < 40; i++) {
      if (await evaluate('document.querySelector("#feedback-dialog-overlay").hidden')) break;
      await delay(50);
    }
    assert.equal(await evaluate('document.querySelector("#feedback-dialog-overlay").hidden'), true);

    // Optional, clearly labelled live ingestion test. No analytics SDK involved.
    let live;
    if (process.argv.includes('--live')) {
      await evaluate(() => {
        window.feedbackMode = 'live';
        window.simulator.openFeedbackDialog();
        document.querySelector('[data-feedback-text]').value = 'DELIVERY VERIFICATION: synthetic 50.25G diagnostic fixture, mobile Chrome; not a user incident.';
        document.querySelector('[data-feedback-form]').requestSubmit();
      });
      for (let i = 0; i < 160; i++) {
        const done = await evaluate(() => document.querySelector('#feedback-dialog-overlay').hidden
          || document.querySelector('[data-feedback-status]').dataset.failed === 'true');
        if (done) break;
        await delay(100);
      }
      live = await evaluate(() => ({ reportId: window.feedbackRequests.at(-1).uuid,
        accepted: document.querySelector('#feedback-dialog-overlay').hidden,
        status: document.querySelector('[data-feedback-status]').textContent, response: window.feedbackLiveResponse }));
      console.log(JSON.stringify({ live }));
      assert.ok(live.accepted, live.status);
    }
    await writeFile(`${artifacts}/result.json`, JSON.stringify({ blocked: true, preservedDraft: true,
      acknowledgedRetry: true, live }, null, 2));
    console.log(JSON.stringify({ blocked: true, preservedDraft: true, acknowledgedRetry: true, live }));
  });
