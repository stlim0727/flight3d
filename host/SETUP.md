# Set up a Flight3d host

This guide accompanies the downloadable executable. You do not need the game
repository, npm or Node. Install Google Chrome or Chromium once; the host uses it
for networking with WebGL disabled. Players run the normal game on their phones.

## 1. Choose a download

Open [Flight3d Releases](https://github.com/stlim0727/flight3d/releases) and choose a `ghost-host-v...` release.
The game releases and ghost-host releases are separate. Match your OS and CPU:

| Computer | Asset suffix |
| --- | --- |
| Windows, Intel/AMD 64-bit | `windows-x64.zip` |
| Linux, Intel/AMD 64-bit | `linux-x64.tar.gz` |
| Linux, ARM64 | `linux-arm64.tar.gz` |
| Mac, Apple Silicon | `macos-arm64.tar.gz` |
| Mac, Intel | `macos-x64.tar.gz` |

Linux binaries target glibc distributions; Alpine/musl builds are not provided.

Extract the archive into a folder you want to keep. Verify the downloaded archive
against `SHA256SUMS` from the same release. Windows PowerShell offers
`Get-FileHash -Algorithm SHA256 FILE.zip`; macOS offers `shasum -a 256 FILE.tar.gz`;
Linux offers `sha256sum FILE.tar.gz`. Compare the complete hash with the matching
filename. Download these together from the project's release, not a third-party
repackaging site.

Native binaries include Node and its license. macOS builds use ad-hoc signing;
Windows builds have no publisher certificate configured. These are not notarized
or publisher-signed releases. Managed-device policies may require administrator
approval. Do not disable your device's security policy to install them. The
portable `.tgz` JavaScript package remains an alternative for existing Node users.

## 2. First run

Install Chrome/Chromium. Open a terminal in the extracted folder. On Windows,
use PowerShell:

```powershell
.\flight3d-ghost-host.exe --check
.\flight3d-ghost-host.exe --name Maverick
```

On Linux or macOS:

```sh
chmod +x flight3d-ghost-host
./flight3d-ghost-host --check
./flight3d-ghost-host --name Maverick
```

`--check` finds the installed browser and prints the state directory and versions.
If it cannot find your browser, provide its full executable path:

```sh
./flight3d-ghost-host --chrome "/path/to/chrome" --name Maverick
```

Windows uses the same `--chrome` option after the `.exe` filename. Do not point it
at a browser shortcut; use the actual browser executable. `--help` lists options.

Wait for the JSON line containing `"event":"ready"`. Copy its `invite` URL and
send it to the player. Opening that link on a phone joins the ordinary multiplayer
room and starts the shared flight automatically. The host appears as Maverick and
flies the 737. Keep this terminal and machine running. Ctrl+C stops the host;
closing the terminal or putting the computer to sleep makes it unavailable.

No web port forwarding is required. Outbound signaling and WebRTC must work on
both networks. Strict NAT or firewalls may need TURN configured by the game/server
operator; opening random inbound ports does not fix that. The normal defaults use
the same public signaling/ICE services as the game.

## 3. Run automatically on Linux

In native archives, the included `flight3d-ghost.service` is for the executable.
Portable JavaScript users should follow README.md for their different unit. Extract a
release into `~/.local/share/flight3d-ghost/releases/VERSION/`, then create `current`
as a symlink to that directory. The executable must be directly inside `current`.
For example, after extracting into a new empty release directory:

```sh
mkdir -p ~/.config/systemd/user
ln -s ~/.local/share/flight3d-ghost/releases/VERSION ~/.local/share/flight3d-ghost/current
cp ~/.local/share/flight3d-ghost/current/flight3d-ghost.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now flight3d-ghost.service
systemctl --user status flight3d-ghost.service
journalctl --user -u flight3d-ghost.service -n 30
```

Replace `VERSION` with your actual release directory. If `current` already exists,
follow the update procedure below instead of overwriting it while running.
For boot/logout persistence, an administrator may need to enable user lingering:
`loginctl enable-linger YOUR_USERNAME`. Check with `loginctl show-user "$USER" -p Linger`.
The service restarts after failures and closes its own browser when stopped.
Windows/macOS foreground execution is supported; automatic startup integration
for those systems is not provided by this systemd unit.

## 4. Preserve your invite and update

Room state lives outside the extracted release folder:

- Linux: `~/.local/state/flight3d-ghost/` (or `$XDG_STATE_HOME/flight3d-ghost/`).
- macOS: `~/Library/Application Support/Flight3dGhost/`.
- Windows: `%LOCALAPPDATA%/Flight3dGhost/`.

Keep `room.json`. To use another location, pass `--state-dir DIR`. Only one host
may use a room code at a time. Never copy the same room state to two running hosts.

Stop the host before updating. Extract the new archive into a separate folder,
verify its checksum, and start that executable with the same state directory.
For systemd, stop the service, replace `current` with a symlink to the new release,
and start it again. Retain the previous folder so rollback is the same procedure
pointing `current` back. Do not delete the state directory during either operation.

Compatible updates preserve the invite. After an incompatible protocol/flight-data
update, share the newly printed URL even if the six-character room code is retained.
The game reports incompatible versions before starting; `--version` identifies the
release, protocol, flight revision and source commit when diagnosing a mismatch.

## Troubleshooting

- **No ready message:** read the final error; run `--check` and verify the browser
  path. Check outbound connectivity to the configured signaling/ICE services.
- **Room already in use:** stop the other host using this state/code. Alternatively,
  use a different `--state-dir` to create an independent room.
- **Guest cannot join:** share the complete `invite` from the current ready message.
  If it reports incompatibility, update the game/host to matching protocol and
  flight revisions. Repeated connection failures across networks may require TURN.
- **Machine sleeps:** the host cannot stay available while asleep or shut down.
- **Service fails:** use `journalctl --user -u flight3d-ghost.service -n 50`; check
  `current`, executable permissions and the installed browser path.
