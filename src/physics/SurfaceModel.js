// World metres, +Y up. A height sampler returns null where its surface is absent.
// Heightfields represent solid ground below their top; water is a flat surface.
// Buildings/bridges remain volumetric colliders, so their roofs do not hide water
// below a bridge. No region/scenario IDs or render visibility enter this module.
export function createSurfaceModel(groundHeightAt, layers = []) {
  return [{ type: 'TERRAIN', heightAt: groundHeightAt }, ...layers];
}

export function surfaceAt(layers, x, z) {
  let selected = null;
  for (const layer of layers) {
    const height = layer.heightAt ? layer.heightAt(x, z) : layer.height;
    if (height === null || !Number.isFinite(height)) continue;
    // Solid ground wins a tie: a zero-metre road is still dry ground.
    if (!selected || height > selected.height ||
        (height === selected.height && selected.type === 'WATER' && layer.type !== 'WATER')) {
      selected = { type: layer.type, height, label: layer.label };
    }
  }
  return selected;
}

export function surfaceContact(layers, point, tolerance = 0) {
  const surface = surfaceAt(layers, point.x, point.z);
  return surface && point.y <= surface.height + tolerance ? surface : null;
}

export function waterContact(layers, point, tolerance = 0.5) {
  // Cheap broad phase before expensive coastline/triangle height queries.
  if (!layers.some(layer => layer.type === 'WATER' && point.y <= layer.height + tolerance)) return null;
  const contact = surfaceContact(layers, point, tolerance);
  return contact?.type === 'WATER' ? contact : null;
}
