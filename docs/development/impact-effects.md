# Impact effects

`ExplosionSystem.spawnExplosion(result, worldVelocity)` receives the velocity
before `triggerCrash` damps it. Visual spread follows squared impact speed, with
bounded particle counts; emitted dust and fragments inherit world momentum.

- Water uses ballistic spray and a soft, expanding surface ring at sea level.
  Spray stretches during ascent, falls under gravity, and fades at the surface.
  Water emits no fire, flash light, glowing fragments or persistent black smoke.
- Terrain uses brown dust; structures use grey dust. Dust slows and settles.
  Solid impacts emit small, non-additive fragments, with a short heat flash and
  limited fire at high speed. No horizontal shockwave floats at building height.
- Reset disposes particle materials/ring geometry and clears lights. Shared
  atlases are retained until system disposal. Particle counts remain bounded.

These are particle effects, not fluid simulation or structural deformation.
Damage detection and audio remain separate from particle emission. Aircraft
breakup and its camera are described below.

## Verification

Run `node --test tests/effectFlipbook.test.js` for water/solid separation,
ballistic settling, speed scaling, lifetimes, budgets and reset sequences.

Start Vite, then use the project browser lease:

```sh
PORT=5188 CRASH_SCREENSHOTS=0 ARTIFACT_DIR=review-artifacts/impact-realism \
  chrome-session --project flight3d node scripts/test-crash-scenarios.js
```

The script checks tower, water, terrain, building, tree, runway excursion and
restart. It also asserts that collision detection and effect emission receive the
same preserved pre-contact velocity, including a body-contact case where the
contact impulse changes the live velocity. It then renders controlled effect scenes at 0.4 and 2.4 seconds, checks
shader diagnostics and captures all three materials. Controlled captures show
particle appearance without the aircraft/HUD occluding them; they do not replace
collision assertions or establish whole-scene camera acceptance. Omit
`CRASH_SCREENSHOTS=0` for the ordinary in-flight captures as well.

See [captured effects](../../review-artifacts/impact-realism/README.md).

## Aircraft breakup and crash camera

`AircraftBreakup` partitions the active exterior's triangles into left/right
outboard regions and four longitudinal center sections. It retains source
materials/UVs, including batched GLBs and the 737's separate procedural landing
gear, and hides the intact aircraft until reset.
Debris inherits pre-contact world velocity plus a bounded outward impulse, then
integrates gravity, drag, rotation and damped terrain contact in the shared 120 Hz
physics steps. Debris begins advancing on the tick after impact, so deterministic
stepping applies only post-impact time without truncating long requests. Paused
physics also holds debris. Water drag and seabed restitution vary with each
piece's immersed height above the current terrain, independently of the collision
label. This lets ship-impact debris sink and water-impact debris reach dry land.
Scenes without a visible ocean supply no water surface.

After the selected airframe finishes loading, `prepareCrashVisuals` partitions its
geometry off-scene and starts `compileAsync` with the current scene lighting.
Initial startup waits for this shader warmup behind the loading overlay; later
model swaps start warmup before the next physics frame. Impact reuses those
buffers, samples current source transforms/materials and visibility (including
stowed/deployed gear), and positions rigid fragments without copying vertices.
C172 flexible struts retain a source-vertex mapping: when suspension deformation
changes their position-buffer version, impact refreshes those small fragments'
positions/normals and bounds in place. Their buffers are still reused, and rigid
airframe/wheel geometry is not refreshed.
Reset retains the prepared buffers for another crash. Selecting another aircraft
or changing between loaded/procedural geometry disposes the previous cache;
`disposePrepared()` releases it explicitly. Source materials/textures stay shared.
The cache retains one selected aircraft's expanded geometry, trading memory and
preparation time for a shorter impact task. Direct callers without preparation
still build synchronously as a fallback.

The camera cuts immediately outside, fits the debris bounds (including portrait
aspect ratios), follows its center and prevents view switches until crash reset.
Reset restores the previous view, user/automatic camera selection state and the
intact aircraft. Deterministic steps snap the camera to the final debris bounds.
Node verification is `node --test tests/aircraftBreakup.test.js tests/crashPreparation.test.js tests/f16.test.js tests/physicsTiming.test.js`;
`test:crash` checks the exterior view, complete loaded geometry including gear,
camera reset, and equal debris/camera state for one 10-second request versus ten
1-second requests. It captures `aircraft_breakup_exterior.png`.

## Crash response and realism rollout

1. **Prepare breakup before impact (this change).** Reuse partitioned geometry
   and start debris material shader compilation before collision. Preserve current
   gear poses, material changes, reset behavior and camera framing. Browser checks
   verify buffer identity across impact and report setup time for all three aircraft.
2. **Remove remaining first-frame GPU/effect stalls.** Measure actual collision to
   first presented crash frame, separately from CPU setup. Warm shadow variants,
   upload debris buffers/textures and prepare bounded particle pools off-screen.
   Cover first/repeated crashes, aircraft/quality changes and slower devices. A
   breakup-only render measurement does not include particle/audio/debrief work;
   `compileAsync` alone does not guarantee a stall-free first frame.
3. **Improve fracture surfaces.** Replace open regional cuts with authored or
   prepared closed fracture meshes, exposed internal surfaces and damaged materials.
   Keep the mesh/draw-call budget bounded and review close-range screenshots.
4. **Improve impact-dependent motion and effects.** Derive fragment impulses/spin
   from contact position, surface normal, incoming momentum and angular velocity.
   Improve ground sliding/settling, directional dust/spray, and severity/fuel-based
   fire. Verify low/high-energy terrain, runway, structure and water impacts over
   time, alongside camera and reset sequences.

The three-second crash-to-debrief timer is separate from impact rendering. This
rollout does not shorten that viewing interval or claim the observed end-to-end
delay is fully resolved by step 1.

This is a bounded visual breakup approximation, not a structural solver: region
boundaries have open cut faces, and debris uses approximate terrain contact radii.
It does not simulate collisions between fragments or with buildings after impact.
