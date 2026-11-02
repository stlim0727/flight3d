# Analytics, Crash Reporting, and User Feedback

Flight3d integrates [PostHog](https://posthog.com) for client-side product analytics, session replay, runtime error tracking, and in-game user feedback.

## Configuration

Telemetry is opt-in and safe no-op by default when no API key is configured.

| Environment Variable / Config | Description | Default |
| :--- | :--- | :--- |
| `VITE_POSTHOG_KEY` | PostHog Project API Key (`phc_...`) | `""` (disabled) |
| `VITE_POSTHOG_HOST` | PostHog API Host endpoint | `https://us.i.posthog.com` |
| `?posthogKey=<key>` | Runtime URL parameter override for debugging | None |
| `?telemetry=0` | Runtime URL parameter to disable telemetry | None |

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

3. **In-Game Bug Report Dialog**:
   - Available on the mission score overlay (`[data-score-report]`) and crash overlay (`#btn-crash-report`).
   - Automatically attaches anonymized flight telemetry (aircraft, scenario, crash reason, FPS, browser info).
