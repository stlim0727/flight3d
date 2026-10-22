# Cockpit shadow contrast acceptance

Source: `fix-cockpit-shadow-contrast`, rebased onto main `f94296b`; refreshed after the PR #156 AO-depth review fix.
Node 22.23.2; Chrome/ANGLE Vulkan on Intel ADL-N; 1280×720, balanced quality.

The sunlight verifier passed all ten frozen poses, plus independent window-frame
casting and AO ablations. Staging now waits for the camera-entry light ramp and
does not integrate flight physics between comparison frames.

- [Clear afternoon cockpit](deck-sun-golden.png)
- [Frozen ablation reference](contrast-final.png)
- [Same pose with native window-frame casting disabled](contrast-frame-casting-off.png)
- [Same pose with contact AO disabled](contrast-ao-off.png)
- [Portrait resize](portrait.png)
- [Full sunlight report](deck-sun-report.json)
- [AO cost and quality/resize checks](extra-checks.json)

The direct-sun ablation changes 9.02% of the frame. Panel maximum luma difference
is 57, versus 22.1 in the earlier issue90 reference run. These are separately
staged runs, not a pixel-aligned before/after image metric. The window-frame-only
ablation changes 5,664 deck pixels by more than 3 RGB levels, peaking at 17;
AO changes 297,275 deck pixels, peaking at 61.33. Neither ablation changes the sampled
outside-window or live instrument-display patches. Repeat-render noise affected one deck pixel
in this final capture. The only browser resource errors were missing favicon.ico.

AO is contact/crease shading. A yoke's projected sunlight shadow still follows
the sun and can fall behind the pilot, outside the visible panel. Its geometry
and visibility now invalidate the cached sun shadow; a separate overhead-light
experiment was not retained because it did not improve the visible silhouette.

The static render-only loop measured 8.73 ms with AO and 3.73 ms without AO
(12 frames each). This omits physics/UI work and is not a live frame-rate claim.
The full verifier measured 124.66 ms with cached sun shadows versus 188.36 ms
forcing their repaint. Performance quality bypassed AO. Portrait AO was 195×422,
with projection matching the 390×844 camera and the main camera layers restored.

Validation: `npm run check`, all 406 Node tests, `npm run build`, and
`CDP_PORT=9471 ARTIFACT_DIR=review-artifacts/cockpit-contrast-acceptance node scripts/verify-cockpit-shadows.mjs`.

Review regression: SSAOPass now starts with the 8 m camera range, and both SSAO
and depth-display near/far uniforms plus normalized rejection bounds follow the
current AO camera on every render. A numerical contact test fails on the previous
code (far=45000) and passes for 1.0/1.1 m surfaces, changed near planes, portrait
projection and balanced/high quality. Browser reports show all three depth
ranges at 0.08–8 m in landscape and portrait. With correct depth, AO is capped at
25% darkening so the window-frame cast-shadow bands remain visible.
