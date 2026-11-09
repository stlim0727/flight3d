# Persistent multiplayer player (host and guest)

`npm run multiplayer:ghost` runs an unattended B738 coastal-cruise host. Its ordinary
invite link works with the existing deployed mobile client. It uses the ordinary simulator UI and guest privileges, with no AI badge. The host name
defaults to Maverick (or Goose in guest mode). It starts two seconds after a guest joins, waits for both
pilots' preparation, then flies an orbit using the production 120 Hz controls,
physics, terrain/contact checks, trim and existing pilot control laws. It sends
ordinary snapshots at 15 Hz. The single executable can also join an existing room as a
guest (`--join CODE` or `--guest`), flying wingman in slot 1. Optional `--voice`
enables synthetic radio transmission (chime/squelch audio) and remote voice energy detection
with call-and-response radio etiquette. By default, voice remains silent without requesting or recording microphone audio.

The installed Chrome provides WebRTC and headless Web Audio. WebGL is disabled;
no WebGL renderer, software renderer, scenery mesh, cockpit or camera is created.
Three.js vectors and aircraft transforms do not require graphics acceleration.
The source headless runtime is also shared by existing physics calibration tests.
The simulator guest still needs its normal WebGL-capable browser.

## Standalone distribution

Native executables include Node and embed all runtime assets. Users only install
Chrome/Chromium. [The end-user setup guide](../../host/SETUP.md) is included in every
archive and attached separately to releases. Maintainers run
`npm run build:ghost:native` on the target OS/architecture; output archives are
named with version, OS and CPU. The build requires the exact Node distribution's
LICENSE and includes it in the native archive.

A reusable native-build workflow produces Linux x64/ARM64, macOS x64/ARM64 and
Windows x64 archives. It smoke-tests each executable in an empty directory; Linux
x64 also passes the complete real WebRTC guest lifecycle test against the binary.
The release job waits for the portable and every native job, downloads their
artifacts by run ID, verifies the combined checksums and attaches all archives,
`SHA256SUMS`, and `SETUP.md`. No partial set is uploaded after a failed build.
macOS uses ad-hoc signing; Windows publisher signing and macOS notarization are
not configured. Supported runner labels come from GitHub's hosted-runner reference.


See [the standalone README](../../host/README.md) for installation without this
repository and [the compatibility contract](multiplayer-contract.md) for host,
guest and game versioning. The portable JavaScript archive is roughly 330 KB compressed and
contains ten files: a Node CLI, a prebuilt browser bundle, metadata, licenses,
documentation and a portable systemd unit. It has zero runtime npm dependencies.
Installed Node 22.23.2+ and Chrome/Chromium are still required.

Maintainers build with `npm run build:ghost`; output is
`artifacts/ghost-host/flight3d-ghost-host-0.1.0.tgz` plus `SHA256SUMS`. CI verifies
and uploads that archive. Publishing a reviewed `ghost-host-v0.1.0` GitHub Release
triggers a separate workflow that verifies the tag/package version, rebuilds and
tests the archive, and attaches it and its checksum as public release assets. It
does not overwrite existing release assets or publish to npm. No release is
created by a normal PR build. Download/extract the archive or install it from the
local file with npm; do not advertise a registry package or a public release until
it has actually been published. `npm run multiplayer:ghost` is the repository
convenience command and builds the same artifact before launching it.

The distributed runtime serves only two built files and local health information
with Node's HTTP server. It never starts Vite, reads the checkout, downloads game
assets, or downloads updated game logic. The HTTP/CDP listeners bind to loopback.
Signaling and ICE configuration are runtime options, not embedded build settings.

## Persistent installation and migration

Use the portable unit in `deploy/flight3d-ghost.service`; it runs the extracted
package at `~/.local/share/flight3d-ghost/current/cli.mjs`. Install Node in its PATH
or override ExecStart with an absolute executable path. The package README covers
release directories, enabling the service, lingering, logs, update and rollback.

The original machine-specific service used a source archive under
`/var/shared/repos/flight3d/.local/ghost-host-runtime` and room state under
`/var/shared/repos/flight3d/.local/ghost-host-state`. To migrate, stop that service,
install the standalone archive, and set `GHOST_STATE_DIR` to the existing state
directory before restarting. Its original room.json (without a schema field) is
accepted as state schema 1. Compatible updates preserve the room code and invite. A protocol/flight revision
change requires sharing the newly generated versioned link.
Do not run both installations simultaneously with the same room code.

## Verification

- `node --test tests/ghostPilot.test.js`: ten minutes of real physics, bounded orbit,
  altitude/speed/stall checks, reset and bounded catch-up after process suspension.
- `GPU_ANGLE=vulkan npm run test:multiplayer`: existing real WebRTC tests plus an
  ordinary guest joining the ghost, shared preparation/start, movement snapshots,
  departure and same-code rejoin. This fixture test does not claim 3D evidence.
- Manual/full-game acceptance: use the printed invite in the deployed simulator.
  Hardware Chrome must pass `scripts/verify-browser-gpu.mjs` before any guest
  rendering assertions. Check visible moving aircraft, leave and rejoin at mobile
  dimensions. A desktop browser's mobile viewport is not a physical phone test.
