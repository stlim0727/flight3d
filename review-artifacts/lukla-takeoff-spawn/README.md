# Lukla takeoff spawn evidence

The `runway` preset at Lukla used to place the aircraft at the low (cliff) end of
the strip on heading 058° facing uphill, which is the landing-only direction. It
now spawns at the upper Runway 24 threshold, backed by the retaining wall, and
accelerates downhill on heading 238° — the same pose the `cliff` demo preset and
the cinematic circuit already start from.

Runway-local axes: `s = x·sin58 − z·cos58` along the strip (+s is the high, NE,
Runway 24 end; the threshold sits at s = +263.5 m and the retaining wall at
s = 265 m), `w` lateral. Pavement elevation is `2836 + 0.1176·s` metres.

## Capture

Headless Chrome 1600×900 with ANGLE/Vulkan against the Vite dev server, driving
`window.simulator` over CDP. After PR #124 the lobby only offers the coastal
airport, so Lukla is entered with `simulator.setAirport('lukla')` — the same call
the lobby airport button makes. A reviewer can repeat it in the browser console:

1. `simulator.setAirport('lukla')`, wait for `simulator.luklaTerrain.isLoaded`.
2. `simulator.setPreset('runway')`, then read the pose.
3. `simulator.controls.setParkingBrake(true); simulator.stepSimulation(10)`.
4. `simulator.setPreset('runway'); simulator.controls.throttle = 1` and step.

## Results (`spawn-measurements.json`)

| step | s (m) | w (m) | above pavement | heading | pitch | on ground | damage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| after airport switch | +240.0 | −5.0 | 3.50 m | 238.0° | −6.71° | yes | none |
| after `setPreset('runway')` | +240.0 | −5.0 | 3.50 m | 238.0° | −6.71° | yes | none |
| 10 s parking brake on the 11.7 % slope | +239.6 | −5.0 | 3.47 m | 238.0° | −6.66° | yes | none |
| 8 s full throttle | +151.7 | −5.0 | 3.48 m | 238.0° | −6.66° | yes | none |

The spawn sits 23 m inside the Runway 24 threshold and 25 m short of the wall,
pointing downhill; the brake holds it on the gradient with 0.4 m of suspension
settle; the roll tracks the centreline offset and reaches 43 KIAS still on the
pavement. Toasts read "Preset: Lukla runway 24 takeoff roll (2,867 m, 11.7%
downhill)" and "Airport changed: Tenzing–Hillary Airport, Nepal (VNLK runway 24,
elevation 2,867 m, 11.7% slope)".

`1_spawn_at_retaining_wall.png` — drone camera at the spawn: the "24" threshold
stripes under the nose, the retaining wall directly behind the aircraft, HUD
heading 238° and 9,408 ft.

`2_downhill_takeoff_roll.png` — chase camera a couple of seconds after the 8 s
mark: 54 KIAS, runway falling away toward the valley, terminal and apron passing
on the left.

## Limitations

- Continuing the roll with no elevator input takes the aircraft off the cliff
  end and destroys it in the valley (measured at t ≈ 24 s, 150 KIAS). That is
  the pilot's job, not the spawn's; the cinematic circuit rotates and climbs.
- The lobby briefing line still prints the airport's approach data
  (`Rwy 058 · threshold elev 9203 ft`) for every Lukla scenario, including the
  two takeoff ones. That line comes from `APPROACH_DATA` and predates this
  change; making it scenario-aware is a separate fix.
- Node tests cover the translation keys and the preset fallback logic. Runway
  framing, the downhill view and the brake hold are browser-only claims, from
  the capture above.
