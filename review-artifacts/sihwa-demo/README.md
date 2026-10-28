# Sihwa coastal tour — complete physical flights

`flights.json` records the actual main simulator, stepping the normal 120Hz
physics via `stepSimulation`. Real-time frame physics was held to prevent
wall-clock work from advancing flight between samples. The aircraft position
was initialized once by the scenario, then advanced through normal forces and
pilot inputs. No crash, landing incident or browser application error occurred.

| Aircraft | Completion | Minimum terrain clearance | Maximum bank | Maximum cross-track error | Bank at manual handoff |
| --- | --- | --- | --- | --- | --- |
| B737-800 | 377.53s | 517.50m | 31.52° | 12.42m | −3.51° |
| C172 | 688.95s | 222.23m | 19.64° | 14.18m | 0.68° |
| F-16 | 341.48s | 582.29m | 32.41° | 10.85m | −0.06° |

All three visited the seawall, tidal power station, Dal Observatory and
Bangameori Beach and completed the offshore return and straight exit. All
finished with less than 8° bank and 2.5m/s vertical speed and retained positive
throttle for manual control. Each was restarted, retained a manually selected
camera through a stage transition, and then cancelled using Esc. The original
B737 departure and C172 airport circuit remain selectable.

The F-16 uses the modeled airbrake at 80% to balance this engine model's idle
thrust at 260kt. Its controller solves the live trim every 0.5s and compensates
for the normal high-speed stick attenuation; it does not scale forces or move
the aircraft along an animation. Airbrake configuration is retained at handoff.

Selected evidence:

- `B738-menu.png`: Incheon scenic tour selection.
- `F16-menu-mobile.png`: tour choice and start button at 390×844.
- `B738-81.png`, `F16-81.png`: power station/observatory passes.
- `C172-82.png`: Bangameori Beach pass.
- `flights.json`: five-second samples, available menu profiles and full results.

All 809 Node tests, syntax checks and the production build passed. This is
functional flight acceptance, not an FPS or real-world aircraft performance
benchmark. Reproduce with the commands in
[the implementation notes](../../docs/development/sihwa-demo.md).
