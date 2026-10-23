# Cockpit aperture evidence

The current implementation separates direct-beam intensity from admitted area. See
[revised acceptance](revised/README.md) for the current results and captures.

The frames and reports immediately below are historical, captured before that correction.
Their intensity and brightness comparisons describe the superseded area-scaled light.

# Historical before / after

Branch `fix-cockpit-aperture-solid-angle`. The deck sun gate was replaced: the old
`facing` heuristic (one dot product against the deck→pane-centre direction, saturating near
1.0 for most daytime bearings) became `directAdmittance()`, the aperture area projected
normal to the sun. The front panes' rake also changed sign, from `-0.47` rad to `+0.47`, so
the glass leans back over the nose instead of forward like a canopy.

Captured with the cockpit shadow demo (`CockpitShadowDemo`), 1280x720, clear sky, 09:00,
one frame per held sun direction. `before-*` is `origin/main`, `after-*` is this branch.
`*-report.json` carries the rig's own numbers per frame.

| frame | sun | deck sun `light.intensity` | full-frame mean luma |
| --- | --- | --- | --- |
| 1 | front left | 7.84 → 3.85 | 83.3 → 94.6 |
| 2 | ahead | 8.31 → 5.72 | 82.5 → 90.7 |
| 3 | front right | 7.84 → 3.85 | 81.7 → 92.7 |
| 4 | right, 40 deg up | 9.09 → 2.14 | 76.5 → 94.1 |
| 5 | high, over the nose | 2.88 → 4.15 | 94.5 → 94.3 |
| 6 | low left | 6.28 → 3.87 | 88.9 → 96.4 |

Mean luma is Rec.709 luma averaged over the whole frame, decoded from the PNGs in pure Node.

## What the pair shows

Frame 5 is the one the change was for. The old gate read a high sun as barely admitted
(2.88 against 9.09 for a morning sun), so the instrument floods stayed near full and the
shaded overhead panel washed out. The high-sun intensity rose from 2.88 to 4.15, while the abeam intensity fell from
9.09 to 2.14. The ahead frame remained stronger at 5.72; these numbers did not make the
high sun the strongest-admitting bearing of the set.

Frames 1-4 and 6 get brighter overall, and that is the expected consequence, not a
regression in the gate: those bearings were over-reported by the saturating heuristic, so
`daylight` falls, `Cockpit.syncDaylight` dims the floods less, and the deck reads lit. The
abeam-aft collapse behind frame 4 in particular is a property of the model, not the maths —
every mesh in `gltfCockpitGroup` lies within |x| ≤ 1.0 m of the centreline, so the deck has
no side-window geometry for an afternoon sun to come through. See issue #164, and "Known
limits" in `docs/development/cockpit-sunlight.md`.
