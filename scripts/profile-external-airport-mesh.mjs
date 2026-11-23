// Bounded ABBA profile of the synchronous external-airport mesh build on hardware Vulkan Chrome.
// A = one RKSS region build inside the window; B = no-build control with the region already mounted.
// Run from the repository root:
//   GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless \
//     node scripts/profile-external-airport-mesh.mjs
// Optional: PROFILE_WINDOW_MS (default 5000), ARTIFACT_DIR (default .cache/external-airport-mesh-profile).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectGpuAngle, withBrowserSession } from './lib/browserHarness.mjs';

const ARTIFACT_DIR = path.resolve(process.env.ARTIFACT_DIR || '.cache/external-airport-mesh-profile');
const WINDOW_MS = Number(process.env.PROFILE_WINDOW_MS) || 5000;
const WARMUP_MS = 2000;
const ORDER = [['A1', 'build'], ['B1', 'control'], ['B2', 'control'], ['A2', 'build']];
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

if (detectGpuAngle() !== 'vulkan') {
  throw new Error('Hardware Vulkan GPU required: set GPU_ANGLE=vulkan and use a real render node; software rendering is not evidence');
}
await mkdir(ARTIFACT_DIR, { recursive: true });
const gpuPath = path.join(ARTIFACT_DIR, 'gpu.json');

