# HUD camera

Issue [#300](https://github.com/stlim0727/flight3d/issues/300) and the approved
[design discussion](https://github.com/stlim0727/flight3d/discussions/303) define
this additional forward camera. The [concept image](../design/issue-300-hud-camera.png)
is an AI-generated UI mockup, not simulator evidence. Actual fixed-pose browser captures:
[desktop](../design/hud-camera-desktop.png) and
[mobile touch](../design/hud-camera-mobile.png). It was generated with the
built-in image tool: a clear forward airport view, green flight instruments,
translucent edge controls, bottom telemetry and disabled future-function buttons.
The actual terrain continues to use the simulator's existing scenery.

Select **HUD · 9** in the main menu's camera settings, press **9** (or numpad 9),
or cycle **C** through chase → drone → flyby → wing → cockpit → HUD.
Existing 1–8 shortcuts keep their meanings. HUD is excluded from scenic AUTO.
It follows the active aircraft's configured captain eye point and forward axis,
without cockpit geometry, head tilt or camera-look orbit. Manual selection keeps
the existing protection against demo framing and temporary gear-camera cuts.

`src/ui/HudProjection.js` projects world directions through the actual render
camera quaternion and vertical FOV. The pitch ladder is a set of constant-world-
elevation arcs; positive pitch moves the horizon down. The camera's inverse
quaternion determines the roll pointer. The center symbol is aircraft boresight,
not a flight-path marker. Units: IAS in knots, MSL altitude in feet, vertical speed
in ft/min, trim in degrees, fuel as a percentage of current tank capacity.

`HudView` owns its canvas and edge controls inside the existing inert HUD root.
Trim uses `Aerodynamics.setTrim` and synchronizes the control state. Flaps, AP,
gear, spoilers, reverse, sound and fullscreen reuse existing handlers. Demo
lockout applies to flight controls. The AP button opens its existing panel;
systems opens a small control panel. Escape closes a panel before pausing.
Map, flight plan, ground services and simulation rate are real disabled buttons
with a localized “Coming soon” label. The rate placeholder is disabled because
simulation speed adjustment is not currently implemented.

Only this camera uses the new overlay and replaces the original telemetry and
control strip. Lobby/paused/loading views hide it, and other cameras restore
existing UI. Rendering temporarily hides the active aircraft group and restores
its visibility in `finally`, independently of aircraft GLB loading behavior.
The hidden airframe also does not cast its own shadow in this mode. Terrain and
other scene objects retain their normal rendering. A crash switches back to the
existing wreckage camera.

## Verification

```sh
node --test tests/hudProjection.test.js tests/cameraSelection.test.js
npm run dev -- --host 127.0.0.1 --port 5300
chrome-session --project flight3d node scripts/verify-hud-camera.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the browser URL and `.cache/hud-camera` output.
The script uses a fixed aircraft pose to check projection, native key/click
interactions, camera/reset/menu transitions, all three aircraft, demo control
lockout, disabled placeholders and responsive touch-control clearance. It saves
screenshots and a JSON report, closes only its own browser tab, and does not
claim a complete flight or landing scenario. Inspect the resulting images in
addition to checking assertions. Unit tests check pitch/roll signs, heading wrap,
FOV scaling, behind-eye rejection, camera persistence and crash recovery.
