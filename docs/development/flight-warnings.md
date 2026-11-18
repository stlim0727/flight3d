# Aircraft warnings

`FlightWarnings` evaluates sensed flight state at each physics step. It exposes
priority-ordered `telemetry.warnings` to the HUD, master caution and audio.
Pull-up overrides stall, terrain, overspeed, sink-rate, departure altitude loss,
engine failure, landing configuration and bank alerts. Clear conditions must
hold for 0.8 seconds; touchdown clears airborne alerts immediately. Aircraft
switches and presets reset history. Overspeed has speed/Mach hysteresis.
The B738 HUD and clacker clear on the first recovered sample outside that
hysteresis band. The B738 PFD speed tape shows the lower of 340 kt and
the indicated speed corresponding to Mach 0.82 at the current altitude.

B738 includes excessive descent (sink rate / pull up), terrain closure and
20-second terrain sampling along the velocity vector, altitude loss after
observed takeoff, low gear/flaps on descent, overspeed (340 KIAS / M0.82), bank
angle, engine failure and takeoff configuration. Normal configured approaches
suppress flat-ground prediction; rising terrain and excessive sink still warn.
Takeoff configuration covers flap range, spoilers and parking brake with high
throttle and airspeed. Engine failure uses a single synthesized caution chime;
overspeed and takeoff configuration use a repeating synthesized tone. Stall
retains the existing pre-stall chirp and horn. GPWS voice alerts preempt numeric
altitude callouts; recovery cancels speech, repeated warnings are spaced 4s apart.

C172 represents a basic aircraft without optional TAWS: continuous pre-stall /
stall horn, visual Vne (163 KIAS), bank and engine alerts, with no invented Boeing
GPWS voice or retractable-gear warnings. F16 uses separate simulator limits
(800 KIAS / M2.05, bank 85 degrees), pull-up / terrain / gear-down / engine / limit
voice alerts and no Boeing altitude callouts. These fighter thresholds are tuning
values, not a flight-manual envelope or an Auto-GCAS implementation.

These are simulator approximations, not certified reproductions of proprietary
GPWS envelopes or exact aircraft recordings. Aural alerts use the real pronouncer
phrase words (`TERRAIN, TERRAIN` / `PULL UP, PULL UP`, `SINK RATE, SINK RATE`,
doubled `FIVE HUNDRED` / `ONE HUNDRED` RADALT callouts) and are spoken through
browser speech synthesis pinned to an English voice, since the GPWS announcer is
an English-language device regardless of OS locale; voice availability, accent and
latency still depend on the browser/OS. Warning tones
use Web Audio and require an initial user gesture, like the existing audio.
Mute, volume and crash silence apply to alerts as well as engine audio.

Terrain prediction uses the current terrain height field, not buildings, traffic,
weather radar or a navigation database. TCAS, windshear, glideslope deviation,
fire detection and AP-disconnect warnings are not simulated: the necessary
sensors or system state are not yet modeled. Engine failure is not engine fire.

References for behavior categories and priorities:
- [Hong Kong CAD GPWS guidance](https://www.cad.gov.hk/english/pdf/CAD516.pdf)
- [FAA flight deck alert prioritization](https://hfcc.dot.gov/publications/docs/GeneralGuidance/zz_FAA_GeneralGuidanceDoc_Chapter_04_Section_03.html)
- [Textron Skyhawk maximum limit speed](https://cessna.txtav.com/en/piston/cessna-skyhawk)

Verification: `node --test tests/flightWarnings.test.js tests/flightAudio.test.js`
checks approach / flare, warning escalation, recovery, invalid inputs, takeoff
altitude loss, touchdown reset, profiles, priority, hysteresis, terrain sampling
and speech arbitration. Browser acceptance uses `scripts/verify-flight-warnings.mjs`.

Acceptance on this branch: `npm run check`, all 702 Node tests, and `npm run build`
passed. The browser harness observed live-physics overspeed, visible `PULL UP`
HUD text, warning-voice dispatch and nonzero OfflineAudioContext output (RMS
0.2455). Its screenshot is a staged HUD review; it is not evidence of a real
terrain encounter. Speech dispatch was intercepted for deterministic assertions;
OS voice playback/listening quality has not been accepted. The browser screenshots
and JSON are written to `.cache/flight-warnings/` and are not committed.


Review regressions: engine warnings inspect only installed engines using
`propulsion.numEngines`; the single-engine compatibility `engine2.failed` flag
is excluded. Departure loss monitoring also ends below 1500ft after reaching
300ft and either five seconds of level flight (within ±100fpm) or a configured
descent. This retains initial climb-loss warnings while allowing low circuits
to enter approach and rearming gear/flap cautions. These phase thresholds are
simulator tuning values. Regression tests use real EngineModel output for all
three aircraft and continuous low-circuit / approach / reset sequences.

Warning arbitration uses the authoritative `isStallWarning` sensor, with the
legacy flags only as a fallback; retained physical separation does not hold a
recovered stall alert or suppress other alerts.
