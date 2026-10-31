import { SIM_CONFIG } from '../config/simConfig.js';

export function clampFrameDelta(delta) {
  return Number.isFinite(delta) ? Math.max(0, Math.min(SIM_CONFIG.physics.maxFrameDelta, delta)) : 0;
}

export function stepPhysics(simulation) {
  if (simulation.gameFlow?.state === 'debrief') return;
  if (simulation.devRunner?.blocksPhysics) return;
  if (simulation.demoDirector?.isActive) {
    simulation.demoDirector.update(simulation.physicsDt);
  }
  // A scene swap can leave the previous airport's low-altitude pose in place
  // while Lukla's DEM loads. Keep polling the director, but never integrate or
  // collide that stale pose against the new terrain before its spawn is ready.
  if (simulation.currentTerrain?.isLoaded === false || simulation.demoDirector?.waitingForTerrain) return;
  simulation.renderPose.reset(simulation.position, simulation.quaternion);
  simulation.devRunner?.beforePhysics();
  const wasCrashed = simulation.isCrashed;
  simulation.integratePhysics(simulation.physicsDt);
  simulation.updateFlightRecording?.(simulation.physicsDt);
  // A collision at the end of this tick creates debris; only subsequent ticks
  // advance it. Both deterministic stepping and rendered frames share this clock.
  if (wasCrashed && simulation.isCrashed) {
    simulation.aircraftBreakup?.update(simulation.physicsDt, simulation.currentTerrain,
      simulation.water?.mesh.visible ? simulation.water.waterLevel : null);
  }
  simulation.devRunner?.afterPhysics(simulation.physicsDt);
}

export function advancePhysicsFrame(simulation, delta) {
  simulation.physicsAccumulator += clampFrameDelta(delta);
  while (simulation.physicsAccumulator >= simulation.physicsDt) {
    stepPhysics(simulation);
    simulation.physicsAccumulator -= simulation.physicsDt;
    if (simulation.devRunner?.blocksPhysics || simulation.gameFlow?.state === 'debrief') { simulation.physicsAccumulator = 0; break; }
  }
}