const round = n => Math.round(n * 100) / 100;
const summarize = values => {
  if (!values.length) return { samples: 0, mean: null, p50: null, p95: null, p99: null, max: null, framesOver50: 0, framesOver100: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => round(sorted[Math.ceil(sorted.length * p) - 1]);
  return {
    samples: values.length,
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(sorted.at(-1)),
    framesOver50: values.filter(ms => ms > 50).length,
    framesOver100: values.filter(ms => ms > 100).length,
  };
};

await withBrowserSession({ path: '/index.html?telemetry=0', timeoutMs: 120000 }, async session => {
  const { cdpPort, gpuAngle, evaluate, delay, exceptions, consoleMessages } = session;
  // Mandatory shader compilation + readPixels preflight against the same browser endpoint.
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    stdio: 'inherit', timeout: 60000, env: { ...process.env, GPU_REPORT: gpuPath },
  });
  const preflight = JSON.parse(await readFile(gpuPath, 'utf8'));
  assert.equal(preflight.passed, true, 'Hardware GPU preflight must pass');
  assert.equal(gpuAngle, 'vulkan');

  const waitFor = async (expression, timeoutMs = 120000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    const state = await evaluate(`({ url: location.href, sim: Boolean(window.sim), ready: window.sim?.startupReady,
      flow: window.sim?.gameFlow?.state, startupError: document.getElementById('startup-error')?.textContent ?? null })`).catch(error => String(error));
    throw new Error(`Timed out: ${expression}; state=${JSON.stringify(state)}; exceptions=${JSON.stringify(exceptions)}; console=${JSON.stringify(consoleMessages.slice(-8))}`);
  };
  await waitFor('Boolean(window.sim?.startupReady)');
  await evaluate(`(() => {
    document.getElementById('lobby-airport-incheon')?.click();
    const select = document.getElementById('lobby-destination');
    select.value = 'RKSS';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await evaluate('sim.fly()');
  await waitFor("sim.airportStreamer?.status?.state === 'ready' && sim.gameFlow.state === 'flight' && !sim.startingFlight", 90000);

  // Inject a timed copy of the streamer's real builder. Only the synchronous
  // createExternalAirportRegion() call is timed; the runtime's cached dynamic
  // import and the already-async fetch/parse are deliberately outside the slice.
  const browser = await evaluate(`(async () => {
    const s = window.sim;
    const surface = await import('/src/geospatial/externalAirportSurface.js');
    if (typeof surface.createExternalAirportRegion !== 'function') throw new Error('Region builder not available');
    const p = { builds: [], longTasks: [], reports: [] };
    window.__meshProfile = p;
    s.airportStreamer._buildRegion = ({ airport, baseOffset, outsideHeight }) => {
      const startMs = performance.now();
      const region = surface.createExternalAirportRegion({ airport, baseOffset, outsideHeight });
      const endMs = performance.now();
      let positionVertices = 0;
      let geometries = 0;
      region?.group?.traverse?.(object => {
        const position = object.geometry?.attributes?.position;
        if (position) { positionVertices += position.count; geometries += 1; }
      });
      p.builds.push({
        startMs, endMs, syncMs: endMs - startMs,
        runways: region?.terrain?.runways?.length ?? 0,
        meshChildren: region?.group?.children?.length ?? 0,
        positionVertices, geometries,
      });
      return region;
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        p.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration, name: entry.name });
      }
    }).observe({ type: 'longtask', buffered: true });
    // Keep every probe report in memory: telemetry=0 means nothing reaches PostHog.
    s.flightPerformance.emit = report => p.reports.push(report);
    s.flightPerformance.intervalMs = 600000;
    s.performanceTelemetryEnabled = true;
    s.setBrowserActive(true);
    const gl = s.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      gpuAngle: 'vulkan',
      webglVersion: gl.getParameter(gl.VERSION),
      webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      webglVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      glError: gl.getError(),
      gpuTimerSupported: Boolean(s.flightGpuTimer?.extension),
      programs: s.renderer.info.programs?.length ?? 0,
      destination: s.destinationAirport,
      streamerStatus: s.airportStreamer.status,
    };
  })()`);
  assert.match(browser.webglRenderer || '', /Intel|NVIDIA|AMD|ATI|Apple|Adreno|Qualcomm|Mali|PowerVR|Radeon|GeForce|ARM/i,
    'WebGL renderer must be identifiable hardware');
  assert.doesNotMatch(browser.webglRenderer || '', SOFTWARE_RENDERER, 'Software rendering is forbidden');
  assert.equal(browser.glError, 0);

  await delay(WARMUP_MS);
  await evaluate(`window.sim.flightPerformance.flush('warmup'); window.__meshProfile.reports.length = 0;`);

  const windows = await evaluate(async ({ windowMs, order }) => {
    const s = window.sim;
    const p = window.__meshProfile;
    const streamer = s.airportStreamer;
    const out = [];
    for (const [label, kind] of order) {
      // Reset out of band: in the same JS task as the trigger, so the frame loop
      // cannot auto-load between unmount and the measured build.
      if (kind === 'build') {
        streamer.setDestination(null);
        streamer.releaseGroundHold();
      }
      s.flightPerformance.flush(`pre-${label}`);
      p.reports.length = 0;
      const startMs = performance.now();
      if (kind === 'build') streamer.ensure('RKSS');
      const frames = [];
      let previous = null;
      await new Promise(resolve => {
        const tick = t => {
          if (previous !== null) frames.push({ startMs: previous, endMs: t, ms: t - previous });
          previous = t;
          if (performance.now() - startMs < windowMs) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const endMs = performance.now();
      s.flightPerformance.flush(label);
      out.push({
        label, kind, startMs, endMs, frames,
        builds: p.builds.filter(b => b.startMs >= startMs && b.endMs <= endMs),
        longTasks: p.longTasks.filter(t => t.startMs <= endMs && t.startMs + t.durationMs >= startMs),
        reports: p.reports.slice(),
        status: streamer.status,
        destination: s.destinationAirport,
        calls: s.renderer.info.render.calls,
        triangles: s.renderer.info.render.triangles,
        programs: s.renderer.info.programs?.length ?? 0,
      });
    }
    return out;
  }, { windowMs: WINDOW_MS, order: ORDER });

  const rows = windows.map(w => {
    const build = w.builds.find(b => b.kind !== 'control') ?? w.builds[0] ?? null;
    const report = w.reports.find(r => r.reason === w.label) ?? w.reports[0] ?? null;
    const longTaskMs = w.longTasks.map(t => t.durationMs);
    const buildFrame = build ? w.frames.find(f => f.startMs <= build.startMs && build.startMs <= f.endMs) ?? null : null;
    return {
      label: w.label,
      kind: w.kind,
      windowMs: round(w.endMs - w.startMs),
      frames: w.frames,
      rawFrameMs: summarize(w.frames.map(f => f.ms)),
      monitor: report && {
        reason: report.reason, frames: report.frames, fps: report.fps, windowMs: round(report.windowMs),
        frameMs: report.frameMs, updateMs: report.updateMs, renderSubmitMs: report.renderSubmitMs,
        gpuMs: report.gpuMs, drawCalls: report.drawCalls, triangles: report.triangles,
        framesOver50Ms: report.framesOver50Ms, framesOver100Ms: report.framesOver100Ms,
        longTasks: report.longTasks,
      },
      monitorReports: w.reports.length,
      build,
      buildFrameMs: buildFrame?.ms ?? null,
      longTasks: { count: longTaskMs.length, totalMs: round(longTaskMs.reduce((a, b) => a + b, 0)), maxMs: longTaskMs.length ? round(Math.max(...longTaskMs)) : 0, entries: w.longTasks },
      counters: { calls: w.calls, triangles: w.triangles, programs: w.programs, destination: w.destination, status: w.status },
    };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    method: { order: ORDER, windowMs: WINDOW_MS, warmupMs: WARMUP_MS, telemetry: 'in-memory only (telemetry=0)' },
    gpuPreflight: preflight,
    browser,
    windows: rows,
    exceptions,
    consoleErrorCount: consoleMessages.filter(m => m.type === 'error').length,
  };
  await writeFile(path.join(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ gpu: preflight.renderer, browser: browser.webglRenderer,
    windows: rows.map(r => ({ label: r.label, kind: r.kind, syncMs: r.build?.syncMs ?? null,
      runways: r.build?.runways ?? null,
      vertices: r.build?.positionVertices ?? null, raw: r.rawFrameMs,
      updateMs: r.monitor?.updateMs?.p95 ?? null, longTasks: r.longTasks.count,
      maxLongTaskMs: r.longTasks.maxMs, framesOver50: r.rawFrameMs.framesOver50 })) }, null, 2));
  console.log(`Artifact: ${path.join(ARTIFACT_DIR, 'report.json')}`);

  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  for (const row of rows) {
    assert.ok(row.frames.length >= 10, `${row.label}: too few frames to compare`);
    assert.ok(row.monitor, `${row.label}: no in-memory flight performance report`);
    if (row.kind === 'build') {
      assert.equal(row.build !== null, true, `${row.label}: no build was measured`);
      assert.equal(row.build.runways, 2, `${row.label}: expected the two-ribbon RKSS workload`);
    } else {
      assert.equal(row.build, null, `${row.label}: control window must not build a region`);
    }
  }
});
