# Multiplayer compatibility contract

Flight3d's browser client and independently installed hosts use the same contract.
A ghost is an ordinary host: no special guest mode, protocol or UI is needed.
The source of truth is `src/multiplayer/compatibility.js`, `RoomSession.js`,
`protocol.js` and `roomCode.js`. Package build metadata is descriptive, not authority.

## Independent versions

| Version | Current | Change it when |
| --- | --- | --- |
| Host package release | 0.1.0 | Distributing a changed host; use semantic versioning for its CLI/config behavior |
| Wire protocol major | 2 | Required fields, state transitions, authority, snapshot interpretation, or mandatory features change incompatibly |
| Flight revision | 1 | Shared world axes/units/origin, scenery placement, aircraft identity/datum, preset spawn or slot definitions change incompatibly |
| Persistent state schema | 1 | The durable room file's required interpretation changes |

Game build hashes, host build hashes and package versions do not need to match.
An AI control-law improvement, local physics tuning or replacement texture does
not require a protocol/flight bump: each pilot owns their own physics and there
is no deterministic lockstep or remote collision authority. Changing an aircraft's
model-origin/contact datum is different from changing its paint and requires a
flight revision if it moves the communicated pose's meaning.

The initial implementation uses exact protocol-major and flight-revision equality.
This is intentionally conservative; it does not pretend to support a compatibility
range without tested adapters. Optional additive message fields are ignored by
existing peers. A mandatory capability must be introduced with a new major or an
explicit, tested negotiation scheme; it must never be assumed from a release number.
There is no speculative feature-negotiation framework in this release.

## Discovery and handshake

### Public room directory

In addition to private direct invites, hosts can opt into the public directory service (`/v1/rooms`).
The directory stores only short-lived metadata with a 45-second time-to-live (TTL) and 15-second host heartbeats.
Secret lease tokens are stored as SHA-256 hashes and verified on heartbeat and deletion.
Directory downtime never prevents direct invites or interrupts ongoing peer-to-peer flights.

- `POST /v1/rooms`: Host registers public room, receives room ID and secret lease token.
- `POST /v1/rooms/{id}/heartbeat`: 15s heartbeat with bearer token, updates status/player count, refreshes 45s TTL.
- `DELETE /v1/rooms/{id}`: Best-effort unregister on graceful host exit.
- `GET /v1/rooms`: Public listing filtered by `protocol` and `flight` revision. Excludes expired rooms (`expiresAt <= serverNow`).

### Versioned invites and handshake

Versioned invite: `https://GAME/flight3d/?r=K7M2QX&mp=2&fr=1`.
The guest validates version hints before connecting or requesting its microphone.
Room signaling identifiers are `flight3d-v2-K7M2QX`; another major has a separate
namespace. The URL hint is necessary to report an unsupported major before trying
the wrong namespace. A compatible update preserves its invite; after an incompatible
upgrade, share the new link with updated hints even if the room code is retained.
Hints are not trusted as compatibility proof: the handshake
is checked again. Plain room codes assume the current major and cannot diagnose
a different-major namespace; share full invite URLs when versions may differ.

Guest sends:

```json
{"type":"hello","version":2,"contract":{"flight":1},"name":"Wing"}
```

Host validates both versions and the name, then replies with its immutable room
configuration:

```json
{"type":"welcome","version":2,"contract":{"flight":1},"name":"Maverick","config":{"airport":"coastal","aircraft":"B738","scenario":"cruise"}}
```

The guest also validates versions, name and supported airport/aircraft/scenario.
Either role sends `{"type":"reject","reason":"incompatible"}` before ending an
incompatible session. No prepare, physics start or aircraft download is authorized
by a failed handshake. The existing room dialog explains that the game/host must
be updated. Local diagnostics distinguish protocol, flight and malformed-contract
failures without exposing ICE credentials.

The pre-metadata protocol-v2 hello/welcome and pre-metadata invite URLs are a
**fixed baseline**: protocol 2, flight revision 1. Missing metadata must never map
to the current flight revision after a bump. Explicit malformed metadata is
rejected, rather than treated as a legacy peer. Legacy tests use frozen packets
with literal version values. New optional metadata is accepted by older v2 peers;
future required changes must increment the major/revision instead of redefining v2.

## Authority and timing

- Exactly one host and one guest. Host owns configuration and shared start/restart;
  guest cannot promote itself, replace configuration or start a shared round.
- Host sends `prepare` with round + 1; both prepare the same configuration in
  host slot 0 / guest slot 1. Guest sends `ready`; host sends `go` only after both
  are ready. Preparation alone never releases physics.
- Each peer owns its aircraft's physics. Reliable ordered WebRTC transports control
  and snapshots; snapshots target 15 Hz with buffering limits. A snapshot carries
  `round`, monotonic `seq`, and respawn `epoch`; stale rounds/sequences/epochs cannot
  overwrite a newer state. Teleports/respawns do not interpolate through terrain.
- There is no shared wall clock. Remote presentation interpolates using local
  arrival times (120 ms delay), marks stale after 500 ms and hides after 3 seconds.
- Heartbeats target 1 second. Connecting/connected/flight liveness uses 20 seconds,
  preparation uses 45 seconds. Human unattended-room renewal remains 60 seconds;
  the persistent host intentionally has an infinite waiting lease. Background
  scheduling and networks can delay processing; these are not hard real-time guarantees.
- Losing either pilot ends the session; no host migration exists. The unattended
  host can register the same invite again, but that is a new session, not automatic
  guest reconnection or continuation of the old round.

## Snapshot interpretation

`p` is world position in meters; `v` is world velocity in meters/second. The world
is right-handed: +Y up, +X east, +Z south in the preset's local airport frame.
`q` is normalized local-to-world quaternion `[x,y,z,w]`; aircraft forward is local
-Z, right +X and up +Y. These are local simulator coordinates, not geodetic ECEF.
`gear` is extension 0–1; `flaps` is degrees. `held`, `crashed` and `talking` are
booleans. The receiving aircraft's graphics, camera and audio are presentation;
they do not become remote forces/colliders.

Existing limits remain authoritative: validated bounded arrays/finite values,
4096-character incoming message bound, 100 messages/second per peer and snapshot
backpressure above 16 KiB. Room codes are invite capabilities, not verified user
identities. Protocol versions establish compatibility, not trust or authentication.

## Release and regression policy

Build `npm run build:ghost` from the same committed source that supplies the web
client. The archive contains `manifest.json` and `--version` reports package
version, source commit/dirty state, protocol major, flight revision and state
schema. The package does not fetch the latest game's JavaScript on startup; its
physics and protocol stay pinned to the installed release. Update and rollback
replace application files while preserving state. Unsupported state schemas fail
startup without rewriting the room.

CI builds and unpacks the archive outside the checkout, checks that it contains no
source/assets/runtime dependencies, and starts it there with installed Chrome.
Real WebRTC checks cover a legacy handshake, a current guest, a mismatched flight
revision rejected before start, AI movement, process restart and the same room
code. Pure contract tests cover both role directions, malformed metadata and URL
routing hints. Protocol or flight changes must extend this compatibility matrix;
changing a constant alone is not sufficient evidence of compatibility.
