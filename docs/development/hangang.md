# Hangang low-flight scenario

Related: #253 (scenario), #267 (detailed bridge assets), #391 (free flight),
#395 (deck lamp/arch collision, banked pavilion contact), #396 (bridge motifs from
the [bridge survey](hangang-bridge-survey.md)).

The lobby offers **Han River** alongside the airports under **Flight region**.
Only this region offers **Han River low-level flight**; existing airports do not.
Selecting it previews its dedicated scenery and locks C172/twilight settings.
The saved region restores on reload. Internal `airport` fields/storage keys are
retained for compatibility but also identify this non-airport region.
It starts a C172 in trimmed flight at 19 m above water, 46 m/s, at twilight and in
calm wind. The dedicated scenery replaces the selected airport for the run;
leaving the scenario restores the previous environment. Restart clears the
contact state and crash camera shake. The normal aircraft controls remain active.
Autopilot disengages while the scenario is active.

## Free flight

Like the other scenarios, Han River does not judge how the aircraft is flown
(#391). There is no course order, gate count, score, flight envelope, route,
time limit or completion state, and nothing fails the run except physical
contact. The bridges, their clearance markers and main-span openings remain as
scenery to fly under or around; the bridges carry no number boards.

## Bridges (#396)

The three bridges are motifs of Seogang, Mapo and Hangang Bridge, in their real
west-to-east order and spacing (1.08 km, then 2.65 km). Each keeps its surveyed
structural type, deck width and longest span from the
[bridge survey](hangang-bridge-survey.md):

| Bridge | Decks | Piers | Above the deck |
|---|---|---|---|
| `seogang` | one, 29 m | 150 m main span, then 90 m spans | Nielsen arch over the main span: ribs lean from x = ±75 m to meet near the deck axis at 67 m |
| `mapo` | upstream and downstream, 22.75 m each | 70 m spans | none |
| `hangang` | twin, 22 m each | 63.5 m spans, main span over Nodeulseom | six tied arches (rise 11 m) over the south channel, from the island's edge to the bank |

The survey has no deck elevations, clearances, water level or pier layout beyond
the longest span, so these stay game choices: girder soffit 34 m, deck top 40 m,
Seogang's 90 m approach spans, the 3–3.25 m gap between twin decks, arch rises and the
crossing angles. Mapo and Hangang Bridge are each two parallel decks in reality
too. The narrowest main span is Hangang Bridge's: 53.5 m between pier caps, about
21 m of clearance either side of the C172's wings on the river axis. The UI still
labels the region as Han River inspired scenery, not a survey reproduction.

The scenario uses the common flight HUD and controls. Use **Esc → Scenario
restart** to restart; after a crash use the common report and
**Space / R / Enter → main menu → Fly**. Menu selection retains the Han River region.

Leaving the river corridor is not prevented. Skyline buildings have no collision
proxies (see below); boundary handling is tracked in #393.

## Physics and geometry contracts

Coordinates are metres, +Y up; progression is generally -Z. Bridge-local X
spans the river. Height is `h = y_aircraft - y_water`. The existing aerodynamic,
engine, mass/CG, trim and fixed-step integration models provide flight behavior;
the scenario adds collision detection only, not corrective forces.
The bridge deck is not inserted into the terrain heightmap. Water/ground height
therefore continues to supply the ground-effect and radio-altimeter reference.

`bridgeSolids()` supplies both rendered geometry and solid collision boxes. Per
deck: the deck, three girders, cross beams every 20 m, and per pier a column and
the cap the girders bear on. `bridgeOpening()` gives the main span's clear
passage: between its pier caps' inner faces (half the span less 5 m), below the
girder soffit (34 m) and across every deck. Each rail box is the collision envelope
of the open railing (curb, posts, mid and top rails) that `hangangBridges.js`
draws inside it. Each deck streetlight (every 55 m from the bridge centre on both
edges of every deck, to 43.8 m) is a pole box and a lamp-head box, drawn and
collided as those boxes. Arch ribs follow `archCentre()`; `bridgeSolids()` gives one
box per tube segment (the chord between rings, padded by the tube radius on every
axis, so leaning ribs are covered too) and the renderer places the tube's rings at
the same segment ends, so the drawn tube lies inside its collision boxes (#395).
`HangangCollision` skips a bridge while the aircraft is more than 10 m beyond its
widest solid across the decks. `hangangBridges.js` merges every bridge into one mesh per
material (steel, concrete, road, lights, markers), so a bridge costs five draw
calls rather than about 110. `HangangCollision` transforms C172 part bounds using
`inverse(M_bridge) * M_aircraft`. Fuselage, wings, tail, fin and fixed gear have
separate conservative bounds. Between physics samples, translation is sampled
at <=0.2 m and quaternion rotation at <=0.015 radians with 0.15 m padding. This
reduces tunneling through thin members; it is an approximation, not exact swept
mesh collision. Each bridge's solids are first narrowed to those overlapping the
whole aircraft's bounds, then tested part by part. A malformed sample is skipped, and a jump of more than about 100 m (a respawn or
teleport) tests only the new pose, so collision stays active afterwards.

Nodeulseom sits under Hangang Bridge's main span (#378, moved with the bridge in #396). `HANGANG_COURSE.nodeulseom`
supplies the island (tapered elliptical cylinder, 0–4 m) to both
`scripts/build-hangang-assets.mjs` and `HangangCollision`, so it is a solid obstacle,
not decoration. The pavilion on it (#381) is `nodeul-pavilion.glb`, placed by
`placeNodeulPavilion()` at 8.5× scale with its long axis along the river: a
49 m square plaza (4.0–4.3 m) carrying a 31 × 42 m building whose roofs reach
15.3 m. The builder bakes `src/config/nodeulPavilionHeights.json` from that GLB's
triangles: the highest surface in each 1 m cell, island-relative. `HangangCollision`
fails a part box that dips below any cell it overlaps, so the empty corners of the
former 45 × 80 m box no longer collide and every roof does. The part's world AABB
only selects candidate cells; each candidate's solid column (up to its height) is
then tested against the part's padded oriented box with a separating-axis test.
A banked wing's AABB reaches below the wing tip, so the AABB alone reported about
12% of pavilion contacts where the aircraft surface stayed clear (#395);
`tests/hangang.test.js` compares contacts at 12°, 20° and 29° of bank with a
0.1 m surface sampling of the same padded part boxes. `tests/nodeulPavilion.test.js`
rebakes the field from the shipped GLB and must match the committed JSON; rerun
the builder after changing the GLB, scale, yaw or island position. The centre of
the opening now clears the pavilion from about 17 m reference height (fixed gear
reaches 1.8 m below it); either side still clears from 10 m. Neither is part of
the terrain heightmap nor changes the ground-effect reference.

Collision does not wait for either GLB. `createNodeulseomStandIns()` draws the
same island and one block per pavilion heightfield cell from the start, and each
stand-in hides only after its GLB loads; a failed load keeps it visible. Bridge
geometry without a collision proxy, such as the gate markers on the pier caps, stays
outside the designated opening; the test checks every rendered triangle, because
merged meshes span the opening (`tests/hangangScene.test.js`).

The riverbanks use sampled BufferGeometry ribbons and the skyline uses one
InstancedMesh with 160 buildings. Scenery is cached and reused on retries.
Buildings outside the river corridor are visual approximations without
collision proxies; #393 tracks them.

## Provenance and limits

All scenery here is original procedural geometry under the repository license,
except the Nodeulseom pavilion. That is mithgarden.studio's *Sejong Complex
Cultural Center - Buildings* (CC BY 4.0, Sketchfab), shipped byte-for-byte as
downloaded (SHA-256 `36476ab1…9b4269b4b`, 541,164 bytes, 3 × 512 px PNG
textures); scale, rotation and an opaque alpha cut-out are applied at runtime.
It stands in for the real Nodeulseom music lounge and does not depict it; see
`public/models/hangang/nodeul-pavilion.LICENSE.txt`. No external bridge models
or map data are bundled; the bridge motifs take only published figures (type,
width, longest span, spacing) from the survey. The UI explicitly
labels this as **Han River inspired training scenery**, not a survey-accurate
reproduction of named Seoul bridges.

The bridges deliberately stay procedural rather than GLB (#396). The repository's
GLBs are themselves exported from Three.js code by `build-hangang-assets.mjs`, so a
bridge GLB would add no detail. It would add an asynchronous load, and with it a
stand-in, failure handling and a second copy of the dimensions, for the scenario's
main obstacles. Revisit this only for externally authored or licensed models, or
when geometry becomes measurably expensive to build at runtime. Survey-accurate
bridges need deck elevations and clearances the survey could not find; until then
the scenery remains a motif, and LOD is not in scope.

## Verification

Node 22.23.2: `npm run check`, `npm test`, `npm run build`.
Focused coverage: `node --test tests/hangang.test.js tests/hangangScene.test.js`.
The full suite passed 798 tests. In this Windows checkout, Incheon JSON fixture
line endings were restored to the canonical LF bytes matching their manifest
hashes; CRLF checkout bytes fail the existing checksum test on the base too.
There is no semantic Incheon scenery change in this feature.

Start Vite on port 5197, then run `node scripts/verify-hangang.mjs`.
`SIM_URL`, `CHROME_PATH`, `CDP_PORT` and `ARTIFACT_DIR` are optional overrides.
The browser harness selects the real lobby button and flies the actual C172
physics with ordinary virtual control inputs from a test pilot. It does not
teleport the aircraft or override forces. The test pilot is only in the
verification script.

Evidence is in `review-artifacts/hangang/`. Checks cover a contact-free flight
under all three bridges, a sustained climb well above the former envelope that
keeps flying, water impact, common pause/restart and crash-to-menu recovery,
autopilot exclusion, absence of a dedicated scenario HUD, and environment restore.
Crash-to-menu follows the player's flow: the collapsed crash report is visible
during the crash scene, then Space opens the menu holding the wreck (still
crashed, no Resume, pending debrief cancelled) and Fly starts a fresh sortie.
Headless runs enable CDP focus emulation so the simulator loop is not held as a
background tab.
Desktop/cockpit/mobile screenshots check framing. Mobile is a viewport check,
not proof of touch handling on a physical phone. Automated piloting demonstrates
feasibility, not human difficulty balance or a real-time FPS benchmark.

### Common HUD verification (#290)

`review-artifacts/hangang-common-ux/` records the panel removal on Node 22.23.2.
Syntax/action checks and the production build passed. All 882 Node tests passed
with the canonical LF checkout bytes for the existing Incheon checksum fixtures;
the untouched Windows main checkout reproduced that CRLF checksum failure first.
No Incheon data change belongs to this PR.

The browser harness completed all three bridges using ordinary control inputs,
then verified pause-menu restart, water impact, Space-to-menu recovery, Fly,
environment restoration and saved-region reload with zero runtime exceptions.
The desktop, cockpit, mobile and crash captures show the common HUD without a
scenario status/score/retry panel. Mobile evidence is viewport-only.

### Bridge detail and draw calls (#396)

`review-artifacts/hangang-396/` holds fixed-camera captures of the same scenes on
the base and with this change. These use headless Chrome on hardware D3D11
(Intel Arc 140V), with the camera placed directly and the clock frozen. Visible
bridge draw calls went from 110–331 per view to 10–15, and bridge triangles from
about 5,000 to 36,700, mostly railing posts. Frame times there are wall-clock
rAF intervals, not a benchmark. After merging #400, the full `verify-hangang.mjs`
run passes against this change with no runtime exceptions. The C172 flies under
all three bridges without contact, and the climb, water impact, pause restart and
crash-to-menu checks all pass.

### Surveyed spans and order (#396)

On Node 22.23.2: syntax/action checks and the production build passed, and 1,155
of 1,156 Node tests passed. The one failure is the existing Incheon checksum test
on this Windows checkout: `coastline.json` is checked out with CRLF, and its LF
bytes hash to the expected `8bd5dd1c…`. `nodeulPavilionHeights.json` is unchanged
after rebaking, because the field is island-relative; `bridges-kit.glb` was
rebuilt for the island's new position.

`verify-hangang.mjs` passes against this change with no runtime exceptions: the
test pilot follows the river axis under Seogang, Mapo and Hangang Bridge to
z = -3,800 m without contact, then the climb, water impact, pause restart and
crash-to-menu checks pass. `review-artifacts/hangang-396-spans/` holds fixed-camera
captures of each bridge (approach, oblique, under the deck) and an overview,
rendered from the running scene with the clock frozen. They are visual checks, not
a frame-time measurement.
