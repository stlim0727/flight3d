import * as THREE from 'three';

/**
 * The render loop and collision detector expect one airport object with an
 * update() method. In the unified world that object has to delegate to every
 * mounted region, translating world-frame positions into each region's own
 * frame before calling it.
 */
export function createWorldAirportFacade(world, spawnAirport) {
  const localPosition = new THREE.Vector3();
  const localCamera = new THREE.Vector3();
  const localOptions = {};
  const facade = {
    isOnRunway: (x, z) => world.isOnRunway(x, z),
    isRunwaySafetyArea: (x, z) => world.isRunwaySafetyArea(x, z),
    nightLighting: { update: sunY => world.nightLightingUpdate(sunY) },
    update(dt, position, time, options = {}) {
      for (const [regionId, region] of world.regions) {
        if (!region.airport?.update) continue;
        const [ox, oz] = world.offsets.get(regionId);
        localPosition.set(position.x - ox, position.y, position.z - oz);
        localOptions.cameraPosition = options.cameraPosition
          ? localCamera.set(options.cameraPosition.x - ox, options.cameraPosition.y, options.cameraPosition.z - oz)
          : localPosition;
        localOptions.quality = options.quality;
        localOptions.paused = options.paused;
        localOptions.headingDeg = options.headingDeg;
        localOptions.trackDeg = options.trackDeg;
        localOptions.hasOpenWorld = Boolean(world.openWorld);
        region.airport.update(dt, localPosition, time, localOptions);
      }
    },
    getGazeTargets() {
      const targets = [];
      for (const region of world.regions.values()) {
        targets.push(...(region.airport?.getGazeTargets?.() ?? []));
      }
      return targets;
    },
    hasModeledBuilding(x, z) {
      for (const [regionId, region] of world.regions) {
        if (!region.airport?.hasModeledBuilding) continue;
        const [ox, oz] = world.offsets.get(regionId);
        if (region.airport.hasModeledBuilding(x - ox, z - oz)) return true;
      }
      return false;
    },
    updateRenderLights(cameraY, limit) {
      for (const region of world.regions.values()) {
        region.airport?.updateRenderLights?.(cameraY, limit);
      }
    },
  };
  for (const key of ['controlTowerData', 'terminalData', 'hangarsData', 'retainingWallData']) {
    if (spawnAirport?.[key]) facade[key] = spawnAirport[key];
  }
  facade.airportRegions = [...world.regions].map(([id, region]) => ({
    airport: region.airport,
    offset: world.offsets.get(id),
  })).filter(entry => entry.airport);
  if (spawnAirport?.parked) facade.parked = spawnAirport.parked;
  return facade;
}
