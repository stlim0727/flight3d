# Flight3d Ghost Host

Run an ordinary Flight3d multiplayer host without cloning the game repository,
installing npm dependencies, downloading game assets, or owning a GPU.
The AI flies a B738 coastal-cruise orbit. Guests use the existing game/invite UI.

## Download an executable

Choose a `ghost-host-v...` release from the [project releases](https://github.com/stlim0727/flight3d/releases).
Native archives are provided for Windows x64, Linux x64/ARM64, and macOS Intel/Apple
Silicon. They include Node; installed Chrome/Chromium is the only application
prerequisite. Follow [SETUP.md](SETUP.md) for choosing an archive, verifying the
checksum, first run, sharing an invite and automatic startup/update instructions.
The guide is included in every archive and attached separately to the release.

Native executables are built on their target OS/CPU and smoke-tested there. Linux
x64 additionally runs the real guest lifecycle test. macOS builds are ad-hoc signed;
Windows builds are unsigned. Publisher signing/notarization is not configured.

PR build artifacts are for review; public downloads appear only after the release
workflow succeeds for a published matching ghost-host release tag.

## Portable JavaScript package

Requirements: **Node.js 22.23.2+** and installed **Chrome or Chromium**. The same
JavaScript package supports Linux, macOS and Windows. Linux is the verified service
platform; macOS/Windows browser detection is provided but not acceptance-tested.

Download `flight3d-ghost-host-0.1.0.tgz` and `SHA256SUMS` from the project's ghost-host
release/artifact. Verify its checksum. Then either install the local archive:

```sh
npm install --global ./flight3d-ghost-host-0.1.0.tgz
flight3d-ghost-host --check
flight3d-ghost-host --name Maverick
```

Or extract it into an empty directory, enter the extracted `package/` directory,
and run `node cli.mjs` there. Nothing is
installed or built on first run. No registry publication is required for this
archive, and no automatic browser download occurs.

The first JSON `ready` message prints the invite URL, room code, release and
compatibility versions. Share the invite with a mobile player. The host starts
when a guest joins and reopens the same room after departure. Voice is silent;
the host never requests microphone access or records guests.

Use `--help` for options. Important configuration:

| CLI option | Environment | Purpose |
| --- | --- | --- |
| `--name` | `GHOST_NAME` | Ordinary pilot name |
| `--state-dir` | `GHOST_STATE_DIR` | Durable room storage |
| `--room` | `GHOST_ROOM` | Explicit six-character room code |
| `--public-url` | `GHOST_PUBLIC_URL` | Game deployment used for invites |
| `--chrome` | `CHROME_PATH` | Installed Chrome/Chromium executable |
| `--signal-url` | `GHOST_SIGNAL_URL` | PeerServer matching the guest deployment |
| `--ice-servers` | `GHOST_ICE_SERVERS` | JSON RTCIceServer array |

`--version` prints release metadata without launching Chrome or creating state.
`--check` validates configuration and finds the browser without opening a room.
A stopped browser or simulation stall exits nonzero so a supervisor can restart it.
Normal startup fails clearly if the browser cannot be found. The browser sandbox
stays enabled; `CHROME_NO_SANDBOX=1` is an explicit exception for environments that
cannot support it. No GPU-disabling or software-renderer flag is used: WebGL is
unavailable and the host creates no renderer.

Only loopback HTTP/CDP ports are opened. No inbound web port forwarding is needed
for the CLI. WebRTC still requires working signaling and ICE connectivity; strict
NAT/firewall combinations may need TURN configured on both game and host. Default
external PeerJS/ICE infrastructure has no service guarantee.

## State and updates

The room is stored separately from the application:

- Linux: `$XDG_STATE_HOME/flight3d-ghost/room.json`, defaulting to
  `~/.local/state/flight3d-ghost/room.json`.
- macOS: `~/Library/Application Support/Flight3dGhost/room.json`.
- Windows: `%LOCALAPPDATA%/Flight3dGhost/room.json`.

Unsupported state schemas fail without rewriting the room. Keep this directory when upgrading or rolling back. Compatible updates preserve
the invite; after a protocol/flight revision change, share the newly generated
versioned link even if the room code is unchanged. Only one process should use
a particular room code. A corrupt room file fails startup instead of silently
changing the invite. The original service's room file can be reused by pointing
`GHOST_STATE_DIR` at its existing directory.

For portable-package long-running Linux installations, extract releases into
`~/.local/share/flight3d-ghost/releases/<version>-<commit>/` using
`tar -xzf ARCHIVE.tgz -C RELEASE_DIRECTORY --strip-components=1`, and point `current`
at the chosen release. Install the included `flight3d-ghost.service` into
`~/.config/systemd/user/`, adjust the Node PATH if necessary, then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now flight3d-ghost.service
journalctl --user -u flight3d-ghost.service -n 30
```

Ensure user lingering is enabled if it must survive logout and start at boot.
Stop the service, switch `current`, and restart to update or roll back. An update
never overwrites state or automatically downloads a different release. Docker is
not required; systemd supervises the CLI and its browser process group.

## Compatibility

The package release, wire protocol and flight-data contract are separate versions.
`manifest.json` and `--version` record all three plus the source commit. Hosts and
guests check the protocol major and flight revision during hello/welcome, before
preparation. Unsupported combinations receive `incompatible` and do not start.
Different release numbers/build commits are allowed when those contracts match.

Legacy protocol-v2 peers without contract metadata map to the fixed original
flight revision 1, not whatever revision the current game happens to use.
Unknown optional fields are ignored; changing required message semantics bumps
the protocol major, while changing coordinates/scenery/spawn meaning bumps the
flight revision. Visual assets and AI tuning alone do not require either bump.
