# Missile research archive and confidence register

This archive preserves all four Gemini shared pages supplied for
[issue #713](https://github.com/stlim0727/flight3d/issues/713), including the
initial detailed research, subsequent revisions, numeric tables, equations,
example code, scenario proposals and embedded source links. Earlier mistakes
are retained to make the research and correction history reviewable in Git.
Use [the model review](../missile-realism.md) for implementation acceptance.
This archive does not supersede the existing combat plan or validate the examples.

## Confidence labels

Labels describe evidence status, not a numerical probability of correctness.

| Label | Meaning and use |
| --- | --- |
| Repository-confirmed | Checked against source at `359813e`; applies to baseline behavior only. |
| External-unverified | A claim or citation in the supplied research; the primary source and exact variant have not been independently checked here. |
| Model-assumption | A candidate approximation or tuning value, not a measured weapon specification. |
| Known-error | Contradicts repository source, contains a demonstrated code/math inconsistency, or overstates its evidence. Preserve for history; do not adopt unchanged. |
| Proposed / untested | A design, interface, scenario or example implementation with no execution or performance evidence. |

**Default for every archived sentence, table cell, equation and code block is
External-unverified and/or Proposed / untested unless this register explicitly
says otherwise.** A source's own “publicly confirmed” label does not upgrade it.
Its generic institutional attribution, quoted passage or URL still requires
checking. Missing public evidence does not prove classification. None of the
example code has been executed as part of this archive.

## Captures and coverage

Captured on 2026-11-13 through Obscura. Each file contains the complete rendered
page text available at capture time, separately extracted full code blocks and
TeX annotations, and the page's links. Shared pages overlap; duplication is
intentional. The capture manifest records sizes, counts and SHA-256 digests.

| Snapshot | Main contents | Status |
| --- | --- | --- |
| [01: Initial research](01-initial-research.md) | Missile tables, propulsion, drag, APN, seeker/countermeasure, fuze/damage formulas and code; broad scenario/integration proposal visible in that share. | Historical, contains known errors. |
| [02: Provenance revision](02-provenance-revision.md) | Earlier research plus AIM-9M/X separation, AIM-120C, SA-6/Stinger tables, model assumptions and 120 Hz corrections. | External-unverified; partial corrections. |
| [03: Guidance/CPA revision](03-guidance-cpa-revision.md) | Primary-source URLs as supplied, velocity-normal projection, independent fuze/damage radii, simultaneous CPA and full example code. | External-unverified; code has known errors. |
| [04: Gravity/TVC/fuze revision](04-gravity-tvc-fuze-revision.md) | Full gravity, force allocation, entry/CPA branching, damage-curve labels and revised example code. | Proposed / untested; remaining defects below. |

“All collected information” means the contents visible on these supplied pages
and our review findings. Nested conversation links, original uploaded project
files, the creator's hidden instructions and primary documents behind citations
were not retrieved as part of the archive. Their links are preserved without a
claim that their contents were captured or verified.

## Topic inventory

| Material preserved | Location | Confidence / interpretation |
| --- | --- | --- |
| AIM-9M and AIM-9X dimensions, launch mass, motor/propellant, burn time/thrust, speed, G, seeker/gimbal/rate and warhead/fuze values | 01–04 tables | External-unverified. Distinguish variants and the source's changing values. Motor, authority and seeker numbers are candidate assumptions, not certified data. |
| AIM-120C dimensions/mass, boost/sustain profile, seeker range/RCS, guidance and warhead values | 01–04 tables | External-unverified; advertised speed does not validate the proposed propulsion or range. |
| SA-6/3M9 and Stinger/MANPADS specifications and propulsion distinctions; SA-11/Igla scenario mentions | 01–02 | External-unverified; separate missile families and variants. |
| Variable mass, pressure correction, impulse, Mach drag tables, lift/induced drag, actuator lag and TVC | 01–04 equations and code | Model-assumption / Proposed; coefficients and allocation policy require calibration. |
| PN/APN, loft bias and distance thresholds, target acceleration inputs, gravity compensation | 01–04 | Model-assumption / Proposed; projection and sensor observability need explicit definitions. |
| IR signature/aspect, flare selection, radar clutter/notch/chaff, terrain LOS and track memory | 01–02 | Proposed / untested. Numeric thresholds and success percentages are unsupported. No universal guaranteed lock break. |
| Fuze modes, simultaneous CPA, explosion coordinates, fragment/damage curves and part damage | 01–04 | Proposed; current baseline CPA concept is repository-confirmed, but archive code is not validated. |
| BVR/WVR, SAM, low-level valley/urban masking, SEAD and MANPADS scenarios | 01–02 | Proposed; broader scope than the current missile-realism implementation issue. |
| Civil-aircraft emergency scenarios, G-LOC, bot observations, debrief and replay integration, implementation prompts | 01–02 | Proposed; assertions that these interfaces/physiology systems already exist are unverified. Ordinary flights must not gain combat implicitly. |
| Full TypeScript examples and source citations/quotations | All snapshots, dedicated extraction sections | Historical reference, not drop-in production code or independently confirmed quotations. |

## Correction history and unresolved findings

| Finding | Review disposition |
| --- | --- |
| Existing Rapier engine, 240 Hz missiles, ready-made TypeScript engine interfaces | Known-error as a description of this checkout. Repository-confirmed: Three.js/ES modules and a separate 120 Hz missile core. |
| Claims of complete/perfect realism or direct integration without reading the source | Unsupported. The source review did not measure hit probability or run browser scenarios. |
| Patrol bandits assumed to offer realistic defensive engagements | Repository-confirmed limitation: current patrol AI does not respond to inbound missiles. |
| Exact target state used by guidance | Ideal-sensor baseline only; estimated state, uncertainty and observable threat response remain proposed work. |
| AIM-9M and AIM-9X conflated; precision values without verifiable attribution | Later tables separate them, but each value still needs primary-source/variant verification. |
| Always `lethal radius < fuze radius`; fuse radius used as maximum damage extent | Known-error. Keep trigger and damage independent; baseline currently uses 14 m for both lethal and fragment radii. |
| LOS-normal acceleration described as velocity-normal acceleration | Known-error. Later projection fixes this algebraic inconsistency but does not prove a real missile's guidance law. |
| Lateral gravity compensation without full external gravity | Known-error in 03; 04 restores full gravity. Saturation/lag still prevents unconditional exact cancellation. |
| ON_ENTRY gated by CPA passage | Known-error in 03; 04 splits conditions. Boundary and stationary-motion cases still need sequence tests. |
| Generic segment distance confused with same-time CPA | Later derivation uses a shared interpolation time correctly. Explosion position and all affected target states must use the actual trigger time. |
| TVC force treated as aerodynamic lift for induced drag | Known-error in 03; 04 separates forces and reduces forward thrust. Allocation is a model assumption. |
| `norm * norm` described as inverse-square decay | Known-error, corrected to arbitrary quadratic falloff in 04. An inverse-square approximation is also not a complete fragment/blast model. |
| All unavailable data called classified | Unsupported, corrected wording in 04. Distinguish unverified sources, insufficient public evidence and model assumptions. |
| Filtered acceleration can exceed newly reduced authority | **Unresolved in 04:** burnout or falling dynamic pressure reduces actuator force, but integration still uses the old filtered `latAccel`. Re-limit/reconstruct actual force after filtering and allocation. |
| Shared `_vHat` survives zero speed or coincident target | **Unresolved in 04:** direction refresh is also gated by target distance. Compute direction for every missile independently, with its own orientation fallback. |
| Text's actual-force equation omits requested force from minimum | **Unresolved in 04:** the written expression is a capacity bound, not the actual requested output. Include demand and verify integrated force equals allocation. |
| Clamped CPA time zero accepted as passage | **Unresolved:** separating/stationary states can satisfy `tauCpa < 1` without a demonstrated minimum crossing. Define arming/history and boundary policy. |
| Velocity-normal force assumed to guarantee zero numerical energy gain | Continuous-time property only. Verify discrete integration and timestep sensitivity. |

The final three code/text findings were supplied after the last Gemini revision;
they are recorded here rather than silently editing the archived source.
The CPA and numerical-integration cautions are additional acceptance constraints
from the repository model review.

## Before implementation

Validate citations and units (including pound/kilogram conversions) against exact
variant-specific primary sources. Record checked passages, conditions and retrieval
dates separately. Do not resolve disagreements by choosing the most precise-looking
number. Preserve all original snapshots when adding a later corrected revision.

Use the model review's sequence matrix: burnout and dynamic-pressure changes,
lock loss, zero speed/coincident positions, interleaved missile updates,
entry/CPA boundaries, force balance, timestep/energy checks, reset/respawn and replay.
Compare a fixed launch-condition matrix with patrol and evasive targets. No
real-world hit-rate claim follows from a plausible trajectory or successful build.
