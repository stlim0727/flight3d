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

`HudView` owns only the conformal flight-instrument canvas. All camera modes
share the same top telemetry, AP/mute header and direct CAM/gear/flaps/spoilers/
reverse row. During demo flight, the row replaces disabled aircraft actions with
a persistent take-control button, independent of the collapsible guide and
warning visibility. The ⋯ panel puts fullscreen first, followed by trim, parking
brake and automatic camera viewing; it stays in the same place across cameras. Trim uses
`Aerodynamics.setTrim` and synchronizes control state. Flight controls retain demo
lockout. Escape closes an open panel before pausing. No disabled future-function
buttons or duplicate telemetry footer occupy the flight view.

Lobby/paused/loading views hide the flight-instrument canvas.
Rendering temporarily hides the active aircraft group and restores
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
lockout and responsive touch-control clearance. It saves
screenshots and a JSON report, closes only its own browser tab, and does not
claim a complete flight or landing scenario. Inspect the resulting images in
addition to checking assertions. Unit tests check pitch/roll signs, heading wrap,
FOV scaling, behind-eye rejection, camera persistence and crash recovery.

## Shared control layout acceptance

```sh
CHROME_PATH=/home/stlim/.local/bin/chrome-headless node scripts/verify-flight-layout.mjs
```

The self-contained harness uses an isolated Chrome profile and Vulkan on Linux.
Check render-device access in the launcher session first. It verifies a hardware
WebGL2 renderer and shader pixel readback, then checks stable control rectangles
across camera modes, the single right-anchored toolbar row whose camera/fullscreen/overflow
group stays reachable while the aircraft actions unfold to its left and scroll into view,
native AP/trim/brake/mute interaction, demo
lockout and one-tap take-control clearance across desktop and phone orientations. Artifacts
are written to `.cache/flight-layout/` (override with `ARTIFACT_DIR`). These are
fixed-pose browser checks, not flight or physical-device acceptance. The older
`verify-responsive-ui.mjs` includes historical toolbar-placement expectations;
use `verify-flight-layout.mjs` for the current shared control layout.
