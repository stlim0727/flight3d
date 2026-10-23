# Aircraft self-shadowing (#143)

The main directional sun follows the displayed aircraft pose at the final render
boundary. Its orthographic half-size stays at 32 m within 60 m of the aircraft,
then grows continuously by 0.2 m per metre of camera distance, capped at the
previous 120 m. The minimum encloses the whole 737 through heading and bank;
remote tower/flyby cameras retain broader scenery coverage. There is still only
one exterior sun, without cascades.

The existing quality keys select 1024² (`performance`), 2048² (`balanced`) or
4096² (`high`) maps. Close-view texels are respectively 6.25, 3.125 and 1.5625 cm,
compared with 11.72 cm before at balanced quality. Startup and live quality changes
both apply the tier; a changed allocation disposes the previous GPU target and
respects the renderer's maximum texture size.

The depth range remains 1–2000 m to preserve ground receivers below the aircraft.
Depth bias changes from -0.0003 (~60 cm over that range) to -0.00002 (~4 cm), with
4 cm normal bias. The smaller depth bias retains thin gear/wing shadows; the
normal offset suppresses grazing-angle acne. The first 0.8 cm / 1.5 cm trial
produced visible striping and was rejected after inspecting the difference images.
The cockpit's separate localized sun, shadow cache and proxy visibility are
unchanged. See [cockpit sunlight](cockpit-sunlight.md).

## Browser verification

Start Vite and run the acceptance tool with Node 22.23.2:

```sh
npm run dev -- --host 127.0.0.1 --port 5193 --strictPort
SIM_URL=http://127.0.0.1:5193 node scripts/verify-aircraft-shadows.mjs --gpu
```

On Windows set `SIM_URL` and `CHROME_PATH` with PowerShell environment variables;
`CHROME_PATH` should point to the installed Chrome executable. The script launches
its own headless browser on CDP port 9459 (`CDP_PORT` overrides it). `--gpu` selects
ANGLE/Vulkan; omitting it selects SwiftShader. `ARTIFACT_DIR` overrides the output
directory, which defaults to `.tmp/aircraft-shadows`.

The tool exercises real GPU allocation through performance → high → balanced,
then stages 30 static frames: loaded GLB and procedural fallback × 08:00, 12:30,
16:48 × wing, tail, belly, ground and cockpit-mode ground. It uses the actual
aircraft, atmospheric lights and HDR environment in an isolated scene with a
plain ground receiver to exclude moving scenery from the measurement.

Each frame is rendered twice unchanged for a noise floor, once with only shadow
intensity removed, and once with only direct sun removed. Raycast receiver masks
restrict measurements to the named surface. A second ray toward the sun checks
that the expected body, vertical tail or gear blocks it, so light-off differences
alone cannot pass as self-shadow evidence. Every receiver must have a measurable
shadow at one or more tested hours; no artificial shadow is required when solar
geometry leaves the surface fully lit. Belly views use an inverted aircraft:
sun above a level aircraft cannot cast landing gear upward onto its belly.

Recorded run: Windows Chrome, Intel Arc 140V, ANGLE/Vulkan. All 30 cells passed;
all repeat renders had zero noisy pixels. At 08:00 the loaded model had 72 body →
wing, 15 vertical tail → horizontal tail, and 48 gear → belly samples that both
darkened with shadows enabled and had the expected geometric occluder. Ground
shadows also passed in exterior and cockpit modes for both models.

See [selected captures and the complete numerical report](../../review-artifacts/issue143/README.md).
Node tests separately check frustum containment through attitude changes and
near/far camera cuts, map disposal, texture limits, existing airport receivers,
and cockpit proxy behavior. This is a static rendering check, not full flight,
mobile interaction, frame-rate benchmarking or a complete cockpit interior
acceptance run.
