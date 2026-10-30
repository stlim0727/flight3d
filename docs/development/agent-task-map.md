# Task map

Use this table to start a bounded investigation; ARCHITECTURE.md gives broader
context, while the current implementation defines actual behavior.

| Task | Implementation to read first | Verification |
| --- | --- | --- |
| Integration, reset, simulation timing | src/main.js; src/core/PhysicsIntegrator.js; src/core/PresetSpawner.js; src/core/physicsTiming.js; src/config/simConfig.js; [physics core](physics-core.md) | npm test; relevant browser scenario |
| Aircraft parameters | src/config/aircraftConfigs.js | physics tests; flight scenario |
| Loading, fuel CG, inertia and trim | src/physics/MassProperties.js; TrimSolver.js; src/ui/LoadingPanel.js; [mass/CG model](mass-cg.md) | tests/massProperties.test.js; trimSolver.test.js; scripts/verify-mass-cg.html |
| Lift, drag, atmosphere, engines | src/physics/Aerodynamics.js; Atmosphere.js; EngineModel.js | tests/aerodynamics.test.js; atmosphere.test.js; engine.test.js |
| Gear, collision, touchdown | src/physics/LandingGear.js; CollisionDetector.js | tests/landingGear.test.js; collision.test.js; gearCamAndTouchdown.test.js; npm run test:crash |
| Keyboard, HOTAS/gamepad, touch input | src/controls/FlightControls.js; HotasController.js; TouchFlightControls.js; index.html; src/styles/touch-controls.css | tests/flightControls.test.js; tests/hotasController.test.js; npm run test:mobile |
| HUD, responsive panels, localization | index.html; src/styles/; src/ui/SimulatorHudAndBindings.js; src/ui/FlightPanels.js; src/i18n/locales/ | tests/controlPanelState.test.js; tests/i18n.test.js; scripts/verify-flight-layout.mjs; browser screenshots |
| Cameras and framing | src/cameras/CameraSystem.js; src/ui/HudView.js; [HUD camera](hud-camera.md) | tests/gearCamAndTouchdown.test.js; tests/hudProjection.test.js; scripts/verify-hud-camera.mjs; browser screenshots |
| Autonomous flight and stage transitions | src/director/DemoFlightDirector.js; src/director/PilotControlLaws.js; src/director/scenarios/ | tests/demoFlightDirector.test.js; tests/demoTouchdown.test.js; npm run test:demo; npm run test:flight |
| Han River manual bridge challenge | src/config/hangangCourse.js; src/director/HangangRun.js; HangangScenario.js; src/environment/HangangScene.js; [course contract](hangang.md) | tests/hangang.test.js; scripts/verify-hangang.mjs |
| Demo flight quality gate (fast-play sweep) | scripts/demo-sweep.mjs; scripts/lib/demoSweepSpec.mjs; scripts/lib/abnormalityChecks.mjs; scripts/demo-sweep-summary.mjs; .github/workflows/demo-sweep.yml; [ci.md](ci.md#autonomous-demo-acceptance) | tests/demoSweepChecks.test.js; tests/coastalDemoScenario.test.js; npm run test:demo-sweep; npm run test:demo-sweep:full |
| Aircraft geometry and cockpit displays | src/aircraft/ | npm run build; cockpit browser screenshots |
| Cockpit sunlight, window-frame shadows, cloud dimming | src/environment/CockpitSunShadow.js; src/aircraft/CockpitAperture.js; [cockpit sunlight](cockpit-sunlight.md) | tests/cockpitSunShadow.test.js; node scripts/verify-cockpit-shadows.mjs |
| Cockpit diffuse sky, bounce, flood control | src/aircraft/CockpitLightTransfer.js; CockpitTransferModel.js; [offline transfer](cockpit-light-transfer.md) | tests/cockpitTransfer.test.js; npm run bake:cockpit; scripts/verify-cockpit-transfer.html |
| Airport runway, building and instrument night lighting | src/environment/AirportNightLighting.js; src/aircraft/InstrumentLighting.js; [night lighting](night-lighting.md) | tests/airportNightLighting.test.js; airport/aircraft tests; hardware browser night/day screenshots |
| Terrain, airport, ocean, sky, vegetation | src/environment/; [Lukla data provenance](lukla-terrain.md); [airport exterior assets](airport-buildings.md); [pavement](pavement.md); [vegetation](foliage.md) | npm run build; relevant scene screenshots; node scripts/verify-foliage.mjs |
| Ship exteriors, buoyancy and wakes | src/environment/Ships.js; ShipAssets.js; [ship assets](ships.md) | tests/ships.test.js; tests/collision.test.js; node scripts/verify-ships.mjs |
| City buildings and foliage | src/environment/FoliageAndCities.js; CityBuildingAssets.js; [city evidence](city-buildings.md) | tests/cityBuildings.test.js; tests/collision.test.js; browser city review |
| Incheon / Yeongjong staged scenery | src/geospatial/incheon.js; IncheonTerrain.js; incheonDressing.js; src/previews/incheon.js; incheonCityAssets.js; scripts/scenery/; scripts/terrain/build-incheon.py; [scope](incheon-scenery.md); [terrain](incheon-terrain.md); [city rendering](incheon-city.md); [flight integration](incheon-flight.md); [traffic and performance](incheon-traffic.md); [Sihwa regional extension](incheon-sihwa.md); [all-aircraft Sihwa demo](sihwa-demo.md) | tests/incheonData.test.js; tests/incheonTerrain.test.js; tests/incheonDressing.test.js; tests/incheonFlight.test.js; tests/incheonTraffic.test.js; scripts/verify-incheon.mjs, verify-incheon-flight.mjs and verify-incheon-traffic.mjs through project Chrome session |
| Sound | src/audio/FlightAudio.js; src/audio/pistonSoundState.js | tests/flightAudio.test.js; scripts/verify-aircraft-audio.mjs; browser interaction and listening |
| Crash and tire effects | src/effects/; [impact effects](impact-effects.md) | npm run test:crash; screenshots |
| Events and diagnostics | src/core/EventBus.js; src/ui/DiagnosticsInspector.js | relevant Node tests and browser inspection |
| Developer mode, scenarios, build identity, render comparisons | src/dev/; src/ui/DeveloperPanel.js; RenderDiagnosticsPanel.js; [developer mode](developer-mode.md); [render comparisons](render-diagnostics.md) | tests/developerMode.test.js; renderDiagnostics.test.js; scripts/verify-developer-mode.mjs and verify-render-diagnostics.mjs |
| CI and agent guidance | [browser GPU policy](browser-gpu.md); scripts/verify-browser-gpu.mjs; package.json; .github/workflows/ci.yml; scripts/check-*.mjs; scripts/agent-workflow.mjs; scripts/lib/browserHarness.mjs; scripts/lib/compactReporter.mjs; AGENTS.md | npm run check; npm test; npm run build |
| PR self-feedback | .agents/skills/flight3d-pr-feedback/SKILL.md; .github/workflows/pr-feedback.yml; scripts/pr-feedback.mjs; [setup and usage](pr-feedback.md) | tests/prFeedback.test.js; npm run check; npm test; npm run build; configured PR smoke test |

Paths separated by semicolons within one directory refer to that same directory.
Browser scenario prerequisites and limitations are in [ci.md](ci.md).
