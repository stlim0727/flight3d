const MAX_SAMPLES = 8192;
const summary = values => {
  if (!values.length) return { samples: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const round = n => Math.round(n * 100) / 100;
  const percentile = p => round(sorted[Math.ceil(sorted.length * p) - 1]);
  return { samples: values.length, mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: round(sorted.at(-1)) };
};

/** Bounded foreground flight windows. Wall-frame gaps are never physics-clamped. */
export class FlightPerformanceMonitor {
  constructor({ emit, intervalMs = 30000 }) {
    this.emit = emit;
    this.intervalMs = intervalMs;
    this.reset();
  }

  reset() {
    this.context = null;
    this.previous = null;
    this.frames = [];
    this.update = [];
    this.render = [];
    this.gpu = [];
    this.calls = [];
    this.triangles = [];
  }

  begin(now, context) {
    if (!context) { this.flush('inactive'); return false; }
    if (this.context && Object.keys(context).some(key => context[key] !== this.context[key])) this.flush('context-change');
    if (!this.context) { this.context = { ...context }; this.started = now; }
    this.frameStart = now;
    this.gap = this.previous === null ? null : now - this.previous;
    this.previous = now;
    return true;
  }

  end({ updateMs, renderMs, calls, triangles }) {
    if (!this.context) return;
    if (this.gap > 0 && Number.isFinite(this.gap)) this.frames.push(this.gap);
    for (const [bucket, value] of [[this.update, updateMs], [this.render, renderMs], [this.calls, calls], [this.triangles, triangles]]) {
      if (Number.isFinite(value) && value >= 0) bucket.push(value);
    }
    if (this.frameStart - this.started >= this.intervalMs || this.update.length >= MAX_SAMPLES) this.flush('interval');
  }

  addGpu(ms, context) {
    // Asynchronous queries from an earlier context/window must not contaminate this one.
    if (context && context === this.context && Number.isFinite(ms) && ms >= 0 && this.gpu.length < MAX_SAMPLES) this.gpu.push(ms);
  }

  flush(reason) {
    if (this.context && this.frames.length) {
      const frameMs = summary(this.frames);
      this.emit({ version: 1, ...this.context, reason, windowMs: this.frameStart - this.started,
        windowStartMs: this.started, windowEndMs: this.frameStart,
        frames: this.frames.length, fps: Math.round(100000 / frameMs.mean) / 100,
        frameMs, updateMs: summary(this.update), renderSubmitMs: summary(this.render), gpuMs: summary(this.gpu),
        drawCalls: summary(this.calls), triangles: summary(this.triangles),
        framesOver50Ms: this.frames.filter(ms => ms > 50).length,
        framesOver100Ms: this.frames.filter(ms => ms > 100).length });
    }
    this.reset();
  }
}

/** Sample GPU time without waiting for the driver or interfering with another timer query. */
export class FlightGpuTimer {
  constructor(gl, onSample) {
    this.gl = gl;
    this.onSample = onSample;
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.frame = 0;
  }

  clear() {
    for (const { query } of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }

  begin(context) {
    const gl = this.gl, ext = this.extension;
    if (++this.frame % 60) return null;
    if (!ext || gl.isContextLost()) { this.clear(); return null; }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.clear(); return null; }
    this.pending = this.pending.filter(item => {
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return true;
      const ms = gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(item.query);
      this.onSample(ms, item.context);
      return false;
    });
    if (this.pending.length >= 4 || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return null;
    const query = gl.createQuery();
    if (!query) return null;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    return { query, context };
  }

  end(item) {
    if (!item) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(item);
  }
}
