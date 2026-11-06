import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { applyLogDepthOffset } from '../environment/RunwayMarkings.js';

/**
 * Jeju Air orange-and-white livery for the Boeing 737-800 (current scheme).
 *
 * Reference features:
 * - White fuselage with a red-orange belly band that rises toward the nose and
 *   sweeps up the rear fuselage into the tail
 * - Orange fin with faceted triangle pattern, white horizontal stabilizers
 * - CFM56 nacelles: white upper cowl, red-orange lower cowl and inlet lip
 * - Orange blended winglets
 * - Large "JEJUair" fuselage wordmark above the window line
 * - Preserves original atlas details (doors, windows, pitot probes, fan blades)
 *
 * Shader colors are written to the linear `diffuseColor`, so every brand color
 * is converted from sRGB via THREE.Color rather than pasted in as raw sRGB.
 */
const linear = hex => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export function applyJejuAirLivery(model, root, container) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const orange = linear('#f26522');
  const belly = linear('#e4411b');
  const white = linear('#f6f6f4');
  model.traverse(mesh => {
    if (!mesh.isMesh || ['tur_01', 'turbs'].includes(mesh.name)) return;
    const material = mesh.material.clone();
    mesh.material = material;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    material.onBeforeCompile = shader => {
      shader.uniforms.liveryTransform = { value: transform };
      shader.vertexShader = 'uniform mat4 liveryTransform; varying vec3 vLiveryPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLiveryPosition = (liveryTransform * vec4(position, 1.0)).xyz;'
      );
      shader.fragmentShader = 'varying vec3 vLiveryPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>
        vec3 p = vLiveryPosition;
        bool oldGreen = diffuseColor.g > diffuseColor.r * 1.4 && diffuseColor.g > diffuseColor.b * 1.25;
        bool fuselage = abs(p.x) < 2.05 && p.z > -19.1 && p.z < 18.95;
        // Vertical fin only: stabilizers (|x| > 0.7) stay white.
        bool tail = abs(p.x) < 0.7 && p.y > 1.5 && p.z > 9.0;
        bool winglet = abs(p.x) > 16.8 && p.y > 0.0 && p.z > 4.4 && p.z < 7.1;
        bool detail = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.28 && !oldGreen;

        // Nacelle: axis along z at |x| = 5.06, y = -1.95. Keep dark intake and exhaust cores.
        vec2 engineAxis = vec2(abs(p.x) - 5.06, p.y + 1.95);
        float engineRadius = length(engineAxis);
        bool engine = engineRadius < 1.25 && p.z > -6.4 && p.z < -0.9 && abs(p.x) > 3.6;
        bool engineCore = (engineRadius < 0.88 && p.z < -4.9) || (engineRadius < 0.75 && p.z > -3.2);

        // Belly band edge: dips mid-body, climbs at the nose and sweeps up the aft fuselage.
        float noseRise = 1.0 - smoothstep(-19.0, -11.0, p.z);
        float tailRise = smoothstep(3.0, 17.0, p.z);
        float bellyTop = -0.95 + noseRise * 0.8 + tailRise * 1.5;

        vec3 jejuOrange = ${orange};
        vec3 jejuBelly = ${belly};
        vec3 jejuWhite = ${white};
        vec3 greyNeutral = vec3(0.70, 0.72, 0.74);

        if (tail || winglet) {
          diffuseColor.rgb = jejuOrange;
        } else if (engine) {
          if (!engineCore) {
            diffuseColor.rgb = p.z < -5.55 ? jejuBelly : (p.y < -2.15 ? jejuBelly : jejuWhite);
          }
        } else if (fuselage) {
          bool lower = p.y < bellyTop;
          if (lower) diffuseColor.rgb = jejuBelly;
          else if (!detail || oldGreen) diffuseColor.rgb = jejuWhite;
        } else if (oldGreen) {
          diffuseColor.rgb = greyNeutral;
        }
        `
      );
    };
    material.customProgramCacheKey = () => 'jeju-air-v2';
    material.needsUpdate = true;
  });

  const airframe = model.getObjectByName('B737');
  if (!airframe || typeof document === 'undefined') return;

  const decals = new THREE.Group();
  decals.name = 'JejuAirLivery';
  container.add(decals);

  const texture = (width, height, paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  };

  const title = texture(1536, 216, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#f26522');
    gradient.addColorStop(1, '#e9381f');
    ctx.fillStyle = gradient;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const measure = (font, text) => {
      ctx.font = font;
      return ctx.measureText?.(text)?.width || w * (text === 'JEJU' ? 0.58 : 0.34);
    };
    const jejuFont = 'italic 900 150px "Arial Black", Arial, sans-serif';
    const airFont = 'italic 700 150px Arial, sans-serif';
    const jejuWidth = measure(jejuFont, 'JEJU');
    const airWidth = measure(airFont, 'air');
    const gap = 14;
    const scale = Math.min(1, (w * 0.97) / (jejuWidth + gap + airWidth));
    ctx.save();
    ctx.translate((w - (jejuWidth + gap + airWidth) * scale) / 2, h / 2);
    ctx.scale(scale, 1);
    ctx.font = jejuFont;
    ctx.fillText('JEJU', 0, 0);
    ctx.font = airFont;
    ctx.fillText('air', jejuWidth + gap, 0);
    ctx.restore();
  });

  // Faceted triangle pattern of the current fin livery, drawn nose-left (u runs aft).
  const facets = texture(512, 600, (ctx, w, h) => {
    const triangle = (color, points) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.closePath();
      ctx.fill();
    };
    triangle('#fba03a', [[0.02, 0.62], [0.46, 0.34], [0.42, 0.9]]);
    triangle('#ffc247', [[0.42, 0.9], [0.46, 0.34], [0.78, 0.66]]);
    triangle('#d9480f', [[0.46, 0.34], [0.8, 0.18], [0.78, 0.66]]);
    triangle('#2fb3d4', [[0.14, 0.3], [0.38, 0.1], [0.42, 0.36]]);
    triangle('#1e8fc0', [[0.55, 0.78], [0.78, 0.66], [0.7, 0.96]]);
  });

  const project = (name, position, size, side, map, target = airframe) => {
    const point = root.localToWorld(new THREE.Vector3(...position));
    const orientation = new THREE.Euler(0, (side * Math.PI) / 2, 0);
    const rotation = new THREE.Quaternion()
      .setFromEuler(orientation)
      .premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
    const geometry = new DecalGeometry(target, point, new THREE.Euler().setFromQuaternion(rotation), new THREE.Vector3(...size));
    geometry.applyMatrix4(inverse);
    const positions = geometry.attributes.position,
      normals = geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(
        i,
        positions.getX(i) + normals.getX(i) * 0.008,
        positions.getY(i) + normals.getY(i) * 0.008,
        positions.getZ(i) + normals.getZ(i) * 0.008
      );
    }
    positions.needsUpdate = true;
    const material = applyLogDepthOffset(new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      roughness: 0.4,
      metalness: 0.05
    }), 4);
    const decal = new THREE.Mesh(geometry, material);
    decal.name = name;
    decals.add(decal);
  };

  for (const side of [-1, 1]) {
    project(`JejuAir-title-${side}`, [side * 1.85, 1.22, -4.4], [10.2, 1.3, 2.2], side, title);
    project(`JejuAir-tail-${side}`, [side * 0.18, 5.2, 15.3], [5.6, 6.4, 0.8], side, facets);
  }
  root.userData.airline = 'Jeju Air';
}
