# Two-player shared flight and voice

Implementation plan (Discussion #509): friends share an invite link, join a private
room capped at two pilots including the host, then fly with continuous voice by default.
Room management is a native modal; invites use six-character codes.

Room recording and multi-aircraft playback are enabled (#672 Tasks 2/3).
The observer uses a separate
monotonic session clock across local holds, crashes and round restarts, and saves
each client's observed tracks once on exit. No snapshot protocol change is needed;
remote crash types remain unknown. See [room replay](replay.md#room-lifecycle-672-tasks-23)
for state history, gap semantics, storage and playback. Each participant's library
can replay both aircraft; participant camera switching is a separate follow-up.

Setup preferences use `flight3d.multiplayer.preferences.v1` in localStorage:
pilot name, scenery, aircraft, and start selection. Restore them before automatic
invite joining; save edits immediately and again when connecting. Validate saved
choices against the supported options and keep defaults for invalid data.
Unavailable storage must not block room creation or joining.

## Contract

See [the versioned compatibility contract](multiplayer-contract.md) for wire,
flight-data, invite and standalone-host release compatibility.

- Codes contain six unambiguous base32 characters (30 random bits) from
  `crypto.getRandomValues`. URLs use `?r=CODE&mp=2&fr=1` (legacy `?r=CODE` still works); manual entry accepts lowercase,
  spaces and hyphens. PeerJS IDs are namespaced separately from display codes.
  Protocol v2 uses these codes; old v1 UUID invites are not accepted.
- After signaling registration, the creator has sixty seconds to explicitly renew
  the waiting deadline. The deadline covers only the connecting state, stops once
  the friend's hello admits them (connected lobby, preparation and flight never
  expire), and never renews from heartbeats, copying a link,
  receiving data or other activity. Expiry is checked before admission, media
  acceptance, renewal and start, not only by the 100ms timer. An expired room
  cannot be revived. A renewal does not require the friend to press anything.
- Cancellation immediately ends the session and closes voice/data connections.
  The creator retains its signaling address as a cancellation responder until
  the tab leaves or creates another room. Late peers receive `cancelled`; when
  the address is gone, `peer-unavailable` produces a cancelled/unavailable notice.
  No persistent room-status backend is introduced: after a tab closes the static
  client cannot distinguish a cancelled code from one that never existed.
- All multiplayer setup, room and voice controls live in `dialog.showModal()`.
  Native focus/pointer isolation and stopped dialog key propagation exclude
  background UI; input and deterministic/frame physics also check modal state.
  A dialog owns only the pause it created. Shared start/reset closes it before
  entering flight; room cancellation keeps the explanatory dialog open. Voice stays on during flight and while the dialog is open; mute/unmute is inside the dialog.
- Host owns room configuration and starts/restarts. Both clients prepare the same
  airport, aircraft, runway/cruise preset, noon lighting and calm wind before a
  ready barrier releases flight. Initial supported airports: coastal, Incheon,
  neon (the ordinary runway/cruise presets). Generated/mission terrain is outside
  this first shared-flight mode. Each pilot runs the existing local physics.
- Slots are separated: runway guest waits 80 m behind; cruise guest starts 60 m
  right and 20 m behind the host. Aircraft are ghosts, with no remote forces or
  collision events. Reset retains the assigned slot and advances a respawn epoch.
- Remote aircraft use the same C172, B738 and F16 visual classes and GLB assets as
  the selected local aircraft, including the normal alignment/livery and gear
  animation. Remote instances create no physics or collision state. Exterior-only
  construction omits the B738 instrument cockpit, live C172 displays, instrument
  lighting and F16 exhaust effects. Remote lights do not illuminate the scene.
  Leaving disposes owned geometry, materials and textures, including assets that
  finish loading after departure. The local aircraft keeps its own resources.
- One admitted data connection and one media connection per room. A third pilot
  receives room-full. No automatic host migration; losing either pilot ends the
  session, releases microphone/calls, and leaves the local flight available solo.
- Versioned validated protocol, bounded snapshots, monotonic sequence/round/epoch,
  stale-packet rejection, interpolation, stale hiding and bounded send buffering.
  Reliable ordered room control; snapshots share that channel at 15 Hz with
  backpressure rather than accumulating old positions.
- Creating or joining automatically requests microphone access. Once permitted,
  voice transmits continuously by default. The modal has a mute/unmute button;
  no push-to-talk shortcut or held button is required. Muting survives dialog,
  reset and AudioContext state changes. Leaving closes all audio tracks.
  Denied permission retains listening and offers an explicit retry.
- Opening a valid room link automatically connects, opens the room modal, and
  requests microphone access. Capture does not wait for AudioContext resume,
  which may be blocked until a user gesture. Context state changes synchronize
  transmission; playback has a retry button when blocked. Invalid links show
  an error without connecting or requesting a microphone. Invite IDs are random
  capabilities. Room membership is not a
  verified identity; invite only trusted friends. P2P can disclose IP addresses.

## Infrastructure

PeerJS provides WebRTC signaling and media/data connections; the production
static client uses PeerJS Cloud by default. This is an external signaling
service, not serverless networking. The selected library's default ICE services
are used unless explicitly configured. They have no availability guarantee from
this project. UI reports connection failures and offers retry/leave. Test across
real independent networks before treating any network/browser combination as
supported. A production relay budget/provider and short-lived credential service
remain deployment decisions; never put private long-lived TURN secrets in Vite
variables (they become public).

`VITE_MULTIPLAYER_SIGNAL_URL` optionally selects a self-hosted PeerServer URL
(e.g. `http://127.0.0.1:9000/flight3d` for local testing).
`VITE_MULTIPLAYER_ICE_SERVERS` optionally contains a JSON RTCIceServer array for
public configuration or ephemeral credentials. HTTPS deployments need HTTPS/WSS
signaling and microphone access requires a secure context (localhost is allowed).
No query-string signaling overrides or production test hooks.

## Verification plan

1. `npm test`: pure room state/authority/capacity, invalid messages, delayed and
   reordered snapshots, interpolation, timeout/disconnect/restart, and voice
   permission/cleanup lifecycle with injected adapters. Controller regressions cover
   restored solo availability, intentional pause retention and preparation holds.
   WaitingLease tests exact sixty-second expiry, renewal and non-revival; modal tests
   cover pause ownership, shared starts and explicit cancel handling.
2. `npm run test:multiplayer`: real Chromium WebRTC between independent pages,
   local PeerServer, no public network or mic hardware: host/guest handshake,
   shared start barrier/config, bidirectional movement/reset, third-peer
   rejection, real audio RTP + decoded continuous voice/mute/unmute, disconnect cleanup.
   This is a required CI step. The fixture imports production room/transport/voice
   modules plus the shipping native-modal markup and controller/flight-controls
   boundary. It verifies focus/pointer isolation, renewal/expiry, and cancellation
   messages for late peers before and after creator disposal. It never creates
   WebGL; hosted CI does not claim 3D acceptance.
3. Local hardware Chrome: GPU verifier first, then two complete simulator pages,
   actual room UI, remote aircraft drawing, reset/restart, voice controls and
   mobile-sized layout. Report actual renderer and evidence, not context creation
   alone. Remote devices/networks and physical mic listening are separate manual
   acceptance; synthetic audio only proves the automated transport/audio path.

Implementation checklist:
- [x] Protocol/session and interpolation with Node coverage.
- [x] PeerJS transport and automatic microphone/mute lifecycle.
- [x] Lobby/HUD, shared start, remote model, reset and leave integration.
- [x] Real browser data/audio integration test wired into CI.
- [x] Full check/test/build and hardware Chrome acceptance.

## Verification record

- Node logic coverage plus the full repository check/test/build gate passed.
- Local signaling browser test and the separate `--public` PeerJS test passed:
  bidirectional data, real audio RTP and decoded tone/silence, capacity, restart
  and teardown. Audio input was synthetic; no physical microphone listening or
  independent WAN/mobile-device test is claimed.
- Hardware Chrome 156.0.8078.73: Intel Graphics ADL-N through ANGLE/Vulkan;
  shader pixel `[255,0,0,255]`, GL error 0. Two real simulator pages passed UI
  join/start, runway separation, remote model rendering, throttle movement,
  reset, restart, individual crash/debrief recovery, PTT release/blur, mobile
  viewport bounds and both host/guest departure. Starts exercised C172/coastal,
  B738/neon cruise, F16/Incheon runway and C172/coastal cruise. This samples
  supported combinations; it is not a full aircraft/scenery/browser matrix.
- Screenshots are generated locally under ignored
  `review-artifacts/multiplayer/`. Hosted CI intentionally proves transport/audio
  behavior without claiming rendered simulator or hardware GPU acceptance.

## Modal and waiting-room acceptance

Hardware Chrome 156 / Intel ADL-N via ANGLE/Vulkan passed the shader readback
`[255,0,0,255]`, GL error 0. Two real simulator pages verified manually typed
short/grouped codes, modal input and physics isolation, phone viewport bounds,
voice/PTT, remote drawing/movement, reset/restart and all three scenery/aircraft
types. A real ten-second waiting deadline was renewed halfway, survived its old
deadline, then cancelled both clients after the next press was missed; a late
joiner received an explicit cancellation message. Screenshots include setup,
waiting, mobile and cancelled states under `review-artifacts/multiplayer/`.
