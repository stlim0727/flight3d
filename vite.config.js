import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MemoryRoomDirectoryStore, handleDirectoryRequest } from './src/multiplayer/roomDirectory.js';

function roomDirectoryDevPlugin() {
  const store = new MemoryRoomDirectoryStore();
  const middleware = async (req, res, next) => {
    const rawUrl = req.originalUrl || req.url || '';
    const pathname = rawUrl.split('?')[0];
    if (pathname === '/v1/rooms' || pathname.startsWith('/v1/rooms/') || pathname === '/rooms' || pathname.startsWith('/rooms/')) {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const protocol = req.socket?.encrypted ? 'https' : 'http';
        const fullUrl = `${protocol}://${req.headers.host || 'localhost'}${rawUrl}`;
        const webReq = new Request(fullUrl, {
          method: req.method,
          headers: req.headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : (bodyText || undefined),
        });
        const webRes = await handleDirectoryRequest(webReq, store);
        res.statusCode = webRes.status;
        for (const [key, value] of webRes.headers.entries()) {
          res.setHeader(key, value);
        }
        res.end(await webRes.text());
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'internal-dev-error', message: err.message }));
      }
    } else {
      next();
    }
  };
  return {
    name: 'flight3d-room-directory-dev',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

let commit = 'unknown';
let commitDate = 'unknown';
let branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Source archive. */ }
// Committer date of HEAD: for merge commits on the deployed branch this is when the change landed.
if (commit !== 'unknown') {
  try { commitDate = execFileSync('git', ['log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim(); } catch { /* Unparsable history. */ }
}
if (branch === 'unknown') {
  try { branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Detached checkout. */ }
}
const revision = commit === 'unknown' ? commit : commit.slice(0, 12);
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [roomDirectoryDevPlugin()],
  define: { __BUILD_INFO__: JSON.stringify({ version, branch, commit, commitDate, revision, builtAt: new Date().toISOString() }) },
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rolldownOptions: {
      input: {
        main: 'index.html',
        incheon: 'incheon.html',
        flights: 'flights.html',
        screens: 'screens.html',
        screensMobilePortrait: 'screens-mobile-portrait.html',
        screensMobileLandscape: 'screens-mobile-landscape.html',
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: [
        '**/*.png',
        '**/*.jpg',
        '**/*.jpeg',
        '**/.chrome-profile/**',
        '**/.worktrees/**',
        '**/scripts/**'
      ]
    }
  }
});
