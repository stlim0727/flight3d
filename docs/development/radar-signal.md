# Active missile radar observation signal

This bounded S3-2 model applies to the **missile's active radar seeker**, including
its existing prelaunch seeker gate. It does not implement an aircraft radar emitter,
search/track modes, datalink, RWR emissions, chaff, Doppler filtering or IFF.
Terrain LOS, gimbal, acquisition delay and finite memory remain separate gates.
The explicit `world.seekerSignalQuality` callback still overrides the default.

The dimensionless target return is `(R0 / range)^4 * RCS / RCS0`, with R0
6500 m and RCS0 1 m². Target `radarCrossSectionM2` is a nonnegative scalar;
missing values use an assumed 1 m². It is not an aircraft-specific measurement
and does not model aspect, frequency, polarization or scattering. Invalid values
produce no observation. The background term is `4 * lookDown * exp(-angle / 0.08)`,
where angle is the elevation separation of the target and terrain directly below
it, and lookDown rises continuously from zero across 0.08 radians. Without a
terrain callback the background is zero. This is a heuristic, not a terrain
backscatter or pulse-Doppler simulation: it does not sample the full beam or
model clutter velocity, surface material, multipath or receiver processing.
The normalized quality is `return / (1 + background + return)`; the existing
seeker threshold determines observation, without a random success roll.

The inverse-fourth dependence follows the two-way spreading in the monostatic
radar equation; target RCS and ground clutter are established radar concepts.
MIT Lincoln Laboratory's [introductory radar course](https://www.ll.mit.edu/outreach/web-based-course-radar-introduction-radar-systems)
introduces RCS, detection and land clutter; its [radar signal processing paper](https://archive.ll.mit.edu/publications/journal/pdf/vol12_no2/12_2radarsignalprocessing.pdf)
discusses clutter and processing. Neither source validates these constants or
claims AIM-120 performance. All numerical values above are simulation assumptions,
not a measured detection range or a real weapon's capability.

Verification: `tests/radarSignal.test.js` covers range, RCS, invalid inputs,
look-down background and track loss/reacquisition. Existing seeker and combat
unit tests cover integration. These checks do not establish real-world accuracy
or validate the complete game scene and human-flown engagement.
