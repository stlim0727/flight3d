// Replaced by Vite at build time, so cached pages retain their own identity.
export const BUILD_INFO = typeof __BUILD_INFO__ === 'undefined'
  ? { version: 'unknown', branch: 'unknown', commit: 'unknown', commitDate: 'unknown', revision: 'unknown', builtAt: 'unknown' }
  : __BUILD_INFO__;
