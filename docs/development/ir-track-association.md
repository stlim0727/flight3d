# IR return association and decoy confirmation

Follow-up to the [locked-shot audit](locked-ir-audit.md), baseline main
`20e0d94`, 2026-11-15. This adds a bounded observation-association model and
corrects confirmation/event semantics. It does not calibrate real AIM-9X
countermeasure resistance or target a chosen kill percentage.

## Changes

Previously, a brighter eligible flare could replace the aircraft hypothesis
using only signal quality and angular proximity. Each pending confirmation tick
also emitted a `decoy_transfer` and stopped updating the still-visible aircraft
estimate. Consequently a candidate, even before confirmation, aged the original
estimate into memory.

Now a still-visible confirmed source continues supplying fresh position and
velocity while a competing candidate accumulates confirmation. Only confirmed
replacement emits `decoy_transfer`, once for that transition. Real occlusion or
signal loss still ages the estimate and expires its finite memory. This state
and event correction applies to IR and radar; the new motion score is IR-only.

The IR candidate score multiplies existing signal quality and angular-overlap
weight by a continuous angular-motion likelihood:

```text
line = sourcePosition - observerPosition                 [m]
relativeVelocity = sourceVelocity - observerVelocity     [m/s]
omega = cross(line, relativeVelocity) / dot(line, line)   [rad/s]
sigmaRate = angularResolution / acquisitionTime          [rad/s]
likelihood = exp(-0.5 * |omega - predictedOmega|² / sigmaRate²)
```

`predictedOmega` comes from the stored confirmed estimate, not an inaccessible
aircraft state. Every eligible source, including the incumbent, receives the
same likelihood. Evaluation of geometry, channel, LOS and signal threshold
precedes candidate-motion access. No aircraft identity, `sourceId`, flare
inventory or guaranteed-rejection rule enters the likelihood. Without an
estimate, acquisition retains the existing signal-based selection. A flare with
indistinguishable motion can still capture a track; once confirmed, it becomes
the estimate's source. Countermeasures and energy/geometry misses remain possible.

The IR angular resolution assumption is **0.001 rad**; the existing 0.15 s
confirmation time gives **0.00667 rad/s** uncertainty. The current simulation
observation contract supplies exact visible-contact position/velocity. This is
an idealized optical-motion measurement, not a rendered image processor or
measurement-noise model. IR range/range-rate estimation errors, spectral tests,
image morphology, background and full imaging reconstruction remain absent.

[NAVAIR](https://www.navair.navy.mil/product/AIM-9X-Sidewinder) describes an
advanced imaging IR seeker; the [US Navy fact file](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2168989/aim-9-sidewinder-missile/aim-9x-sidewinder-missile/)
describes countermeasure capability. These support the qualitative distinction
from a brightest-point tracker. Neither source provides this algorithm or its
constants, confirms its adequacy, or supports a numerical kill-rate claim.

## Paired matrix and sensitivity

Use `timeout --signal=TERM --kill-after=5s 60s node scripts/audit-locked-ir.mjs`.
The audit is introduced in PR #768; this follow-up is based on that audit branch.
It retains the same 100 geometries and identical launch-state assertions across
patrol, reaction-only and reaction-plus-flare controls. All have 68 actual
locked launches and 32 withheld no-lock cases. Full per-shot JSON/5 Hz
trajectories remain in `.cache/locked-ir/`.

| Model | Patrol kills | Reaction-only kills | Reaction + flare kills |
| --- | ---: | ---: | ---: |
| Baseline | 66/68 | 65/68 | 8/68 |
| Confirmation/event correction, motion likelihood disabled | — | — | 8/68 |
| Correction + angular-motion likelihood | 66/68 | 65/68 | 36/68 |

The event/confirmation fixes alone do **not** explain the improvement. The
behavioral change comes from the added motion association model. With the new
default, all 68 targets dispense flares; 35 cases emit a confirmed decoy transfer.
Outcomes with flares are 36 kills, four nonlethal bursts, 27 expiries and one
ground impact. This is a deterministic fixture comparison, not a production
player sortie or an independent statistical sample.

At 1.5 km initial range, flare-enabled kills change from 0/20 to 14/20;
at 2.5 km they remain 2/20. The farther cases remain unresolved modeling work,
not a claim that all post-lock susceptibility has been fixed.

Changing only angular resolution to 0.0005 / 0.001 / 0.002 rad yields
48 / 36 / 25 kills out of the same 68 launches (confirmed transfer cases
23 / 35 / 46). The response is sensitive to this assumed sensor uncertainty;
**36/68 is not a validated realistic rate**. The default is an explicit
measurement-resolution assumption, not a coefficient fitted to a desired rate.
Disabling motion scoring for the ablation uses a very large angular uncertainty;
source emission, flare dynamics and weapon energy constants are untouched.

Regression coverage includes pending-candidate rejection without stale state,
fresh incumbent measurements during confirmation, one event per confirmed
capture, ambiguous-motion flare capture, flare fading/reacquisition, reset,
visible-contact-only motion reads, and a consistent flare track that does not
yield to a brighter aircraft solely because of its type. Tests also retain radar/chaff confirmation,
terrain/memory, IR emission, physics, combat and replay contracts.

No rendering/UI effects changed. All evidence here is Node numerical testing;
full game-scene, human sortie and real weapon performance are not verified.

The later [2.5 km recovery audit](ir-recovery-25km.md) separates flare capture,
aircraft reacquisition and terminal guidance with paired controls. It finds the
remaining 2.5 km misses are sustained decoy-track geometry, not a seeker-state
or event defect.
