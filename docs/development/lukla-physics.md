# Lukla contact physics and demo acceptance

The demo is an entertainment circuit using the existing 737 geometry with an
explicit **43,000 kg** loading (configured empty mass plus approximately 1.6 t),
scaled rigid-body inertias, and unchanged aerodynamic coefficients, engine
rating, terrain, and tire friction coefficients. The takeoff banner names this
loading. Selecting a manual preset or another airport restores the default
66,000 kg configuration. This does not establish real 737 operating performance
or permission to operate at Lukla.

## Contact and damage

LandingGear evaluates each wheel before force integration using
`v_contact = v_CG + omega_world cross r_world`. The normal impact speed is
`max(0, -v_contact dot terrainNormal)`, so horizontal flight into an uphill
runway is an impact even when world vertical speed is zero. Nose-down rotation
can damage the nose gear even with zero CG descent.

The simulation's conservative failure envelope is 3.8 m/s for a main gear and
2.8 m/s for the nose gear, or geometric penetration beyond the 0.9 m strut stroke
plus 0.08 m numerical allowance. These are **simulation thresholds, not certified
737 collapse limits**. Persistent failure triggers the existing crash lifecycle;
only a preset reset clears it. The model still does not simulate progressive
structural fatigue, detailed tire failures, or a calibrated oleo energy curve.

The former `ground + 2.8 m` position clamp and downward-velocity cancellation
are removed. They hid impact before the old `ground + 2.15 m` crash test could
run. Gear impact detection now belongs to LandingGear; CollisionDetector checks
body/wing/nacelle contact on every surface, including the runway. Nacelle bottoms
include their probe radius. Ground presets use the actual wheel geometry rather
than spawning with the struts already bottomed out.

Touchdown events use the first contacting frame, including shallow penetration;
requiring 3 cm penetration on that frame could suppress a genuine touchdown.
At low speed, wheel braking uses a stopping impulse capped by the existing
Coulomb friction limit instead of viscous drag that permits steady downhill
creep. The existing parking constraint holds the stopped aircraft.

## Circuit and completion

The route stays continuous after the initial preset. It tracks the measured
terrain without terrain carving or pose/velocity corrections. A 5 m takeoff
lateral offset gives the wide wing clearance from the modeled raised apron.
Climb/turn altitude and speed guidance use aerodynamic force/moment balance.
Final lateral guidance uses actual world velocity; the previous `sim.velocity`
reference was undefined. The approach starts about 1.2 km right of the
centerline, so the closure rate toward it is capped at 50 m/s and by
`sqrt(2 * 2.5 m/s² * |w|)` (`luklaCenterlineClosure`), the rate a coordinated
turn can still remove before the centerline. Chasing the offset proportionally
overshot it and S-turned at 26° of bank down the final, sinking the airplane
into the cliff below the threshold (#292). Bank is limited to 15° inside 900 m
and 8° inside 400 m of the threshold. A curved flare starts 650 m before the aim
point, turning descent into uphill flight before wheel contact. Full landing
flaps and a 112 KIAS target reduce energy; observed contact is about 108 KIAS.
Ground spoilers and reverse are selected on main-gear contact, wheel braking
waits for the lowered nose, and reverse is discontinued below 25 KIAS. The
measured sweep flight touches down 40 m past the threshold and stops with about
115 m of runway left.

Elapsed time, low IAS, low radio altitude, and proximity to the cliff cannot
independently prove success. Completion requires recorded airborne departure,
main-gear runway contact, intact gear, all three gear supported, CG inside the
safe runway envelope, and actual 3D speed below 0.5 m/s for two uninterrupted
seconds. The outcome is retained in `demoDirector.luklaScenario.result` after the
director returns to idle. Successful handover retains the parking brake.

Constructor auto-start remains pending with the parking brake set until the
DEM is loaded. The active request can be cancelled by Esc, presets, or airport
changes; both pending and running requests become `cancelled` on ordinary stop,
while completed/failed outcomes are preserved. Cancelled requests never restart
on load completion. The director
starts the circuit from its next update after loading. HTTP failures, fetch
rejections, and invalid DEM grids expose `loadError`; a pending director records
`failed`, clears the loading UI, and releases the parking brake on the next
update. A successful explicit loader retry clears the error. Physics crashes use
`stopForCrash` to record the failure before deactivating the director, so an
additional scenario update is not needed to persist the outcome.

## Reproduce

With Node 22.23.2 and Chrome available, start Vite, then run:

```sh
npm run dev -- --host 127.0.0.1 --port 5181
PORT=5181 npm run test:lukla -- --screenshots
```

`PORT`, `CDP_PORT`, `ARTIFACT_DIR`, and `LUKLA_RUNS` are configurable. The default
is three circuits. Chrome retains its normal sandbox for non-root users; UID 0
launches add `--no-sandbox` for root-owned containers. The harness intercepts the initial DEM request to verify
pending constructor auto-start and automatic resumption on load, then freezes wall-clock
advance, and executes the actual browser `stepSimulation` at 120 Hz. Screenshots
are opt-in. Missing completion, missing touchdown events, stalls, nonfinite
state, damage, less than 50 m of runway remaining, and movement during the
10-second parking hold all fail. It also injects 20 m/s downward and level-into-
uphill contacts: both must crash before any position correction. Manual preset
mass restoration and synchronous failure recording through the real
`triggerCrash` path are checked there as well. HTTP 503 and network-failure
interception checks verify terminal loading failure, and real Esc/preset/airport
UI actions must retain a cancelled outcome. No fallback screenshot earns a pass.

The committed acceptance report identifies the GPU renderer and records each
run's outcome, touchdown, peak normal impact, runway margin, and parking hold.
