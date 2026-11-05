import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

/**
 * Jeju Air signature orange-and-white livery for the Boeing 737-800.
 *
 * Features:
 * - Vibrant Jeju orange tailfin and CFM56 engine cowlings
 * - Pure white fuselage with clean pearl grey lower belly
 * - Orange blended winglets
 * - "JEJU air" fuselage wordmark and stylized Jeju flight smile tail emblem
 * - Preserves original atlas details (doors, windows, pitot probes, fan blades)
 */
export function applyJejuAirLivery(model, root, container) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
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
        bool fuselage = abs(p.x) < 2.05 && p.z > -19.1 && p.z < 17.8;
        bool tail = p.y > 2.0 && p.z > 10.5;
        bool engine = abs(p.x) > 3.8 && abs(p.x) < 6.5 && p.y < -0.9 && p.z > -7.0 && p.z < -3.0;
        bool winglet = abs(p.x) > 16.8 && p.y > 0.0 && p.z > 4.4 && p.z < 7.1;
        bool detail = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.28 && !oldGreen;

        vec3 jejuOrange = vec3(0.957, 0.475, 0.125); // #f47920
        vec3 whiteUpper = vec3(0.96, 0.96, 0.97);    // #f5f6f6
        vec3 greyLower = vec3(0.88, 0.90, 0.92);     // #e7eaed
        vec3 greyNeutral = vec3(0.85, 0.87, 0.89);

        if (tail || winglet) {
          diffuseColor.rgb = jejuOrange;
        } else if (engine) {
          if (!detail || oldGreen) {
            diffuseColor.rgb = jejuOrange;
          }
        } else if (fuselage) {
          if (!detail || oldGreen || p.y < -0.8) {
            diffuseColor.rgb = (p.y > -0.32) ? whiteUpper : greyLower;
          }
        } else if (oldGreen) {
          diffuseColor.rgb = greyNeutral;
        }
        `
      );
    };
    material.customProgramCacheKey = () => 'jeju-air-v1';
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

  const title = texture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f47920';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 115px "Arial Black", Arial, sans-serif';
    ctx.fillText('JEJU air', w / 2, h / 2, w - 24);
  });

  const symbol = texture(512, 512, ctx => {
    ctx.translate(256, 256);
    ctx.rotate(-0.18);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 110px "Arial Black", Arial, sans-serif';
    ctx.fillText('JEJU', 0, -30, 360);
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.fillText('air', 140, 25, 120);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -10, 155, 0.25, Math.PI - 0.25);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(140, -45, 14, 0, Math.PI * 2);
    ctx.fill();
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
    const material = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      roughness: 0.4,
      metalness: 0.05
    });
    const decal = new THREE.Mesh(geometry, material);
    decal.name = name;
    decals.add(decal);
  };

  for (const side of [-1, 1]) {
    project(`JejuAir-title-${side}`, [side * 1.85, 0.95, -5.5], [9.5, 1.15, 1.25], side, title);
    project(`JejuAir-tail-${side}`, [side * 0.18, 5.7, 15.3], [3.5, 3.5, 0.8], side, symbol);
  }
  root.userData.airline = 'Jeju Air';
}
