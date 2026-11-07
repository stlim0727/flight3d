import { Boeing737 } from '../aircraft/Boeing737.js';
import { Cessna172 } from '../aircraft/Cessna172.js';
import { F16 } from '../aircraft/F16.js';

/** The same visual classes as the local aircraft, without a second instrument panel. */
export function createRemoteAircraftModel(aircraft) {
  const options = { exteriorOnly: true };
  if (aircraft === 'B738') return new Boeing737(null, null, null, null, null, null, options);
  if (aircraft === 'C172') return new Cessna172(null, null, options);
  if (aircraft === 'F16') return new F16(options);
  throw new Error(`Unsupported remote aircraft: ${aircraft}`);
}

/** Remote instances own their resources; never dispose the local aircraft's assets. */
export function disposeRemoteModel(root, disposedResources = new Set()) {
  const release = resource => {
    if (!resource?.dispose || disposedResources.has(resource)) return;
    disposedResources.add(resource); resource.dispose();
  };
  root.traverse(node => {
    release(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) release(value);
      for (const uniform of Object.values(material.uniforms ?? {})) if (uniform.value?.isTexture) release(uniform.value);
      release(material);
    }
    release(node.shadow);
  });
  return disposedResources;
}
