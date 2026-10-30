# Touch / gyro response audit

Both input sources now pass through `shapeTouchStick`: 6% radial deadzone,
then `0.35*t + 0.65*t^3` where `t=(travel-0.06)/0.94`. The output is monotonic
and reaches full authority only at the circular rim. This deliberately gives
more fine resolution near centre; it is not a linear position-to-attitude map.

Previously gyro bypassed this curve and sent individually clipped linear axes.
At 10% normalized travel it sent 10% versus the thumb stick's 1.494%, about 6.7x
more command. Diagonal gyro could send `[1,1]` while its displayed knob had
already stopped at the unit circle. Gyro now uses the same curve and circular
vector budget. The graphic still displays physical normalized tilt; it does not
shrink to the shaped control command. Full-axis tilt ranges remain 25 degrees
pitch and 30 degrees roll, measured from calibration.

| Normalized travel | Touch / corrected gyro command | Previous gyro command |
| --- | --- | --- |
| 5% | 0% | 5% |
| 10% | 1.494% | 10% |
| 20% | 5.428% | 20% |
| 50% | 23.049% | 50% |
| 100% | 100% | 100% |

`node scripts/audit-control-response.mjs` prints a reproducible CSV using the
live FlightControls actuator and Aerodynamics model for F16, 350 KIAS, 3000 m,
2.86-degree AoA, neutral trim and zero initial rates. It settles control travel,
then reports incremental angular acceleration relative to neutral at fixed
airflow. It uses the integrator's axis/inertia convention: pitch moment times
`invIyy`, negative roll moment times `invIxx`. These are initial acceleration
snapshots, not sustained rates, flight trajectories or manufacturer data.

At 10% travel the corrected model gives 6.505 deg/s² pitch and 21.397 deg/s² roll,
versus 43.532 and 143.186 for the old gyro path. The input curve and model moment
continue increasing through the range; small touch inputs are not saturating.
Tests repeat the sweep at 200, 350 and 500 KIAS, in both axes and signs.

Aircraft motion depends on dynamic pressure, angular damping, airflow, inertia
and how long an input is held. A constant off-centre stick keeps commanding
control deflection; it does not request a fixed bank or pitch angle. The F16
currently shares the generic surface-command/stiffness/actuator path and has no
F16-specific load-factor/rate-command FLCS or validated G/AoA envelope limiter.
This audit and gyro fix do not establish real-aircraft handling fidelity or
change the aerodynamic coefficients, keyboard, HOTAS or autonomous controllers.

Physical touch/gyro feel still requires device/browser acceptance under the
hardware GPU procedure in `browser-gpu.md`.
