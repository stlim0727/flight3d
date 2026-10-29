# F-16 Lukla canyon aerobatics acceptance

2026-10-28, PR #277. Vite development server, existing Flight3d GPU-configured
Chrome session, 1440×900. Extensions were disabled for this run after a looping
extension made DevTools unresponsive. Renderer-specific performance is not measured.

```sh
npm run dev -- --host 127.0.0.1 --port 5188
PROFILE=canyon-chase APP_URL=http://127.0.0.1:5188/ \
  chrome-session --project flight3d node scripts/verify-f16-lukla.mjs
```

The real simulator with loaded DEM, virtual input attenuation/slew, mass/fuel,
contact/collision pipeline and physical engine/aerodynamics completed in 37.67
simulated seconds. Minimum center-point clearance: 100.70 m. Maximum cabin load:
7.997G. Maximum bank: 179.996°. Time beyond 150° bank: 3.63 s. No sampled stall,
crash, nonfinite position, runtime exception or failed shader diagnostics.
Restart and cancellation release virtual controls. Samples are recorded each
simulated second; scenario extrema accumulate every physics step.

- [Barrel roll](barrel-roll.png): 120.7° bank during the continuous roll.
- [Inverted crossing](inverted.png): −178.9° bank above the valley.
- [Upright pull-up](pull-up.png): cockpit-normal HUD load 7.74G at capture;
  the substep peak was 7.997G.
- [Full samples](browser-results.json).

The first actual-browser attempt exposed uncompensated high-speed stick
attenuation and failed during slalom. The scenario now inverts that mapping
before submitting its requested surface deflections. The bounded Node flight
check includes the same attenuation and slew so this regression is exercised
without WebGL too. The actual cabin G display no longer clips at 5.5G.

These are deterministic stepped-flight checks and settled camera captures,
not a wall-clock frame-rate benchmark, audio test or full manual flight test.
