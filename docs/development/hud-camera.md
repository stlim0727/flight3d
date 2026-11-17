# HUD camera

The in-flight **CAM** control is a native dropdown containing all manual views
and a single **Auto** choice. The separate Scenic Auto play/pause button has
been removed; both previously controlled the same automatic camera state.
Auto now holds framing while its flight context stays stable. It chooses chase
for low terrain or steep manoeuvres, cockpit for a descending configured
approach, flyby for a straight fast low pass, and drone for parked/cruise views.
A six-second minimum hold and one-second context confirmation prevent rapid
cuts. Manual view selection and touch/mouse look retain their existing priority.

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
across camera modes, the right-anchored toolbar whose camera/fullscreen/overflow
group stays reachable, native AP/trim/brake/mute interaction, demo
lockout and one-tap take-control clearance across desktop and phone orientations.
Phones in portrait show only the core airspeed, altitude and (from 361px wide)
heading readouts in the first row. The second row wraps every aircraft control
instead of scrolling, so landing gear is visible without a drag; it dims to 40%
after 2.5s without input and returns to full opacity on pointer, key or focus
activity. The row order is aircraft controls, overflow (trim and parking brake),
demo takeover, cameras, fullscreen. Camera buttons and fullscreen are optional:
the Option tab's "Top menu items" checkboxes hide them (`toolbarHidden`), and the
harness checks that an empty selection leaves one undragged row in both
orientations, that seven cameras fit a 390px portrait second row, that a hidden
camera stays selectable without its button returning, and that the selection
survives a reload. On 320px-class screens even the five aircraft controls,
overflow and fullscreen (7 × 44px) exceed one row, so `fullscreen-wrapped` moves
fullscreen to the end of the second row, beside the camera strip or alone, and the
toolbar never needs a third row. `src/ui/toolbarVisibility.js` holds the DOM-independent rules
(`tests/toolbarVisibility.test.js`). Issue #808 draws gear (state arrow per
`updateControlState`), spoilers (stowed line / deployed triangle, after the Airbus
ECAM flight-control page) and fullscreen (enter/exit) as icons from
`src/ui/toolbarIcons.js`. Flaps show a smaller icon over the angle (`data-icon-value`
on `::before`; at 1025px and wider the key hint joins the angle there). The reverser
reads `REV` in every language, as cockpit engine displays print it; takeover and
all camera views keep their text labels. Icons are `currentColor` CSS masks on `::after`
(`data-icon`, `--toolbar-icon`), so disabled grey/opacity and idle dimming apply to
them unchanged, and the accessible name stays the full text. The cockpit eyepoint pill (`#pov-actions-bar`)
follows `--flight-panels-top`, the measured bottom of the control rows, so it
clears a wrapped camera strip. Its adjustment panel is docked to the bottom edge
(right-aligned, or a thin three-column strip when the viewport is shorter than
560px) with its height capped below `--flight-panels-top`, so the windshield,
horizon and HUD stay visible while the eyepoint is adjusted. The harness waits
for the cockpit view to load at each viewport and checks the pill against the
toolbar and the panel against the toolbar and lower console band. With live touch
controls it also checks that a warning row keeps the pill above every touch card
beneath it. On short screens the expanded demo guide can push the pill over those
cards, which is accepted: the demo disables them (`aircraftControlsDisabled`) and
the guide leaves on takeover. Artifacts
are written to `.cache/flight-layout/` (override with `ARTIFACT_DIR`). These are
fixed-pose browser checks, not flight or physical-device acceptance. The older
`verify-responsive-ui.mjs` includes historical toolbar-placement expectations;
use `verify-flight-layout.mjs` for the current shared control layout.
