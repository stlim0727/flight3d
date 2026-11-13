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

Beam intensity is unchanged. This increases modelled aperture area rather than
concealing missing geometry with a response curve. Since the light-transfer bake
(#163, [cockpit-light-transfer.md](cockpit-light-transfer.md)) the floods no longer
follow aperture admittance, so these fractions are a diagnostic and the cookie
leak term; they do not dim or brighten the instruments.

## Verification

`tests/cockpitSideWindows.test.js` checks both aft quarters, sampled monotonicity,
shared pane identities, shadow-pass restoration, triangle-area conservation,
UV interpolation and bounded cut depth. The existing sunlight suite now checks
all six optical panes, including back-face clearing and full-turn continuity.

The asset regression decodes the shipped medium GLB, checks that both side
apertures were blocked by real liner triangles, and verifies that the depth
proxies clear those rays while preserving the original meshes through batching.
It only decodes the `Body*` liners, so it cannot see the other interior meshes
described below.

For GPU A/B acceptance, start Vite and open
`/scripts/verify-cockpit-side-windows.html`. It loads the interior, enters the
shadow demo through developer mode and, for the six demo views plus two aft
quarters, renders the same frame with the proxies cut, the proxies closed and the
deck sun off. It reports four- and six-pane admittance, flood intensity and the
share of pixels that change. Keep the Browser window visible.

## GPU result (2026-11-13)

Run on Chrome/ANGLE D3D11, Intel Arc 140V, `lightingBakeStatus: ready`, five
depth proxies, pilot view (camera mode 0):

| View (bearing°, elev°) | Admittance 4 → 6 panes | Pixels changed: cut vs closed | Pixels changed: deck sun vs off |
| --- | --- | --- | --- |
| leftFront (-65, 22) | .704 → .842 | 0% | 0.75% |
| front (0, 25) | .988 → .996 | 0% | 0.81% |
| rightFront (65, 22) | .704 → .842 | 0% | 1.86% |
| right (100, 40) | .338 → .496 | 0% | 0.10% |
| high (0, 65) | .655 → .709 | 0% | 1.51% |
| low (-35, 12) | .884 → .942 | 0% | 0.68% |
| rightAft (135, 20) | .104 → .224 | 0% | 0% |
| leftAft (-150, 20) | .013 → .090 | 0.15% | 0.15% |

Floods read 0 in every frame: with the bake ready they are folded into the
transfer, and nothing in the frame follows admittance. The over-brightening that
#164 reported (+26 to +55 mean luma) therefore no longer has a mechanism.

The side apertures themselves admit almost no direct light on the GPU. Turning
the view ±0.8 and ±1.6 rad gives the same result. Rays traced inward along the
sun direction from a 5 × 5 grid on each No.3 pane, in the raw medium GLB with the
cut liners ignored, are stopped within about 5 cm by meshes that are not liners:

| Sun (bearing°, elev°) | Pane | Rays clear | First blockers |
| --- | --- | --- | --- |
| 90, 20 | 3R | 36% | `Cube1075` side panel, `cockpit_door` |
| 100, 40 | 3R | 12% | `Cube1075`, `cockpit_door` |
| 120, 30 / 135, 20 | 3R | 0% | `Cube1075`, `cockpit_door` |
| -100, 40 | 3L | 20% | `Cylinder817`, `cockpit_door` |
| -150, 20 | 3L | 20% | `cockpit_door`, `Cylinder817` |

`cockpit_door` is the aft bulkhead (z -11.79 to -11.66, spanning the deck width),
so the aft part of each fitted No.3 rectangle lies behind it. `Cube1075`
(x 0.17 to 0.71, y 0.23 to 1.34, z -12.20 to -11.79) fills the right sidewall
from the No.2 aft edge back to the bulkhead; `Cylinder817` does the same at the
left (x -0.77 to -0.49, z -12.03 to -11.78). The asset has no free sidewall where
a No.3 window would be. These are panels and the bulkhead, not window posts, and
they are deliberately left as casters: cutting them too would admit sun through
solid geometry, which is the leak #164 warned against.

## Status

#164 is closed on this basis: the profile is split, No.3 is authored with
provenance, the depth proxies agree with the cookie for the liners, and the
reported flood over-brightening is gone. Real aft-quarter sunlight in the deck
needs a cockpit model with No.3 openings and free sidewall behind them. Until
then the six-pane admittance overstates what reaches the deck at side and aft
bearings. #163's transport traces the same geometry with the same cut proxies, so
it should meet the same blockers; that has not been measured separately.
