# Cockpit interior sunlight evidence (#90)

Captured by `node scripts/verify-cockpit-shadows.mjs` on 2026-10-22 with
`npm run check`, `npm test` (375 pass) and `npm run build` green, on Node 22.23.2,
ANGLE Vulkan / Intel Graphics ADL-N, 1280x720 viewport, in the 3D cockpit camera
mode with the animation loop paused and the pose staged per frame.

## Frames

`deck-sun-<cell>.png` is the whole cockpit; the numbers below come from
`deck-sun-report.json`, which records the deck-local sun bearing and elevation,
spot intensity, facing, cookie coverage and centroid, daylight factor, the three
instrument flood intensities, and a centre-patch luma histogram for every cell.

| Cell | Sun in deck frame | Spot intensity | Cookie centroid | Floods |
| --- | --- | ---: | --- | --- |
| morning | -24 deg, elev 17 | 1.17 | 0.512 / 0.531 | 0.67, 0.90, 0.45 |
| noon | 0 deg, elev 64 | 0.63 | 0.480 / 0.534 | 0.91, 1.21, 0.61 |
| golden | 43 deg, elev 20 | 1.56 | 0.472 / 0.535 | 0.47, 0.63, 0.32 |
| night | 52 deg, elev -46 | 0.03 | 0.505 / 0.447 | 1.18, 1.58, 0.79 |
| leftSun | -90 deg, elev 46 | 1.92 | 0.461 / 0.483 | 0.30, 0.40, 0.20 |
| rightSun | 90 deg, elev 46 | 1.92 | 0.536 / 0.509 | 0.30, 0.40, 0.20 |
| bankLeft | -121 deg, elev 36, rolled -35 | 1.92 | 0.486 / 0.462 | 0.30, 0.40, 0.20 |
| bankRight | -59 deg, elev 36, rolled +35 | 1.92 | 0.483 / 0.519 | 0.30, 0.40, 0.20 |
| overcast | 0 deg, elev 64, cloud 0.8 | 0.16 | 0.480 / 0.533 | 1.12, 1.50, 0.75 |
| astern | 180 deg, elev 17 | 0.00 | 0.515 / 0.493 | 1.20, 1.60, 0.80 |

Heading and bank move the pattern to opposite sides of the cookie (leftSun 0.461
against rightSun 0.536, bankLeft 0.462 against bankRight 0.519 in the other axis).
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
| World outside the windshield | 0.10 | 0.0% | 1.0 |
| Glareshield top | 2.37 | 16.0% | 19.9 |
| Panel face | 1.32 | 7.0% | 22.1 |
| Pedestal | 4.43 | 26.5% | 19.9 |

The deck sun lands on the deck and leaves the scene outside the glass untouched.

## Limits visible here

- Noon is the weakest frame: a 64 deg sun is raked off by the windshield, so facing
  drops to 0.35 and the floods stay near full. Physically right, but the pattern is
  faintest in the middle of the day.
- Surfaces closer to the sun than the 0.45 m clip plane read as flat sun (the
  copilot console with the sun abeam right).
- Flood brightness follows admitted sun, not general skylight, so overcast keeps the
  floods bright.
- Exterior airframe self-shadow is out of scope for this change.
- Timings (122.8 ms frozen against 199.8 ms per frame with the map forced) are
  contended headless measurements on shared integrated graphics. They show only that
  freezing the map is cheaper and that a steady deck-local sun does not repaint.
