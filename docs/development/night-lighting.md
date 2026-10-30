# Airport and instrument night lighting

`AirportNightLighting` supplies coastal, Lukla and Incheon airport lighting.
Intensity follows solar direction continuously between sun heights -0.10 and
0.08 (approximately -6 to +5 degrees), so twilight brings the lights on and
sunrise extinguishes them. Night ambient light and HDR reflection floors remain
well below daylight but retain enough detail to read nearby aircraft and terrain.

Runway edge and bidirectional threshold/end lamps share a single Points draw.
Their small screen-space halos keep them visible on approach; the shader uses
the renderer's logarithmic depth buffer so buildings and terrain still occlude
them. Looking into a threshold shows green; looking outward from the runway
shows red. Lukla lights interpolate the runway elevation. These are simulator
visual aids, not a claim that real Lukla supports night operations.

Each airport has six to eight unshadowed apron/street SpotLights, with visible
pole fixtures. Runway lights do not add individual Three.js lights. Lamps are
children of their airport group, so airport switching excludes inactive lights.
Lukla lamps follow the apron transform; Incheon lamps sit on the mapped apron
beside the departure stand. Floods aim across the apron at aircraft height,
with stronger output and overlapping coverage. No collision surfaces or navigation routes change.

Terminal/tower glazing uses cloned emissive materials, preserving cached GLB
materials and restoring the original appearance during the day. Late GLB loads
inherit the current lighting level. Incheon's facade emission masks illuminate
only window texels, leaving wall frames and roofs dark. A deterministic room
palette varies warm/neutral/cool light, brightness and vacancy across all airport
facades; a subtle vertical falloff adds depth without animated flickering. These simulate light
from occupied rooms; they do not add modeled building interiors.

Boeing retains its baked, automatically controlled flight-deck floods and live
emissive displays. C172 and F-16 add a short-range, shielded instrument-panel
SpotLight in aircraft coordinates, aimed below the pilot's eye. It follows the
same twilight curve and loses power on crash. It does not change PFD/MFD content.

Logic and geometry coverage: `tests/airportNightLighting.test.js`, plus existing
airport-building and aircraft suites. Rendering acceptance still requires the
hardware Chrome procedure in [browser-gpu.md](browser-gpu.md), with night/day,
airport switching, approach and cockpit screenshots.
