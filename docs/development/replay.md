# Flight recording and replay

Flights automatically collect a pose track alongside the debrief's telemetry report.
After at least five valid simulation seconds, the debrief offers **Watch replay**;
its Share tab offers **Save replay**. The lobby's **Saved replays** opens the device's
library. Flights can be renamed, watched, exported as JSON, imported or deleted.
Storage is local to the browser origin: at most eight saves, 160 KB base64 per
flight and 1 MB total. The oldest saves are evicted under budget or quota pressure.
Export files to retain copies outside that browser.

Playback has play/pause, previous/next recorded sample, a time scrubber, all ten
existing camera views, and 30/50/100/200/300 percent speeds. Camera digit shortcuts
and mouse look continue to work while aircraft inputs are disabled. Exit or Escape
returns to the lobby; it never hands the recorded aircraft pose to a live flight.
The viewer waits for terrain to load. Recorded time of day and generated valley
course seeds are restored without starting another scored attempt. Playback cannot
start during a multiplayer room or an in-progress scene swap.

## Representation and ownership

`ReplayRecorder` observes telemetry plus the authoritative quaternion at 5 Hz.
It progressively thins samples to 2.5/1.25/0.625 Hz to fit the byte budget. An
80-byte binary record quantizes scalar telemetry and stores a compact unit
quaternion. Longer flights that exceed the final rung remain viewable from the
current debrief but cannot be saved. Damage flags are quantized, so replay is a
visual flight record rather than an exact simulation checkpoint. Dynamic traffic,
debris and world animations are not recorded.

`ReplayDirector` owns the pose during playback, interpolating positions and
quaternions rather than re-simulating pilot input. `activePoseDriver()` is the
physics ownership seam; the existing shadow rig keeps priority. Replay resets
render interpolation every frame and reseeds camera damping on seeks. The host
flight created for playback is removed from both recorders and never produces a
new debrief. Playback exit restores the previous camera/sky settings and releases
any generated terrain owned by replay.

`ReplayStore` uses a small index and individual localStorage payloads. Import
reuses the decoder and storage budgets; the library renders names as plain text.
These files contain no executable pilot code.

## Verification

Run the Node replay tests with `node --test tests/replay*.test.js
 tests/trackSampler.test.js tests/poseOwnership.test.js` (on one line).

`npm run test:replay` starts local Vite and isolated hardware Chrome. It invokes
`scripts/verify-browser-gpu.mjs` against that actual browser before acceptance.
The host needs `/dev/dri/renderD128` access and the installed user Chrome wrapper;
`CHROME_PATH` can select another hardware-enabled Chrome. The test explicitly
selects Vulkan and permits no software fallback.

The script verifies record/save/watch, the 3× clock and rendered pose, backwards
scrubbing, recorded frame stepping, all cameras, portrait/landscape layouts,
native touch speed selection, exit, library rename/delete/import, invalid input,
reload persistence, a real Lukla recording/replay, and seeded valley terrain
restoration using a pose fixture. Screenshots, GPU evidence and a result file
are written under ignored `review-artifacts/replay/`.
