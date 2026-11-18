/** Production configuration comes from the build, never an invite link. */
export const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: [
      'turn:eu-0.turn.peerjs.com:3478',
      'turn:us-0.turn.peerjs.com:3478',
    ],
    username: 'peerjs',
    credential: 'peerjsp',
  },
]);

export function peerOptions(env = (typeof import.meta !== 'undefined' ? import.meta.env : {}), dynamicIceServers = null) {
  env = env || (typeof import.meta !== 'undefined' ? import.meta.env : {}) || {};
  const options = { debug: 0 };
  if (env.VITE_MULTIPLAYER_SIGNAL_URL) {
    const url = new URL(env.VITE_MULTIPLAYER_SIGNAL_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid-signaling');
    Object.assign(options, { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), path: url.pathname, secure: url.protocol === 'https:' });
  }

  // 1. Explicit build environment takes precedence when provided
  if (env.VITE_MULTIPLAYER_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(env.VITE_MULTIPLAYER_ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        options.config = { iceServers: parsed };
        return options;
      }
    } catch {}
  }

  // 2. Dynamic credentials from directory worker (e.g. Cloudflare Calls TURN)
  if (Array.isArray(dynamicIceServers) && dynamicIceServers.length > 0) {
    options.config = { iceServers: dynamicIceServers };
    return options;
  }

  // 3. Built-in default STUN + PeerJS TURN relay fallback
  options.config = { iceServers: DEFAULT_ICE_SERVERS };
  return options;
}
