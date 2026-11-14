# Neon Metropolis canal and bridge flight

Related: #551 (a river for Neon Metropolis; the first attempt, PR #576, moved the Han
River course in whole and left it outside the city), #628 (the city as an island), #253
(the former Han River scenario), #391 (free flight).

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
  crossing the canyon axis, straight from shore to shore (`riverCenter()`).
- 220 m of water between vertical quay walls (`halfWidth` 110 m), the water 14 m below
  the street (`waterLevel` -14). From |z| = 1200 the walls curve out on a 150 m quarter
  circle (`mouth`) into the island's shore, so at either end the canal widens to 520 m
  and opens into the sea (`riverHalfWidth()`).
- `NeonCity.getHeight()` is 0 on land (`isLand()`) and the water level elsewhere, so the
  walls are a step in the city terrain: ground effect, radio altitude, gear contact and
  body probes all see them. The terrain also reports `getWaterLevel()`, which
  `CollisionDetector.checkWater()` uses instead of sea level, so flying below the street
  over the canal or the sea is not ditching. It is the same -14 m under the street, where
  the sea runs on beneath the island: the shared water checks count water only where the
  terrain is within 2.5 m of it, so a street crash stays a ground impact (#458, #648).
- `createNeonRiver()` (`NeonRiver.js`) draws the street on both banks and the causeway,
  one sea surface at the water level across the whole 24 km scenery (running on under the
  island), the quay walls around every shore (`landOutline()`), violet waterline ribbons
  along the walls and pink (west bank and causeway) / cyan (east bank) promenade strips
  along their tops. Ground and water are strips sampled at most every 100 m (finer
  through the curves, `islandRows()`) and cut into columns at most 100 m wide, so no
  triangle spans kilometres (near-plane 1/w interpolation). Avenue grid lines stay on
  land, and street lamps stop at the walls.
- The canal must read at night without brightening the city (#581). The scene's
  environment is a daytime HDR that Neon Metropolis dims to 3%, so the water carries its
  own environment map, an equirectangular copy of the stylized sky dome's gradient: the
  glossy water mirrors the magenta horizon and stands out from the black quay walls,
  brightest at the grazing angles of the bridge flight. Quay lights (`quayLights`, one
  `Points` cloud) stand every 20 m on every promenade strip, 1 m behind the wall tops,
  tracing the canal's course and the island's shore ahead from the water and from above.
  They are light only, flush with the promenade, with no collision.
- Ten towers were moved clear of the canal and the bridges; the Chrysler-style crown
  tower now stands on the east quay. `tests/neonRiver.test.js` keeps every tower more
  than 30 m from the water and 15 m from every bridge solid.

## The island

`NEON_ISLAND` (#628) puts the city on an island in the sea. Everything that is not
island or causeway is sea at the canal's water level, 14 m below the street.

- A rectangle with 600 m rounded corners (`corner`) around the skyline: x = 150 to 4000,
  its north and south shores straight at z = ±1350 (`halfZ`), where the canal opens into
  the sea (`islandShore()`). Every tower stands at least 100 m from the outer shore.
- The runway (and its safety area, x = -2500 to 1900, |z| <= 50) leaves the island
  westward on the only causeway, 120 m wide (`causeway.halfWidth` 60 m) and out to
  x = -2600: everything beside and beyond it is sea, so the take-off and approach run
  over one road across the water. The highway lamps and gantries along it stand on it.
- The quay walls, waterline ribbons, promenade strips and quay lights run around the whole
  shore of both banks, the causeway included, as closed loops (`landOutline()`, counter-
  clockwise, with the water on the right of each step).

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
- The streets are flat decals on the street; they add no collision. The north tower at
  x = 2560 moved from z = -670 to -760 to clear the light bridge's east approach.
  `tests/neonRoads.test.js` keeps every street 10 m from every tower and off the water,
  each ramp foot on an approach of the deck width, and the runway, streets and bridges
  one connected network.

## Towers and wind comparison sites

Related: #693 (city wind plan), #694 (background turbulence), #696 (stage 3 settings).

`src/config/neonBuildings.js` (`NEON_TOWERS`) is the one tower table. `NeonCity` builds
every tower mesh from it and appends `towerRecord()` for each to `buildingData`, so
drawing and collision cannot drift and no second list exists. Each record keeps a
stable `id` and the true roof height (`roofHeight`) next to the collision `height`, which
pads the roof by `ROOF_MARGIN` (8 m) for spires and roof caps. Bridge boxes stay
separate records carrying `bridge`. Note +Z is south: the clusters at z > 0 are the
south side of the canyon.

The layout was reviewed (#695) so one straight flight compares different urban
settings. The canyon flight (east along z = 0 at 110 m from x = 200) passes, in order,
the sites in `NEON_WIND_SITES`:

| Site | Centre x | Setting |
|---|---|---|
| `open` | 300 | West waterfront: no tower in the envelope or upwind to the north shore |
| `wide-canyon` | 1050 | At least 200 m between the nearest towers (gateway towers, podiums) |
| `slot` | 1560 | 124 m between continuous 150 m and 170 m walls for 240 m: height/width above 1 |
| `canal` | 2300 | Open water 14 m below the street, along the design wind |
| `lee` | 2520 | Directly downwind of the 420 m crown tower on the east quay |
| `rooftop` | 2970 | 30 m above an 80 m roof to the south, 35 m below a 145 m terrace to the north |

Each `region` is a layout envelope in the WindField region shape (centre at the flight
height, radius, fade = radius / 2); envelopes do not overlap. They are not tuned winds.
The sites assume a design wind from the north (`DESIGN_WIND_FROM_DEG` = 0): across the
canyon, along the canal, a crosswind on the 090° runway. `src/config/neonWind.js` uses
it as the mean wind direction of the urban field (#696).

Only four towers changed; the rest of the skyline, the runway, causeway, canal, bridges
and streets are unchanged:

- The podiums at (1460, 155) and (1580, -140) became the slot walls `slot-south` and
  `slot-north` (240 x 36 m, centred at x = 1560, z = ±80).
- The podiums at (2880, 135) 95 m and (3020, -150) 105 m were drawn in to the avenue as
  `terrace-south` (2900, 72) 80 m and `terrace-north` (3040, -75) 145 m.

`UrbanWindField` (#696) derives wakes and roof shear from this tower table; see
[pilot-wind.md](pilot-wind.md#neon-urban-wind-696). It does not model channelling
between towers. `tests/neonBuildings.test.js` keeps the table and records one-to-one, the
footprints matching THREE's rotation, each site's geometry (open fetch, slot and wide
widths, open water, lee tower upwind, roofs above and below), and the whole canyon line
clear at 110 m with at least 43 m to every tower beside it. `node
scripts/neon-city-map.mjs <out.svg> [title] [root]` draws the map; the review's
[before](../design/neon-695-layout-before.png) and
[after](../design/neon-695-layout-after.png) maps are kept in `docs/design`.

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
  The land is the island on either side of the canal, up to its north and south shores,
  and the causeway (#628); the walls are taken as straight along Z at the part's
  position. Over the sea beyond the island only the water is solid.
  Malformed samples are skipped, and a jump of more than about 100 m (a respawn) tests
  only the new pose. The towers are left to `CollisionDetector`.

## Bridge flight

The scenario starts a C172 in trimmed flight 10 m above the water (y = -4, below the
street) at 46 m/s, in calm wind, over the sea 550 m south of the island, heading north
(000°) into the canal's mouth toward the cable-stayed bridge. The altimeter reads below zero there, because the
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
Focused coverage: `node --test tests/bridgeFlight.test.js tests/neonRiver.test.js tests/neonCity.test.js tests/neonRoads.test.js tests/neonBuildings.test.js`.

With Vite and a checked hardware-GPU Chrome ([browser GPU](browser-gpu.md)), `CDP_URL=…
SIM_URL=… node scripts/verify-neon-canyon.mjs` starts the canyon flight from the lobby
in a C172, B738 and F16 and flies the whole line through every wind comparison site with
production physics and the background wind; a test pilot sets only virtual control
inputs (the jets accelerate to 180 kt from their 70 m/s spawn). It fails on a crash, a
pass within 30 m of a tower, or a page exception, captures the slot, canal, lee and
rooftop, and prints the wind RMS inside each site. Evidence goes to
`review-artifacts/neon-canyon/`.

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
