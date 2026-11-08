/**
 * Flight3d PostHog Analytics and Crash Reporting
 *
 * Provides:
 * - Autocapture for menu interactions and DOM clicks
 * - Game-specific domain events (flight start, crash, completion, pilot mode change)
 * - Error tracking & WebGL context loss capture
 * - User feedback / bug report telemetry
 * - A bounded queue for events captured before the lazily imported SDK resolves
 * - Automatic analytics safely no-op when unconfigured; explicit reports require acknowledgement
 */

import { createFeedbackReport, deliverFeedbackReport, gatherFeedbackDiagnostics } from './feedbackReport.js';
import { inLanguage } from '../i18n/index.js';

let posthogInstance = null;
let initialized = false;
let initPromise = null;
let activeSim = null;

/**
 * Events are queued until `posthog.init` resolves because the SDK arrives through a dynamic
 * import, and a page-hide flush cannot wait for it. Bounded so a load that never initializes
 * (telemetry disabled, import failure) leaks nothing.
 */
export const PENDING_EVENT_CAP = 32;
let pendingEvents = [];

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
export const DEFAULT_POSTHOG_KEY = 'phc_ussf2qgryzxghWApkvG2kcpXarbF4nNGTNEnwCBy8VKj';

/** Read PostHog API key from environment, window, or URL query */
export function getPostHogConfig() {
  if (typeof window === 'undefined') {
    return { apiKey: '', host: DEFAULT_POSTHOG_HOST, enabled: false };
  }

  const urlParams = new URLSearchParams(window.location.search);
  const urlKey = urlParams.get('posthogKey');
  const urlHost = urlParams.get('posthogHost');
  let storedOptOut = false;
  try { storedOptOut = window.localStorage?.getItem('flight3d_telemetry_optout') === '1'; } catch { /* Restricted storage. */ }
  const disabled = urlParams.get('telemetry') === '0' || window.__POSTHOG_DISABLED__ === true || storedOptOut;

  const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_POSTHOG_KEY) || '';
  const envHost = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_POSTHOG_HOST) || DEFAULT_POSTHOG_HOST;

  const apiKey = (urlKey || window.__POSTHOG_KEY__ || envKey || DEFAULT_POSTHOG_KEY || '').trim();
  const host = (urlHost || window.__POSTHOG_HOST__ || envHost || DEFAULT_POSTHOG_HOST).trim();

  return {
    apiKey,
    host,
    enabled: Boolean(apiKey) && !disabled,
  };
}

/**
 * Initialize PostHog lazily in the browser.
 * Safe no-op if no key is configured or when running in test fixtures.
 */
