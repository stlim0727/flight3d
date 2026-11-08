# Neon Metropolis canal and bridge flight

Related: #551 (a river for Neon Metropolis; the first attempt, PR #576, moved the Han
River course in whole and left it outside the city), #253 (the former Han River
scenario), #391 (free flight).

The separate **Han River** region is retired. Of it only the idea of an acrobatic flight
under bridges survives, as Neon Metropolis's fourth scenario, **River Bridge Low
Flight** (`bridge`). Its course, Seoul bridge motifs, landmarks, Nodeulseom and pavilion
are not reused. A saved `flight3d.airport = hangang` or a `?terrain=hangang` link
resolves to `neon` + `bridge` in a C172, so old choices and links keep working.

## The canal

`src/config/neonRiver.js` (`NEON_RIVER`) defines a canal that cuts north–south through
the middle of the skyline, at right angles to the runway (which runs 090° along z = 0
from x = -2400 to 1800). Metres, +Y up.

- Centreline x = 2300, between the Art Deco spire and the Chrysler-style crown tower,
  crossing the canyon axis. Straight for |z| <= 2000, then easing 200 m to either side
  toward the scenery edge (`riverCenter()`).
- 220 m of water between vertical quay walls (`halfWidth` 110 m), the water 14 m below
  the street (`waterLevel` -14).
- `NeonCity.getHeight()` is the water level between the walls and 0 elsewhere, so the
  walls are a step in the city terrain: ground effect, radio altitude, gear contact and
  body probes all see them. The terrain also reports `getWaterLevel()`, which
  `CollisionDetector.checkWater()` uses instead of sea level, so flying below the street
  inside the canal is not ditching.
- `createNeonRiver()` (`NeonRiver.js`) draws the street on both banks with the canal left
  open, the water, the quay walls, violet waterline ribbons along the walls and pink/cyan
  promenade strips along their tops. Ground and water are strips sampled every 100 m and
  cut into columns at most 100 m wide, so no triangle spans kilometres (near-plane 1/w
  interpolation). Avenue grid lines and street lamps stop at the walls.
- Ten towers were moved clear of the canal and the bridges; the Chrysler-style crown
  tower now stands on the east quay. `tests/neonRiver.test.js` keeps every tower more
  than 30 m from the water and 15 m from every bridge solid.

## Bridges

Three bridges sized for the city cross the canal, from south to north:

| `id` | z | Type | Deck | Clear water below the deck |
|---|---|---|---|---|
| `cable` | 650 | cable-stayed tram and footbridge: H pylon on the east quay, cyan harp of stays and back-stays | 14 m wide, top 7 m | 17.7 m, the whole canal width |
| `arch` | 0 | avenue on the canyon axis: magenta tied arch (rise 40 m) with neon hangers every 10 m | 30 m wide, top 7 m | 17.7 m, the whole canal width |
| `light` | -650 | low girder light bridge on two piers at x = ±40 m, amber glow | 18 m wide, top 4 m | 14.7 m; centre span 76 m between the piers |

Each deck reaches 12 m onto both banks and ramps down to the street at 8% on an
embankment. Neon strips run under both deck edges, lamps stand every 30 m on both deck
edges, and the decks carry open railings. Everything stays below the canyon flight's
110 m (the pylon tops out at 77 m).

`bridgeSolids()` is the single source of truth: per bridge, the deck, LED strips,
railing envelopes, lamps, ramp segments, piers, arch rib segments, hangers, pylon legs
and crossbeam, and each cable split into segments of at most 12 m. `neonBridges.js`
draws plain solids as exactly their boxes, railings and ramps inside their envelopes,
and arch ribs and cables as cylinders inside the boxes that pad each chord by the tube
radius. Each bridge is merged into at most five meshes (steel, concrete, road, light,
neon). `bridgeOpening()` is the clear passage under each deck; nothing is drawn in it.

## Streets

