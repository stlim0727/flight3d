# Pavement comparison — 2026-10-21

Base: upstream main `184ec96`. After: this issue #8 follow-up. Both already use
the existing 1K PBR textures, rubber streaks and repair patches; the comparison
shows the added sealed cracks and Lukla foundation clearance fix.

Windows, Chrome 155.0.8059.85 (headless), Intel Arc 140V GPU (8GB), ANGLE D3D11,
1200×800, DPR 1, ACES tone mapping, identical camera/light/time per pair.
The production classes are used with asynchronous building-kit replacement
disabled. Coastal views include terrain; Lukla is isolated without loaded DEM.

| View | Before calls | After calls | Median ms before → after | p95 ms before → after |
| --- | ---: | ---: | ---: | ---: |
| Coastal approach | 322 | 324 | 1.0 → 0.9 | 2.4 → 1.6 |
| Coastal close | 218 | 220 | 0.5 → 0.6 | 1.7 → 2.0 |
| Coastal apron | 186 | 187 | 0.5 → 0.8 | 0.9 → 2.0 |
| Coastal night | 322 | 324 | 1.0 → 1.1 | 2.1 → 2.8 |
| Lukla approach | 89 | 91 | 0.4 → 0.3 | 0.9 → 0.8 |
| Lukla close | 75 | 77 | 0.3 → 0.3 | 0.8 → 1.4 |
| Lukla apron | 53 | 54 | 0.3 → 0.3 | 1.6 → 0.7 |
| Lukla night | 89 | 91 | 0.5 → 0.3 | 1.6 → 0.8 |

20 warm-ups, 45 samples with `gl.finish()` per view. Small differences are noisy;
these synchronized render-only samples do not establish flight frame rate.
The added texture costs an estimated 1,398,101 bytes (1.33MiB RGBA8 + mipmaps),
shared across both airports. Estimated airport texture totals: coastal
34,603,008 → 36,001,109 bytes; Lukla 35,302,059 → 36,700,160 bytes. These are
image-dimension estimates, not measured driver allocations. The six downloaded
maps remain 3,803,265 bytes before and after, verified by SHA-256; the crack
artwork adds no image transfer. Source code transfer is slightly larger.

The close and approach views show rough, matte pavement without obvious static
moire, specular glitter, or missing pavement. The coastal terrain boundary,
runway numbers/markings, and lights remain visible. The new cracks are subtle
branching lines and fade through filtering at distance. Lowering the Lukla
foundation removes its exact coplanarity while retaining the apron outline.
Static screenshots do not prove temporal stability, full DEM terrain seams,
mobile performance, or full-flight acceptance. No 60fps guarantee is made.

All six maps loaded; shader diagnostics and browser errors passed. PAPI passed
2° → 3° → 4° → 2° transitions, with 0 → 2 → 4 → 0 white lamps, and approach
strobes remained active. Node 22.23.2: `npm ci`, `npm run check`, all 286 tests,
and `npm run build` passed. Base inspection reproduced foundation top = 0,
exactly matching the apron plane; the regression requires it below 0.

## Images

Each pair uses the same camera, lighting, animation time and resolution.
Raw [results.json](results.json) includes unrounded timings and GPU details.

| View | Before | After |
| --- | --- | --- |
| Coastal approach | [PNG](before-Airport-approach.png) | [PNG](after-Airport-approach.png) |
| Coastal close | [PNG](before-Airport-close.png) | [PNG](after-Airport-close.png) |
| Coastal apron | [PNG](before-Airport-apron.png) | [PNG](after-Airport-apron.png) |
| Coastal night | [PNG](before-Airport-night.png) | [PNG](after-Airport-night.png) |
| Lukla approach | [PNG](before-LuklaAirport-approach.png) | [PNG](after-LuklaAirport-approach.png) |
| Lukla close | [PNG](before-LuklaAirport-close.png) | [PNG](after-LuklaAirport-close.png) |
| Lukla apron | [PNG](before-LuklaAirport-apron.png) | [PNG](after-LuklaAirport-apron.png) |
| Lukla night | [PNG](before-LuklaAirport-night.png) | [PNG](after-LuklaAirport-night.png) |

Reproduction: [pavement acceptance](../../docs/development/pavement.md).
