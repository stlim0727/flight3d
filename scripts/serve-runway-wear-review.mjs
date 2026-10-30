// Open the printed URL in a browser. Results/images are saved by the review page.
import { createServer } from 'vite';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const baseline = '.cache/pavement-baseline';
const artifacts = 'review-artifacts/runway-wear';
fs.mkdirSync(baseline, { recursive: true });
fs.mkdirSync(artifacts, { recursive: true });
const base = process.env.BASE_REV || 'origin/main';
for (const name of ['Airport', 'LuklaAirport', 'IncheonPavement', 'Pavement']) {
  const source = execFileSync('git', ['show', `${base}:src/environment/${name}.js`], { encoding: 'utf8' })
    .replaceAll("'./AirportBuildings.js'", "'/src/environment/AirportBuildings.js'")
    .replaceAll("'./RunwayMarkings.js'", "'/src/environment/RunwayMarkings.js'");
  fs.writeFileSync(`${baseline}/${name}.js`, source);
}
const server = await createServer({
  server: { host: '127.0.0.1', port: 5191, strictPort: true },
  plugins: [{ name: 'runway-review-evidence', configureServer(vite) {
    vite.middlewares.use('/__runway_evidence', async (req, res) => {
      if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:5191') {
        res.writeHead(403).end(); return;
      }
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 12_000_000) throw new Error('Evidence too large');
        }
        const { name, data } = JSON.parse(body);
        if (!/^(?:(?:before|after)-(?:Airport|LuklaAirport|Incheon)-(?:overview|close|night)\.png|results\.json)$/.test(name)) {
          throw new Error('Invalid evidence name');
        }
        fs.writeFileSync(`${artifacts}/${name}`, name.endsWith('.png') ? Buffer.from(data, 'base64') : data);
        res.end('saved');
      } catch (error) { res.writeHead(400).end(error.message); }
    });
  } }]
});
await server.listen();
console.log(`Runway review: http://127.0.0.1:5191/scripts/verify-runway-wear.html (base ${base})`);
