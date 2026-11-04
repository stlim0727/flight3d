/**
 * Flight3d PostHog Analytics and Crash Reporting
 *
 * Provides:
 * - Autocapture for menu interactions and DOM clicks
 * - Game-specific domain events (flight start, crash, completion, pilot mode change)
 * - Error tracking & WebGL context loss capture
 * - User feedback / bug report telemetry
 * - Zero-overhead / safe no-op when unconfigured or in tests
 */

let posthogInstance = null;
let initialized = false;
let initPromise = null;
let activeSim = null;

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
  const disabled = urlParams.get('telemetry') === '0' ||
    window.__POSTHOG_DISABLED__ === true ||
    window.localStorage?.getItem('flight3d_telemetry_optout') === '1';

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
    return {
      aircraft: sim.currentAircraftId ?? null,
      airport: sim.activeAirport ?? null,
      scenario: sim.lastPresetType ?? sim.lobby?.preset ?? null,
      isCrashed: Boolean(sim.isCrashed),
      crashReason: sim.crashResult?.type ?? null,
      pilotMode: sim.lobby?.pilotMode ?? null,
      fps: Number.isFinite(sim.lastFrameDelta) && sim.lastFrameDelta > 0
        ? Math.round(1 / sim.lastFrameDelta) : null,
      flightDurationSec: sim.flightRecorder?.elapsedSeconds != null
        ? Number(sim.flightRecorder.elapsedSeconds.toFixed(1)) : null,
    };
  } catch {
    return {};
  }
}

/** Safe track event */
export function trackEvent(eventName, properties = {}, options = {}) {
  if (!posthogInstance) return;
  try {
    posthogInstance.capture(eventName, {
      ...gatherFlightContext(),
      ...properties,
      timestamp: Date.now(),
    }, options);
  } catch (err) {
    console.debug('[Analytics] capture error:', err);
  }
}

/** Capture exceptions with game context */
export function captureException(error, additionalContext = {}) {
  if (!posthogInstance) return;
  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    posthogInstance.capture('$exception', {
      $exception_message: errorObj.message,
      $exception_type: errorObj.name || 'Error',
      $exception_stack_trace_raw: errorObj.stack || '',
      ...gatherFlightContext(),
      ...additionalContext,
    }, { send_instantly: true });
  } catch (err) {
    console.debug('[Analytics] exception capture error:', err);
  }
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

/** Track aircraft impact / crash */
export function trackFlightCrash({ airport, aircraft, scenario, crashResult, speedKnots }) {
  trackEvent('flight_crashed', {
    airport,
    aircraft,
    scenario,
    crashType: crashResult?.type || 'UNKNOWN',
    crashName: crashResult?.name || 'Crash',
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
 * Track one startup load trace per page load. The report arrives already aggregated by
 * src/core/startupTrace.js: flat scalars for trending, per-asset-class buckets plus the
 * slowest/largest names as JSON properties.
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
  trackEvent('startup_trace', payload, { send_instantly: true });
}

/**
 * Track an individual resource loading latency measurement.
 * Useful for runtime dynamic asset fetching (e.g. aircraft swap, scenery kit, sound effects).
 */
export function trackResourceLatency({ name, durationMs, type = 'other', sizeBytes = null, cached = false }) {
  if (!name || !Number.isFinite(durationMs)) return;
  trackEvent('resource_loaded', {
    resource_name: name,
    resource_duration_ms: Math.round(durationMs),
    resource_type: type,
    resource_size_bytes: sizeBytes != null ? Math.round(sizeBytes) : null,
    resource_cached: Boolean(cached),
  });
}

/** Submit user bug report or feedback */
export async function sendUserFeedback({ message, contact = '', category = 'bug', includeContext = true, context = {} }) {
  if (!posthogInstance && !initialized) {
    try {
      await initAnalytics();
    } catch {
      // safe no-op on load failure
    }
  }

  const payload = {
    feedback_message: message,
    feedback_contact: contact,
    feedback_category: category,
    ...(includeContext ? gatherFlightContext() : {}),
    ...context,
  };

  trackEvent('user_feedback_submitted', payload, { send_instantly: true });
  trackEvent('$feedback', {
    $feedback_text: message,
    $feedback_category: category,
    $feedback_contact: contact,
    ...payload,
  }, { send_instantly: true });

  try {
    if (typeof posthogInstance?.flush === 'function') {
      posthogInstance.flush();
    }
  } catch {
    // ignore flush errors
  }
}

/** For tests: inject mock or reset state */
export function _resetAnalyticsForTesting(instance = null) {
  posthogInstance = instance;
  initialized = Boolean(instance);
  initPromise = null;
  activeSim = null;
}
