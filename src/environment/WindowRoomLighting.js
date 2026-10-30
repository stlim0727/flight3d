import * as THREE from 'three';

/** Fixed occupied-room palette: stable across reloads, with a few unlit rooms. */
export function createRoomLightTexture() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  const palette = [0xffc985, 0xffdfb0, 0xfff3de, 0xdceaff].map(hex => new THREE.Color(hex));
  let seed = 73013;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) {
    const color = palette[Math.floor(random() * palette.length)];
    const brightness = random() < .12 ? .035 : .35 + random() * .4;
    pixels.set([color.r, color.g, color.b].map(c => Math.round(c * brightness * 255)).concat(255), i * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Modulate existing window emission/masks, keeping roofs and wall frames unlit. */
export function shadeWindowRooms(material, texture, level) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, { roomLights: { value: texture }, roomLightLevel: level });
    shader.vertexShader = 'varying vec3 roomPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec4 roomVertex = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        roomVertex = instanceMatrix * roomVertex;
      #endif
      roomPosition = (modelMatrix * roomVertex).xyz;
    `);
    shader.fragmentShader = `uniform sampler2D roomLights;
      uniform float roomLightLevel;
      varying vec3 roomPosition;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      vec3 room = floor(roomPosition / vec3(3.5, 3.6, 3.5));
      vec2 roomUV = (vec2(room.x + room.z * 7., room.y + room.z * 13.) + .5) / 32.;
      vec3 roomGlow = texture2D(roomLights, roomUV).rgb * 2.;
      // Soft ceiling-to-floor falloff suggests room depth behind existing panes.
      roomGlow *= .85 + .15 * fract(roomPosition.y / 3.6);
      totalEmissiveRadiance *= mix(vec3(1.), roomGlow, roomLightLevel);
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}-occupied-rooms-v1`;
  material.needsUpdate = true;
}
