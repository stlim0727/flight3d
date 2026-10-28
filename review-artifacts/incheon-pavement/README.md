# Incheon runway-entry overlap

The original runway and taxiway/apron color batches occupy the same Y plane.
At the actual 33L entry near (465, -766), camera motion changes which coplanar
fragments win depth testing. The comparison recreates those original batches
from the frozen production airfield data and uses the new production pavement
builder for the fix. Markings, widths and heights match between versions.

The fix subtracts rendered runway triangles from non-runway pavement. It retains
the paved union, source holes, original +1.5 cm surface / +3 cm paint heights,
source coordinates, colors and four material batches. Ground grading, contact
and collision data are unchanged.

2026-10-28 validation:

- Syntax/action-pin checks, 794 Node tests and production build passed.
- Three new geometry tests cover single-surface intersections, union area,
  unchanged Y/source data, apron holes and multi-segment runway masks.
- The shared project Chrome rendered with Intel ADL-N Vulkan hardware and
  logarithmic depth, near 0.08 m and far 45,000 m.
- Four viewpoints (cockpit, approach, drone, far) each used five camera offsets.
  Surface-only pixels were compared against a runway-only reference at the same
  pose: 408,004 mismatches before, 2 boundary pixels after, across 2,579,721
  sampled runway pixels. Every fixed sample passed the 0.05% boundary tolerance.
- No application, shader or WebGL readback errors. See `results.json`.
- Before/after captures include the unchanged painted centerlines; screenshots
  were visually inspected. Quantification hides paint to isolate pavement color.

This is an isolated production-pavement rendering comparison, not a full-scene
FPS or flight-physics benchmark. Reproduce with the commands in
`docs/development/incheon-flight.md`.
