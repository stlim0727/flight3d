# Persistent multiplayer host

`npm run multiplayer:ghost` runs an unattended B738 coastal-cruise host. Its ordinary
invite link works with the existing deployed mobile client. No simulator UI,
protocol version, guest privileges, or AI badge changes are needed. The host name
defaults to Maverick. It starts two seconds after a guest joins, waits for both
pilots' preparation, then flies an orbit using the production 120 Hz controls,
physics, terrain/contact checks, trim and existing pilot control laws. It sends
ordinary snapshots at 15 Hz. The host answers the ordinary voice connection with
a silent track; it never requests or records microphone audio.

The installed Chrome provides WebRTC and silent Web Audio only. WebGL is disabled;
no WebGL renderer, software renderer, scenery mesh, cockpit or camera is created.
Three.js vectors and aircraft transforms do not require graphics acceleration.
The source headless runtime is also shared by existing physics calibration tests.
The simulator guest still needs its normal WebGL-capable browser.

## Run and configure

Use Node 22.23.2, `npm ci`, and installed `google-chrome-stable`:

```sh
npm run multiplayer:ghost
```

The command prints an invite and writes `room.json` under `.local/ghost-host/`.
The room code persists across restarts. Configuration is through environment:

- `GHOST_STATE_DIR`: durable directory for `room.json`.
- `GHOST_ROOM`: optional valid six-character room code; otherwise reuse saved code
  or generate one. Never run two hosts with the same code.
- `GHOST_NAME`: normal pilot name, default Maverick.
- `GHOST_PUBLIC_URL`: guest game's URL, default the production GitHub Pages game.
- `CHROME_PATH`: installed Chrome executable, default `/usr/bin/google-chrome-stable`.
- `CHROME_NO_SANDBOX=1`: only for environments where Chrome's sandbox cannot run.
- Existing `VITE_MULTIPLAYER_SIGNAL_URL` / `VITE_MULTIPLAYER_ICE_SERVERS` apply to
  the host; they must match the guest deployment's networking configuration.

The service uses an infinite unattended waiting lease; human rooms retain their
60-second manual renewal policy. One guest is admitted. After departure or a
connection failure the host disposes the old session, waits three seconds, and
registers the same code again with fresh physics. Guests reconnect through the
same invite. Guest reset remains the ordinary local reset; shared restart stays
host-owned. A flight failure ends the connection and reopens the room.

The Vite module server and Chrome debugging endpoint bind to loopback and are not
public web services. The service needs outbound access to public PeerJS and WebRTC
ICE infrastructure. Current default ICE services have no availability guarantee;
an independent mobile/cellular connection still needs user acceptance. This is
not a TURN deployment or a change to the existing two-player P2P architecture.

## Persistent installation on this machine

`deploy/flight3d-ghost.service` is a user systemd unit for this host's existing
`/opt/node/bin/node`. Install a committed source archive and `npm ci` in
`/var/shared/repos/flight3d/.local/ghost-host-runtime`, independently of task
worktrees. Preserve `/var/shared/repos/flight3d/.local/ghost-host-state/room.json`
when updating. Stop the service before replacing its runtime.

```sh
mkdir -p ~/.config/systemd/user
cp deploy/flight3d-ghost.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now flight3d-ghost.service
systemctl --user status flight3d-ghost.service
journalctl --user -u flight3d-ghost.service -n 30
```

User lingering must be enabled for boot/logout persistence (`loginctl show-user
"$USER" -p Linger`). This machine already has `Linger=yes`. `Restart=always`
recovers process/browser failures; stopping the unit explicitly keeps it stopped.
Chrome and its children belong to the unit's control group. Runtime cleanup closes
only this host's browser and temporary profile. Computer shutdown, loss of network,
and outages of external signaling/ICE still make the host unavailable.

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
