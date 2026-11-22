// Vite exposes BASE_URL at build time (e.g. /flight3d/ on GitHub Pages); the
// raw demo server has no import.meta.env, so fall back to the site root.
const moduleEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const assetBase = (moduleEnv.BASE_URL || '/').replace(/\/?$/, '/');
function assetUrl(relativePath) {
  return assetBase + relativePath.replace(/^\//, '');
}

// The prebuilt MediaPipe bundle must load as a plain public asset. Wrapping the
// dynamic import keeps Vite from rewriting it to vision_bundle.mjs?import.
const importAsset = new Function('url', 'return import(url)');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * HeadPoseDetector — face detection and head-pose estimation for cameraSystem.
 *
 * Uses MediaPipe Tasks Vision (FaceDetector / BlazeFace) to locate a face in a
 * video frame, then maps face position to yaw/pitch with a neutral point and
 * calibrated dynamic range. Assets load lazily from the site base path.
 *
 * Usage:
 *   const detector = await HeadPoseDetector.create();
 *   const pose = detector.detect(video, performance.now());
 *   if (pose.detected) cameraSystem.setHeadLook(pose.yaw, pose.pitch);
 */
export class HeadPoseDetector {
  /**
   * @param {Object} options
   *   - bundleUrl / wasmPath / modelPath: overrides for the MediaPipe assets
   *   - delegate: 'AUTO' (default), 'GPU' or 'CPU'
   *   - maxYaw / maxPitch: pose limits in radians
   *   - minDetectionConfidence: 0..1
   *   - calibrationWindowMs: recent samples used by calibrate() (default 3000)
   *   - minRange: minimum half-range as a fraction of frame (default 0.05)
   */
  constructor(options = {}) {
    this.bundleUrl = options.bundleUrl || assetUrl('mediapipe/vision_bundle.mjs');
    this.wasmPath = options.wasmPath || assetUrl('mediapipe/wasm');
    this.modelPath = options.modelPath || assetUrl('mediapipe/face_detector.tflite');
    this.delegate = options.delegate || 'AUTO';
    this.maxYaw = options.maxYaw ?? Math.PI * 0.5;
    this.maxPitch = options.maxPitch ?? Math.PI * 0.45;
    this.minDetectionConfidence = options.minDetectionConfidence ?? 0.5;
    this.calibrationWindowMs = options.calibrationWindowMs ?? 3000;
    this.minRange = options.minRange ?? 0.05;

    // Neutral face position (normalized 0..1) and half-range for full ±yaw/pitch.
    this.neutral = { x: 0.5, y: 0.5 };
    this.range = { x: 0.5, y: 0.5 };
    this.samples = [];

    this.faceDetector = null;
    this.lastTimestamp = -1;
    this.lastPose = { detected: false, yaw: 0, pitch: 0, confidence: 0, bbox: null };
  }

  /**
   * Load MediaPipe and create the face detector. Must be awaited before detect().
   * @param {Object} options - same keys as the constructor.
   */
  static async create(options = {}) {
    const detector = new HeadPoseDetector(options);
    const vision = await importAsset(detector.bundleUrl);
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(detector.wasmPath);
    const delegates = detector.delegate === 'GPU' ? ['GPU']
      : detector.delegate === 'CPU' ? ['CPU']
        : ['GPU', 'CPU'];
    let lastError = null;
    for (const delegate of delegates) {
      try {
        detector.faceDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: detector.modelPath,
            delegate,
          },
          runningMode: 'VIDEO',
          minFaceDetectionConfidence: detector.minDetectionConfidence,
        });
        detector.activeDelegate = delegate;
        return detector;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Could not create MediaPipe FaceDetector');
  }

  /**
   * Detect a face and estimate head pose from an image/canvas/video source.
   * @param {ImageSource} source - HTMLVideoElement, HTMLCanvasElement, ImageBitmap, etc.
   * @param {number} timestampMs - monotonically increasing timestamp in ms.
   * @returns {{detected:boolean, yaw:number, pitch:number, confidence:number, bbox:Object|null}}
   */
  detect(source, timestampMs = performance.now()) {
    if (!this.faceDetector) {
      return { ...this.lastPose, detected: false };
    }
    // MediaPipe requires strictly increasing timestamps for VIDEO mode.
    const ts = timestampMs > this.lastTimestamp ? timestampMs : this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    let result;
    try {
      result = this.faceDetector.detectForVideo(source, ts);
    } catch (err) {
      console.warn('[HeadPoseDetector] detection failed:', err.message);
      return { ...this.lastPose, detected: false };
    }

    const detections = result?.detections || [];
    if (detections.length === 0) {
      this.lastPose = { detected: false, yaw: this.lastPose.yaw, pitch: this.lastPose.pitch, confidence: 0, bbox: null };
      return { ...this.lastPose };
    }

    // Use the highest-confidence face. MediaPipe Tasks Vision puts the score
    // in categories[0].score and the box in pixel coordinates (originX/originY).
    let best = detections[0];
    let bestScore = best.categories?.[0]?.score ?? best.score ?? 0;
    for (let i = 1; i < detections.length; i++) {
      const score = detections[i].categories?.[0]?.score ?? detections[i].score ?? 0;
      if (score > bestScore) {
        best = detections[i];
        bestScore = score;
      }
    }

    const bbox = best.boundingBox;
    const srcWidth = source.videoWidth || source.width || 640;
    const srcHeight = source.videoHeight || source.height || 480;
    const xCenter = ((bbox.originX ?? 0) + (bbox.width ?? 0) / 2) / srcWidth;
    const yCenter = ((bbox.originY ?? 0) + (bbox.height ?? 0) / 2) / srcHeight;

    // Keep a sliding window of recent face positions for calibrate().
    this.samples.push({ t: ts, x: xCenter, y: yCenter });
    while (this.samples.length > 1 && this.samples[0].t < ts - this.calibrationWindowMs) {
      this.samples.shift();
    }

    // Neutral position maps to zero; the calibrated half-range maps to full ±yaw/pitch.
    const nx = (xCenter - this.neutral.x) / this.range.x;
    const ny = (yCenter - this.neutral.y) / this.range.y;
    const yaw = clamp(nx, -1, 1) * this.maxYaw;
    const pitch = clamp(-ny, -1, 1) * this.maxPitch;

    this.lastPose = {
      detected: true,
      yaw,
      pitch,
      confidence: bestScore,
      bbox: {
        x: xCenter,
        y: yCenter,
        width: (bbox.width ?? 0) / srcWidth,
        height: (bbox.height ?? 0) / srcHeight,
      },
    };
    return { ...this.lastPose };
  }

  /**
   * Return the active calibration and recent sample count.
   */
  getCalibration() {
    return {
      neutral: { ...this.neutral },
      range: { ...this.range },
      samples: this.samples.length,
    };
  }

  /**
   * Reset neutral to the most recently detected face position so it maps to
   * yaw/pitch zero. The dynamic range is unchanged.
   * @returns {boolean} true if a face was available.
   */
  reset() {
    if (!this.lastPose.detected || !this.lastPose.bbox) {
      return false;
    }
    this.neutral.x = this.lastPose.bbox.x;
    this.neutral.y = this.lastPose.bbox.y;
    this.samples.length = 0;
    return true;
  }

  /**
   * Calibrate from recent face positions: the midpoint of the observed
   * dynamic range becomes neutral, and the observed half-range maps to the
   * full ±yaw/pitch output. Requires at least two distinct samples.
   * @returns {boolean} true if calibration was applied.
   */
  calibrate() {
    if (this.samples.length < 2) {
      return false;
    }
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const s of this.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    this.neutral.x = (minX + maxX) / 2;
    this.neutral.y = (minY + maxY) / 2;
    this.range.x = Math.max(this.minRange, (maxX - minX) / 2);
    this.range.y = Math.max(this.minRange, (maxY - minY) / 2);
    return true;
  }

  dispose() {
    if (this.faceDetector) {
      this.faceDetector.close();
      this.faceDetector = null;
    }
  }
}

export default HeadPoseDetector;
