// Shared self-contained headless Chrome + CDP + Vite session harness for verification scripts.
// Eliminates ~90 lines of repeated WebSocket/CDP/server boilerplate per verification script.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function detectGpuAngle() {
  if (process.env.GPU_ANGLE) return process.env.GPU_ANGLE;
  return existsSync('/dev/dri/renderD128') ? 'vulkan' : 'swiftshader';
}

export function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolvePort(port)));
    });
    srv.on('error', reject);
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

export async function withBrowserSession(options = {}, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const mobile = Boolean(options.mobile);
  const deviceScaleFactor = options.deviceScaleFactor ?? 1;
  const cdpPort = Number(options.cdpPort || process.env.CDP_PORT || (await getFreePort()));
  const gpuAngle = detectGpuAngle();
  const profileDir = await mkdtemp(join(tmpdir(), 'flight3d-cdp-'));
  const chromeBin = process.env.CHROME_PATH || 'google-chrome-stable';

  let viteProc = null;
  let origin = options.origin || process.env.APP_URL || process.env.SIM_URL || '';
  if (!origin && options.startVite !== false) {
    const vitePort = await getFreePort();
    origin = `http://127.0.0.1:${vitePort}`;
    const mode = options.preview ? 'preview' : 'dev';
    viteProc = spawn('npx', ['vite', ...(mode === 'preview' ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    for (let i = 0; i < 80; i++) {
      try {
        const res = await fetch(origin);
        if (res.ok) break;
      } catch { /* wait for server */ }
      await delay(100);
    }
  }

  const chromeArgs = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    `--use-angle=${gpuAngle}`,
    ...(gpuAngle === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
    'about:blank',
  ];

  const chromeProc = spawn(chromeBin, chromeArgs, { stdio: 'ignore', windowsHide: true });
  let socket = null;
  let seq = 0;
  const pending = new Map();
  const exceptions = [];
  const consoleMessages = [];

  const send = (method, params = {}) =>
    new Promise((resolveSend, rejectSend) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, options.timeoutMs ?? 60000);
      pending.set(id, msg => {
        clearTimeout(timer);
        if (msg.error) rejectSend(new Error(JSON.stringify(msg.error)));
        else resolveSend(msg.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (exprOrFn, arg) => {
    const expression = typeof exprOrFn === 'function'
      ? `(${exprOrFn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
      : String(exprOrFn);
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  const screenshot = async filePath => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const resolved = resolve(filePath);
    await mkdir(resolve(resolved, '..'), { recursive: true });
    await writeFile(resolved, Buffer.from(data, 'base64'));
    return resolved;
  };

  try {
    let target = null;
    for (let i = 0; i < 100; i++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
        target = pages.find(p => p.type === 'page');
      } catch { /* starting */ }
      if (target) break;
      await delay(100);
    }
    if (!target) throw new Error(`Chrome CDP page target not available on port ${cdpPort}`);

    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', rejectOpen, { once: true });
    });
    socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params.exceptionDetails.text);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        consoleMessages.push(msg.params);
      }
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });

    if (options.path || options.url) {
      const targetUrl = options.url || `${origin}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
      await send('Page.navigate', { url: targetUrl });
    }

    return await fn({ origin, cdpPort, gpuAngle, send, evaluate, screenshot, exceptions, consoleMessages, delay });
  } finally {
    try { socket?.close(); } catch { /* ignore */ }
    try { chromeProc.kill('SIGKILL'); } catch { /* ignore */ }
    try { viteProc?.kill('SIGTERM'); } catch { /* ignore */ }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
