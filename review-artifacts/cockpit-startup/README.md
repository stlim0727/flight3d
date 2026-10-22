# Cockpit interior startup evidence

Captured with `npm run test:cockpit` (headless Chrome 1440×900, ANGLE/Vulkan,
Vite dev server). Re-run with `ARTIFACT_DIR=/tmp/... FORCE_GPU=0` for a
SwiftShader run.

`mode` is the camera mode: 0 = COCKPIT, 1 = CHASE. `loaded` is
`cockpit.gltfCockpitLoaded`, `mountedDisplays` whether the live PFD/ND/EICAS/MCP/CDU
group is parented to the interior.

## Cold load (`cold-load-frames.json`, `1_cold_load_view.png`)

Sampled on every animation frame from before the first page script runs:

- The first rendered frame is the exterior view (mode 1), not the cockpit.
- 11 frames pass while the 3.8 MB interior GLB downloads; none of them are in
  cockpit mode, so there is no interior to swap out from under the camera.
- The GLB resolves and mounts its displays at ~10.3 s; the demo cuts into the
  cockpit at ~10.8 s and holds it.
- No frame is in cockpit mode without a loaded interior, and the live display
  group is never mounted before its GLB resolves.

Before this change the vector cockpit was the cockpit view's first paint and the
GLB replaced it mid-shot; the vector geometry is now deleted.

## Interior unavailable (`failed-asset-run.json`, `2_interior_unavailable_exterior.png`)

Both `b737-cockpit-medium.glb` and `b737-cockpit-draco.glb` are failed at the
network layer, so `cockpitModelFailed` is the only remaining state:

- Requesting cockpit mode returns to chase within a frame and toasts
  "Cockpit interior unavailable — showing exterior view".
- The screenshot shows the 737 exterior on the runway with that toast, proving
  cockpit mode no longer renders open sky now that the vector fallback is gone.
