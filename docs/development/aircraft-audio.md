# Aircraft audio

`FlightSimulator.loadAircraftConfig` passes the selected aircraft configuration
to `FlightAudio`, before any user gesture initializes the audio graph. Aircraft
switches reuse that graph and fade the previous engine's buses out. Presets reset
crash suppression, stall timing and altitude-callout history.

The default profile preserves the existing jet roar and N1/N2 oscillators. The
C172 declares a piston profile: a periodic pressure pulse at four-stroke firing
frequency plus blade-passage-modulated propeller air noise. Turbine oscillators,
jet roar, pack noise and Boeing altitude voices remain silent in that profile.
The stall warning is continuous in flight, with no transport stick-shaker chirp.

The simulator currently exposes normalized shaft speed as `engine1.n1` for all
aircraft. `pistonSoundState` maps that telemetry to approximate 700–2700 RPM for
sound synthesis (two firing/blade pulses per revolution with the C172 tuning).
It is not a measured Lycoming recording or a new piston/propeller physics model.
Failure removes combustion pulses; a stopped failed aircraft has no propeller
noise. An airborne failed engine can retain quiet windmilling air noise.

Mute controls the shared output while the engine parameters continue updating.
Muting and aircraft/preset changes cancel queued speech. Crash audio suppresses
continuous sound until a preset reset, including crashes that occurred muted.

Engine volume (0–100%) scales one engine bus that carries the jet roar/whine and
piston/propeller sources before cockpit and distance acoustics. Wind, rumble,
pack hum, warnings, GPWS, radio and multiplayer voice keep their level. The
slider appears in flight settings and the multiplayer dialog; both stay in sync.

## Verification

```sh
node --test tests/flightAudio.test.js
npm run dev -- --host 127.0.0.1 --port 5188
chrome-session --project flight3d node scripts/verify-aircraft-audio.mjs
```

The browser harness owns one tab in the existing project Chrome. It uses native
mute/unmute clicks to exercise AudioContext's gesture gate, switches aircraft
repeatedly, verifies the graph is reused and checks failed-engine silence. It
then renders actual browser OfflineAudioContext graphs into 48 kHz mono WAVs:
old idle/full-power, C172 idle/full-power and power-to-failure. Spectral and RMS
checks verify firing frequencies, suppression of the turbine-whistle component,
non-clipping output and a silent failure tail. `APP_URL` and `ARTIFACT_DIR` can
change the server and output directory.

Listen to the [review WAVs](../../review-artifacts/aircraft-audio/README.md) for
subjective timbre assessment. Automated signal checks are not human listening,
and do not validate speaker, headphone or Bluetooth sound quality.
