# Cockpit shadow contrast acceptance

Source: `fix-cockpit-shadow-contrast`, rebased onto main `f94296b`.
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

The direct-sun ablation changes 9.39% of the frame. Panel maximum luma difference
is 75, versus 22.1 in the earlier issue90 reference run. These are separately
staged runs, not a pixel-aligned before/after image metric. The window-frame-only
ablation changes 6,994 deck pixels by more than 3 RGB levels, peaking at 21.67;
AO changes 7,250 deck pixels, peaking at 8. Neither ablation changes the sampled
outside-window or live instrument-display patches. Repeat-render noise was zero
in this final capture. The only browser resource errors were missing favicon.ico.

AO is contact/crease shading. A yoke's projected sunlight shadow still follows
the sun and can fall behind the pilot, outside the visible panel. Its geometry
and visibility now invalidate the cached sun shadow; a separate overhead-light
experiment was not retained because it did not improve the visible silhouette.

The static render-only loop measured 5.81 ms with AO and 2.78 ms without AO
(12 frames each). This omits physics/UI work and is not a live frame-rate claim.
The full verifier measured 124.26 ms with cached sun shadows versus 187.71 ms
forcing their repaint. Performance quality bypassed AO. Portrait AO was 195×422,
with projection matching the 390×844 camera and the main camera layers restored.

Validation: `npm run check`, all 405 Node tests, `npm run build`, and
`CDP_PORT=9471 ARTIFACT_DIR=review-artifacts/cockpit-contrast-acceptance node scripts/verify-cockpit-shadows.mjs`.
