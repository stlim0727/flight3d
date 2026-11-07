# Neon Metropolis river and bridge flight

Related: #551 (the river joins Neon Metropolis), #253 (the former Han River
scenario), #391 (free flight), #395 (deck lamp/arch collision), #396 (bridge motifs
from the [bridge survey](hangang-bridge-survey.md)), #429 (approach ramps).

The separate **Han River** region is retired (#551). Its river and bridges now run
through **Neon Metropolis**, so the city has a river for every flight there, and the
former start point became the city's fourth scenario, **River Bridge Low Flight**
(`bridge`). A saved `flight3d.airport = hangang` or a `?terrain=hangang` link resolves
to `neon` + `bridge` in a C172, so old choices and links keep working.

The Seoul-specific scenery is gone with the region: the Yeouido, Namsan and Lotte
landmark GLBs, the skyline and beacons, Nodeulseom and its pavilion (and their CC BY
model and heightfield). Neon Metropolis supplies the skyline instead, on both banks.

## Bridge flight

The scenario starts a C172 in trimmed flight 19 m above the river, at 46 m/s, in calm
wind, heading east along the river toward the first bridge, with the north-bank
skyline to the left. It keeps the city's time of day and stylised night sky. The
normal controls and the common HUD apply; autopilot disengages while it is active.
Selecting it in the menu selects the C172 and locks the aircraft buttons
(`requiredAircraft()` in `scenarioRegistry.js`).

Like the other scenarios it does not judge how the aircraft is flown (#391): no
course order, gates, score, envelope, route, time limit or completion. Only physical
contact ends the run. **Esc → Scenario restart** restarts it; after a crash the
common report and **Space / R / Enter → main menu → Fly** apply.

## Layout and coordinate frames

Metres, +Y up. `HANGANG_COURSE` keeps the river, bridges and spawn in the former
course frame (travel generally -Z, bridge-local X across the river), and
`HANGANG_COURSE.frame` places that frame in the city: yaw -90° about +Y at
(-700, -1900). Course -Z is world +X (east) and course +X is world +Z (north).
`courseToWorld()` / `worldToCourse()` convert points; both the river group
(`NeonRiver.js`) and `HangangCollision` use the same frame transform.

The river is 900 m wide (`halfWidth` 450 m) and lies along the south edge of the
skyline, more than 1 km south of the runway (|z| <= 30). Its water lies flush with
the city ground at y = 0, so the city's flat terrain remains the ground-effect and
radio-altimeter reference and the generic water check applies unchanged.
`createNeonRiver()` builds the city ground on both banks with the river left open,
the water between the banks, and cyan/pink promenade strips along the banks. Ground
and water are strips sampled every 100 m along the river and cut into columns of at
most 100 m, so no triangle spans kilometres (near-plane 1/w interpolation). A south
bank skyline faces the existing towers across the river. `tests/neonRiver.test.js`
checks that every tower stands more than 30 m from the water and 15 m from every
bridge deck and approach ramp.

## Bridges (#396)

The three bridges are still motifs of Seogang, Mapo and Hangang Bridge, in their real
west-to-east order and spacing (1.08 km, then 2.65 km). Each keeps its surveyed
structural type, deck width and longest span from the
[bridge survey](hangang-bridge-survey.md):

| Bridge | Decks | Piers | Above the deck |
|---|---|---|---|
| `seogang` | one, 29 m | 150 m main span, then 90 m spans | Nielsen arch over the main span: ribs lean from x = ±75 m to meet near the deck axis at 67 m |
| `mapo` | upstream and downstream, 22.75 m each | 70 m spans | none |
| `hangang` | twin, 22 m each | 63.5 m spans | six tied arches (rise 11 m) over the south channel |

Heights stay game choices: girder soffit 34 m, deck top 40 m. The narrowest main span
is Hangang Bridge's: 53.5 m between pier caps. A restyle into bridge forms suited to
the neon city is follow-up work. Past each deck end an approach ramp (#429) carries the
road down to the ground at a 6% grade (about 667 m), on columns every 40 m, with a
retained embankment where less than 6 m would stay beneath the slab.

## Collision

`bridgeSolids()` supplies both rendered geometry and collision boxes per bridge: deck,
girders, cross beams, piers and caps, railing envelopes, deck and ramp streetlights,
arch rib segments and approach ramp segments. `hangangBridges.js` merges each bridge
into five meshes (steel, concrete, road, lights, markers) drawn inside those boxes.

Two consumers use them:

- **Every flight in Neon Metropolis.** `bridgeWorldBoxes()` turns every solid into a
  world box rotated about +Y in the city building record shape, and `NeonCity`
  appends them to `buildingData`. `CollisionDetector` tests them with each aircraft's
  probes like the towers, so a B738 or F-16 on the canyon or cruise preset also hits
  the bridges.
- **The bridge flight.** `HangangCollision` adds the swept C172 test: part boxes
  (fuselage, wing, tail, fin, fixed gear) transformed by
  `inverse(M_frame * M_bridge) * M_aircraft`, with translation sampled at <= 0.2 m and
  rotation at <= 0.015 rad between physics samples and 0.15 m padding. It catches thin
  members such as rails, lamps and arch ribs between frames. A part reaching the water
  level is `water` over the river and `ground` on the banks. Malformed samples are
  skipped, and a jump of more than about 100 m (a respawn) tests only the new pose.
  The towers are left to `CollisionDetector`.

## Verification

Node 22.23.2: `npm run check`, `npm test`, `npm run build`.
Focused coverage: `node --test tests/hangang.test.js tests/neonRiver.test.js tests/neonCity.test.js`.

Start Vite on port 5197, then run `node scripts/verify-neon-bridge.mjs`
(`SIM_URL`, `CHROME_PATH`, `CDP_PORT` and `ARTIFACT_DIR` are optional overrides). It
picks Neon Metropolis and the bridge flight with the real lobby buttons and flies the
actual C172 physics with ordinary virtual control inputs from a test pilot: under all
three bridges without contact, then a climb, pause restart, autopilot exclusion,
environment restore, water impact, crash-to-menu recovery and saved-selection reload.
Evidence is written to `review-artifacts/neon-bridge/`. Mobile captures are viewport
checks only, and automated piloting shows feasibility, not difficulty balance or FPS.
