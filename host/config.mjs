import { homedir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { accessSync, constants, statSync } from 'node:fs';
import { validRoom } from '../src/multiplayer/roomCode.js';
import { peerOptions } from '../src/multiplayer/peerOptions.js';

export function defaultStateDir(env = process.env, platform = process.platform) {
  if (platform === 'win32') return join(env.LOCALAPPDATA || homedir(), 'Flight3dGhost');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Flight3dGhost');
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'flight3d-ghost');
}
export function findChrome(explicit, env = process.env) {
  const candidates = explicit ? [explicit] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...[env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
      .map(base => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser',
  ];
  for (const candidate of candidates) {
    const paths = /[/\\]/.test(candidate) ? [candidate]
      : (env.PATH || '').split(delimiter).map(dir => join(dir, candidate));
    for (const path of paths) try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return resolve(path);
    } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Chrome/Chromium not found. Install a browser or set --chrome /path/to/browser.');
}
export function readConfig(args, env = process.env) {
  const values = { 'state-dir': env.GHOST_STATE_DIR, room: env.GHOST_ROOM, name: env.GHOST_NAME || 'Maverick',
    'public-url': env.GHOST_PUBLIC_URL || 'https://stlim0727.github.io/flight3d/', chrome: env.CHROME_PATH,
    'signal-url': env.GHOST_SIGNAL_URL || env.VITE_MULTIPLAYER_SIGNAL_URL,
    'ice-servers': env.GHOST_ICE_SERVERS || env.VITE_MULTIPLAYER_ICE_SERVERS };
  const flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (['help', 'version', 'check'].includes(key) && args[i].startsWith('--')) { flags.add(key); continue; }
    if (!args[i].startsWith('--') || !Object.hasOwn(values, key)) throw new Error(`Unknown option: ${args[i]}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
  }
  if (flags.has('help') || flags.has('version')) return { flags };
  if (values.room && !validRoom(values.room)) throw new Error('Room must be a six-character code (2–9, A–Z excluding I/O).');
  const url = new URL(values['public-url']);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Public URL must be an HTTP(S) game URL without credentials.');
  let options;
  try { options = peerOptions({ VITE_MULTIPLAYER_SIGNAL_URL: values['signal-url'], VITE_MULTIPLAYER_ICE_SERVERS: values['ice-servers'] }); }
  catch { throw new Error('Invalid signaling URL or ICE configuration.'); }
  const validServer = server => server && typeof server === 'object' && !Array.isArray(server)
    && (typeof server.urls === 'string' && server.urls.length > 0
      || Array.isArray(server.urls) && server.urls.length > 0 && server.urls.every(url => typeof url === 'string' && url.length > 0));
  if (options.config && (!Array.isArray(options.config.iceServers) || options.config.iceServers.some(server => !validServer(server)))) {
    throw new Error('ICE servers must be a JSON array of RTCIceServer objects.');
  }
  return { flags, stateDir: resolve(values['state-dir'] || defaultStateDir(env)),
    room: values.room, name: values.name, publicUrl: url.href, chrome: values.chrome,
    noSandbox: env.CHROME_NO_SANDBOX === '1', options };
}
