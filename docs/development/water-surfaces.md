# Water surface classification

CollisionDetector asks the active terrain's `isWater(x, z)` at each contact
probe's world X/Z (metres). Elevation alone does not identify water. Missing
membership means no water detection; new maps must explicitly define membership
and include a dry-ground / water regression test where applicable.

Membership and vertical contact are separate: the current detector retains
`probe.y <= (terrain.waterLevel ?? 0) + 0.5` metres and its existing speed gate
(`speed >= 5 m/s` or `abs(vertical speed) >= 1 m/s`). These are crash detection
approximations, not buoyancy or a wave-contact solver. Visibility and the render
water object do not define physics. Forces, gear contacts and integration are
unchanged by this classification contract.

- Coastal: analytic ground below mean sea level (0 m) is covered by ocean.
  The former global 2.5 m lowland allowance no longer applies.
- Neon, Lukla, generated valley: no water.
- Incheon core: exact coastline predicate, including polygon holes.
- Incheon regional extension: membership in the land-only indexed triangle mesh,
  using the existing barycentric query. Missing ground returns `null` internally,
  distinguishing sea from land whose elevation happens to be 0 m; public ground
  heights still return 0 for sea. Raised additional surfaces retain their existing
  solid/contact handling and do not redefine the underlying water footprint.
- Han River common detector: river corridor excluding Nodeulseom's elliptical
  base footprint, using the course's water level.

Han River also runs a dedicated swept part-envelope detector before the common
detector. Its existing bank-as-water classification and boundary contact precision
are tracked separately in [#471](https://github.com/stlim0727/flight3d/issues/471).
The shared membership added here does not fix that independent path.

Review and staged work: [#470](https://github.com/stlim0727/flight3d/issues/470).
