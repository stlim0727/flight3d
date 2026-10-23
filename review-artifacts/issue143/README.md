# Aircraft shadow evidence

Captured with `scripts/verify-aircraft-shadows.mjs --gpu` on Windows Chrome,
Intel Arc 140V / ANGLE Vulkan. [Complete report](results.json) covers both the
loaded GLB and procedural fallback at three solar times, including cockpit-mode
ground shadows. The selected images below are the loaded model at 08:00.

| Receiver | Final render | Shadow intensity off | Shadow difference ×8 |
| --- | --- | --- | --- |
| Wing | [lit](loaded-8-wing-lit.png) | [off](loaded-8-wing-shadow-off.png) | [diff](loaded-8-wing-diff.png) |
| Horizontal tail | [lit](loaded-8-tail-lit.png) | [off](loaded-8-tail-shadow-off.png) | [diff](loaded-8-tail-diff.png) |
| Belly (inverted) | [lit](loaded-8-belly-lit.png) | [off](loaded-8-belly-shadow-off.png) | [diff](loaded-8-belly-diff.png) |
| Ground, exterior | [lit](loaded-8-ground-lit.png) | [off](loaded-8-ground-shadow-off.png) | [diff](loaded-8-ground-diff.png) |
| Ground, cockpit mode | [lit](loaded-8-ground-cockpit-lit.png) | [off](loaded-8-ground-cockpit-shadow-off.png) | [diff](loaded-8-ground-cockpit-diff.png) |

The paired images hold pose, sun and illumination fixed and remove only shadow
intensity. Differences therefore show cast shadows rather than general lighting.
Raycast receiver and source checks are described in the
[verification notes](../../docs/development/aircraft-shadows.md).
