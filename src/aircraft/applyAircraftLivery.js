import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { applyLogDepthOffset } from '../environment/RunwayMarkings.js';

const SKIP_SCHEME_MESHES = new Set(['tur_01', 'turbs']);
const LIVERY_GROUP_NAME = 'AddonAircraftLivery';

function cloneMaterial(material) {
  if (Array.isArray(material)) return material.map(item => item.clone());
  return material.clone();
}

export function disposeLiveryGroup(group) {
  if (!group) return;
  const textures = new Set();
  group.traverse(obj => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) textures.add(mat.map);
      mat.dispose?.();
    }
  });
  for (const texture of textures) texture.dispose?.();
}

export function restoreBaseLiveryMaterials(model) {
  if (!model) return;
  model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return;
    if (!mesh.userData.baseLiveryMaterial) {
      mesh.userData.baseLiveryMaterial = mesh.material;
    } else if (mesh.material !== mesh.userData.baseLiveryMaterial) {
      mesh.material = mesh.userData.baseLiveryMaterial;
    }
  });
}

function ensureClonedMaterial(mesh, clonedMeshes) {
  if (clonedMeshes.has(mesh)) return mesh.material;
  const cloned = cloneMaterial(mesh.material);
  mesh.material = cloned;
  clonedMeshes.add(mesh);
  return cloned;
}

function applyMaterialEntry(material, entry, loader) {
  if (entry.color && material.color) material.color.set(entry.color);
  if (Number.isFinite(entry.roughness) && 'roughness' in material) material.roughness = entry.roughness;
  if (Number.isFinite(entry.metalness) && 'metalness' in material) material.metalness = entry.metalness;
  if (entry.map?.url && loader) {
    loader.load(entry.map.url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, error => {
      console.error('Addon livery texture failed to load:', error);
    });
  }
  material.needsUpdate = true;
}

function applyMaterialOverrides(model, materials, loader, clonedMeshes) {
  const wildcard = materials['*'] ?? null;
  model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const matched = list.map(mat => materials[mesh.name] ?? materials[mat.name] ?? wildcard);
    if (!matched.some(Boolean)) return;
    const cloned = ensureClonedMaterial(mesh, clonedMeshes);
    const clonedList = Array.isArray(cloned) ? cloned : [cloned];
    clonedList.forEach((mat, index) => {
      if (matched[index]) applyMaterialEntry(mat, matched[index], loader);
    });
  });
}

