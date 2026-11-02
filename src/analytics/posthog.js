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

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

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

  const apiKey = (urlKey || window.__POSTHOG_KEY__ || envKey || '').trim();
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
        autocapture: true,
        capture_pageview: true,
        capture_pageleave: true,
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
export function trackEvent(eventName, properties = {}) {
  if (!posthogInstance) return;
  try {
    posthogInstance.capture(eventName, {
      ...gatherFlightContext(),
      ...properties,
      timestamp: Date.now(),
    });
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
    });
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

/** Submit user bug report or feedback */
export function sendUserFeedback({ message, contact = '', category = 'bug', includeContext = true, context = {} }) {
  const payload = {
    feedback_message: message,
    feedback_contact: contact,
    feedback_category: category,
    ...(includeContext ? gatherFlightContext() : {}),
    ...context,
  };
  trackEvent('user_feedback_submitted', payload);
}

/** For tests: inject mock or reset state */
export function _resetAnalyticsForTesting(instance = null) {
  posthogInstance = instance;
  initialized = Boolean(instance);
  initPromise = null;
  activeSim = null;
}
