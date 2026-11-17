# Headless flight systems

`FlightControlLaws`, `AutopilotController`, `FlightWarningsCore`, and
`gyroOrientation` can be imported in Node without browser globals. They do not
poll devices, register events, access storage, translate text, render, or play
sound. Each simulation must own its own instances.

## Control inputs

```js
const laws = new FlightControlLaws();
const inputs = laws.update({
  pitch: 0.2, roll: -0.1, yaw: 0, throttle: 0.7, brakes: 0,
  pitchTrim: 0, flapsDelta: 0, gearToggle: false, reverserToggle: false,
}, dt, telemetry.iasKnots, 'B738');
const result = physics.step(dt, inputs, environment);
```

Pitch/roll/yaw are -1..1 (positive nose up/right wing down/right yaw).
Throttle and brakes are absolute 0..1. Omitted throttle holds its current value;
omitted axes/brakes return toward neutral. `pitchTrim` is a signed trim rate
command, 1 = 1.5 degrees/second; output `pitchTrim` is the integrated angle.
Optional `throttleRate` ramps at 0.35/second. Supply finite axes and positive dt
in seconds. Toggle and flap delta commands are one-update pulses. `spoilers` is
an optional absolute 0..1 command. Outputs are plain physics input objects.

Defaults preserve calibrated virtual inputs without an additional deadzone or
curve. Configure `deadzoneStick`, `deadzoneRudder`, and `precisionCurve` for
unshaped analog inputs. The precision curve applies to F16/C172. `flapCount`
overrides the built-in B738/F16/C172 detent counts for another aircraft.

`FlightControls` extends the laws and collects browser/device inputs before
calling `updateSources(dt, iasKnots, aircraftId)`. This compatibility entry point
retains source precedence, keyboard/touch release rates, manual HOTAS curves,
autonomous control gating, parking-brake release and existing writable fields.
HOTAS device mapping uses the same exported `applyDeadzone` function. Gyro angle
math and screen metadata interpretation remain pure functions accepting explicit
values in `gyroOrientation.js`; permission and event handling stay in the UI.

Existing flap controls send detent changes to aerodynamics, which owns flap
travel. Existing brakes apply immediately and throttle axes set absolute power;
this refactor does not introduce new delays in those paths.

## Autopilot

`engage(mode, snapshot)` and `update(snapshot, dt)` accept the physics result
shape `{ telemetry, position, quaternion, linearVelocity }`. Vectors and unit
quaternions may be plain `{x,y,z}` / `{x,y,z,w}` objects. The pose is authoritative;
telemetry supplies IAS/TAS in knots, throttle and optional `airportKey` for APP.
World units are metres, +Y up, identity forward -Z. Captured altitude is feet,
VSI feet/minute and attitude degrees using the existing YXZ convention.

Flat telemetry inputs remain supported. `autopilotState(snapshot)` exports the
conversion for callers that need a flat snapshot. The controller returns its
borrowed `{ elevator, aileron, throttle }` buffer, overwritten on the next update.
Existing mode gates, trim feedforward and control gains are unchanged.

## Warnings

`FlightWarningsCore.update(dt, telemetry, terrainAheadSeconds = Infinity)` returns
`{ activeWarnings, gpwsCallout, stallWarning, overspeed, bankAngle,
terrainConflict }`. Ground contact is `telemetry.onGround`, and radio height is
`radioAltFt`. All existing warning profiles, priority and 0.8-second clear
hysteresis remain intact. `terrainConflictSeconds(position, velocity, terrain,
landing)` samples an injected `getHeight(x, z)` provider without renderer access.

`gpwsCallout` is null or a one-sample `{ altitudeFt, text }` crossing event for
B738. Crossing order, alert inhibition, duplicate suppression and rearming above
1000 ft match the existing audio logic. `activeWarnings` retains stable warning
ids and presentation metadata for existing consumers; generating strings has no
presentation side effects. `FlightWarnings` retains the old array return API.
`FlightAudio` uses the shared pure crossing detector at its existing update
cadence, preserving muted/paused playback behavior. Reset/configure clears the
core's warning and crossing history. Consumers should treat returned warnings as
read-only; copy snapshots when keeping historical records.

## Package ownership and updates

See the [core change guide](flightsim-core-change-guide.md) for ownership decisions,
examples, coordinated changes, and verification/release steps.

The implementation is owned by the independent public repository
[stlim0727/flightsim-core](https://github.com/stlim0727/flightsim-core), distributed
as the npm-compatible `@stlim0727/flightsim-core` package. Flight3d's package.json
and lockfile pin the full v0.1.0 commit over HTTPS. No submodule initialization,
registry credentials, or sibling checkout is needed for `npm ci`.

The package is initially distributed from GitHub, not npmjs.com. It has explicit
root/subpath exports, a math-only Three.js peer dependency, its own CI and tests,
and a packed-install check running all aircraft outside the source checkout.

The local physics/config/control-core modules are compatibility reexports;
change algorithms and aircraft parameters in flightsim-core, release a new
version, then update Flight3d's dependency commit and lockfile in a focused PR.
Preserve the HTTPS URL if npm normalizes it to a GitHub shorthand during update.
Run focused integration tests and Flight3d CI; browser-sensitive changes also
require the hardware GPU acceptance scenarios.

Airport/scenery data remains in Flight3d. The local AutopilotController adapter
injects `approachDeviation(airportKey, state)`. The standalone controller accepts
this callback through its constructor, and the package exports generic
`approachDeviation(approachGeometry, state)` math for other consumers. Without a
navigation callback APP stays armed; HDG/ALT/VS/SPD/PITCH remain available.
