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

### Air combat tracks

F-16 sorties append an optional combat section after the pose frames (codec v4).
Solo tracks without combat remain v2, and room tracks remain v3, so older builds
still import them. The section records:

- bandit poses at 2 Hz (position, heading, alive state) and the six-station rail
  loadout mask;
- missile poses at 20 Hz while a missile is alive (position, attitude, motor
  state);
- detonation and expiry markers with position and velocity.

Playback interpolates the recorded poses and rail mask; it does not re-simulate
guidance. This keeps seeks instant and guarantees that speed changes cannot alter
the recorded outcome. Detonations stage one explosion when crossed and suppress
events already in the past when seeking. Replay HUD/cockpit/chase views show the
recorded bandits as target designators, the remaining rail count, missiles in
flight and the cumulative splash count at the current playback time. Combat is recorded only when the live
F-16 air-to-air system is active, so B737/C172 tracks are unchanged. The recorder
thins combat samples before pose samples when the per-entry budget is tight.

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

### Room lifecycle (#672 Tasks 2–3)

`MultiplayerController` connects `RoomReplaySession` to the first `go`, its frame
updates, and `ended`/`pagehide`. `ROOM_REPLAY_ENABLED` is **true**: the library can
play both local and remote aircraft, including imported v3 room records.

When enabled, the room clock is `(performance.now() - startedAt) / 1000`, in seconds,
independent of local physics time. Menu/debrief holds do not stop remote recording.
Round restarts preserve the recorder; each aircraft has its own segment counter.
The controller observes world positions (metres) and authoritative unit quaternions;
remote positions already include `RemoteTrack`'s arrival-clock interpolation.
It does not simulate remote physics or apply network delay a second time.

`metadata.room` contains the local pilot, room code, rounds, end reason,
`sessionDurationSec`, `startOffsetSec`, `partial` and a `timeline`. Timeline entries
are `{timeSec, states}`, with local pilot at index 0 and remotes at indices 1..N.
Each state contains visible/held/crashed/stale/segment and optional crash type/speed
(knots). Local types come from `crashResult`; remote types are `unknown` without a
wire change. These are observed state transitions, not an exact crash simulation.
They survive pose thinning and support repeated crashes/respawns and backwards seek.
The sampler never interpolates across a retained state transition. Playback
consumes visibility and crash states for every aircraft, including hidden local poses.

Blur marks an observation gap. Frame gaps over 500 ms also hide both tracks until
the next observation; stale remote snapshots are hidden in the timeline. A large
gap advances room time without inventing frames or counting it as valid flight
duration. End callbacks use previously observed poses because the transport may
have cleared its remote buffer. `finish` is idempotent, including pagehide + ended.

`room_auto_save` is independent of the legacy solo `auto_save`; both share storage
budgets and ordinary eviction. Renaming promotes either to a manual save. Slot
replacement excludes the old slot before budget calculation and restores old
payloads on failed writes. With room recording active, sortie auto-save is skipped;
manual debrief saves remain solo. Save errors produce a toast and a best-effort
next-library-visit notice. Inaccessible storage cannot persist that notice;
pagehide does not guarantee recovery from browser/OS termination.

State history is bounded to the smaller of 16 KB or a quarter of the decoded
entry budget. If transitions alone exceed it, the retained pose window is shortened
along with the history. Pose-window trimming retains the state at its beginning.
Finalization rebases both poses and timeline, and the library labels partial room
records. This can retain less than the nominal roughly 30-minute pose budget.

### Room playback

`ReplayDirector` awaits each remote production model before enabling playback.
Remote actors are visual only: `sampleRemote()` supplies world position and
quaternion, gear and flaps. The live network clock, remote crash inference and
collision registration do not run. The camera still follows the local aircraft;
participant switching and event markers remain separate follow-ups.

`ReplayCrashEffects` reconstructs each pilot's impact from the transition timeline.
Effect age is `replayTime - impactTime` in seconds. Pause freezes it, speed scales it,
and seeks rebuild it with steps no larger than 1/60 s (breakup integrates internally
at 1/120 s). Impact velocity uses adjacent world positions within the same segment,
optionally scaled by the recorded speed in knots divided by 1.94384. It never derives
velocity across a respawn. Remote models retain their local transform beneath a
world-pose wrapper, so breakup applies the world transform exactly once.

Effects are visual approximations, not recorded trajectories. Remote impact type
stays `unknown`; local water/terrain/ship types come from the recording. Reconstruction
is bounded to 30 seconds after each impact; after that the crashed airframe stays
hidden until respawn. Gaps and backwards seeks clear effects. Playback starts with
live wreckage cleared and disposes remote models, indicators, fragments and explosion
resources on exit or failed loading. Local contact shadows follow replay visibility.

`ReplayStore` uses a small index and individual localStorage payloads. Debrief download
and replay library export share one unified format (`flight3d.sortie.v1`):
```json
{
  "kind": "flight3d.sortie.v1",
  "report": { "...": "telemetry report or index summary" },
  "track": "<base64 encoded binary track (v2 solo or v3 room)>"
}
```
Debrief download emits this file with the full telemetry report and the encoded track;
library export emits it with a compact debrief summary (`reason`, `touchdown`, `crash`, `peakG`).
Saved replays in the lobby library display this summary badge alongside duration and timestamp.
Import reuses the decoder and storage budgets, accepting both `flight3d.sortie.v1` and legacy
`flight3d.replay.v1` files; the library renders names as plain text.
These files contain no executable pilot code.

## Verification

Run the Node replay tests with `node --test tests/replay*.test.js
 tests/roomReplay*.test.js tests/trackSampler.test.js tests/poseOwnership.test.js`
(on one line).

`node scripts/verify-room-recording.mjs` uses hardware Chrome and the real
controller/recorder/store/library with a deterministic peer/clock fixture. It checks
held-local/continuing-remote recording, suspension gaps, one-shot save, import/export,
library names/watch availability and reload persistence. On Windows start Vite separately
and set `APP_URL` to its origin; the script uses installed Chrome with D3D11.
Evidence goes to `review-artifacts/room-recording/`. This is not two-peer WebRTC,
tab-close acceptance or multi-aircraft rendering.

`node scripts/verify-room-playback.mjs` runs local signaling and Vite, verifies the
installed Chrome hardware renderer, and connects actual WebRTC peers in isolated
storage contexts. It checks menu hold, two injected collisions through production
crash handling, debrief, personal respawn, round restart, departure, independent
auto-saves, import/export, two rendered aircraft, seek, pause/3× and disposal. A
second room closes a real tab and reopens its storage; another expires a heartbeat
to exercise timeout. Collisions are injected, not flown accidents, and the timeout
clock is advanced explicitly. Evidence goes to `review-artifacts/room-playback/`.

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
