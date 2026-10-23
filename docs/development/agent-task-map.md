# Task map

Use this table to start a bounded investigation; ARCHITECTURE.md gives broader
context, while the current implementation defines actual behavior.

| Task | Implementation to read first | Verification |
| --- | --- | --- |
| Integration, reset, simulation timing | src/main.js; src/config/simConfig.js | npm test; relevant browser scenario |
| Aircraft parameters | src/config/aircraftConfigs.js | physics tests; flight scenario |
| Lift, drag, atmosphere, engines | src/physics/Aerodynamics.js; Atmosphere.js; EngineModel.js | tests/aerodynamics.test.js; atmosphere.test.js; engine.test.js |
| Gear, collision, touchdown | src/physics/LandingGear.js; CollisionDetector.js | tests/landingGear.test.js; collision.test.js; gearCamAndTouchdown.test.js; npm run test:crash |
| Keyboard, gamepad, touch input | src/controls/FlightControls.js; TouchFlightControls.js; index.html; style.css | tests/flightControls.test.js; npm run test:mobile |
| HUD, responsive panels, localization | index.html; style.css; src/ui/FlightPanels.js; src/i18n/ | tests/controlPanelState.test.js; scripts/verify-responsive-ui.mjs; browser screenshots |
| Cameras and framing | src/cameras/CameraSystem.js | tests/gearCamAndTouchdown.test.js; browser screenshots |
| Autonomous flight and stage transitions | src/director/DemoFlightDirector.js; src/director/PilotControlLaws.js; src/director/scenarios/ | tests/demoFlightDirector.test.js; tests/demoTouchdown.test.js; npm run test:demo; npm run test:flight |
| Aircraft geometry and cockpit displays | src/aircraft/ | npm run build; cockpit browser screenshots |
| Cockpit sunlight, window-frame shadows, cloud dimming | src/environment/CockpitSunShadow.js; src/aircraft/CockpitAperture.js; [cockpit sunlight](cockpit-sunlight.md) | tests/cockpitSunShadow.test.js; node scripts/verify-cockpit-shadows.mjs |
| Terrain, airport, ocean, sky, vegetation | src/environment/; [Lukla data provenance](lukla-terrain.md); [airport exterior assets](airport-buildings.md); [pavement](pavement.md); [vegetation](foliage.md) | npm run build; relevant scene screenshots; node scripts/verify-foliage.mjs |
| Ship exteriors, buoyancy and wakes | src/environment/Ships.js; ShipAssets.js; [ship assets](ships.md) | tests/ships.test.js; tests/collision.test.js; node scripts/verify-ships.mjs |
| City buildings and foliage | src/environment/FoliageAndCities.js; CityBuildingAssets.js; [city evidence](city-buildings.md) | tests/cityBuildings.test.js; tests/collision.test.js; browser city review |
| Sound | src/audio/FlightAudio.js | browser interaction and listening |
| Crash and tire effects | src/effects/ | npm run test:crash; screenshots |
| Events and diagnostics | src/core/EventBus.js; src/ui/DiagnosticsInspector.js | relevant Node tests and browser inspection |
| CI and agent guidance | package.json; .github/workflows/ci.yml; scripts/check-*.mjs; AGENTS.md | npm run check; npm test; npm run build |

Paths separated by semicolons within one directory refer to that same directory.
Browser scenario prerequisites and limitations are in [ci.md](ci.md).
