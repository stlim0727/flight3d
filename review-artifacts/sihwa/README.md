# Sihwa regional scenery acceptance

Reproduce with the development server on port 5288 and:

```sh
chrome-session --project flight3d node scripts/verify-sihwa.mjs
```

The script uses a private context inside the existing project Chrome, closes only
that context, and keeps extension diagnostics separate from application errors.
The inspection page loads the actual `loadIncheonAirport` implementation and its
terrain, landmark meshes and collisions. Its independent camera and daylight are
for review; this is not an automated flight or a frame-rate benchmark.

- `plant.png`: mapped station footprint, ten generator roof details, visitor facilities.
- `tower.png`: circular observation head and shaft, 75m above the modeled site pad.
- `beach.png`: Bangameori sand polygon clipped and draped onto the mapped coast.
- `seawall.png`: the complete seawall corridor and the open lake/sea on each side.
- `review.json`: measured render counts, bridge triangle height agreement, tower
  collisions/clearances, and the main-simulator integration result. `complete`
  stays false if a run fails before all checks finish.

The four regional views rendered 6–18 draw calls and 264,224–266,658 triangles
(including water and other visible airport scenery). These are scene counters,
not FPS measurements. Fourteen bridge triangle samples agreed with the contact
sampler within 8.9e-16m. Shaft/head collision, empty space beside the shaft and
clearance above the tower all passed. No application, shader or extension errors
were recorded in the regional scene.

The local gate also passed `npm run check`, all 796 Node tests and `npm run build`.
Source hashes, projected landmark coordinates, 1,000+ regional triangle samples,
core edge heights, unchanged airport grading and open-water locations are covered
by `tests/sihwaRegion.test.js`. Architecture, road widths/deck elevations and
facility grading are model approximations described in
[the source and implementation notes](../../docs/development/incheon-sihwa.md).

The main simulator also loaded the Incheon extension, showed its terrain mesh,
and held the aircraft on the existing runway for 10 simulated seconds without a
crash. All ground queries there remained at the modeled 7m runway elevation.
The completed run recorded no application, shader or extension errors.
