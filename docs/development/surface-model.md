# Common ground / water contact classification

`physics/SurfaceModel.js` selects the exposed surface at world X/Z in metres.
Maps register layers with a `type` and either a constant `height` (flat water) or
`heightAt(x,z)` (existing geometry sampler). A sampler returns `null` for missing
ground, preserving the distinction between a sea-level road and open water.
The highest surface wins; solid ground wins equal-height ties. There are no map
names, `isWater` implementations, or renderer visibility checks in this decision.
Maps without registered layers use their existing heightfield as dry ground.

Coastal terrain registers its existing heightfield plus a zero-metre sea plane.
Incheon registers nullable ground from the existing coastline cache / regional
triangle mesh plus the same plane. Interior coast cells reuse `landNodes`; only
coast cells query the polygon. No new raster, geometry asset or coastline copy is
created. Han River registers the existing bank function, tapered elliptical island
and course water level. Geometry providers describe coverage and height; the
common selector owns ground-versus-water classification.

Both the general collision detector and Han River's swept part detector query
this model. Each query uses the contact probe/corner's own world position (+Y up).
The general detector retains its speed gate (5m/s horizontal-plus-vertical speed
or 1m/s absolute vertical speed) and 0.5m water tolerance. Han River retains its
0.15m part margin, interpolation steps and no speed exemption. These are contact
approximations; force integration, buoyancy and waves are not changed.

Solid obstacles (Han River bridges, ships, buildings and the pavilion) retain their existing
volume collision geometry. A bridge roof must not become a terrain heightfield:
its elevated surface would incorrectly hide water beneath it. Han River's existing
island/pavilion volume checks remain, while bank/water contacts use transformed
part corners rather than the aircraft centre combined with a world AABB minimum.
Corners are sampled envelopes, not exact triangle-triangle continuous collision.
Sihwa's existing raised roads/decks are still heightfield overlays; this change
preserves that representation and does not introduce underpass volume collision
for those assets.

Tests cover dry zero-elevation ground, submerged ground, missing ground, elevated
water, coastline/mesh data, contact-side queries, speed gates, bank/island/water,
environment switching and reset. Browser evidence and CI are recorded in the PR.
