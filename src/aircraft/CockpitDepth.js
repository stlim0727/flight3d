// Shadow lookup and SSAO reconstruct ordinary projection depth. The beauty
// camera still needs logarithmic depth for the 45 km exterior view.
const materials = new WeakSet();
const meshes = new WeakSet();

export function useProjectionDepth(material) {
  if (materials.has(material)) return;
  materials.add(material);
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
  };
  material.customProgramCacheKey = () => `${cacheKey}:projection-depth-v1`;
  material.needsUpdate = true;
}

/** Also covers asynchronously loaded and rebuilt aircraft meshes. */
export function prepareCockpitShadowDepth(root) {
  root.traverse(mesh => {
    if (!mesh.isMesh || meshes.has(mesh)) return;
    meshes.add(mesh);
    const before = mesh.onBeforeShadow;
    mesh.onBeforeShadow = function (...args) {
      before.apply(this, args);
      // Patch the actual renderer-selected depth variant, preserving alpha,
      // clipping, displacement and existing custom depth materials. Point-light
      // distance materials already encode their own radial depth.
      const depth = args[5];
      if (depth.isMeshDepthMaterial) useProjectionDepth(depth);
    };
  });
}
