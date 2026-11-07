import { createSimulatorScenarioStart } from '../../src/core/simulatorScenarioStart.js';
import { createSimulatorFlightStart } from '../../src/core/simulatorFlightStart.js';
import { readFileSync } from 'node:fs';
import { saveSimulatorPreferences } from '../../src/config/simulatorPreferences.js';
import { isScenarioAvailable } from '../../src/config/scenarioRegistry.js';
import { FLOW } from '../../src/ui/GameFlowController.js';

// Load the production coordinator class without booting its browser/Three scene.
const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('class FlightSimulator {');
const end = source.indexOf('\ninstallPresetSpawner(FlightSimulator);');
if (start < 0 || end < start) throw new Error('Simulator class boundaries not found');
export const SimulatorClass = new Function('createSimulatorScenarioStart', 'createSimulatorFlightStart', 'startupStage', 'FLOW', 'saveSimulatorPreferences', 'isScenarioAvailable', `return (${source.slice(start, end)});`)(createSimulatorScenarioStart, createSimulatorFlightStart, () => {}, FLOW, saveSimulatorPreferences, isScenarioAvailable);
