// Map scenery vertices share the terrain coordinate frame across tile meshes.
export function addGroundSurfaceColor(shader, colorSource) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `
    #include <common>
    varying vec2 vGroundXZ;
  `).replace('#include <begin_vertex>', `
    #include <begin_vertex>
    vGroundXZ = position.xz;
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
    #include <common>
    varying vec2 vGroundXZ;

    float groundHash(vec2 cell) {
      vec3 p = fract(cell.xyx * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float groundNoise(vec2 p) {
      #if (defined(QUALITY_FAST) && QUALITY_FAST == 1) || (defined(QUALITY_ULTRALOW) && QUALITY_ULTRALOW == 1) || (defined(QUALITY_PERFORMANCE) && QUALITY_PERFORMANCE == 1)
        return 0.0;
      #else
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float value = mix(
          mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), f.x),
          mix(groundHash(cell + vec2(0.0, 1.0)), groundHash(cell + 1.0), f.x),
          f.y
        );
        return (value - 0.5) * (1.0 - smoothstep(0.25, 1.0, length(fwidth(p))));
      #endif
    }
  `).replace('#include <color_fragment>', `
    #include <color_fragment>
    ${colorSource}
  `);
}
