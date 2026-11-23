# Physics modeling principles

Agreed owner direction (issue #109 follow-up): what meets the player's eyes must
be derived from continuous physical state, not from condition checks that switch
behavior on and off.

## Allowed condition checks

1. **Performance gates (broad phase).** Skipping work whose result cannot
   matter is legitimate optimization, not fakery. Example: ground contact
   evaluation may be skipped while the aircraft is far above the terrain, as
   long as the full calculation runs whenever contact is remotely possible.
   A gate may only decide *whether to compute*, never *what happens*.
2. **Annunciation and warning logic.** Real airm warning systems genuinely are
   condition-check based (stick shaker triggers at a sensed parameter). Flags
   like `isStalled`/`isPreStall` may drive HUD text, audio, and other
   presentation, and must never feed back into forces, moments, or control
   authority.

## Prohibited patterns

- Branching force/moment/coefficient models on a discrete flag
  (`if (isStalled) ...`) or on an ad-hoc threshold that changes behavior
  discontinuously.
- "Playing" a symptom (nose drop, wing drop, buffet) as an animation or impulse
  keyed to a state label instead of as the consequence of the coefficient model.

## Required pattern

Phenomena with memory or rate effects — flow separation onset/reattachment
hysteresis, ground effect, gear/speedbrake dynamics — are modeled as state
variables evolved continuously per timestep (e.g., exponential relaxation with
asymmetric time constants), and all dependent coefficients are continuous
functions of those state variables. Flags are derived *from* the state
(`isStalled = separation > threshold && airflow valid`) for annunciation only.

When adding or reviewing a physics feature, ask: would removing every
behavior-switch `if` from the force model change the aircraft's motion? If yes,
the switch is conditional acting and should be replaced with state-variable
modeling, or justified as one of the two allowed checks above.

## Airport and environmental surfaces

1. **Continuous contact height.** Terrain contact height (`getHeight(x, z)`) must
   blend continuously between runway/taxiway pavement, building footprints, and
   external terrain DEM. Structural footprints (towers, passenger terminals) must
   maintain their base floor elevation without sinking under external terrain.
2. **Visual-physical lighting and geometry consistency.**
   - Reciprocal runway ends reverse approach heading relative to the runway
     axis. Lateral offsets for approach aids (PAPI, ALS) must scale by the end's
     relative direction sign (`pilotRight = right * sign`) to keep the pilot-relative
     side (`left` / `right`) consistent on both ends.
   - Displaced thresholds separate approach landing limits from pavement rollout:
     green threshold lights sit at `end.threshold`, while red runway end lights
     remain at `end.physical`.
   - Apron light poles must pair visual emissive fixtures with actual `SpotLight`
     illumination and night-level modulation so parked aircraft and tarmac receive light.
