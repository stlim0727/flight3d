# Changelog

## [Unreleased]
- **feat(camera):** director camera missile cinematics
  - A rail release in `DIRECTOR` mode cuts immediately to a wing-mounted launch shot, then a rigid follow cam on the missile, then the targeted bandit's POV as it closes.
  - The bandit POV waits for a 1.6 km entry range and uses a proximity telephoto so the round grows from a speck through detonation.
  - `CameraSystem.setCombatStateProvider()` feeds the live missile and bandit arrays; replays keep their own director timeline.
- **fix(replay):** show F-16 missile launches, bandit targets and bursts in recorded replays
  - Replay tracks now carry a compact combat section (codec v4) with 2 Hz bandit poses, 20 Hz missile poses, detonation/expiry markers and the rail loadout mask.
  - Playback interpolates the recorded combat state, stages each detonation once, and restores the fired-rail count and time-correct splash count; it never re-simulates guidance, so seeks and speed changes cannot alter the outcome.
  - Replay HUD, cockpit and chase overlays show recorded bandits as target designators.
  - B737/C172 and older v1–v3 tracks remain readable; combat samples are thinned before pose samples when the entry budget is tight.
- **feat(combat):** F-16 AIM-9X/AIM-120C rail missiles, TPN guidance, HUD lock and RWR (#612 Sprint 1)
  - Six procedural rail missiles (4× AIM-9X, 2× AIM-120C) mounted on the F-16 wingtip and underwing stations; fired stations hide their mesh and reload on preset restart.
  - 120 Hz continuous rocket mass/thrust, atmospheric drag, gravity, 3D true proportional navigation, seeker gimbal limit and closest-approach proximity fuse.
  - Two patrolling bandit drones, HUD target designator / lock diamond / `SHOOT` cue / off-screen locator, weapon and splash inventory, and a 360° RWR display.
  - Three-stage RWR audio (search ping, lock beep, launch siren), missile launch whoosh and lock tone.
  - `Enter` fires, `N` cycles targets, with matching touch buttons; see [air-to-air missiles](docs/development/air-to-air-missiles.md).
- **feat(ui):** make gradual gaze reset optional (#658)
  - Added a persisted Auto gaze reset option so a released drag or hat-switch glance can hold its off-center view instead of slowly returning to the default.
- **fix(audio):** boost mobile & Bluetooth headphone loudness, makeup gain, and route recovery
  - Added post-compressor makeup gain (+4.1 dB, 1.6x) and normalized pink noise buffer to reach commercial game loudness standards (~ -14 LUFS RMS).
  - Added 4-stage volume cycling: 100% (Normal) → 150% (Mobile Boost) → 200% (Bluetooth Max Boost) → Muted → 100%.
  - Added continuous cockpit avionics cooling fan and ECS pack ventilation hum (`packSynth`) to eliminate dead silence on runway/idle.
  - Implemented persistent keep-alive gesture listeners and Web Audio `interrupted`/`suspended` auto-resume to handle Bluetooth earphone route switches on iOS/Android.
  - Retuned turbofan engine acoustic filter from 180 Hz to 280–1200 Hz sweet spot for mobile transducers and wireless earbuds.
  - Added dual-spool CFM56 N1/N2 turbine whine harmonics and ground rolling runway rumble.
  - Added on-screen sound & volume toggle button to preset bar, action panel, and mobile touch overlay.
- **feat:** camera‑anchored infinite ocean mesh and touchdown smoke realism (merged #29)
  - Ocean mesh now anchored to camera with grid snapping (`snapStep`).
  - Realistic tire smoke on landing gear; brake‑intensity threshold and nose‑wheel exclusion.
  - Updated Boeing 737‑800 landing‑gear geometry to official specs (wheeltrack 5.72 m, wheelbase 15.60 m).
  - Added verification script `scripts/verify-ocean-views.js` and unit test `tests/waterOcean.test.js`.

*Released on 2026‑10‑19*
