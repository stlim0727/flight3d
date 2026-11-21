import * as THREE from 'three';

/**
 * The render loop and collision detector expect one airport object with an
 * update() method. In the unified world that object has to delegate to every
 * mounted region, translating world-frame positions into each region's own
 * frame before calling it.
 */
export function createWorldAirportFacade(world, spawnAirport) {
  const localPosition = new THREE.Vector3();
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
        localOptions.cameraPosition = localPosition;
        localOptions.quality = options.quality;
        localOptions.paused = options.paused;
        localOptions.headingDeg = options.headingDeg;
        localOptions.trackDeg = options.trackDeg;
        region.airport.update(dt, localPosition, time, localOptions);
      }
    },
  };
  for (const key of ['controlTowerData', 'terminalData', 'hangarsData', 'retainingWallData']) {
    if (spawnAirport?.[key]) facade[key] = spawnAirport[key];
  }
  if (spawnAirport?.checkBuildingCollision) {
    facade.checkBuildingCollision = probes => spawnAirport.checkBuildingCollision(probes);
  }
  return facade;
}
