import assert from 'node:assert/strict';
import { access, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A missing/unknown renderer or an incomplete draw must never earn a pass. */
export function assertHardwareDraw(report) {
  assert.equal(report?.webgl2, true, 'WebGL2 context creation failed');
  assert.equal(typeof report.renderer, 'string', 'GPU renderer information is unavailable');
  assert.doesNotMatch(report.renderer, /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i,
    'Software GPU renderer is forbidden; investigate hardware access instead');
  assert.match(report.renderer, /Intel|NVIDIA|AMD|ATI|Apple|Adreno|Qualcomm|Mali|PowerVR|Radeon|GeForce|ARM/i,
    'Hardware renderer is unrecognized; inspect browser GPU diagnostics');
  assert.deepEqual(report.pixel, [255, 0, 0, 255], 'WebGL2 shader drawing/readPixels failed');
  assert.equal(report.error, 0, 'WebGL2 reported a GL error');
}

const drawProbe = `(() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) return { webgl2: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, '#version 300 es\\nvoid main(){vec2 p[3]=vec2[](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));gl_Position=vec4(p[gl_VertexID],0.,1.);}'],
    [gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float;out vec4 color;void main(){color=vec4(1.,0.,0.,1.);}'],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program); gl.viewport(0, 0, 16, 16);
  gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
  const pixel = new Uint8Array(4);
  gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const report = { webgl2: true, version: gl.getParameter(gl.VERSION), renderer,
    pixel: [...pixel], error: gl.getError() };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return report;
})()`;

async function verify(endpoint) {
  // Check the executor running this command, not just a host inventory.
  const devices = await readdir('/dev/dri').catch(() => []);
  const accessible = [];
  for (const name of devices.filter(name => /^renderD\d+$/.test(name))) {
    const device = `/dev/dri/${name}`;
    try { await access(device, constants.R_OK | constants.W_OK); accessible.push(device); }
    catch { /* Renderer inspection below cannot replace device access. */ }
  }
  assert.ok(accessible.length, 'No accessible /dev/dri/renderD* in this executor. Check sandbox visibility and render/video permissions; use the authorized host execution path, not software fallback.');
  const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const version = await (await request(`${endpoint}/json/version`)).json();
  const response = await request(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
  assert.ok(response.ok, `CDP target creation failed: ${response.status}`);
  const target = await response.json();
  let ws;
  const pending = new Map();
  try {
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timed out')); }, 15000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    let sequence = 0;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!pending.has(message.id)) return;
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const result = await call('Runtime.evaluate', { expression: drawProbe, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    const report = result.result.value;
    assertHardwareDraw(report);
    const evidence = { passed: true, browser: version.Browser, devices: accessible, ...report };
    if (process.env.GPU_REPORT) await writeFile(process.env.GPU_REPORT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    for (const { timer } of pending.values()) clearTimeout(timer);
    ws?.close();
    // Own only this disposable probe tab; never close another agent's browser.
    await request(`${endpoint}/json/close/${target.id}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = (process.argv[2] || process.env.CDP_URL || 'http://127.0.0.1:9225').replace(/\/$/, '');
  try {
    if (process.env.GPU_REPORT) await writeFile(process.env.GPU_REPORT, '{"passed":false,"status":"pending"}\n');
    await verify(endpoint);
  } catch (error) {
    if (process.env.GPU_REPORT) await writeFile(process.env.GPU_REPORT, `${JSON.stringify({ passed: false, error: error.message })}\n`);
    console.error(error.message); process.exitCode = 1;
  }
}