export async function initAnalytics(sim = null) {
  if (sim) activeSim = sim;
  if (initialized) return posthogInstance;
  if (initPromise) return initPromise;

  const { apiKey, host, enabled } = getPostHogConfig();
  if (!enabled || typeof window === 'undefined') {
    initialized = true;
    // Opted out or unconfigured: hold nothing and send nothing.
    pendingEvents = [];
    return null;
  }

  initPromise = (async () => {
    try {
      const module = await import('posthog-js');
      const posthog = module.default ?? module;

      posthog.init(apiKey, {
        api_host: host,
        defaults: '2026-08-30',
        autocapture: true,
        capture_pageview: true,
        capture_pageleave: true,
        capture_performance: {
          network_timing: true,
          web_vitals: true,
          web_vitals_attribution: ['LCP', 'INP'],
        },
        disable_session_recording: false,
        // Disable high-frequency canvas video to preserve 60/120fps GPU performance
        record_canvas: false,
        persistence: 'localStorage+cookie',
        // Cohorts and person-level insights join on person profiles; the default
        // 'if_enabled' drops them, leaving behavioral cohorts unable to calculate.
        person_profiles: 'always',
        bootstrap: {
          distinctID: getOrCreateAnonymousId(),
        },
        loaded: (ph) => {
          ph.register({
            app: 'flight3d',
            buildVersion: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.version : 'dev',
            buildCommit: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.revision : 'dev',
            screenOrientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
            isTouchDevice: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
          });
        },
      });

      posthogInstance = posthog;
      initialized = true;
      drainPendingEvents();

      // Register global error listener
      window.addEventListener('error', event => {
        captureException(event.error || new Error(event.message || 'Unknown window error'), {
          source: 'window.onerror',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });

      window.addEventListener('unhandledrejection', event => {
        captureException(event.reason || new Error('Unhandled Promise rejection'), {
          source: 'unhandledrejection',
        });
      });

      return posthogInstance;
    } catch (err) {
      console.warn('[Analytics] Failed to initialize PostHog:', err);
      initialized = true;
      return null;
    }
  })();

  return initPromise;
}

/** Anonymous client ID cached in localStorage */
function getOrCreateAnonymousId() {
  const KEY = 'flight3d_client_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'usr_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anon_' + Date.now();
  }
}

/** Gather current simulator state metadata for tagging */
export function gatherFlightContext(sim = activeSim) {
  if (!sim) return {};
  try {
    const isMultiplayer = Boolean(sim.multiplayer?.active);
    const room = isMultiplayer ? sim.multiplayer?.room : null;
    const session = room?.session;
    return {
      aircraft: sim.currentAircraftId ?? null,
      airport: sim.activeAirport ?? null,
      scenario: sim.lastPresetType ?? sim.lobby?.preset ?? null,
      isCrashed: Boolean(sim.isCrashed),
      crashReason: sim.crashResult?.type ?? null,
      pilotMode: sim.lobby?.pilotMode ?? null,
      fps: Number.isFinite(sim.lastFrameDelta) && sim.lastFrameDelta > 0
        ? Math.round(1 / sim.lastFrameDelta) : null,
      flightDurationSec: sim.flightRecorder?.elapsed != null
        ? Number(sim.flightRecorder.elapsed.toFixed(1)) : null,
      isMultiplayer,
      multiplayerRole: room ? (room.host ? 'host' : 'guest') : null,
      multiplayerState: session?.state ?? null,
    };
  } catch {
    return {};
  }
}

/**
 * Capture through the SDK, or hold the event until it resolves. Keeping this path in one place
 * is what lets a `pagehide` startup trace survive a boot where the SDK import has not finished.
 */
function captureOrQueue(eventName, payload, options) {
  if (!posthogInstance) {
    if (pendingEvents.length >= PENDING_EVENT_CAP) pendingEvents.shift();
    pendingEvents.push({ eventName, payload, options });
    return;
  }
  try {
    posthogInstance.capture(eventName, payload, options);
  } catch (err) {
    console.debug('[Analytics] capture error:', err);
  }
}

function drainPendingEvents() {
  const queued = pendingEvents;
  pendingEvents = [];
  for (const event of queued) captureOrQueue(event.eventName, event.payload, event.options);
}

/**
 * Send an event without flight context. Use this for events that carry their own state, so a
 * startup trace is not tagged with whatever the simulator happened to be holding when it flushed.
 */
function sendEvent(eventName, properties = {}, options = {}) {
  captureOrQueue(eventName, { ...properties, clientTimeMs: Date.now() }, options);
}

/** Safe track event, tagged with the live simulator state */
export function trackEvent(eventName, properties = {}, options = {}) {
  sendEvent(eventName, { ...gatherFlightContext(), ...properties }, options);
}

/** Capture exceptions with game context */
export function captureException(error, additionalContext = {}) {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  captureOrQueue('$exception', {
    $exception_message: errorObj.message,
    $exception_type: errorObj.name || 'Error',
    $exception_stack_trace_raw: errorObj.stack || '',
    ...gatherFlightContext(),
    ...additionalContext,
    clientTimeMs: Date.now(),
  }, { send_instantly: true });
}

/** Track flight start */
export function trackFlightStart({ airport, aircraft, scenario, pilotMode, timeOfDay }) {
  trackEvent('flight_started', {
    airport,
    aircraft,
    scenario,
    pilotMode: pilotMode || 'human',
    timeOfDay,
  });
}

/** Track flight finish/stop */
export function trackFlightEnd({ airport, aircraft, scenario, reason, durationSeconds, score, gatesCleared }) {
  trackEvent('flight_ended', {
    airport,
    aircraft,
    scenario,
    endReason: reason,
    durationSeconds: durationSeconds != null ? Number(durationSeconds.toFixed(1)) : null,
    score: score ?? null,
    gatesCleared: gatesCleared ?? null,
  });
}

/**
 * Track one scored arena run. The runner, not the lobby preset, owns the attempt, so the
 * mission id is the scenario and the runner's verdict is the end reason.
 */
export function trackMissionEnd(record, { airport, aircraft } = {}) {
  if (!record) return;
  trackFlightEnd({
    airport,
    aircraft,
    scenario: record.manifest?.id ?? null,
    reason: record.status === 'succeeded' ? 'completed' : record.reason || record.status,
    durationSeconds: record.tick / 120,
    score: record.result?.metrics?.finalScore,
    gatesCleared: record.result?.metrics?.completedGates,
  });
}

/** Track aircraft impact / crash */
export function trackFlightCrash({ airport, aircraft, scenario, crashResult, speedKnots }) {
  trackEvent('flight_crashed', {
    airport,
    aircraft,
    scenario,
    crashType: crashResult?.type || 'UNKNOWN',
    // Crash names are localized getters; pin English so one crash is one breakdown value.
    crashName: inLanguage('en', () => crashResult?.name) || 'Crash',
    speedKnots: speedKnots != null ? Math.round(speedKnots) : null,
  });
}

/** Track pilot mode change in UI */
export function trackPilotModeChange(mode, missionId) {
  trackEvent('pilot_mode_selected', {
    pilotMode: mode,
    missionId,
  });
}

/**
 * Submit one scored attempt to the shared leaderboard feed. Read back by the
 * Pages build (scripts/build-leaderboard.mjs) into leaderboard.json, so the
 * browser never needs a write endpoint. Flat snake_case scalars keep the
 * HogQL side simple; identity rides on the anonymous distinct id.
 */
export function trackScoreSubmitted(attempt, { comparisonKeyHash = '', fingerprintHash = '' } = {}) {
  if (!attempt) return;
  trackEvent('score_submitted', {
    mission: attempt.conditions?.mission ?? null,
    rulesVersion: attempt.conditions?.rulesVersion ?? null,
    callsign: attempt.callsign,
    pilot_kind: attempt.pilotKind,
    score: attempt.metrics?.finalScore ?? null,
    duration_seconds: Number.isFinite(attempt.durationSeconds)
      ? Number(attempt.durationSeconds.toFixed(2)) : null,
    environment_seed: attempt.conditions?.environmentSeed ?? null,
    comparison_key_hash: comparisonKeyHash,
    fingerprint_hash: fingerprintHash,
    recorded_at: attempt.recordedAt,
  }, { send_instantly: true });
}

/** Track multiplayer room creation */
export function trackMultiplayerRoomCreated({ room, scenario, aircraft, airport, isPublic = false }) {
  trackEvent('multiplayer_room_created', {
    room,
    scenario,
    aircraft,
    airport,
    isPublic: Boolean(isPublic),
  });
}

/** Track multiplayer room join attempt */
export function trackMultiplayerRoomJoined({ room, method = 'code' }) {
  trackEvent('multiplayer_room_joined', {
    room,
    joinMethod: method,
  });
}

/** Track successful peer-to-peer connection */
export function trackMultiplayerConnected({ room, role, connectionDurationMs = null }) {
  trackEvent('multiplayer_connected', {
    room,
    role,
    connectionDurationMs: connectionDurationMs != null ? Math.round(connectionDurationMs) : null,
  });
}

/** Track multiplayer round start */
export function trackMultiplayerRoundStarted({ room, round, scenario, aircraft, airport }) {
  trackEvent('multiplayer_round_started', {
    room,
    round,
    scenario,
    aircraft,
    airport,
  });
}

/** Track multiplayer session end / disconnect */
export function trackMultiplayerSessionEnded({ room, role, reason, durationSeconds = null, roundsPlayed = 0 }) {
  trackEvent('multiplayer_session_ended', {
    room,
    role,
    endReason: reason || 'unknown',
    durationSeconds: durationSeconds != null ? Number(durationSeconds.toFixed(1)) : null,
    roundsPlayed: Number(roundsPlayed) || 0,
  });
}

/** Track microphone / voice state changes */
export function trackMultiplayerVoiceToggled({ enabled, muted }) {
  trackEvent('multiplayer_voice_toggled', {
    voiceEnabled: Boolean(enabled),
    voiceMuted: Boolean(muted),
  });
}

/**
 * Track one startup load trace per page load. The report arrives already aggregated by
 * src/core/startupTrace.js: flat scalars for trending, per-asset-class buckets plus the
 * slowest/largest names as JSON properties. Sent without flight context: the trace describes
 * the boot, and the simulator may already have moved on by the time it flushes.
 */
export function trackStartupTrace(report) {
  if (!report) return;
  const top = report.blocking ?? report.slowest?.[0] ?? null;
  const latency = (cls, field) => (report.classes?.[cls]?.count ? report.classes[cls][field] : null);
  const payload = {
    ...report,
    slowestAsset: top?.name ?? null,
    slowestAssetDurationMs: top?.duration ?? null,
    glbMaxLatencyMs: latency('glb', 'maxMs'),
    glbTotalLatencyMs: latency('glb', 'totalMs'),
    binMaxLatencyMs: latency('bin', 'maxMs'),
    textureMaxLatencyMs: latency('texture', 'maxMs'),
    audioMaxLatencyMs: latency('audio', 'maxMs'),
  };
  sendEvent('startup_trace', payload, { send_instantly: true });
}

/** Separate from common analytics tags so detailed samples are sent only by request. */
export function gatherUserFeedbackContext(sim = activeSim) {
  const browser = typeof navigator !== 'undefined' ? navigator : {};
  return { ...gatherFlightContext(sim), ...gatherFeedbackDiagnostics(sim),
    userAgent: browser.userAgent ?? null, platform: browser.platform ?? null,
    maxTouchPoints: browser.maxTouchPoints ?? 0, braveApiAvailable: Boolean(browser.brave),
    pageUrl: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : null,
    viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : null,
  };
}

/** Capture now, rather than after an SDK load or a later retry. */
export function prepareUserFeedback({ message, contact = '', category = 'bug', includeContext = true, context, sim = activeSim }) {
  return createFeedbackReport({ message, contact, category,
    context: includeContext ? (context ?? gatherUserFeedbackContext(sim)) : {},
  });
}

/** User-requested report; never enable automatic telemetry as a side effect. */
export async function sendUserFeedback(options) {
  const report = options.report ?? prepareUserFeedback(options);
  const { apiKey, host } = getPostHogConfig();
  let distinctId;
  try { distinctId = posthogInstance?.get_distinct_id?.(); } catch { /* SDK unavailable. */ }
  return deliverFeedbackReport(report, { apiKey, host,
    distinctId: distinctId || getOrCreateAnonymousId() });
}

/** For tests: inject mock or reset state */
export function _resetAnalyticsForTesting(instance = null) {
  posthogInstance = instance;
  initialized = Boolean(instance);
  initPromise = null;
  activeSim = null;
  // An injected instance plays the role of `posthog.init` resolving, so whatever queued before
  // it must arrive; resetting to null is teardown, and queued events go with it.
  if (instance) drainPendingEvents();
  else pendingEvents = [];
}
