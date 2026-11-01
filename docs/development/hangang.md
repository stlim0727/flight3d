# Hangang low-flight scenario

Related: #253 (scenario), #267 (detailed bridge assets), #391 (free flight).

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
contact. The bridges, their clearance markers and the central opening remain as
scenery to fly under or around; the bridges carry no number boards.

The scenario uses the common flight HUD and controls. Use **Esc → Scenario
restart** to restart; after a crash use the common report and
**Space / R / Enter → main menu → Fly**. Menu selection retains the Han River region.

Leaving the river corridor is not prevented. Skyline buildings and above-deck
arch decorations have no collision proxies (see below); boundary handling is
tracked in #393.

## Physics and geometry contracts

Coordinates are metres, +Y up; progression is generally -Z. Bridge-local X
spans the river. Height is `h = y_aircraft - y_water`. The existing aerodynamic,
engine, mass/CG, trim and fixed-step integration models provide flight behavior;
the scenario adds collision detection only, not corrective forces.
The bridge deck is not inserted into the terrain heightmap. Water/ground height
therefore continues to supply the ground-effect and radio-altimeter reference.

`bridgeSolids()` supplies both rendered deck/pier/girder/rail geometry and solid
collision boxes. `HangangCollision` transforms C172 part bounds using
`inverse(M_bridge) * M_aircraft`. Fuselage, wings, tail, fin and fixed gear have
separate conservative bounds. Between physics samples, translation is sampled
at <=0.2 m and quaternion rotation at <=0.015 radians with 0.15 m padding. This
reduces tunneling through thin members; it is an approximation, not exact swept
mesh collision. A malformed sample is skipped, and a jump of more than about 100 m (a respawn or
teleport) tests only the new pose, so collision stays active afterwards.

Nodeulseom sits under the central bridge opening (#378). `HANGANG_COURSE.nodeulseom`
supplies the island (tapered elliptical cylinder, 0–4 m) to both
`scripts/build-hangang-assets.mjs` and `HangangCollision`, so it is a solid obstacle,
not decoration. The pavilion on it (#381) is `nodeul-pavilion.glb`, placed by
`placeNodeulPavilion()` at 8.5× scale with its long axis along the river: a
49 m square plaza (4.0–4.3 m) carrying a 31 × 42 m building whose roofs reach
15.3 m. The builder bakes `src/config/nodeulPavilionHeights.json` from that GLB's
triangles: the highest surface in each 1 m cell, island-relative. `HangangCollision`
fails a part box that dips below any cell it overlaps, so the empty corners of the
former 45 × 80 m box no longer collide and every roof does. `tests/nodeulPavilion.test.js`
rebakes the field from the shipped GLB and must match the committed JSON; rerun
the builder after changing the GLB, scale, yaw or island position. The centre of
the opening now clears the pavilion from about 17 m reference height (fixed gear
reaches 1.8 m below it); either side still clears from 10 m. Neither is part of
the terrain heightmap nor changes the ground-effect reference.

Collision does not wait for either GLB. `createNodeulseomStandIns()` draws the
same island and one block per pavilion heightfield cell from the start, and each
stand-in hides only after its GLB loads; a failed load keeps it visible. Bridge
meshes without a collision proxy, such as the gate markers on the pier faces, stay
outside the designated opening (`tests/hangangScene.test.js`).

The riverbanks use sampled BufferGeometry ribbons and the skyline uses one
InstancedMesh with 160 buildings. Scenery is cached and reused on retries.
Above-deck arch decorations and buildings outside the river corridor
are visual approximations without detailed collision proxies. #267 owns
detailed asset/collision contracts.

## Provenance and limits

All scenery here is original procedural geometry under the repository license,
except the Nodeulseom pavilion. That is mithgarden.studio's *Sejong Complex
Cultural Center - Buildings* (CC BY 4.0, Sketchfab), shipped byte-for-byte as
downloaded (SHA-256 `36476ab1…9b4269b4b`, 541,164 bytes, 3 × 512 px PNG
textures); scale, rotation and an opaque alpha cut-out are applied at runtime.
It stands in for the real Nodeulseom music lounge and does not depict it; see
`public/models/hangang/nodeul-pavilion.LICENSE.txt`. No external bridge models
or map data are bundled. The UI explicitly
labels this as **Han River inspired training scenery**, not a survey-accurate
reproduction of named Seoul bridges. Dimensions are designed for the playable
course. Surveyed placement, detailed GLB/PBR assets, LOD, asset fallback and
performance budgets remain in #267; this scenario does not complete that issue.

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
