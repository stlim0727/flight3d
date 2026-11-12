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
    this.timeline = [];
  }

  /**
   * @param {{segment?: *, remotes?: (object|null)[]}} [room] `segment` changes on every local
   *   respawn or restart; each remote entry is an interpolated snapshot, or null while unseen
   */
  update(dt, telemetry, quaternion, { segment = 0, remotes = [], local = {}, round = 1 } = {}) {
    this.frame = { segment, remotes, local, round };
    super.update(dt, telemetry, quaternion);
    this.frame = null;
  }

  _observe(telemetry, quaternion) {
    const sample = super._observe(telemetry, quaternion);
    sample.segment = advanceSegment(this.localSegment, this.frame?.segment);
    sample.remotes = this.remoteSegments.map((state, index) => observeRemote(this.frame?.remotes?.[index], state));
    // State transitions are independent of pose thinning. Task 3 can seek directly into a
    // crash, hold or observation gap without replaying every preceding frame.
    if (this.metadata.room) {
      this.metadata.room.rounds = Math.max(this.metadata.room.rounds ?? 0, this.frame?.round ?? 1);
      const local = this.frame?.local ?? {};
      const states = [{ visible: local.visible !== false, held: local.held === true,
        crashed: local.crashed === true, stale: false, segment: sample.segment,
        ...(local.crashed ? { crash: local.crash ?? { type: 'unknown' } } : {}) },
      ...sample.remotes.map(({ visible, held, crashed, stale, segment }) =>
        ({ visible: visible && !stale, held, crashed, stale, segment, ...(crashed ? { crash: { type: 'unknown' } } : {}) }))];
      if (JSON.stringify(states) !== JSON.stringify(this.timeline.at(-1)?.states)) {
        this.timeline.push({ timeSec: sample.timeSec, states });
      }
      this._boundTimeline();
    }
    return sample;
  }

  _boundTimeline() {
    // Reserve at most a quarter of the binary budget for transition history. If state
    // changes alone fill it, shorten the retained window instead of dropping its events.
    const budget = Math.min(16_000, this.maxBase64Bytes * 3 / 16);
    while (this.timeline.length > 1 && new TextEncoder().encode(JSON.stringify(this.timeline)).length > budget) {
      this.timeline.shift();
      this.samples = this.samples.filter(sample => sample.timeSec >= this.timeline[0].timeSec);
      this.trimmed = true;
    }
    this.metadata.room.timeline = this.timeline;
    this._measureMetadata();
  }

  capacity() {
    // Space for finalized duration, offset and end reason, added at finish.
    return maxSamplesFor(this.maxBase64Bytes, this.metadataBytes + (this.metadata.room ? 256 : 0), this.remoteCount);
  }

  /** A room can outlast the coarsest rung; it keeps the most recent frames instead of refusing. */
  _append(sample) {
    if (this.metadata.room) {
      while (this.samples.length >= this.capacity() && this.samples.length > 1) {
        if (this.interval < REPLAY_INTERVAL_LADDER.at(-1)) {
          this.samples = this.samples.filter((_, index) => index % 2 === 0);
          this.interval *= 2;
        } else { this.samples.shift(); this.trimmed = true; }
      }
      this.samples.push(sample);
      // Retain the state at the beginning of the surviving pose window.
      while (this.timeline.length > 1 && this.timeline[1].timeSec <= this.samples[0].timeSec) this.timeline.shift();
      this._boundTimeline();
      return;
    }
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
    const offset = this.trimmed ? track.samples[0].timeSec : 0;
    if (track.metadata.room) {
      track.metadata.room = { ...track.metadata.room, partial: this.trimmed,
        sessionDurationSec: track.durationSec, startOffsetSec: offset,
        timeline: this.timeline.map(event => ({ ...event, timeSec: Math.max(0, event.timeSec - offset) })) };
    }
    // A trimmed room starts mid-flight; playback still starts at zero.
    if (this.trimmed) {
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
