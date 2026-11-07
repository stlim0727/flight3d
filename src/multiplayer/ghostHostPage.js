import { PeerRoom } from './PeerRoom.js';
import { VoiceLink } from './VoiceLink.js';
import { GhostPilot, GHOST_CONFIG } from './GhostPilot.js';

/** Internal localhost entry; nothing is added to the simulator's UI or build. */
window.startGhostHost = ({ room: code, name = 'Maverick', options } = {}) => {
  if (window.ghostHost) throw new Error('already-started');
  let room, pilot, reconnectTimer, startTimer;
  let stopped = false, generation = 0, last = performance.now(), snapshotAt = 0;
  const status = window.ghostHost = { state: 'connecting', code, generation: 0, error: null };
  const connect = () => {
    if (stopped) return;
    clearTimeout(startTimer);
    room?.dispose();
    const current = ++generation;
    Object.assign(status, { state: 'connecting', registered: false, generation, error: null });
    const voice = new VoiceLink();
    voice.setMuted(true);
    voice.context.resume().catch(() => {});
    room = new PeerRoom({ hostRoom: code, name, config: GHOST_CONFIG, voice, options,
      // Unattended service policy; ordinary human rooms keep their existing lease.
      waitingMs: Infinity,
      prepare: () => { pilot = new GhostPilot(); },
      fly: () => { last = performance.now(); snapshotAt = 0; },
      changed: () => {
        if (current !== generation || !room) return;
        Object.assign(status, { state: room.session.state, registered: room.registered === true,
          generation, round: room.session.round, remoteName: room.session.remoteName });
        if (room.session.state === 'connected' && !startTimer) {
          // Give the normal guest dialog time to show the host before preparation.
          startTimer = setTimeout(() => { startTimer = null; room.session.start(); }, 2000);
        }
      },
      ended: reason => {
        status.reason = reason;
        clearTimeout(startTimer); startTimer = null;
        reconnectTimer = setTimeout(connect, 3000);
      },
    });
  };
  const timer = setInterval(() => {
    const now = performance.now(), elapsed = (now - last) / 1000; last = now;
    if (room?.session.state !== 'flying') return;
    try {
      pilot.advance(elapsed);
      if (now - snapshotAt >= 1000 / 15) {
        room.session.snapshot(pilot.snapshot()); snapshotAt = now;
        status.position = pilot.snapshot().p;
        status.simSeconds = pilot.sim.totalSimTime;
      }
    } catch (error) { status.error = error.message; room.close('connection'); }
  }, 1000 / 60);
  status.stop = () => {
    stopped = true; ++generation;
    clearTimeout(reconnectTimer); clearTimeout(startTimer); clearInterval(timer); room?.dispose();
  };
  connect();
};
