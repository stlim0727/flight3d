/** Load a bundled Float32 terrain-grid set described by terrain-metadata.json. */
export async function loadBundledTerrainGrid(baseUrl, TerrainClass) {
  const json = async file => {
    const response = await fetch(`${baseUrl}${file}`);
    if (!response.ok) throw new Error(`Terrain asset ${file}: HTTP ${response.status}`);
    return response.json();
  };
  const [metadata, coastline] = await Promise.all([json('terrain-metadata.json'), json('coastline.json')]);
  const entries = await Promise.all(Object.entries(metadata.grids).map(async ([name, descriptor]) => {
    const response = await fetch(`${baseUrl}${descriptor.file}`);
    if (!response.ok) throw new Error(`Terrain grid ${name}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== descriptor.gridSize ** 2 * 4) throw new Error(`Terrain grid size mismatch: ${name}`);
    const view = new DataView(buffer);
    const values = new Float32Array(descriptor.gridSize ** 2);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
    return [name, values];
  }));
  return new TerrainClass(metadata, Object.fromEntries(entries), coastline);
}
