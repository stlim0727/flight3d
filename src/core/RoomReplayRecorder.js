import { ReplayRecorder } from './ReplayRecorder.js';
import { REPLAY_INTERVAL_LADDER, maxSamplesFor } from '../replay/replayConfig.js';

/**
 * Records a whole multiplayer room on one clock: the local aircraft with its full telemetry,
 * plus a pose-only record per remote aircraft taken at the same instant (#646). Each client
 * records what it saw, so the track survives a peer leaving before the room ends.
 */
export class RoomReplayRecorder extends ReplayRecorder {
  /**
   * @param {object} metadata sortie metadata, as for a solo track
   * @param {{name: string, aircraft: string, slot: number}[]} pilots remote pilots, in the
   *   order `update()` receives their samples for the whole room
   */
  start(metadata, pilots = []) {
    super.start({ ...metadata, remotes: pilots.map(pilot => ({ ...pilot })) });
    this.remoteCount = pilots.length;
    this.localSegment = {};
    this.remoteSegments = pilots.map(() => ({}));
    this.frame = null;
    this.trimmed = false;
  }

  /**
   * @param {{segment?: *, remotes?: (object|null)[]}} [room] `segment` changes on every local
   *   respawn or restart; each remote entry is an interpolated snapshot, or null while unseen
   */
  update(dt, telemetry, quaternion, { segment = 0, remotes = [] } = {}) {
    this.frame = { segment, remotes };
    super.update(dt, telemetry, quaternion);
    this.frame = null;
  }

  _observe(telemetry, quaternion) {
    const sample = super._observe(telemetry, quaternion);
    sample.segment = advanceSegment(this.localSegment, this.frame?.segment);
    sample.remotes = this.remoteSegments.map((state, index) => observeRemote(this.frame?.remotes?.[index], state));
    return sample;
  }

  capacity() {
    return maxSamplesFor(this.maxBase64Bytes, this.metadataBytes, this.remoteCount);
  }

  /** A room can outlast the coarsest rung; it keeps the most recent frames instead of refusing. */
  _append(sample) {
    if (this.samples.length >= this.capacity() && this.interval >= REPLAY_INTERVAL_LADDER.at(-1)) {
      this.samples.shift();
      this.samples.push(sample);
      this.trimmed = true;
      return;
    }
    super._append(sample);
  }

  finish() {
    if (this.track) return this.track;
    const track = super.finish();
    if (!track) return null;
    // A trimmed room starts mid-flight; playback still starts at zero.
    if (this.trimmed) {
      const offset = track.samples[0].timeSec;
      for (const sample of track.samples) sample.timeSec -= offset;
      track.durationSec -= offset;
    }
    track.remotes = track.metadata.remotes.map((pilot, index) => ({ ...pilot,
      samples: track.samples.map(sample => ({ timeSec: sample.timeSec, ...sample.remotes[index] })) }));
    for (const sample of track.samples) delete sample.remotes;
    return track;
  }
}

/** Counts key changes, so a respawn is a segment boundary however the caller names it. */
function advanceSegment(state, key) {
  if (!('key' in state)) { state.key = key; state.segment = 0; }
  else if (key !== state.key) { state.key = key; state.segment++; }
  return state.segment;
}

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

/** A `RemoteTrack.sample()` result: the pose this client actually showed for that pilot. */
function observeRemote(remote, state) {
  if (!remote || !finiteArray(remote.p, 3) || !finiteArray(remote.q, 4)) {
    return { visible: false, crashed: false, held: false, stale: false, segment: state.segment ?? 0 };
  }
  return {
    visible: true,
    x: remote.p[0], y: remote.p[1], z: remote.p[2],
    quat: [...remote.q],
    gearState: Number.isFinite(remote.gear) ? remote.gear : 0,
    flapDegree: Number.isFinite(remote.flaps) ? remote.flaps : 0,
    crashed: remote.crashed === true,
    held: remote.held === true,
    stale: remote.stale === true,
    segment: advanceSegment(state, `${remote.round}:${remote.epoch}`),
  };
}
