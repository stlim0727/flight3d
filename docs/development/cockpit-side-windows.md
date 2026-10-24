# No.3 side-window aperture (#164)

The optical profile now includes the two fixed No.3 side windows. `VISIBLE_GLASS`
contains only the original glass; `APERTURE_OPENINGS` also includes optical-only
No.3 panes. The four original `WINDSHIELD_PANES` remain shared without copying their definitions.

## Provenance and fitting

Reference: Mark @ MarkusPilot, *B737 Measurements for Home Flight Simulator
Flight Deck Building*, PDF pages 5 (side outline), 7 (frame dimensions), 8 (plan):
https://static1.1.sqspcdn.com/static/f/1003521/14628065/1318577037160/B737%2BFlight%2BDeck%2BMeasurements%2BInformation%2BSheet.pdf

This is a simulator-building reference, not certified Boeing geometry. Its
frame drawing shows widening towards the rear and a narrower top than bottom.
For **both** mirrored No.3 panes the fitted inputs are:

| Property | Basis |
| --- | --- |
| Width 0.60 m | Approximate rear side-window extent in the side/plan drawings, fitted to this asset; not a dimensioned glass measurement |
| Height 0.44 m | Existing No.2 profile height, retained at the seam; not a measured No.3 height |
| Centre x = ±0.70 m | Fitted to decoded native liner intersections at approximately 0.59–0.66 m; the reference's wider frame spans cannot be used unscaled |
| Centre y = 0.95 m | Same belt line as existing No.2 glass |
| Centre z = -11.79 m | Adjacent to No.2's aft edge with a narrow separator; fitted in aircraft coordinates |
| Rotation x = 0.70, y = ∓1.22 rad | Rectangular approximation to the inward top rake and widening aft outline; normals are (±0.939, 0.221, -0.263), not rear-facing |

The rectangular replacement is intentionally approximate. It is not a measured
trapezoidal glass asset, and none of the fitted centres/angles should be mistaken
for aircraft manufacturing dimensions. The original No.1/2 values are unchanged.

**Correction to the issue:** No.4/5 are optional upper eyebrow windows, not a
second pair of aft side windows. More importantly, a pane behind a pilot need not
have an aft-facing normal. The reference outline widens aft. We therefore do not
invent a rear-facing pane or promise nonzero acceptance at every bearing. At
20°/40° elevation, a sun exactly astern still sees no opening. The sampled
nose-to-tail response decreases on each side; azimuth is periodic, so a response
cannot strictly decrease through a complete 360° turn.

## Matching the solid model

The loaded interior has opaque liners between the eye and the new optical panes.
The change uses the issue's shadow-only alternative, not a visible asset rebuild.
Before static batching, `bindCockpitSideWindowShadows()` builds depth-only proxies for
Body002/006/018. It subtracts pane-aligned rectangular tunnels from those copies,
splitting boundary-crossing triangles and interpolating attributes. The bounded
0.50 m half-depth reaches the narrower native liners without the opposite wall.
Seats, controls, instruments and the native window posts remain shadow casters.

The original liners skip only the tagged cockpit-sun pass; the cut proxies draw
only in that pass and write neither colour nor beauty depth. Main-sun shadows,
visible geometry and GLB files remain unchanged. Static batching preserves these
special meshes and their pass hooks. No tinted quad is placed over the solid
sidewall. This remains a virtual aperture: a future remodel is needed to see
through actual No.3 glass. It must not be described as completed visible windows
or a fully measured light-transfer asset for #163.

## Measured projected-area response

Fractions of each profile's own best-accepting direction, old → new:

| Elevation | 0° | 45° | 90° | 135° | 180° |
| --- | --- | --- | --- | --- | --- |
| 20° | .997 → 1.000 | .851 → .938 | .437 → .615 | .104 → .224 | 0 → 0 |
| 40° | .913 → .941 | .801 → .875 | .448 → .599 | .077 → .198 | 0 → 0 |

Beam intensity and the flood-dimming law are unchanged. This increases modelled
aperture area rather than concealing missing geometry with a response curve.

## Verification

`tests/cockpitSideWindows.test.js` checks both aft quarters, sampled monotonicity,
shared pane identities, shadow-pass restoration, triangle-area conservation,
UV interpolation and bounded cut depth. The existing sunlight suite now checks
all six optical panes, including back-face clearing and full-turn continuity.

The asset regression decodes the shipped medium GLB, checks that both side
apertures were blocked by real liner triangles, and verifies that the depth
proxies clear those rays while preserving the original meshes through batching.

For GPU A/B acceptance, start Vite and open
`/scripts/verify-cockpit-side-windows.html`. Run the six-frame comparison after
loading. It compares four-pane/closed-depth and six-pane/cut-depth states of the
same loaded scene and reports admittance, flood intensity and cockpit-region
luma, with paired captures. It does not assert that every pixel gets darker:
additional direct beams can brighten receivers while the instrument floods dim.

**Current validation limit:** the final shadow-only implementation has Node/GLB
coverage, but its six-frame GPU comparison has not been completed. The browser
connection became unavailable. Earlier interactive screenshots tested an
abandoned visible-cut approach and are not evidence for this final implementation.
