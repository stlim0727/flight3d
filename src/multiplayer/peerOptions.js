/** Production configuration comes from the build, never an invite link. */
export function peerOptions(env = import.meta.env) {
  const options = { debug: 0 };
  if (env.VITE_MULTIPLAYER_SIGNAL_URL) {
    const url = new URL(env.VITE_MULTIPLAYER_SIGNAL_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid-signaling');
    Object.assign(options, { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), path: url.pathname, secure: url.protocol === 'https:' });
  }
  if (env.VITE_MULTIPLAYER_ICE_SERVERS) options.config = { iceServers: JSON.parse(env.VITE_MULTIPLAYER_ICE_SERVERS) };
  return options;
}
