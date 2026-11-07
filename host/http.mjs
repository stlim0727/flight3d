import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

/** Serve exactly the bundled host files, never the checkout or arbitrary paths. */
export async function serveHost(webRoot, health) {
  const html = await readFile(new URL('index.html', webRoot));
  const script = await readFile(new URL('host.js', webRoot));
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/health') {
      const status = health();
      res.writeHead(status.ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(status)); return;
    }
    const asset = path === '/' ? html : path === '/host.js' ? script : null;
    if (!asset) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html' : 'text/javascript' });
    res.end(req.method === 'HEAD' ? undefined : asset);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}