`src/config/neonRoads.js` (`neonStreets()`) lays a street network between the towers on
both banks (#579). Before it the city had only the runway highway, which stopped 290 m
short of the canal, and no road reached a bridge. Every street is an axis-aligned
rectangle on the ground; a street joining another runs to that street's far edge, so
junctions and corners are fully paved.

- North-south streets (20 m) at x = 500, 1350, 1880, 2720, 3212 and 3700, from z = -880
  to 880. The two inside the runway's length stop at its edges (|z| = 30) instead of
  crossing it.
- East-west streets (20 m) at z = ±540 and ±870, from x = 490 to the west riverside street
  (x = 1880) and from the east riverside street (x = 2720) to x = 3710.
- Bridge approaches at each deck's width from the riverside streets to the ramp feet
  (`bridgeFeet()`). The arch bridge carries the main avenue: the runway highway runs on
  from x = 1800 to its west foot, and the avenue continues from its east foot to x = 3710
  under the gantries.
- Only the bridges join the banks. `createNeonRoads()` (`NeonRoads.js`) draws dark asphalt
  at the runway's height (y = 0.04) and violet curb lines (0.08) along every edge that does
  not open onto another street, the runway or a bridge foot, all cut into pieces of at
  most 100 m. Highway lamps that would stand in a street are left out.
- The streets are flat decals on the street; they add no collision. The south tower at
  x = 2560 moved from z = -670 to -760 to clear the light bridge's east approach.
  `tests/neonRoads.test.js` keeps every street 10 m from every tower and off the water,
  each ramp foot on an approach of the deck width, and the runway, streets and bridges
  one connected network.

## Collision

- **Every flight in Neon Metropolis.** `bridgeWorldBoxes()` turns every solid into a
  world box in the city building record shape, and `NeonCity` appends them to
  `buildingData`. `CollisionDetector` tests them with each aircraft's probes like the
  towers, so a B738 or F-16 on any Neon preset also hits the bridges.
- **The bridge flight.** `BridgeCollision` adds the swept C172 test: part boxes
  (fuselage, wing, tail, fin, fixed gear) sampled at <= 0.2 m of translation and
  <= 0.015 rad of rotation between physics samples with 0.15 m padding, which catches
  thin members (lamps, hangers, cables) between frames. A part reaching the water level
  over the canal is `water`. The street block beyond either wall is solid up to the
  street, tested against each part's oriented box (separating axes), so a wing tip past
  the wall below the street is `wall`, while a wing banked up over the wall's top is not.
  The wall is taken as straight along Z at the part's position; the canal bends gently.
  Malformed samples are skipped, and a jump of more than about 100 m (a respawn) tests
  only the new pose. The towers are left to `CollisionDetector`.

## Bridge flight

The scenario starts a C172 in trimmed flight 10 m above the water (y = -4, below the
street) at 46 m/s, in calm wind, 750 m south of the city, heading north (000°) up the
canal toward the cable-stayed bridge. The altimeter reads below zero there, because the
street is the city's elevation. It keeps the city's time of day and night sky. The
normal controls and common HUD apply; autopilot disengages and demos do not start while
it is active. Selecting it in the menu selects the C172 and locks the aircraft buttons
(`requiredAircraft()` in `scenarioRegistry.js`).

Like the other scenarios it does not judge how the aircraft is flown (#391): no course
order, gates, score, envelope, route, time limit or completion. Only physical contact
ends the run. **Esc → Scenario restart** restarts it; after a crash the common report
and **Space / R / Enter → main menu → Fly** apply.

## Verification

Node 22.23.2: `npm run check`, `npm test`, `npm run build`.
Focused coverage: `node --test tests/bridgeFlight.test.js tests/neonRiver.test.js tests/neonCity.test.js tests/neonRoads.test.js`.

Start Vite, then run `node scripts/verify-neon-bridge.mjs` (`SIM_URL`, `CHROME_PATH`,
`CDP_PORT` and `ARTIFACT_DIR` are optional overrides). It picks Neon Metropolis and the
bridge flight with the real lobby buttons and flies the actual C172 physics with
ordinary virtual control inputs from a test pilot: 8 m above the water under all three
bridges to z = -1900 without contact, then a climb above the street, pause restart,
autopilot exclusion, demo exclusion, environment restore, water impact, crash-to-menu
recovery and saved-selection reload. Evidence is written to
`review-artifacts/neon-bridge/`. Its crash-retry telemetry check (`retry.healthy`)
also fails on the base before #551 with the old Han River script, with the same stale
values. Mobile captures are viewport checks only, and automated piloting shows
feasibility, not difficulty balance or FPS.
