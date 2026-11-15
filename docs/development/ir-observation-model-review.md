# IR observation model review: sustained decoy tracking

Follow-up to the [locked-shot audit](locked-ir-audit.md), the
[association model](ir-track-association.md) and the
[2.5 km recovery audit](ir-recovery-25km.md). Tracked by issue #770. Base
`origin/main` at the time of writing; no gameplay coefficient changed.

The question is why a locked AIM-9X follows a flare for about 4.4 seconds and
misses, and whether the observation model should be changed. The conclusion is
that the behaviour is the expected output of the current **point-source**
model. Two concrete diagnostic defects were found and fixed; no behavioural
model change was justified without adding new assumptions that the public
evidence does not supply.

## Model as implemented

`src/weapons/MissileSeeker.js` evaluates each visible contact through:

1. **Signal competition** — a contact is observable when it is inside the
   field of view and gimbal, clear of terrain, inside the range gate, and above
   the minimum signal quality. For IR, `infraredSignalQuality` is a relative
   spreading model from emission and range; a flare's `infraredEmission` is
   compared with the aircraft's engine/airframe emission. A brighter contact
   therefore has a higher base score.
2. **Angular-overlap weight** — a candidate near the established line of sight
   is preferred. IR uses a 0.05 rad Gaussian; radar also uses a range term.
3. **Angular-motion likelihood** — each candidate's angular rate is compared
   with the predicted rate from the confirmed estimate, with a 0.001 rad
   angular-resolution assumption divided by the 0.15 s acquisition time. This
   is the only time-extended cue in the model.
4. **Confirmation** — a candidate must persist for `seekerAcquireSeconds`
   (0.15 s) before it replaces the estimate. Until then, a still-visible
   incumbent keeps supplying fresh position and velocity.
5. **Memory and reacquisition** — after a real loss, the estimate coasts for
   `seekerMemorySeconds` (0.6 s) and then the track is lost. A newly exposed
   contact must be re-confirmed.

The model is a single-channel, bright-point tracker with a short angular-motion
test. It has no imaging, no spectral comparison, no range or range-rate
estimation, and no target-shape or plume-modulation cue. A flare that is
dispensed along the aircraft's initial velocity therefore matches the predicted
angular motion closely enough to pass the likelihood, and wins on brightness.
That is the sustained track: once confirmed, the estimate follows the flare
until the flare leaves the field of regard or the missile's geometry degrades.

## Evidence at identical launch states

| Control | Fixed geometry, 68 locked shots | 2.5 km, 20 conditions |
| --- | ---: | ---: |
| Evasion only, no flares | 65 kills | 20/20 kills |
| Evasion + flares | 36 kills | 2/20 kills |
| Flare hidden at 0.2 s | — | 20/20 kills |
| Flare hidden at 2 s | — | 18/20 kills |
| Flare hidden at 4 s | — | 8/20 kills |

The 0.2 s cutoff removes the sustained decoy return and restores full recovery.
The 2 s and 4 s cutoffs show a monotonic dependence on decoy-track duration. The
seeker state machine, reacquisition, proportional navigation and fuze all work
when the aircraft stays inside the field of regard. The dominant cause is the
credible flare track, not a confirmation tick, event counter or memory bug.

The 2.5 km recovered misses reach the 35 g structural cap; requested lateral
acceleration peaks at 2695 m/s² against 343 m/s² available, and 14/20 have zero
propellant at closest approach. Energy and geometry are spent during the decoy
track. These are consequences of the track, not separate defects.

## What the point-source model lacks

- **Imaging**: no shape, size or morphology. A flare and a distant aircraft are
  both unresolved points.
- **Spectral discrimination**: one broadband IR channel. No two-colour ratio or
  spectral signature test.
- **Range and range-rate**: the seeker does not estimate range; closing rate is
  not used to reject a decoy whose ballistic trajectory diverges after
  separation.
- **Temporal signature**: flare rise/decay is modelled as emission only; the
  seeker does not test plume modulation or persistence against an aircraft.
