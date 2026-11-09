import * as THREE from 'three';
import { Atmosphere } from './Atmosphere.js';

const specificForce = new THREE.Vector3();
const cabinUp = new THREE.Vector3();
const midpoint = new THREE.Quaternion();

/** Step-averaged, unfiltered normal specific force at the instantaneous CG.
 * Includes contact constraint impulses; excludes a velocity rebase due only to
 * moving the CG reference. This is not a cockpit/seat sensor or a resultant G.
 */
export function normalLoadFactor(beforeVelocity, afterVelocity, beforeRotation, afterRotation, dt) {
  specificForce.copy(afterVelocity).sub(beforeVelocity).divideScalar(dt);
  specificForce.y += Atmosphere.G0;
  midpoint.copy(beforeRotation).slerp(afterRotation, 0.5);
  cabinUp.set(0, 1, 0).applyQuaternion(midpoint);
  return specificForce.dot(cabinUp) / Atmosphere.G0;
}

/**
 * Single-step 1st-order low-pass exponential moving average (EMA) filter.
 * Standard cutoff frequency 8.0 Hz filters out discrete solver spike noise (Δv / Δt)
 * while preserving valid structural aerodynamic / touchdown loads.
 *
 * @param {number} rawGz - Instantaneous normal specific force
 * @param {number|null} prevFilteredGz - Previous filtered output
 * @param {number} dt - Step duration in seconds
 * @param {number} [cutoffHz=8.0] - Cutoff frequency (FDR standard 5-10Hz, default 8.0Hz)
 * @returns {number} Filtered normal specific force
 */
export function filterGForce(rawGz, prevFilteredGz, dt, cutoffHz = 8.0) {
  if (!Number.isFinite(rawGz)) return prevFilteredGz ?? 1.0;
  if (!Number.isFinite(prevFilteredGz)) return rawGz;
  if (!Number.isFinite(dt) || dt <= 0) return prevFilteredGz;
  const rc = 1.0 / (2.0 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  return prevFilteredGz + (rawGz - prevFilteredGz) * alpha;
}

/**
 * Stateful 1st-order EMA Low-Pass Filter for normal G-load telemetry.
 */
export class GForceFilter {
  constructor(cutoffHz = 8.0) {
    this.cutoffHz = cutoffHz;
    this.filteredGz = null;
  }

  reset(initialG = null) {
    this.filteredGz = Number.isFinite(initialG) ? initialG : null;
  }

  update(rawGz, dt) {
    this.filteredGz = filterGForce(rawGz, this.filteredGz, dt, this.cutoffHz);
    return this.filteredGz;
  }
}

/**
 * Calculates the maximum moving average over a sustained duration window.
 * Filters out isolated 1-2 tick numerical spikes (<80ms) and computes the maximum
 * sustained structural load over a specified duration threshold (80~100ms).
 *
 * @param {Array<{timeSec: number, g: number, dt: number}>} samples
 * @param {number} windowStart - start time of analysis window (e.g. T_touchdown - 0.5s)
 * @param {number} windowEnd - end time of analysis window (e.g. T_touchdown + 2.5s)
 * @param {number} [durationThreshold=0.10] - sustained duration threshold (default 0.10s / 100ms)
 * @returns {number} Maximum sustained average G-force in window
 */
export function calculateSustainedPeak(samples, windowStart, windowEnd, durationThreshold = 0.10) {
  if (!Array.isArray(samples) || samples.length === 0) return 1.0;

  // Filter samples that fall within [windowStart, windowEnd]
  const inWindow = samples.filter(s => s.timeSec >= windowStart - 1e-4 && s.timeSec <= windowEnd + 1e-4);
  if (inWindow.length === 0) return 1.0;

  let maxAvg = 1.0;
  let hasValidWindow = false;

  let windowDuration = 0;
  let windowWeightedG = 0;
  let left = 0;

  for (let right = 0; right < inWindow.length; right++) {
    const sRight = inWindow[right];
    const dtRight = sRight.dt ?? (right > 0 ? sRight.timeSec - inWindow[right - 1].timeSec : 1 / 120);
    windowDuration += dtRight;
    windowWeightedG += sRight.g * dtRight;

    // Shrink left side if window duration exceeds threshold
    while (left < right && windowDuration - (inWindow[left].dt ?? 1 / 120) >= durationThreshold) {
      const dtLeft = inWindow[left].dt ?? 1 / 120;
      windowDuration -= dtLeft;
      windowWeightedG -= inWindow[left].g * dtLeft;
      left++;
    }

    if (windowDuration >= durationThreshold * 0.90) {
      const avg = windowWeightedG / windowDuration;
      if (!hasValidWindow || avg > maxAvg) {
        maxAvg = avg;
        hasValidWindow = true;
      }
    }
  }

  if (!hasValidWindow) {
    let totalDt = 0;
    let sumG = 0;
    for (const s of inWindow) {
      const dt = s.dt ?? (1 / 120);
      totalDt += dt;
      sumG += s.g * dt;
    }
    return totalDt > 0 ? sumG / totalDt : inWindow[0].g;
  }

  return maxAvg;
}

/**
 * Touchdown G-Force Analyzer.
 * Manages the 3.0s analysis window (T_touchdown - 0.5s ~ T_touchdown + 2.5s)
 * and sustained peak verification (80-100ms moving average) triggered by
 * Weight On Wheels (WOW).
 */
export class TouchdownGAnalyzer {
  constructor({
    leadSec = 0.5,
    trailSec = 2.5,
    durationThreshold = 0.10,
    historySec = 5.0
  } = {}) {
    this.leadSec = leadSec;
    this.trailSec = trailSec;
    this.durationThreshold = durationThreshold;
    this.historySec = historySec;
    this.samples = [];
    this.activeTouchdowns = [];
  }

  reset() {
    this.samples = [];
    this.activeTouchdowns = [];
  }

  recordSample(timeSec, g, dt) {
    if (!Number.isFinite(timeSec) || !Number.isFinite(g) || !Number.isFinite(dt) || dt <= 0) return;
    this.samples.push({ timeSec, g, dt });
    const cutoff = timeSec - this.historySec;
    const earliestActive = this.activeTouchdowns.length > 0
      ? Math.min(...this.activeTouchdowns.map(t => t.windowStart))
      : Infinity;
    const effectiveCutoff = Math.min(cutoff, earliestActive);
    while (this.samples.length > 0 && this.samples[0].timeSec < effectiveCutoff) {
      this.samples.shift();
    }
  }

  triggerTouchdown(timeSec, initialG = 1.0) {
    const td = {
      tTouchdown: timeSec,
      windowStart: timeSec - this.leadSec,
      windowEnd: timeSec + this.trailSec,
      peakG: initialG,
      finalized: false
    };
    this.activeTouchdowns.push(td);
    td.peakG = this.evaluateTouchdown(td, timeSec);
    return td;
  }

  evaluateTouchdown(td, currentTimeSec) {
    const windowEnd = Math.min(td.windowEnd, currentTimeSec);
    const peak = calculateSustainedPeak(this.samples, td.windowStart, windowEnd, this.durationThreshold);
    td.peakG = Math.max(td.peakG, peak);
    if (currentTimeSec >= td.windowEnd) {
      td.finalized = true;
    }
    return td.peakG;
  }

  update(timeSec) {
    for (const td of this.activeTouchdowns) {
      if (!td.finalized) {
        this.evaluateTouchdown(td, timeSec);
      }
    }
    this.activeTouchdowns = this.activeTouchdowns.filter(td => timeSec <= td.windowEnd + 1.0);
  }
}
