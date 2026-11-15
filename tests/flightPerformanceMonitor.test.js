import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightPerformanceMonitor, FlightGpuTimer } from '../src/core/FlightPerformanceMonitor.js';

const context = { aircraft: 'B738', camera: 'cockpit' };
const sample = (monitor, now, c = context) => {
  monitor.begin(now, c);
  monitor.end({ updateMs: 3, renderMs: 4, calls: 42, triangles: 1000 });
};

test('raw stalls survive aggregation; first frame and resumed gaps are excluded', () => {
  const reports = [];
  const monitor = new FlightPerformanceMonitor({ emit: r => reports.push(r), intervalMs: 300 });
  sample(monitor, 0); sample(monitor, 16); sample(monitor, 32); sample(monitor, 332);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].frames, 3);
  assert.equal(reports[0].frameMs.max, 300);
  assert.equal(reports[0].framesOver100Ms, 1);
  assert.equal(reports[0].renderSubmitMs.mean, 4);
  sample(monitor, 350); sample(monitor, 366);
  monitor.begin(380, null);
  assert.equal(reports[1].reason, 'inactive');
  sample(monitor, 50000); sample(monitor, 50016); monitor.flush('pagehide');
  assert.equal(reports[2].frameMs.max, 16);
});

test('context changes isolate windows and late GPU results; empty flushes do not emit', () => {
  const reports = [];
  const monitor = new FlightPerformanceMonitor({ emit: r => reports.push(r) });
  monitor.flush('empty');
  sample(monitor, 0); const old = monitor.context;
  sample(monitor, 16); monitor.addGpu(9, old);
  sample(monitor, 32, { ...context, camera: 'external' });
  monitor.addGpu(999, old);
  sample(monitor, 48, { ...context, camera: 'external' }); monitor.flush('end');
  assert.equal(reports.length, 2);
  assert.equal(reports[0].camera, 'cockpit');
  assert.equal(reports[0].gpuMs.mean, 9);
  assert.equal(reports[1].gpuMs.samples, 0);
});

test('sample cap bounds memory even when the clock does not advance', () => {
  const reports = [];
  const monitor = new FlightPerformanceMonitor({ emit: r => reports.push(r) });
  for (let i = 0; i < 9000; i++) sample(monitor, i / 1000);
  assert.equal(reports.length, 1);
  assert.ok(monitor.update.length < 8192);
});

test('GPU queries poll without blocking, discard disjoint samples and respect other timers', () => {
  const samples = [], deleted = [];
  let disjoint = false, available = false, busy = false, begins = 0;
  const ext = { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 };
  const gl = { QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, CURRENT_QUERY: 5,
    getExtension: () => ext, isContextLost: () => false,
    getParameter: () => disjoint, getQuery: () => busy,
    createQuery: () => ({}), beginQuery: () => begins++, endQuery() {},
    deleteQuery: q => deleted.push(q), getQueryParameter: (_, param) => param === 3 ? available : 8000000 };
  const timer = new FlightGpuTimer(gl, ms => samples.push(ms));
  let item;
  for (let i = 0; i < 60; i++) item = timer.begin(context);
  timer.end(item);
  assert.equal(begins, 1);
  timer.begin(context); assert.equal(samples.length, 0);
  available = true;
  for (let i = 0; i < 60; i++) { const q = timer.begin(context); timer.end(q); }
  assert.deepEqual(samples, [8]);
  available = false;
  for (let i = 0; i < 60; i++) { const q = timer.begin(context); timer.end(q); }
  disjoint = true;
  for (let i = 0; i < 60; i++) timer.begin(context);
  assert.equal(timer.pending.length, 0);
  assert.equal(samples.length, 1);
  disjoint = false; busy = true;
  for (let i = 0; i < 60; i++) assert.equal(timer.begin(context), null);
  assert.ok(deleted.length >= 2);
});
