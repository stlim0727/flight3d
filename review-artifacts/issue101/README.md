# Issue 101: cockpit stutter mitigation

Verified on headless Chrome with ANGLE/Vulkan at 1440 × 900 on the Lukla runway.
`browser-results.json`, `cockpit.png`, and `gear.png` record the medium model;
`fallback/` records a second run with the medium GLB blocked to exercise Draco.

- Medium cockpit: 123 nonempty model meshes; batching eliminates 2,372 mesh
  submissions relative to the extracted, unbatched hierarchy. Each moving pivot
  batches only its own surfaces; static panels never absorb controls.
- Draco fallback: 118 nonempty model meshes, with eight independent moving pivots.
- Ten display updates: PFD/ISFD 10 redraws each, ND/EICAS 5 each, MCP/CDU 0
  unchanged redraws. An MCP selection change redraws once. Deterministic stepping
  refreshes both ND and EICAS immediately.
- Held/reversed/released controls restore their neutral transforms. Yokes still
  hide and show. No uncaught browser exceptions were recorded.
- Gear camera raised 0.20 m (local Y -2.6 → -2.4). The existing 0.25 m exterior
  near plane is retained: it already exceeds the issue's requested 0.15 m.
- Whole-scene render calls include environment, shadow passes, framing and live
  display surfaces; they are not the count of cockpit model meshes.

Shader warmup awaits `compileAsync` with scene fog/lights and temporarily includes
hidden cabin lights while gathering programs. This does not pre-upload all mesh
buffers/textures. These bounded checks do not establish a locked 60 FPS, a <20 ms
cold switch, or absence of every rollout spike; those issue estimates remain
hardware-dependent and require a dedicated timing benchmark.

Validation: `npm run check`, `npm test` (289 passed), `npm run build`; geometry
coverage includes nested transforms, preserved bounds/UVs, moving descendants,
and mirrored indexed/nonindexed winding and tangent handedness. Display tests
cover unchanged state, selection changes, stall caution release, and route changes.

To reproduce, start Vite and open the app in headless Chrome with CDP on port
9451 (or set `CDP_PORT`). Run:

```sh
node scripts/verify-cockpit-stutter.mjs
FALLBACK=1 ARTIFACT_DIR=review-artifacts/issue101/fallback node scripts/verify-cockpit-stutter.mjs
```
