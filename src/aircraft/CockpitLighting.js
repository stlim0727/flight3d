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

/**
 * The enclosed deck receives much less sky fill than the outdoor scene. Retain
 * directional skylight on upward faces so curves read without flattening the
 * sunlight's shadows. This changes indirect light only, never emissive displays.
 */
export function shadeCockpitMaterial(material) {
  if (!material.isMeshStandardMaterial || material.userData.cockpitLighting) return;
  material.userData.cockpitLighting = true;
  material.envMapIntensity = 0.25;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      vec3 deckWorldNormal = inverseTransformDirection( normal, viewMatrix );
      float deckSkyFill = mix( 0.12, 0.32, smoothstep( -0.2, 0.85, deckWorldNormal.y ) );
      reflectedLight.indirectDiffuse *= deckSkyFill;
      reflectedLight.indirectSpecular *= 0.35;`
    );
  };
  material.customProgramCacheKey = () => 'cockpit-enclosed-skylight-v1';
  material.needsUpdate = true;
}

/** A cheap signature of the animated casters, independent of aircraft world pose. */
export function cockpitCasterState(cockpit) {
  return [cockpit.yokesVisible, ...(cockpit.gltfYokes ?? []).flatMap(yoke => [
    yoke.rotation.z, yoke.position.z,
  ]), ...(cockpit.gltfEngineControls?.throttles ?? []).map(pivot => pivot.rotation.x),
  ...(cockpit.gltfEngineControls?.pedals ?? []).map(pivot => pivot.position.z),
  cockpit.gltfCockpitLoaded].join(',');
}
