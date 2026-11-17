import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorAudioCoordinator } from '../src/core/SimulatorAudioCoordinator.js';
import { SimulatorInputCoordinator } from '../src/core/SimulatorInputCoordinator.js';
import { FLOW } from '../src/ui/GameFlowController.js';

describe('SimulatorAudioCoordinator', () => {
  it('delegates update to audio with distance and cockpit mode', () => {
    let updateArgs = null;
    const mockAudio = {
      update(...args) {
        updateArgs = args;
      },
    };
    const coordinator = new SimulatorAudioCoordinator(mockAudio);
    coordinator.update(0.016, { iasKnots: 150 }, true, 25);
    assert.deepEqual(updateArgs, [0.016, { iasKnots: 150 }, true, 25]);
  });

  it('syncs mute and radio pause on background and game pause', () => {
    const pausedStates = [];
    const radioPausedStates = [];
    const mockAudio = {
      setPaused(p) { pausedStates.push(p); },
      setRadioPaused(p) { radioPausedStates.push(p); },
    };
    const coordinator = new SimulatorAudioCoordinator(mockAudio);

    coordinator.syncAudioPause({ browserBackgrounded: false, flowState: FLOW.FLIGHT });
    assert.equal(pausedStates.at(-1), false);
    assert.equal(radioPausedStates.at(-1), false);

    coordinator.syncAudioPause({ browserBackgrounded: true, flowState: FLOW.FLIGHT });
    assert.equal(pausedStates.at(-1), true);
    assert.equal(radioPausedStates.at(-1), true);

    coordinator.syncAudioPause({ browserBackgrounded: false, flowState: FLOW.PAUSED });
    assert.equal(pausedStates.at(-1), true);
    assert.equal(radioPausedStates.at(-1), true);

    coordinator.syncAudioPause({ browserBackgrounded: false, flowState: FLOW.LOBBY });
    assert.equal(pausedStates.at(-1), false);
    assert.equal(radioPausedStates.at(-1), true);
  });

  it('syncs gun fire audio', () => {
    let gunState = null;
    const mockAudio = {
      startGunFire() { gunState = 'started'; },
      stopGunFire() { gunState = 'stopped'; },
    };
    const coordinator = new SimulatorAudioCoordinator(mockAudio);
    coordinator.syncGunAudio(true);
    assert.equal(gunState, 'started');
    coordinator.syncGunAudio(false);
    assert.equal(gunState, 'stopped');
  });
});

describe('SimulatorInputCoordinator', () => {
  it('releases all controls', () => {
    let releasedKeys = false;
    let touchStick = null;
    let touchRudder = null;
    let touchBrakes = null;
    const mockControls = {
      releaseAllKeys() { releasedKeys = true; },
      setTouchStick(x, y) { touchStick = [x, y]; },
      setTouchRudder(r) { touchRudder = r; },
      setTouchBrakes(b) { touchBrakes = b; },
    };
    const coordinator = new SimulatorInputCoordinator();
    coordinator.releaseAllControls(mockControls);
    assert.equal(releasedKeys, true);
    assert.deepEqual(touchStick, [0, 0]);
    assert.equal(touchRudder, 0);
    assert.equal(touchBrakes, 0);
  });

  it('updates input blocked state based on simulation subsystems', () => {
    let released = false;
    const sim = {
      controls: {
        inputBlocked: false,
        releaseAllKeys() { released = true; },
        setTouchStick() {},
        setTouchRudder() {},
        setTouchBrakes() {},
      },
      multiplayer: { modalOpen: false, room: { session: { state: 'idle' } } },
      gameFlow: { blocksFlightInput: () => false },
      shadowDemo: { active: false },
      devRunner: { blocksInput: false },
      pilotArena: { active: false },
      demoDirector: { isRestartConfirmOpen: false },
    };
    const coordinator = new SimulatorInputCoordinator(sim);
    coordinator.updateInputBlocked(sim);
    assert.equal(sim.controls.inputBlocked, false);

    sim.gameFlow.blocksFlightInput = () => true;
    coordinator.updateInputBlocked(sim);
    assert.equal(sim.controls.inputBlocked, true);
    assert.equal(released, true);
  });
});
