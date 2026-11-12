# Changelog

## [Unreleased]
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