function applySchemeShader(model, root, scheme, clonedMeshes) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const topColor = new THREE.Color(scheme.topColor);
  const bellyColor = new THREE.Color(scheme.bellyColor);
  const tailColor = new THREE.Color(scheme.tailColor ?? scheme.topColor);
  const hasStripe = Boolean(scheme.stripeColor);
  const stripeColor = new THREE.Color(scheme.stripeColor ?? scheme.topColor);
  const splitY = Number.isFinite(scheme.splitY) ? scheme.splitY : -0.32;
  const stripeHalfHeight = Number.isFinite(scheme.stripeHalfHeight) ? scheme.stripeHalfHeight : 0.035;

  model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material || SKIP_SCHEME_MESHES.has(mesh.name)) return;
    const material = ensureClonedMaterial(mesh, clonedMeshes);
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const list = Array.isArray(material) ? material : [material];
    for (const mat of list) {
      mat.onBeforeCompile = shader => {
        shader.uniforms.liveryTransform = { value: transform };
        shader.uniforms.liveryTopColor = { value: topColor };
        shader.uniforms.liveryBellyColor = { value: bellyColor };
        shader.uniforms.liveryTailColor = { value: tailColor };
        shader.uniforms.liveryStripeColor = { value: stripeColor };
        shader.uniforms.liveryHasStripe = { value: hasStripe ? 1.0 : 0.0 };
        shader.uniforms.liverySplitY = { value: splitY };
        shader.uniforms.liveryStripeHalfHeight = { value: stripeHalfHeight };
        shader.vertexShader = 'uniform mat4 liveryTransform; varying vec3 vLiveryPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvLiveryPosition = (liveryTransform * vec4(position, 1.0)).xyz;',
        );
        shader.fragmentShader = [
          'varying vec3 vLiveryPosition;',
          'uniform vec3 liveryTopColor;',
          'uniform vec3 liveryBellyColor;',
          'uniform vec3 liveryTailColor;',
          'uniform vec3 liveryStripeColor;',
          'uniform float liveryHasStripe;',
          'uniform float liverySplitY;',
          'uniform float liveryStripeHalfHeight;',
          '',
        ].join('\n') + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          vec3 p = vLiveryPosition;
          bool oldGreen = diffuseColor.g > diffuseColor.r * 1.4 && diffuseColor.g > diffuseColor.b * 1.25;
          bool fuselage = abs(p.x) < 2.05 && p.z > -19.1 && p.z < 17.8;
          bool tail = p.y > 2.0 && p.z > 10.5;
          bool detail = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.28 && !oldGreen;
          if (tail) {
            diffuseColor.rgb = liveryTailColor;
          } else if (fuselage && (!detail || oldGreen)) {
            diffuseColor.rgb = (p.y > liverySplitY) ? liveryTopColor : liveryBellyColor;
            if (liveryHasStripe > 0.5 && abs(p.y - liverySplitY) < liveryStripeHalfHeight) {
              diffuseColor.rgb = liveryStripeColor;
            }
          } else if (oldGreen) {
            diffuseColor.rgb = liveryBellyColor;
          }
        `);
      };
      mat.customProgramCacheKey = () => 'addon-livery-scheme-v1';
      mat.needsUpdate = true;
    }
  });
}

function createCanvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function createTaegeukTexture(emblem) {
  const primary = emblem.primaryColor ?? '#d51d44';
  const secondary = emblem.secondaryColor ?? '#084884';
  const accent = emblem.accentColor ?? '#ffffff';
  return createCanvasTexture(512, 512, ctx => {
    ctx.translate(256, 256);
    ctx.rotate(-0.2);
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(0, 0, 225, Math.PI, 0);
    ctx.arc(112.5, 0, 112.5, 0, Math.PI);
    ctx.arc(-112.5, 0, 112.5, 0, Math.PI, true);
    ctx.fill();
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.arc(0, 0, 225, 0, Math.PI);
    ctx.arc(-112.5, 0, 112.5, Math.PI, 0);
    ctx.arc(112.5, 0, 112.5, Math.PI, 0, true);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(-112.5, 0, 112.5, Math.PI, 0);
    ctx.arc(112.5, 0, 112.5, Math.PI, 0, true);
    ctx.stroke();
  });
}

function applyDecals(model, root, container, livery, loader) {
  if ((!livery.title && !livery.tailEmblem) || typeof document === 'undefined') return;
  const airframe = model.getObjectByName('B737');
  if (!airframe || !airframe.isMesh) return;

  const decals = new THREE.Group();
  decals.name = LIVERY_GROUP_NAME;
  container.add(decals);

  const project = (name, position, size, side, map) => {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const point = root.localToWorld(new THREE.Vector3(...position));
    const orientation = new THREE.Euler(0, side * Math.PI / 2, 0);
    const rotation = new THREE.Quaternion()
      .setFromEuler(orientation)
      .premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
    const geometry = new DecalGeometry(airframe, point, new THREE.Euler().setFromQuaternion(rotation), new THREE.Vector3(...size));
    geometry.applyMatrix4(inverse);
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(
        i,
        positions.getX(i) + normals.getX(i) * 0.008,
        positions.getY(i) + normals.getY(i) * 0.008,
        positions.getZ(i) + normals.getZ(i) * 0.008,
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
      metalness: 0.05,
    }), 4);
    const decal = new THREE.Mesh(geometry, material);
    decal.name = name;
    decals.add(decal);
  };

  if (livery.title?.text) {
    const titleColor = livery.title.color ?? '#063b70';
    const titleText = livery.title.text;
    const titleMap = createCanvasTexture(1024, 160, (ctx, w, h) => {
      ctx.fillStyle = titleColor;
      ctx.font = 'bold 104px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(titleText, w / 2, h / 2, w - 24);
    });
    for (const side of [-1, 1]) {
      project(`AddonLivery-title-${side}`, [side * 1.85, 0.95, -5.5], [9.5, 1.15, 1.25], side, titleMap);
    }
  }

  if (livery.tailEmblem) {
    if (livery.tailEmblem.map?.url && loader) {
      loader.load(livery.tailEmblem.map.url, texture => {
        if (!decals.parent) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        for (const side of [-1, 1]) {
          project(`AddonLivery-tail-${side}`, [side * 0.18, 5.7, 15.3], [3.5, 3.5, 0.8], side, texture);
        }
      }, undefined, error => {
        console.error('Addon tail emblem texture failed to load:', error);
      });
    } else if (livery.tailEmblem.kind === 'taegeuk') {
      const symbolMap = createTaegeukTexture(livery.tailEmblem);
      for (const side of [-1, 1]) {
        project(`AddonLivery-tail-${side}`, [side * 0.18, 5.7, 15.3], [3.5, 3.5, 0.8], side, symbolMap);
      }
    }
  }
}

/**
 * Apply a declarative addon livery (material/texture overrides, two-tone scheme,
 * and optional fuselage/tail decals) to a loaded aircraft GLB scene.
 */
export function applyAircraftLivery(model, root, container, livery, { textureLoader } = {}) {
  if (!model || !livery) return;
  const existing = container?.getObjectByName(LIVERY_GROUP_NAME);
  if (existing) {
    container.remove(existing);
    disposeLiveryGroup(existing);
  }

  restoreBaseLiveryMaterials(model);
  const clonedMeshes = new Set();
  const loader = textureLoader ?? new THREE.TextureLoader();
  if (livery.scheme) applySchemeShader(model, root, livery.scheme, clonedMeshes);
  if (livery.materials) applyMaterialOverrides(model, livery.materials, loader, clonedMeshes);
  if (container) applyDecals(model, root, container, livery, loader);
  if (livery.airline && root?.userData) root.userData.airline = livery.airline;
}
