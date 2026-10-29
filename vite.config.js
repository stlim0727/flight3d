import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let commit = 'unknown';
let branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Source archive. */ }
if (branch === 'unknown') {
  try { branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Detached checkout. */ }
}
const revision = commit === 'unknown' ? commit : commit.slice(0, 12);
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify({ version, branch, commit, revision, builtAt: new Date().toISOString() }) },
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rolldownOptions: {
      input: { main: 'index.html', incheon: 'incheon.html', flights: 'flights.html' }
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
