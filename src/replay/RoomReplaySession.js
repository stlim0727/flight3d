import { RoomReplayRecorder } from '../core/RoomReplayRecorder.js';

/** Local monotonic room clock. It observes poses; it never advances flight physics. */
export class RoomReplaySession {
  constructor(store, { now = () => performance.now(), recorder = new RoomReplayRecorder(), onSaved = () => {} } = {}) {
    this.store = store;
    this.now = now;
    this.recorder = recorder;
    this.onSaved = onSaved;
    this.active = false;
  }

  start(metadata, pilots) {
    if (this.active) return; // Restarting a round keeps the same room recording.
    this.startedAt = this.now();
    this.previousAt = this.startedAt;
    this.lastObservation = null;
    this.recorder.start({ ...metadata, room: { ...metadata.room, timeline: [] } }, pilots);
    this.active = true;
  }

  observe(observation) {
    if (!this.active) return;
    const at = this.now();
    if (!Number.isFinite(at) || at <= this.previousAt) return;
    // A suspended frame loop supplies no observations. Mark that interval explicitly;
    // never integrate a large dt into invented motion after the tab resumes.
    if (this.lastObservation && at - this.previousAt > 500) this.gap();
    const dt = (at - this.previousAt) / 1000;
    this.previousAt = at;
    const { telemetry, quaternion, ...room } = observation;
    const validBefore = this.recorder.validDuration;
    this.recorder.update(dt, telemetry, quaternion, room);
    if (dt > 0.5 && this.recorder.validDuration > validBefore) this.recorder.validDuration -= dt - 0.2;
    this.lastObservation = observation;
  }

  gap() {
    if (!this.active) return;
    const timeline = this.recorder.timeline;
    const last = timeline.at(-1);
    if (!last) return;
    const states = last.states.map(state => ({ ...state, visible: false, held: true }));
    if (JSON.stringify(last.states) !== JSON.stringify(states)) {
      timeline.push({ timeSec: this.recorder.elapsed, states });
      this.recorder._boundTimeline();
    }
  }

  finish(reason) {
    if (!this.active) return null;
    // End callbacks may arrive after RemoteTrack.clear(); keep the last observed poses.
    // Mark the unobserved tail instead of fabricating a final snapshot.
    const at = this.now();
    if (at > this.previousAt) {
      if (at - this.previousAt > 500) this.gap();
      this.recorder.elapsed = (at - this.startedAt) / 1000;
    }
    this.active = false;
    const track = this.recorder.finish();
    if (!track) return null;
    track.metadata.room.endReason = String(reason).slice(0, 32);
    const result = this.store.saveRoomAuto(track);
    this.onSaved(result);
    return result;
  }
}
