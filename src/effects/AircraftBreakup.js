import * as THREE from 'three';

function visibleBelow(object, root) {
  for (let node = object; node && node !== root; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function fragmentBounds(object, box = new THREE.Box3()) {
  for (const mesh of object.children) if (mesh.visible) box.expandByObject(mesh);
  return box;
}

// Partition actual exterior triangles into structural regions, including batched GLBs.
// Own only generated geometry; source materials/textures remain owned by the aircraft.
export class AircraftBreakup {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];
    this.persistentPieces = [];
    this.target = new THREE.Vector3();
    this.radius = 20;
    this.firstContact = null;
  }

  // Prepare once after the selected airframe loads, never in the impact hot path.
  // Retain source transforms so articulated gear still uses its impact-time pose.
  prepare(aircraft) {
    if (this.preparedAircraft === aircraft &&
        this.preparedUseGltf === aircraft.useGltf &&
        this.preparedVersion === aircraft.breakupVersion) return false;
    this.disposePrepared({ clearPersistent: false });
    const wasCockpit = Boolean(aircraft.isCockpit);
    const cockpitVisible = aircraft.cockpit?.group.visible;
    aircraft.setCockpitMode(false);
    try {
      this.buildPrepared(aircraft);
      this.preparedAircraft = aircraft;
      this.preparedUseGltf = aircraft.useGltf;
      this.preparedVersion = aircraft.breakupVersion;
    } finally {
      aircraft.setCockpitMode(wasCockpit);
      if (aircraft.cockpit && cockpitVisible != null) aircraft.cockpit.group.visible = cockpitVisible;
    }
    return true;
  }

  buildPrepared(aircraft) {
    this.preparedRoot = new THREE.Group();
    this.preparedFragments = [];
    const root = aircraft.group;
    root.updateWorldMatrix(true, true);
    const sources = aircraft.useGltf ? [aircraft.gltfGroup,
      aircraft.gearGroup?.parent === root ? aircraft.gearGroup : null]
      : aircraft.proceduralGroup ? [aircraft.proceduralGroup]
        : [aircraft.fuselageGroup, aircraft.wingGroup, aircraft.tailGroup,
          aircraft.empennageGroup, aircraft.enginesGroup, aircraft.gearGroup];
    const inverse = root.matrixWorld.clone().invert();
    const meshes = [];
    const bounds = new THREE.Box3();
    // Include hidden articulation alternatives (e.g. stowed/deployed F16 gear).
    // Their impact-time visibility is applied without generating new geometry.
    for (const source of sources.filter(Boolean)) source.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const transform = inverse.clone().multiply(mesh.matrixWorld);
      const mirrored = transform.determinant() < 0;
      geometry.applyMatrix4(transform);
      const tangent = geometry.getAttribute('tangent');
      if (mirrored && tangent) {
        for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i));
      }
      geometry.computeBoundingBox();
      if (visibleBelow(mesh, root)) bounds.union(geometry.boundingBox);
      meshes.push({ geometry, material: mesh.material, mirrored, source: mesh, inverseTransform: transform.clone().invert() });
    });
    if (bounds.isEmpty()) {
      for (const { geometry } of meshes) geometry.dispose();
      return;
    }
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const regions = new Map();
    for (const { geometry, material, mirrored, source, inverseTransform } of meshes) {
      const p = geometry.attributes.position;
      const buckets = new Map();
      for (let i = 0; i < p.count; i += 3) {
        const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        const region = Math.abs(x - center.x) > size.x * 0.16
          ? (x < center.x ? 'left' : 'right')
          : `body${Math.min(3, Math.floor(4 * (z - bounds.min.z) / Math.max(size.z, 0.01)))}`;
        const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
        const matIndex = group?.materialIndex ?? 0;
        const key = `${region}:${matIndex}`;
        if (!buckets.has(key)) buckets.set(key, { region, matIndex, indices: [] });
        // Baking removes the negative object scale that WebGL used to reverse
        // front-face culling, so carry that reversal into every vertex attribute.
        buckets.get(key).indices.push(...(mirrored ? [i + 2, i + 1, i] : [i, i + 1, i + 2]));
      }
      for (const { region, matIndex, indices } of buckets.values()) {
        const fragment = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geometry.attributes)) {
          const data = new attr.array.constructor(indices.length * attr.itemSize);
          indices.forEach((index, n) => {
            for (let k = 0; k < attr.itemSize; k++) data[n * attr.itemSize + k] = attr.array[index * attr.itemSize + k];
          });
          fragment.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
        }
        const mesh = new THREE.Mesh(fragment, Array.isArray(material) ? material[matIndex] : material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        fragment.computeBoundingBox();
        fragment.computeBoundingSphere();
        // C172 spring struts deform their buffers rather than their transforms.
        // Only those small parts retain a vertex mapping; rigid airframes stay cached.
        const deformation = source.userData.flexible ? {
          indices: Uint32Array.from(indices, i => source.geometry.index?.getX(i) ?? i),
          transform: inverseTransform.clone().invert(),
          version: source.geometry.attributes.position.version,
        } : null;
        this.preparedFragments.push({ mesh, source, inverseTransform, matIndex, deformation });
        if (!regions.has(region)) {
          const group = new THREE.Group();
          group.name = region;
          regions.set(region, group);
        }
        regions.get(region).add(mesh);
      }
      geometry.dispose();
    }
    for (const object of regions.values()) this.preparedRoot.add(object);
  }

  spawn(aircraft, velocity, { detachRegions = null } = {}) {
    this.clear();
    this.firstContact = null;
    // Direct callers and crashes during asset loading still have a safe fallback.
    this.prepare(aircraft);
    aircraft.setCockpitMode(false);
    const root = aircraft.group;
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    for (const { mesh, source, inverseTransform, matIndex, deformation } of this.preparedFragments) {
      if (deformation && deformation.version !== source.geometry.attributes.position.version) {
        const position = mesh.geometry.attributes.position;
        const normal = mesh.geometry.attributes.normal;
        const sourcePosition = source.geometry.attributes.position;
        const sourceNormal = source.geometry.attributes.normal;
        const normalTransform = new THREE.Matrix3().getNormalMatrix(deformation.transform);
        const vertex = new THREE.Vector3();
        deformation.indices.forEach((index, i) => {
          vertex.fromBufferAttribute(sourcePosition, index).applyMatrix4(deformation.transform);
          position.setXYZ(i, vertex.x, vertex.y, vertex.z);
          if (normal && sourceNormal) {
            vertex.fromBufferAttribute(sourceNormal, index).applyNormalMatrix(normalTransform);
            normal.setXYZ(i, vertex.x, vertex.y, vertex.z);
          }
        });
        position.needsUpdate = true;
        if (normal && sourceNormal) normal.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        deformation.version = sourcePosition.version;
      }
      mesh.matrix.copy(inverse).multiply(source.matrixWorld).multiply(inverseTransform);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = visibleBelow(source, root);
      // Liveries/material quality can change without replacing the geometry.
      mesh.material = Array.isArray(source.material) ? source.material[matIndex] : source.material;
    }
    const regions = [...this.preparedRoot.children];
    const bounds = new THREE.Box3();
    for (const object of regions) {
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.setScalar(1);
      object.updateMatrixWorld(true);
      fragmentBounds(object, bounds);
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const speed = velocity.length();

    const detachSet = Array.isArray(detachRegions) && detachRegions.length > 0
      ? new Set(detachRegions)
      : null;

    if (detachSet) {
      const detachedObjects = regions.filter(o => detachSet.has(o.name));
      const remainingObjects = regions.filter(o => !detachSet.has(o.name));

      for (const object of detachedObjects) {
        const box = fragmentBounds(object);
        if (box.isEmpty()) continue;
        const pivot = box.getCenter(new THREE.Vector3());
        const offset = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        object.children.forEach(mesh => {
          mesh.matrix.premultiply(offset);
          mesh.matrixWorldNeedsUpdate = true;
        });
        object.position.copy(pivot).applyMatrix4(root.matrixWorld);
        object.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()));
        const outward = pivot.clone().sub(center).applyQuaternion(object.quaternion).normalize();
        const impulse = outward.multiplyScalar(Math.min(18, speed * 0.15));
        impulse.y += Math.min(8, speed * 0.06);
        this.scene.add(object);
        this.pieces.push({
          object,
          velocity: velocity.clone().multiplyScalar(0.6).add(impulse),
          spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3),
          radius: box.getSize(new THREE.Vector3()).length() * 0.12,
          isDetachedPart: true,
          partName: object.name,
        });
      }

      if (remainingObjects.length > 0) {
        const mainGroup = new THREE.Group();
        mainGroup.name = 'SeveredAirframe';
        for (const object of remainingObjects) mainGroup.add(object);
        const mainBox = fragmentBounds(mainGroup);
        const pivot = mainBox.getCenter(new THREE.Vector3());
        const offset = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        mainGroup.traverse(node => {
          if (node.isMesh) {
            node.matrix.premultiply(offset);
            node.matrixWorldNeedsUpdate = true;
          }
        });
        mainGroup.position.copy(pivot).applyMatrix4(root.matrixWorld);
        mainGroup.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()));

        // Continuous aerodynamic roll & yaw moments from missing wing lift & drag
        const isLeftMissing = detachSet.has('left');
        const isRightMissing = detachSet.has('right');
        const rollRate = isLeftMissing ? 3.6 : isRightMissing ? -3.6 : 0.8;
        const yawRate = isLeftMissing ? -1.5 : isRightMissing ? 1.5 : 0.4;
        const pitchRate = 0.5;
        const spin = new THREE.Vector3(pitchRate, yawRate, rollRate);

        this.scene.add(mainGroup);
        const mainPiece = {
          object: mainGroup,
          velocity: velocity.clone().multiplyScalar(0.7),
          spin,
          radius: mainBox.getSize(new THREE.Vector3()).length() * 0.15,
          isMainBody: true,
          severedSide: isLeftMissing ? 'left' : isRightMissing ? 'right' : null,
          localSpin: true,
        };
        this.pieces.push(mainPiece);
        this.mainPiece = mainPiece;
      }
    } else {
      let n = 0;
      for (const object of regions) {
        const box = fragmentBounds(object);
        if (box.isEmpty()) continue;
        const pivot = box.getCenter(new THREE.Vector3());
        const offset = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        object.children.forEach(mesh => {
          mesh.matrix.premultiply(offset);
          mesh.matrixWorldNeedsUpdate = true;
        });
        object.position.copy(pivot).applyMatrix4(root.matrixWorld);
        object.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()));
        const outward = pivot.clone().sub(center).applyQuaternion(object.quaternion).normalize();
        const impulse = outward.multiplyScalar(Math.min(16, speed * 0.13));
        impulse.y += Math.min(7, speed * 0.05);
        this.scene.add(object);
        this.pieces.push({ object, velocity: velocity.clone().multiplyScalar(0.55).add(impulse),
          spin: new THREE.Vector3(0.4 + n * 0.13, (n % 2 ? -1 : 1) * 0.6, 0.3 - n * 0.11),
          radius: box.getSize(new THREE.Vector3()).length() * 0.12 });
        n++;
      }
    }
    this.aircraft = aircraft;
    root.visible = false;
    this.updateBounds();
  }

  integratePieces(pieces, h, terrain, waterLevel, recordContact = false) {
    for (const piece of pieces) {
      const { object, velocity, spin, radius } = piece;
      const floor = terrain?.getHeight(object.position.x, object.position.z) ?? 0;
      // Approximate the immersed height of the fragment's contact sphere.
      // Dry terrain, shoreline crossings and shallow water use the same forces.
      const immersion = Number.isFinite(waterLevel) ? THREE.MathUtils.clamp(
        (Math.min(waterLevel, object.position.y + radius)
          - Math.max(floor, object.position.y - radius)) / (2 * radius), 0, 1) : 0;
      velocity.y -= 9.81 * h;
      velocity.multiplyScalar(Math.exp(-(0.12 + 2 * immersion) * h));
      spin.multiplyScalar(Math.exp(-2 * immersion * h));
      object.position.addScaledVector(velocity, h);
      if (piece.localSpin) {
        object.rotateX(spin.x * h);
        object.rotateY(spin.y * h);
        object.rotateZ(spin.z * h);
      } else {
        object.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), spin.x * h);
        object.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), spin.y * h);
        object.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), spin.z * h);
      }
      object.quaternion.normalize();
      const contactHeight = (terrain?.getHeight(object.position.x, object.position.z) ?? 0) + radius;

      // Track first contact with water surface or dry ground during sub-stepping
      if (recordContact && !this.firstContact) {
        const isWaterContact = Number.isFinite(waterLevel) && floor < waterLevel && (object.position.y - radius <= waterLevel);
        const isGroundContact = object.position.y <= contactHeight;
        if (isWaterContact) {
          this.firstContact = {
            point: object.position.clone(),
            velocity: velocity.clone(),
            piece,
            isWater: true,
            isGround: false,
          };
        } else if (isGroundContact) {
          this.firstContact = {
            point: object.position.clone(),
            velocity: velocity.clone(),
            piece,
            isWater: false,
            isGround: true,
          };
        }
      }

      if (object.position.y < contactHeight) {
        object.position.y = contactHeight;
        if (velocity.y < 0) velocity.y = Math.abs(velocity.y) > 1 ? -velocity.y * 0.18 * (1 - immersion) : 0;
        velocity.x *= Math.exp(-3.5 * h);
        velocity.z *= Math.exp(-3.5 * h);
        spin.multiplyScalar(Math.exp(-5 * h));
      }
    }
  }

  update(dt, terrain, waterLevel = null) {
    // Substeps bound contact integration, not the total elapsed simulation time.
    let remaining = Number.isFinite(dt) ? Math.max(dt, 0) : 0;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      this.integratePieces(this.pieces, h, terrain, waterLevel, true);
      if (this.persistentPieces?.length) {
        this.integratePieces(this.persistentPieces, h, terrain, waterLevel, false);
      }
    }
    if (this.aircraft) this.aircraft.group.visible = false;
    this.updateBounds(terrain, waterLevel);

    // Update persistent wreckage pieces (fade and dispose after duration)
    if (this.persistentPieces?.length) {
      for (let i = this.persistentPieces.length - 1; i >= 0; i--) {
        const p = this.persistentPieces[i];
        p.timer = (p.timer ?? 0) + dt;
        if (p.timer >= p.duration) {
          this.scene.remove(p.object);
          p.object.traverse(node => {
            if (node.isMesh) {
              node.geometry?.dispose();
              if (Array.isArray(node.material)) node.material.forEach(m => m?.dispose());
              else node.material?.dispose();
            }
          });
          this.persistentPieces.splice(i, 1);
        } else if (p.timer > p.duration - 2) {
          const alpha = Math.max(0, (p.duration - p.timer) / 2);
          p.object.traverse(node => {
            if (node.isMesh && node.material) {
              const mats = Array.isArray(node.material) ? node.material : [node.material];
              for (const m of mats) {
                if (m) {
                  m.transparent = true;
                  m.opacity = alpha;
                }
              }
            }
          });
        }
      }
    }
  }

  updateBounds(terrain, waterLevel = null) {
    if (!this.pieces.length) return;
    if (this.mainPiece) {
      this.target.copy(this.mainPiece.object.position);
      this.radius = Math.max(10, this.mainPiece.radius);
      const floor = terrain?.getHeight(this.target.x, this.target.z) ?? 0;
      if (Number.isFinite(waterLevel) && floor < waterLevel) this.target.y = Math.max(waterLevel, this.target.y);
      return;
    }
    const box = new THREE.Box3();
    for (const { object } of this.pieces) {
      object.updateWorldMatrix(true, true);
      fragmentBounds(object, box);
    }
    box.getCenter(this.target);
    this.radius = Math.max(10, box.getSize(new THREE.Vector3()).length() / 2);
    const floor = terrain?.getHeight(this.target.x, this.target.z) ?? 0;
    if (Number.isFinite(waterLevel) && floor < waterLevel) this.target.y = Math.max(waterLevel, this.target.y);
  }

  clear({ persist = false, duration = 30 } = {}) {
    this.firstContact = null;
    if (persist && this.pieces.length > 0) {
      for (const piece of this.pieces) {
        const objClone = piece.object.clone(true);
        objClone.traverse(node => {
          if (node.isMesh) {
            if (node.geometry) node.geometry = node.geometry.clone();
            if (node.material) {
              node.material = Array.isArray(node.material)
                ? node.material.map(m => m ? m.clone() : m)
                : node.material.clone();
            }
          }
        });
        this.scene.add(objClone);
        this.persistentPieces.push({
          object: objClone,
          velocity: piece.velocity.clone(),
          spin: piece.spin.clone(),
          radius: piece.radius,
          timer: piece.timer ?? 0,
          duration,
          localSpin: Boolean(piece.localSpin),
        });
      }
    }
    // Restore composite groups (SeveredAirframe) back to direct children of preparedRoot
    if (this.mainPiece?.object) {
      const mainGroup = this.mainPiece.object;
      this.scene.remove(mainGroup);
      while (mainGroup.children.length > 0) {
        const child = mainGroup.children[0];
        child.position.set(0, 0, 0);
        child.quaternion.identity();
        child.scale.setScalar(1);
        this.preparedRoot?.add(child);
      }
      this.mainPiece = null;
    }
    for (const { object } of this.pieces) {
      this.scene.remove(object);
      if (object.name !== 'SeveredAirframe') {
        object.position.set(0, 0, 0);
        object.quaternion.identity();
        object.scale.setScalar(1);
        this.preparedRoot?.add(object);
      }
    }
    this.pieces = [];
    if (this.aircraft) this.aircraft.group.visible = true;
    this.aircraft = null;
  }

  disposePrepared({ clearPersistent = true } = {}) {
    this.clear();
    if (clearPersistent) {
      for (const piece of this.persistentPieces) {
        this.scene.remove(piece.object);
        piece.object.traverse(node => {
          if (node.isMesh) {
            node.geometry?.dispose();
            if (Array.isArray(node.material)) node.material.forEach(m => m?.dispose());
            else node.material?.dispose();
          }
        });
      }
      this.persistentPieces = [];
    }
    this.preparedRoot?.traverse(mesh => mesh.geometry?.dispose());
    this.preparedRoot = null;
    this.preparedFragments = [];
    this.preparedAircraft = null;
    this.preparedVersion = null;
  }
}
