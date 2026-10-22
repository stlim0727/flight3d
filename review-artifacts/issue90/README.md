# Cockpit interior sunlight evidence (#90)

Captured by `node scripts/verify-cockpit-shadows.mjs` on 2026-10-22 with
`npm run check`, `npm test` (368 pass) and `npm run build` green, on Node 22.23.2,
ANGLE Vulkan / Intel Graphics ADL-N, 1280x720 viewport, in the 3D cockpit camera
mode with the animation loop paused and the pose staged per frame.

## Frames

`deck-sun-<cell>.png` is the whole cockpit; the numbers below come from
`deck-sun-report.json`, which records the deck-local sun bearing and elevation,
spot intensity, facing, cookie coverage and centroid, daylight factor, the three
instrument flood intensities, and a centre-patch luma histogram for every cell.

| Cell | Sun in deck frame | Spot intensity | Cookie centroid | Floods |
| --- | --- | ---: | --- | --- |
| morning | -24 deg, elev 20 | 1.49 | 0.517 / 0.536 | 0.50, 0.67, 0.34 |
| noon | -2 deg, elev 68 | 0.30 | 0.487 / 0.551 | 1.06, 1.41, 0.71 |
| golden | 44 deg, elev 23 | 1.60 | 0.473 / 0.539 | 0.45, 0.60, 0.30 |
| night | 49 deg, elev -43 | 0.03 | 0.500 / 0.449 | 1.18, 1.58, 0.79 |
| leftSun | -94 deg, elev 45 | 1.93 | 0.462 / 0.478 | 0.30, 0.40, 0.20 |
| rightSun | 95 deg, elev 47 | 1.93 | 0.538 / 0.504 | 0.30, 0.40, 0.20 |
| bankLeft | -123 deg, elev 33, rolled -35 | 1.93 | 0.491 / 0.464 | 0.30, 0.40, 0.20 |
| bankRight | -63 deg, elev 38, rolled +35 | 1.93 | 0.478 / 0.515 | 0.30, 0.40, 0.20 |
| overcast | -2 deg, elev 69, cloud 0.8 | 0.06 | 0.487 / 0.554 | 1.17, 1.57, 0.78 |
| astern | 180 deg, elev 12 | 0.00 | 0.515 / 0.498 | 1.20, 1.60, 0.80 |

Heading and bank move the pattern to opposite sides of the cookie (leftSun 0.462
against rightSun 0.538, bankLeft 0.464 against bankRight 0.515 in the other axis).
Night, sun-astern and overcast leave the deck to its floods, which stay at or above
the 0.15 floor; the floods dim to a quarter while low sun lights the deck.

## What the rig contributes

`deck-sun-leftSun-diff.png` is the same staged frame with and without the deck sun,
amplified 12x around mid-grey: mid-grey is no change, brighter is sun the rig adds,
darker is interior geometry taking light back. Pixels that differ between two
identical renders are masked out as flat dark; on this run nothing was masked
(static share 1.000), so the frame repeats exactly. Mean luma delta over each region:

| Region | Mean | Pixels moved >6 | Peak |
| --- | ---: | ---: | ---: |
| World outside the windshield | 0.18 | 0.0% | 1.0 |
| Glareshield top | 3.80 | 11.8% | 29.1 |
| Panel face | 2.19 | 10.0% | 27.0 |
| Pedestal | 5.00 | 30.3% | 21.1 |

The deck sun lands on the deck and leaves the scene outside the glass untouched.

## Limits visible here

- Noon is the weakest frame: a 68 deg sun is raked off by the windshield, so facing
  drops to 0.16 and the floods stay near full. Physically right, but the pattern is
  faintest in the middle of the day.
- Surfaces closer to the sun than the 0.45 m clip plane read as flat sun (the
  copilot console with the sun abeam right).
- Flood brightness follows admitted sun, not general skylight, so overcast keeps the
  floods bright.
- Exterior airframe self-shadow is out of scope for this change.
- Timings (217.6 ms frozen against 355.7 ms per frame with the map forced) are
  contended headless measurements on shared integrated graphics. They show only that
  freezing the map is cheaper and that a steady deck-local sun does not repaint.
