# Flight recording and replay

Flights automatically collect a pose track alongside the debrief's telemetry report.
After at least five valid simulation seconds, the debrief offers **Watch replay**;
its Share tab offers **Save replay**. The lobby's **Saved replays** opens the device's
library. Flights can be renamed, watched, exported as JSON, imported or deleted.

Every finished sortie is also written to a single `auto_save` slot, so the most
recent flight is always in the library without a manual save. Each new flight replaces
it; renaming it converts it into an ordinary save that later flights no longer
overwrite, and the eight-entry budget still applies.

Storage is local to the browser origin: at most eight saves, 160 KB base64 per
flight and 1 MB total. The oldest saves are evicted under budget or quota pressure.
Export files to retain copies outside that browser.

Playback has play/pause, previous/next recorded sample, a time scrubber, all ten
existing camera views, and 30/50/100/200/300 percent speeds. Camera digit shortcuts
and mouse look continue to work while aircraft inputs are disabled. Exit or Escape
returns to the debrief that opened the playback, so its save and share actions stay
reachable (#648); library playback returns to the lobby. Neither hands the recorded
aircraft pose to a live flight.
The viewer waits for terrain to load. Recorded time of day and generated valley
course seeds are restored without starting another scored attempt. Playback cannot
start during a multiplayer room or an in-progress scene swap.

## Representation and ownership

`ReplayRecorder` observes telemetry plus the authoritative quaternion at 5 Hz.
It progressively thins samples to 2.5/1.25/0.625 Hz to fit the byte budget. An
80-byte binary record quantizes scalar telemetry and stores a compact unit
quaternion. Codec v2 uses four previously reserved bytes for two unsigned 16-bit
fuel-flow readings (10 kg/h resolution), covering the F16's 4,500 kg/h maximum
without increasing storage budgets. The decoder continues to read v1 tracks
with their original one-byte fuel-flow layout; existing library/export containers
keep their keys and identifiers. Longer flights that exceed the final rung remain viewable from the
current debrief but cannot be saved. Damage flags are quantized, so replay is a
visual flight record rather than an exact simulation checkpoint. Dynamic traffic,
debris and world animations are not recorded. A crashed sortie instead stores a
`metadata.crash` marker (type, simulation time, impact speed); playback stages the
explosion and breakup when it reaches that time and removes them on a seek back.

`ReplayDirector` owns the pose during playback, interpolating positions and
quaternions rather than re-simulating pilot input. `activePoseDriver()` is the
physics ownership seam; the existing shadow rig keeps priority. Replay resets
render interpolation every frame and reseeds camera damping on seeks. Mission-owned physics ticks feed the recorders once per step, while mission
scoring keeps control of completion. A prepared course seed survives retry setup,
and its track is frozen before mission terrain is released. The host
flight created for playback is removed from both recorders and never produces a
new debrief. Playback exit restores the previous camera/sky settings and releases
any generated terrain owned by replay.

## Multiplayer room tracks (#646)

`RoomReplayRecorder` extends the solo recorder for a multiplayer room. Every frame
holds the local aircraft's 80-byte record plus a 23-byte pose-only record per remote
pilot, taken at the same instant from the interpolated snapshot this client showed:
position, compact quaternion, gear, flaps, visible/crashed/held/stale flags and a
segment counter. Each client records what it saw, so a room track does not depend on
the other pilot staying connected. Remote aircraft carry no instruments.

A segment changes whenever an aircraft respawns or the room restarts (the caller's
local key, or a remote snapshot's round/epoch). `sampleTrack()` and `sampleRemote()`
hold the earlier pose until the next segment's first sample and never blend toward an
unseen remote sample. The pilot list is stored as `metadata.remotes`, so the decoder
knows the frame width; codec v3 is written only for tracks with remote pilots, while
solo tracks stay v2 for older builds. A room that outlasts the coarsest rung keeps its
most recent frames instead of being refused, and its timeline is rebased to zero.

Recording the room and saving it when the room ends is wired in a later step; this
format and recorder are not yet used by the multiplayer controller.

`ReplayStore` uses a small index and individual localStorage payloads. Import
reuses the decoder and storage budgets; the library renders names as plain text.
These files contain no executable pilot code.

## Verification

Run the Node replay tests with `node --test tests/replay*.test.js
 tests/roomReplay.test.js tests/trackSampler.test.js tests/poseOwnership.test.js`
(on one line).

`npm run test:replay` starts local Vite and isolated hardware Chrome. It invokes
`scripts/verify-browser-gpu.mjs` against that actual browser before acceptance.
The host needs `/dev/dri/renderD128` access and the installed user Chrome wrapper;
`CHROME_PATH` can select another hardware-enabled Chrome. The test explicitly
selects Vulkan and permits no software fallback.

The script verifies record/save/watch, the 3× clock and rendered pose, backwards
scrubbing, recorded frame stepping, all cameras, portrait/landscape layouts,
native touch speed selection, exit, library rename/delete/import, invalid input,
reload persistence, a real Lukla recording/replay, and seeded valley terrain
restoration using a pose fixture, plus two real valley mission recordings with
save/playback across a retry. Screenshots, GPU evidence and a result file
are written under ignored `review-artifacts/replay/`.
