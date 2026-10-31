# Local pilot missions (Discussion #356)

This implements the local, trusted-code portion of the v6 plan in
[Discussion #356](https://github.com/stlim0727/flight3d/discussions/356).
It is unranked. A native Worker is not a hostile-code security sandbox.
Community uploads, server scoring, physiological impairment and visual object
recognition are not enabled.

## Run the physics sweep

Use Node 22.23.2 and `npm ci`, then `npm run test:pilot`. The sweep runs the
production 120 Hz integrator, controls, aerodynamics, engines, gear contacts,
terrain sampling and collision policy without a renderer. Each pilot runs at
5 Hz with exactly 24 physics ticks between observation and command application.
No GPU or software rendering is involved. UI, particles, audio and asset loading
are omitted; physics is not replaced by a second simplified engine.

Default cases are takeoff and landing with mild wind, correlated sensor errors,
and seeds 1–5. Any non-success makes the command fail. The cases and their
thresholds are fixed before evaluating pilots. Available controls:

```sh
PILOT_PROFILE=calm-debug-v1 PILOT_SENSOR_NOISE=0 npm run test:pilot
PILOT_MISSION=landing PILOT_SEEDS=1,2,3,4,5 npm run test:pilot
PILOT_REPORT=/tmp/pilot-report.json npm run test:pilot
```

`PILOT_PROFILE` can be `calm-debug-v1` or `mild-disturbance-v1`.
Sensor noise is controlled separately in this CLI to permit the four
wind/noise on/off diagnostic combinations. The browser's calm option defaults
to sensor noise off; mild defaults to on. In addition to the sweep, `npm test`
covers exact deadlines, first-contact anchoring, bounce, stop hold, malformed
snapshots, lifecycle cancellation and isolated-thread watchdog behavior.

The supplied examples passed both missions on mild-wind/noisy seeds 1–5 and
the calm/no-noise baseline. See [the acceptance report](pilot-mission-acceptance.json).
Manifests identify this limited calibration as `limited-training-suite-v1`;
it does not certify arbitrary seeds, aircraft, weather or real-aircraft behavior.
A separate integration test runs both missions through the actual isolated
JavaScript-thread pilot runtime and asynchronous runner, with production physics.
The standalone sweep evaluates synchronous SDK hooks; it does not itself test
the Worker transport. A passing logic suite/build alone is not a flight sweep.

## Opt-in browser laboratory

Start Vite and open `/?pilotArena=1`. Choose a mission, wind profile and seed,
load an example or a trusted local `.js` file, and run it. Nothing is uploaded.
The expandable panel includes an editor, result metrics, a 2D runway trace and
downloadable run data. Ordinary game URLs keep their existing behavior.

The first version aborts on pause/menu, external aircraft/preset/airport change
or explicit manual takeover. It does not preserve guest state across pause.
Starting a mission replaces the current flight with a coastal B738 scenario.
Mission preparation calls explicitly identify themselves so they do not trigger
the external-change cancellation path. While active, the asynchronous runner
owns physics advancement; the animation loop continues rendering and does not
also integrate physics.

One frame is yielded per decision interval, so this laboratory is fast-play
rather than guaranteed real time. The displayed clock is simulation time.
Worker wait consumes wall time only. Prepared controls are held during the
initial 24-tick delay. Mission failure is terminal; subsequent visual behavior
cannot turn it into success.

## Pilot API

```js
export function createPilot(api) {
  return {
    reset(briefing) {},
    onTick(observation) {
      return { elevator: 0, aileron: 0, rudder: 0, throttle: 0.5, brakes: 0 };
    }
  };
}
```

Hooks are synchronous. Pilot state persists in the instance. Every run starts
a new instance; asynchronous hooks and external imports are unsupported.
`api.random()` is a deterministic guest stream, independent of hidden sensor
and environment seeds; `api.log()` is bounded. Runtime/startup faults terminate
the Worker. All five axes are required and finite; surface axes use -1..1 and
throttle/brakes 0..1. Validation is atomic. Existing physical response limits
remain in the control path.

`PilotPerception.js` defines the allowlisted flat host-snapshot contract and
sensor units. Available observations are instruments, training-navigation
deviations, actuator feedback and debounced weight-on-wheels. Continuous values
use `{status, mean, std, sampleTick}`; unavailable values have null mean/std.
Navigation deviations are explicit training equipment, not synthetic vision.
No raw simulator objects, world coordinates, hidden seeds or exact mission state
are passed to the pilot. Visual contacts are disabled.

Gear, flaps, trim, spoilers and reversers are fixed by the mission. Activating
another controller or changing that configuration ends the run. Throttle is
explicitly retained on release, while surface virtual targets and brakes are
released; this is a deterministic handover policy, not an automatic safe landing.

## Validation boundaries

The rendererless sweep validates implemented numerical flight behavior, not
real-aircraft fidelity or the browser panel's visual layout. Worker scheduling
and timeout behavior have separate tests. Following the user's direction, GPU
rendering is not an acceptance dependency for this physics/algorithm feature.
The browser UI remains opt-in until its interaction and layout have been checked.

Future work: validate additional scenarios and held-out seeds, restricted guest
runtime, authoritative evaluation, configurable physiology and visual contacts.
See [pilot wind](pilot-wind.md) for the physical-disturbance audit and model.