- **Spatial extent and background**: no resolved silhouette, clutter or
  background rejection.

The angular-motion likelihood is the only cue that separates a decoy from the
aircraft, and its 0.001 rad resolution is an explicit assumption. A decoy that
matches the aircraft's motion at release passes it.

## Evidence versus assumptions

Public primary sources describe the AIM-9X as an imaging IR seeker and describe
countermeasure capability:

- [NAVAIR AIM-9X product page](https://www.navair.navy.mil/product/AIM-9X-Sidewinder)
- [US Navy AIM-9X fact file](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2168989/aim-9-sidewinder-missile/aim-9x-sidewinder-missile/)

These support the qualitative claim that a real seeker has more discrimination
than a brightest-point tracker. They do not publish the algorithm, its
thresholds, or a validated kill probability against flares. Adding imaging,
spectral or range-rate rejection would therefore be a **new assumption set**,
not a derivation from public evidence. The current 1 mrad angular resolution,
0.15 s confirmation, 0.6 s memory, 6 s flare lifetime, 28° acquisition field of
view, 65° gimbal and 35 g limit are all simulation assumptions.

## Concrete defects found and fixed

Both are diagnostic-contract defects; neither changes missile behaviour.

1. **Trace LOS was bandit-referenced.** The 120 Hz trace reported the angle
   between missile velocity and the *aircraft* line of sight, while the
   guidance gimbal check uses the angle to the *seeker estimate*. When the
   estimate follows a decoy, the trace could not show the angle that actually
   triggered `gimbal_limit`. In the 2.5 km flare-only rows the two angles
   diverge sharply: at aspect 90° the bandit-referenced angle is 72.8° while
   the estimate-referenced angle is 178.2° (estimate 29 m from the missile);
   at aspect 135° it is 76.3° versus 2.3° (estimate 338 m). Fixed by adding
   `seekerLosAngleDeg` and `seekerEstimateRangeM` to the trace sample and to
   the audit metrics.
2. **`lastObservation` described the competitor during memory.** When the
   incumbent was hidden but a competitor was visible, the memory branch kept
   the competitor's observation while the estimate still aged from the
   incumbent. Diagnostics therefore reported a visible contact's reason during
   a memory state. Fixed by restoring the incumbent's loss reason in the memory
   branch. The competing branch now also records the incumbent's fresh
   evaluation when it keeps the track.

Regression coverage: `tests/missileSeeker.test.js` asserts that a memory state
with a visible competitor reports the incumbent's terrain loss reason. The
20-condition 2.5 km audit re-run produces identical terminals and summary rows
before and after the change; only the new diagnostic fields differ.

## Target and non-goals

The target is the paired no-flare control baseline: 20/20 at 2.5 km and 65/68
in the fixed geometry. For flare-enabled cases, the target is to show that any
improvement comes from a documented discrimination mechanism, not from tuning a
coefficient. A specific flare-case kill percentage is **not** set, because no
validated model exists to justify one; 2/20 is a model output, not a target to
fit.

Explicitly not changed: flare brightness/emission, flare lifetime, the 1 mrad
association assumption, the 65° gimbal limit, the 35 g structural limit, or the
launch geometry. Changing any of these to raise the 2.5 km rate would be tuning
to a desired outcome, which #770 rules out.

## Next model work

A defensible next step would be a separate discrimination model with its own
evidence and its own sensitivity study, for example a two-colour ratio or a
range-rate consistency test, added as an explicit seeker assumption. It should
be validated against the same paired launch states and should report the
no-flare controls as a regression gate. Until such evidence exists, the
point-source behaviour is the correct output of the current model.

## Limits

- 20 deterministic 2.5 km geometries and 68 fixed-geometry shots; not a
  statistical sample or a real AIM-9X kill-rate claim.
- Node numerical evidence only; no browser, rendering, human sortie or live
  weapon validation.
- The audit's diagnostic fields are experiment-only; default simulation output
  is unchanged.
- The 0.2/2/4 s flare cutoffs are diagnostic interventions, not gameplay
  behaviour or proposals.
