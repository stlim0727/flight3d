import { HeadPoseDetector } from './HeadPoseDetector.js';

/**
 * MobileHeadTracking — webcam face tracking for CameraSystem head views.
 *
 * Requests the device camera only when explicitly enabled (user gesture),
 * detects a face at a throttled rate, and feeds yaw/pitch into the dedicated
 * head-look channel on CameraSystem. Detection assets load lazily on enable.
 */
export class MobileHeadTracking {
  /**
   * @param {import('./CameraSystem.js').CameraSystem} cameraSystem
   * @param {Object} [options]
   *   - detectIntervalMs: detection cadence (default 83 ms ≈ 12 Hz)
   *   - videoWidth / videoHeight: ideal capture size (default 640x480)
   *   - facingMode: 'user' | 'environment' (default 'user')
   *   - onStatusChange: callback(message)
   */
  constructor(cameraSystem, options = {}) {
    if (!cameraSystem) throw new Error('MobileHeadTracking needs a CameraSystem');
    this.cameraSystem = cameraSystem;
    this.detectIntervalMs = options.detectIntervalMs ?? 83;
    this.videoWidth = options.videoWidth ?? 640;
    this.videoHeight = options.videoHeight ?? 480;
    this.facingMode = options.facingMode || 'user';
    this.onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : null;

    this.detector = null;
    this.video = null;
    this.stream = null;
    this.state = 'idle';
    this.message = 'Head tracking off';
    this.lastPose = { detected: false, yaw: 0, pitch: 0, confidence: 0, bbox: null };
    this.lastDetect = 0;
  }

  getStatus() {
    return {
      state: this.state,
      message: this.message,
      detected: this.lastPose.detected,
      confidence: this.lastPose.confidence,
      delegate: this.detector?.activeDelegate || null,
      calibration: this.detector ? this.detector.getCalibration() : null,
    };
  }

  _setStatus(state, message) {
    this.state = state;
    this.message = message;
    if (this.onStatusChange) this.onStatusChange(this.getStatus());
  }

  get isEnabled() {
    return this.state === 'active' || this.state === 'requesting' || this.state === 'loading';
  }

  /** Request camera permission and load the detector. Must be called from a user gesture. */
  async enable() {
    if (this.isEnabled) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this._setStatus('error', 'Camera API unavailable — use HTTPS or a supported browser');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      this._setStatus('error', 'Camera needs HTTPS (or localhost)');
      return;
    }

    this._setStatus('requesting', 'Requesting camera permission…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.facingMode,
          width: { ideal: this.videoWidth },
          height: { ideal: this.videoHeight },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      this.video = document.createElement('video');
      this.video.srcObject = this.stream;
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.autoplay = true;
      this.video.setAttribute('style', 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;');
      document.body.appendChild(this.video);
      await this.video.play();

      this._setStatus('loading', 'Loading face detector…');
      this.detector = await HeadPoseDetector.create();

      this.cameraSystem.setHeadTrackingEnabled(true);
      this.lastDetect = 0;
      this._setStatus('active', 'Head tracking on — looking for a face');
    } catch (err) {
      this.disable();
      this._setStatus('error', `Head tracking failed: ${err?.message || err}`);
    }
  }

  disable() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    if (this.detector) {
      this.detector.dispose();
      this.detector = null;
    }
    this.cameraSystem.setHeadTrackingEnabled(false);
    this.lastPose = { detected: false, yaw: 0, pitch: 0, confidence: 0, bbox: null };
    if (this.state !== 'error') this._setStatus('idle', 'Head tracking off');
  }

  toggle() {
    if (this.isEnabled) this.disable();
    else return this.enable();
    return Promise.resolve();
  }

  /** Zero yaw/pitch at the current face position. */
  reset() {
    if (!this.detector) return false;
    const ok = this.detector.reset();
    this.cameraSystem.resetHeadLook();
    this._setStatus(this.state, ok ? 'Neutral set to current head position' : 'No face detected — cannot reset');
    return ok;
  }

  /** Use the recent dynamic face range as the full yaw/pitch range. */
  calibrate() {
    if (!this.detector) return false;
    const ok = this.detector.calibrate();
    this.cameraSystem.resetHeadLook();
    this._setStatus(this.state, ok ? 'Calibrated from recent head movement' : 'Move your head, then calibrate');
    return ok;
  }

  /** Call once per render frame. Detection is throttled; smoothing stays per-frame. */
  update(nowMs = performance.now()) {
    if (this.state !== 'active' || !this.detector || !this.video) return;
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return;
    if (nowMs - this.lastDetect < this.detectIntervalMs) return;
    this.lastDetect = nowMs;

    const pose = this.detector.detect(this.video, nowMs);
    this.lastPose = pose;
    if (pose.detected) {
      this.cameraSystem.setHeadLook(pose.yaw, pose.pitch);
    }
  }
}

export default MobileHeadTracking;
