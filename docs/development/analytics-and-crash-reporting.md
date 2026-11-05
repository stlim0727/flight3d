# Analytics, Crash Reporting, and User Feedback

Flight3d integrates [PostHog](https://posthog.com) for client-side product analytics, session replay, runtime error tracking, and in-game user feedback.

## Configuration

Telemetry is opt-in and safe no-op by default when no API key is configured.

| Environment Variable / Config | Description | Default |
| :--- | :--- | :--- |
| `VITE_POSTHOG_KEY` | PostHog Project API Key (`phc_...`) | Configured default (`phc_ussf...`) |
| `VITE_POSTHOG_HOST` | PostHog API Host endpoint | `https://eu.i.posthog.com` |
| `?posthogKey=<key>` | Runtime URL parameter override for debugging | None |
| `?posthogHost=<host>` | Runtime URL host override for debugging | None |
| `?telemetry=0` | Runtime URL parameter to disable telemetry | None |
| `window.__POSTHOG_KEY__` / `__POSTHOG_HOST__` | Build/hosting override, same precedence slot below the URL parameter | None |
| `window.__POSTHOG_DISABLED__` | Set `true` to force telemetry off regardless of key | None |
| `localStorage.flight3d_telemetry_optout` | Set to `'1'` to opt this browser out permanently | unset |

`?telemetry=0` and the opt-out key short-circuit `getPostHogConfig()`, so no observer is
installed and nothing is queued.

### GitHub Pages Deployment
To enable PostHog in production GitHub Actions builds:
Add `VITE_POSTHOG_KEY` as a GitHub Actions repository secret or variable.

## Performance & Privacy Architecture

1. **Zero-Overhead Physics & 60fps Rendering**:
   - `posthog-js` is loaded via dynamic `import()` asynchronously in the background (`requestIdleCallback`), never blocking initial canvas creation or WebGL shader compilation.
   - Canvas video recording is disabled (`record_canvas: false`) so 60/120Hz Three.js GPU rendering remains at native speeds without memory or GC overhead.
   - Session recording captures DOM interactions (button clicks, menu navigation, touch stick UI, dialogs).

2. **Domain Events**:
   - `flight_started`: airport, aircraft, scenario, pilot mode (human / AI), time of day.
   - `flight_crashed`: collision type (terrain, building, water), impact airspeed, scenario.
   - `flight_ended`: landing completion, duration, score, gates cleared.
   - `pilot_mode_selected`: tracks player preference between human control and AI autopilot.
   - `user_feedback_submitted`: in-game bug reports and comments with attached diagnostic state.
   - `startup_trace`: one boot timeline per page load (below).
   - `$exception`: raised through `captureException()`, with live simulator context attached.
   - Every event carries `clientTimeMs` (epoch ms, client clock). Do **not** add a `timestamp`
     property: PostHog already owns that column and a property with the same name shadows the
     server-received time in table views and HogQL filters.
   - Events sent before `posthog-js` finishes its dynamic import are held in a bounded queue
     (`PENDING_EVENT_CAP`, oldest dropped) and replayed on init, so a startup trace that fires
     during page hide is not silently discarded. When telemetry is disabled or unconfigured the
     queue is cleared instead, so an opted-out load sends nothing later.

### `startup_trace` (v2)

Collected by `src/ui/StartupLoadMonitor.js`, aggregated by the pure `src/core/startupTrace.js`
(`TRACE_VERSION = 2`), sent with `send_instantly` and **without** flight context — a boot that
never reached a cockpit has no meaningful `aircraft`/`airport`, and mixing the two populations was
the source of contradictory properties in v1.

Latency KPIs — use these for performance work:

| Field | Meaning |
| :--- | :--- |
| `lobbyReadyMs` | navigation start → the first `lobby-ready` or `fly` mark: the app is interactive. This is the number that should fall when the boot gets faster. |
| `fcpMs`, `navigation.firstContentfulPaintMs`, `navigation.largestContentfulPaintMs` | browser paint marks, independent of our own overlay. |
| `navigation.*` (`fetchStartMs`, `responseStartMs`, `domContentLoadedMs`, `loadMs`) | `PerformanceNavigationTiming`, i.e. what the network and HTML parse cost. |
| `boot.stagesMs` | per-stage durations from the boot `marks`, so a regression is attributable to a stage. |
| `assetMsBeforeReady`, `requestsBeforeReady`, `bytesBeforeReady` | the asset work done before the overlay lifted. |
| `slowest`, `largest`, `blocking` | top-N assets by duration / encoded size, and the single longest pre-ready asset. |
| `longTasks` | `{ count, totalMs, maxMs }` of blocking main-thread tasks during the boot. |

Funnel stages, **not** latency:

- `readyMs` is when the user happened to reach a cockpit. It includes lobby idle time, so a field
  median in the tens of seconds is expected and says nothing about boot speed. Chart it as
  "did this load reach a cockpit", never as a p50/p95 target.
- `firstFrameMs` and `cockpitStageMs` mark rendering milestones inside that funnel.

Outcome and completeness:

- `outcome`: `ready` \| `failed` \| `deadline` (no ready anchor by `HARD_DEADLINE_MS`) \|
  `never-ready` (a forced flush with no ready anchor). `readySource` is kept as-is for insight
  continuity, including `'never'`.
- `flushReason`: `settle` \| `pagehide` \| `hidden` \| `deadline` \| `failed`. Pre-ready loads
  flush on tab hide, which is what mobile does instead of `pagehide` before killing a tab.
- `bootId`: per-load id (`crypto.randomUUID`, random fallback). A load can emit at most one
  partial row (`flushReason` on `never-ready`) plus one final row; join them on `bootId` to see
  what each early flush missed. `$window_id` is **not** per-load — three field traces shared one —
  so it cannot substitute.
- Coverage of a row is measurable: `totals.requestsAfterReady`, `totals.bytesAfterReady`,
  `postReadyMs`.

Cold vs warm:

- `totals.transferBytes: 0` with a non-zero `encodedBodySize` means HTTP-cache hits, not a missing
  measurement: `cacheWarmRatio` (hits / sized requests, `null` when nothing was sizeable),
  `totals.cacheHitRequests`, `totals.sizeUnknownRequests`, and `documentCached`.
- `isOpaque` counts "size unavailable", which includes a *memory*-cache hit, not cross-origin:
  own-origin filtering runs first, so on GitHub Pages every surviving entry is same-origin. Treat
  `sizeUnknownRequests` as sizing gaps, not as third-party traffic.

Expected quirks in the data:

- `classes.audio.count: 0` is correct. `src/audio/FlightAudio.js` synthesises everything
  procedurally (`ctx.createBuffer`, oscillators); the only real fetch is
  `src/audio/DepartureRadio.js`, driven from `src/director/scenarios/IncheonDepartureScenario.js`
  long after `ready`.
- `backgroundBoot: true` means the load ran out of sight: the tab never became visible, or it became
  visible only after the overlay had lifted. Paint and LCP on such a row describe the reveal, not the
  boot. A load that was visible from install reports `false`.

Health query — the capture rate is the instrument for this whole feature. `events` has no `name`
column; group on `event` and read custom fields through `properties.<field>`:

```sql
SELECT event, count() FROM events
WHERE (event = '$pageview' OR event = 'startup_trace') AND timestamp > now() - INTERVAL 30 DAY
GROUP BY event
```

`startup_trace ÷ $pageview` should be ≥ 0.8. The v1 field data measured 6 ÷ 46 ≈ 0.13 over 24 h and
18 ÷ 86 ≈ 0.21 over 30 days (both verified against the EU project with the read-only key). Split by
`properties.outcome` before reading any percentile: `never-ready` rows carry `readyMs: null`, so an
average silently drops the loads this feature was added to capture.

3. **In-Game Bug Report Dialog**:
   - Available on the mission score overlay (`[data-score-report]`) and flight debrief (`#debrief-feedback`).
   - Automatically attaches anonymized flight telemetry (aircraft, scenario, crash reason, FPS, browser info).

## Built-in PostHog Dashboard

`scripts/lib/posthogDashboard.mjs` declares the "Flight3d Overview" dashboard (flights/day, outcomes, players by country world map, players by region and city table,
start→end funnel, breakdowns by aircraft/scenario/airport, pilot mode, crash types, duration, score,
boot-to-interactive and reached-a-cockpit timings broken down by `outcome`, feedback, exceptions).
Create or update it in PostHog (idempotent):

```sh
POSTHOG_PERSONAL_API_KEY=phx_... POSTHOG_PROJECT_ID=<id> npm run posthog:dashboard
npm run posthog:dashboard -- --dry-run   # list insights without calling the API
```

The personal API key needs `dashboard:write` and `insight:write` scopes. Set `POSTHOG_APP_HOST` for
US Cloud (`https://us.posthog.com`); the default is EU. Never commit the key. Query shapes were not
verified against a live project; check the first run's output.

The script adds an insight only when its **name** is not already on the dashboard, so renaming a tile
here leaves the old one in PostHog and editing a query under an existing name does nothing. Delete or
edit the stale tile in the UI after a rename.
