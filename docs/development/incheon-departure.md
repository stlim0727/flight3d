# Incheon gate departure demo

Select **Incheon → Boeing 737-800 → Auto demo → Incheon gate → pushback → takeoff**
in the lobby, then watch the demo.
The departure profile is offered only for B738. C172 keeps its original Incheon tour.

The departure flies eight stages: gate preparation, tug pushback, disconnect,
taxi, hold short / tower contact, line up and wait, takeoff clearance, and takeoff
with an airborne manual handoff. Bundled English radio speech includes distinct pilot, ground-crew and controller voices with matching captions. Stage names, speaker labels and the briefing support Korean and English. Exchanges are scripted; microphone recognition is not included. Waiting stages finish only after the current call ends. The master mute/volume controls apply to radio playback, the menu pauses and resumes at the same speech position, and cancellation/reset stops it without stale replay.

G1 is an authored gate placement within source Apron 1, not a surveyed stand ID.
Its L-shaped bridge has a fixed elevated access corridor, a right-angle rotunda,
and a telescopic apron arm docking at the 737 forward port door. Only the apron
arm retracts before pushback. The layout reproduces this gate architecture, not
surveyed dimensions of a particular Incheon stand. The fixed access axis meets
the frozen terminal footprint (`relation/3917466`) at aircraft-local Z=-48.227 m;
the corridor starts 12 cm inside that mapped wall rather than stopping on apron.

The 737 exterior uses a classic Korean Air blue-top livery, KOREAN AIR titles
on both sides and red/blue tail emblems. It retains the existing GLB, windows,
landing gear and articulated surfaces. This is an authored interpretation of
the classic scheme, not a particular registered airframe or the newer fleet-wide
rebranding. The operator is listed on the [official 737 fleet page](https://www.koreanair.com/contents/plan-your-travel/in-flight-experience/fleet/b737?hl=ko).
Captions and Gemini clips use **Korean Air 123**: the operator's
[FAA telephony designator](https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_1.html)
with a fictional scenario flight number, not a published scheduled flight.
Apron 1 and Apron 2 boundaries come from complete OpenStreetMap multipolygon
relations 3917465 and 3156115. The original bounding-box snapshot omitted member
ways and the airfield builder ignored relations. Supplementary frozen full-relation
snapshots restore those members, with checksums and versions recorded in
`public/scenery/incheon/apron-source-metadata.json`. Overlapping elements retain
the same versions and coordinates as the original snapshot. Supplementary element
timestamps must not be newer than the original snapshot cutoff. Open/incomplete
rings are rejected and inner holes are preserved instead of filled.

No authored apron rectangle, widened taxi corridor or runway-entry connector is
added to rendering, ground contact or grading. Taxi vertices retain the mapped
centreline coordinates. Departure uses runway 33L because its existing mapped
connector provides a continuous path from the apron. The tug follows a reverse
arc inside the source apron and hands over aligned with the taxi exit.

These are OSM geometry boundaries, not surveyed accuracy or live operational
clearances. Existing default widths remain where the original taxiway has no
width tag; those defaults are not widened for this demo. Airport elevation remains
the existing modeled 7 m. The landing-traffic call is scripted.

There is one initial gate reset through the normal preset lifecycle. A visible
low-profile 6 m conventional tractor animates its wheels, steering and beacon.
The fixed 5.1 m towbar meets the nose gear at local Z = -12.5 m; its length is
based on the [manufacturer's B737 towbar specification](https://jms.aero/files/2193/upload/Downloads/J-TOW.pdf).
The tractor follows a horizontal tow constraint independently of aircraft yaw,
pitch and roll. Once the pin is released, it accelerates ahead, steers through
an 8 m radius and brakes to a park, retaining the bar on its transport dolly.
Taxi waits for the vehicle to stop clear. The tractor stays visible until
scenario cleanup. Geometry is authored Three.js meshes, rather than a third-party
GLB; the fix is in dimensions, clearance and kinematics. It supplies bounded horizontal towing forces and a heading-restoring moment
through the normal integrator. After disconnect, all motion uses engine thrust,
nosewheel steering, wheel brakes and flight controls. Hold-short and lineup
completion require a physical stop. Lineup alone does not release takeoff thrust.
The 737 uses flaps 15, rotates from 140 knots and follows a 170-knot initial-climb target. Completion requires real liftoff and 80 m above airport elevation; the handoff
retains climb thrust. Esc, preset changes, airport changes and restart remove the
tug and release automation. P restarts the selected departure profile.

## Verification

```sh
node --test tests/incheonDeparture.test.js tests/incheonDemo.test.js tests/departureRadio.test.js tests/departureJetBridge.test.js tests/incheonAprons.test.js
npm run check
npm test
npm run build
```

For browser acceptance, start Vite on port 5283, then use the project browser:

```sh
npm run dev -- --host 127.0.0.1 --port 5283
chrome-session --project flight3d node scripts/verify-incheon-departure.mjs
chrome-session --project flight3d node scripts/verify-departure-audio.mjs
chrome-session --project flight3d node scripts/verify-departure-gate.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the URL and `.cache/incheon-departure`
artifact directory. The harness checks desktop/mobile menu selection and overflow,
flies the complete departure with deterministic physics, captures each stage,
checks every grounded wheel against the source pavement on every physics step,
checks gear integrity / absence of crashes and invalid positions, verifies the
climb-thrust handoff, and restarts/cancels to verify tug cleanup and input release.
It closes only its own tab. Review the PNGs and `results.json` alongside the exit
status. Node tests separately cover stage gating, bounded towing force, restart,
cancellation, and a stop/alignment/clearance sequence.

See [captured acceptance evidence](../../review-artifacts/incheon-departure/README.md).

The flight harness mutes audio so deterministic accelerated stepping does not wait
for wall-clock speech. The audio harness separately tests a native user click,
actual live voice samples, speech-end gating, pause/resume offset, mute/unmute,
cancellation, and offline rendering of all eight decoded clips. Set `SCREENSHOTS=0`
for a physics-only run if GPU screenshot capture is slow.

Voice assets are already bundled; no runtime TTS, OS voice installation or API key
is needed. Current clips use Gemini 3.1 Flash TTS Preview: Charon (pilot), Fenrir (crew)
and Kore (controllers). To regenerate, set `GEMINI_API_KEY` in the authoring
environment and run `node scripts/build-gemini-departure-radio.mjs` with FFmpeg
installed. See [Gemini authoring](gemini-radio.md). The manifest records the
transcript, speaker voice and duration. Attribution is in
`public/audio/departure/LICENSE.txt`. Generated speech is band-limited to
300–3200 Hz and compressed; it is synthetic dialogue, not a recording of live controllers.

The gate harness checks desktop/mobile selection, the 737 bridge docking and
clearance sequence, visible tractor movement after uncoupling, wheel animation
and cancellation cleanup, with screenshots under `.cache/departure-gate`.
