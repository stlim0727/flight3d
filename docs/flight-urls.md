# Flight URL selector

Use the [interactive flight selector](https://stlim0727.github.io/flight3d/flights.html)
to choose one flight and open its gameplay link. The directory no longer expands
all aircraft/scenario combinations or every seeded pilot case into long tables.

- **Ordinary flight:** terrain → aircraft → scenario. Each selector offers only
  choices supported by the preceding selections. Changing terrain automatically
  replaces an unavailable aircraft or scenario.
- **AI pilot:** mission → environment → seed. The selected case has a
  **gameplay link and a pilot-code link** side by side. The code is the readable,
  unminified source included in that same deployment.

The ordinary selector retains all supported flights. The AI selector is driven
by the case registry, including the F-16 Lukla valley mission when available in
the deployed build. All seeds of one mission use the same pilot algorithm;
only the environment and sensor-noise seed vary.

## URL parameters

| Parameter | Purpose |
| --- | --- |
| `aircraft` | `B738`, `C172`, or `F16` |
| `terrain` | `coastal`, `lukla`, `incheon`, `neon`, or `hangang` |
| `scenario` | A supported scenario for the selected terrain/aircraft |
| `pilotArena=1` | Open the local pilot console |
| `pilotCase` | Select and automatically start a known built-in pilot case |

Values are case sensitive. Ordinary URL parameters override saved preferences;
omitted values retain saved choices. Invalid or unsupported ordinary selections
fall back to the existing defaults. Unknown pilot case IDs never execute source
or silently start a different test. Hangang is C172-only; cliff takeoff is
Lukla-only. Browser audio permission rules still apply.

## AI pilot mission selector

Choose a mission, its environment and one seed in the directory. Opening the
selected gameplay link starts the bundled pilot at 1× after the simulator is
ready. The console provides stop/manual takeover and fast evaluation. No
executable source is accepted from URL parameters.

Examples, rather than an exhaustive case list:

- [Takeoff, mild wind, seed 1](https://stlim0727.github.io/flight3d/?aircraft=B738&terrain=coastal&scenario=runway&pilotArena=1&pilotCase=takeoff-mild-1)
  · [takeoff pilot source](https://github.com/stlim0727/flight3d/blob/main/src/pilot/examples/takeoff.js)
- [Landing, calm baseline](https://stlim0727.github.io/flight3d/?aircraft=B738&terrain=coastal&scenario=approach&pilotArena=1&pilotCase=landing-calm)
  · [landing pilot source](https://github.com/stlim0727/flight3d/blob/main/src/pilot/examples/landing.js)

Calm baseline cases disable sensor noise. Mild cases use seeded physical wind
and correlated sensor errors. See the [pilot arena contract and verification](development/pilot-arena.md)
for their meaning and limits. The Lukla valley course, observations and scoring
are defined by its mission documentation rather than by this URL directory.
