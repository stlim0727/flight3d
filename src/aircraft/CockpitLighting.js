/** Keep the closed exterior skin out of the deck sun, but in the exterior sun. */
export function excludeFromDeckShadow(mesh) {
  const before = mesh.onBeforeShadow;
  const after = mesh.onAfterShadow;
  let savedRange;
  mesh.onBeforeShadow = function (...args) {
    before.apply(this, args);
    const [, , , shadowCamera, geometry] = args;
    if (shadowCamera.userData.cockpitSun) {
      savedRange = { ...geometry.drawRange };
      geometry.setDrawRange(0, 0);
    }
  };
  mesh.onAfterShadow = function (...args) {
    const geometry = args[4];
    if (savedRange) {
      geometry.setDrawRange(savedRange.start, savedRange.count);
      savedRange = undefined;
    }
    after.apply(this, args);
  };
}

/** Baked diffuse irradiance in the deck frame; emissive displays stay independent. */
export function shadeCockpitMaterial(material, transfer = null) {
  if (!material.isMeshStandardMaterial || material.userData.cockpitLighting === (transfer ?? 'fallback')) return;
  material.userData.cockpitLighting = transfer ?? 'fallback';
  material.envMapIntensity = 1;
  material.onBeforeCompile = shader => {
    if (transfer) {
      Object.assign(shader.uniforms, transfer.uniforms);
      shader.vertexShader = `attribute vec4 deckTransferUV;
        uniform sampler2D deckTransfer;
        varying vec4 deckFrontIrradiance;
        varying vec4 deckBackIrradiance;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        deckFrontIrradiance = texture2D(deckTransfer, deckTransferUV.xy);
        deckBackIrradiance = texture2D(deckTransfer, deckTransferUV.zw);`);
      shader.fragmentShader = `varying vec4 deckFrontIrradiance;
        varying vec4 deckBackIrradiance;\n` + shader.fragmentShader;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `irradiance = ${transfer
    ? 'PI * (gl_FrontFacing ? deckFrontIrradiance.rgb : deckBackIrradiance.rgb)'
    : 'vec3(0.0)'};
      iblIrradiance = vec3(0.0);
      #include <lights_fragment_end>
      reflectedLight.indirectSpecular *= ${transfer
    ? '(gl_FrontFacing ? deckFrontIrradiance.a : deckBackIrradiance.a)'
    : '0.0'};`
    );
  };
  material.customProgramCacheKey = () => transfer ? 'cockpit-baked-transfer-v1' : 'cockpit-transfer-fallback-v1';
  material.needsUpdate = true;
}

/** A cheap signature of the animated casters, independent of aircraft world pose. */
export function cockpitCasterState(cockpit) {
  return [cockpit.yokesVisible, ...(cockpit.gltfYokes ?? []).flatMap(yoke => [
    yoke.rotation.z, yoke.position.z,
  ]), ...(cockpit.gltfEngineControls?.throttles ?? []).map(pivot => pivot.rotation.x),
  ...(cockpit.gltfEngineControls?.pedals ?? []).map(pivot => pivot.position.z),
  cockpit.gltfAirframeControls?.gear.position.y,
  cockpit.gltfAirframeControls?.flaps.rotation.x,
  cockpit.gltfAirframeControls?.spoilers.rotation.x,
  ...(cockpit.gltfAirframeControls?.trimWheels ?? []).map(pivot => pivot.rotation.x),
  cockpit.gltfCockpitLoaded].join(',');
}
