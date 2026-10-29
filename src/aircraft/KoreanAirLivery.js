import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

/** Classic Korean Air blue-top scheme for the 737-800.
 * Original atlas still supplies windows, doors and fan detail. No GLB is replaced.
 */
export function applyKoreanAirLivery(model, root, container) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  model.traverse(mesh => {
    if (!mesh.isMesh || ['tur_01', 'turbs'].includes(mesh.name)) return;
    const material = mesh.material.clone(); mesh.material = material;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    material.onBeforeCompile = shader => {
      shader.uniforms.liveryTransform = { value: transform };
      shader.vertexShader = 'uniform mat4 liveryTransform; varying vec3 vLiveryPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiveryPosition = (liveryTransform * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 vLiveryPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 p = vLiveryPosition;
        bool oldGreen = diffuseColor.g > diffuseColor.r * 1.4 && diffuseColor.g > diffuseColor.b * 1.25;
        bool fuselage = abs(p.x) < 2.05 && p.z > -19.1 && p.z < 17.8;
        bool tail = p.y > 2.0 && p.z > 10.5;
        bool detail = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.28 && !oldGreen;
        vec3 blue = vec3(0.29, 0.57, 0.70);
        if (tail || (fuselage && (!detail || oldGreen))) {
          diffuseColor.rgb = (p.y > -0.32 || tail) ? blue : vec3(0.82, 0.85, 0.87);
          if (fuselage && abs(p.y + 0.32) < 0.035 && !tail) diffuseColor.rgb = vec3(0.55, 0.025, 0.055);
        } else if (oldGreen) diffuseColor.rgb = vec3(0.82, 0.85, 0.87);
      `);
    };
    material.customProgramCacheKey = () => 'korean-air-classic-v1';
    material.needsUpdate = true;
  });
  const airframe = model.getObjectByName('B737');
  if (!airframe || typeof document === 'undefined') return;
  const decals = new THREE.Group(); decals.name = 'KoreanAirLivery'; container.add(decals);
  const texture = (width, height, paint) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4; return map;
  };
  const title = texture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#063b70'; ctx.font = 'bold 115px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('KOREAN AIR', w / 2, h / 2, w - 20);
  });
  const symbol = texture(512, 512, ctx => {
    // Original vector approximation of the classic red/blue Taegeuk mark.
    ctx.translate(256, 256); ctx.rotate(-.2);
    ctx.fillStyle = '#d51d44'; ctx.beginPath(); ctx.arc(0, 0, 225, Math.PI, 0); ctx.arc(112.5, 0, 112.5, 0, Math.PI); ctx.arc(-112.5, 0, 112.5, 0, Math.PI, true); ctx.fill();
    ctx.fillStyle = '#084884'; ctx.beginPath(); ctx.arc(0, 0, 225, 0, Math.PI); ctx.arc(-112.5, 0, 112.5, Math.PI, 0); ctx.arc(112.5, 0, 112.5, Math.PI, 0, true); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 13; ctx.beginPath();
    ctx.arc(-112.5, 0, 112.5, Math.PI, 0); ctx.arc(112.5, 0, 112.5, Math.PI, 0, true); ctx.stroke();
  });
  const project = (name, position, size, side, map, target = airframe) => {
    const point = root.localToWorld(new THREE.Vector3(...position));
    const orientation = new THREE.Euler(0, side * Math.PI / 2, 0);
    const rotation = new THREE.Quaternion().setFromEuler(orientation).premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
    const geometry = new DecalGeometry(target, point, new THREE.Euler().setFromQuaternion(rotation), new THREE.Vector3(...size));
    geometry.applyMatrix4(inverse);
    const positions = geometry.attributes.position, normals = geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(i, positions.getX(i) + normals.getX(i) * .008,
        positions.getY(i) + normals.getY(i) * .008, positions.getZ(i) + normals.getZ(i) * .008);
    }
    positions.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false,
      alphaTest: .05, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, roughness: .4, metalness: .05 });
    const decal = new THREE.Mesh(geometry, material); decal.name = name; decals.add(decal);
  };
  for (const side of [-1, 1]) {
    project(`KoreanAir-title-${side}`, [side * 1.85, .95, -5.5], [9.5, 1.15, 1.25], side, title);
    project(`KoreanAir-tail-${side}`, [side * .18, 5.7, 15.3], [3.5, 3.5, .8], side, symbol);
  }
  root.userData.airline = 'Korean Air';
}
