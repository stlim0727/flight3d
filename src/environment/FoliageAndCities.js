import * as THREE from 'three';
import { createTreeGeometry, TREE_SPECIES, TREE_LOD_DISTANCE, TREE_LOD_HYSTERESIS } from './TreeModels.js';
import { DISTRICT, districtLot, inDistrict, createDistrictRoads, loadDistrictKit } from './CityDistrict.js';
import { cityWindowIntensity, createCityBuildingAssets } from './CityBuildingAssets.js';
import { planNorthDistrict } from './NorthCityDistrict.js';
import { surfaceGeometry } from './CitySurface.js';

/** Instanced vegetation and cities; collision metadata is independent of visual LOD. */
export class FoliageAndCities {
  constructor(terrain, random = Math.random) {
    this.terrain = terrain;
    this.random = random;
    this.group = new THREE.Group();

    this.treeData = [];
    this.buildingData = [];
    this.northDistrict = planNorthDistrict(terrain);

    this.initFoliage();
    this.initCities();
    // Filter after consuming the original foliage/city random sequence so other
    // districts keep their positions, dimensions, colors and archetypes.
    const keep = this.treeData.map(t => !this.northDistrict.excludesTree(t.x, t.z, t.radius));
    this.treeInstances = this.treeInstances.filter((_, i) => keep[i]);
    this.treeData = this.treeData.filter((_, i) => keep[i]);
    this.lastTreeCamera.set(Infinity, Infinity, Infinity);
    this.update(new THREE.Vector3());
    this.group.add(createDistrictRoads(terrain));
    const roads = new THREE.Mesh(surfaceGeometry(terrain, this.northDistrict.polygons),
      new THREE.MeshStandardMaterial({ color: 0x444a4c, roughness: .95 }));
    roads.name = 'north-district-roads'; roads.receiveShadow = true;
    this.group.add(roads);
    this.districtReady = typeof window === 'undefined' ? Promise.resolve(false) :
      loadDistrictKit().then(meshes => {
        meshes.forEach((mesh, i) => {
          const near = this.cityArchetypes[i + 3].near;
          near.geometry = mesh.geometry;
          near.material = mesh.material;
        });
        this.districtLoaded = true;
        this.setTimeOfDay(this.cityHour);
        return true;
      }).catch(error => {
        console.warn('City district kit unavailable; keeping fallback buildings.', error);
        return false;
      });
  }

  initFoliage() {
    const treeCount = 3500;

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.treeBatches = TREE_SPECIES.map(species => {
      const geometries = [createTreeGeometry(species, true), createTreeGeometry(species, false)];
      const meshes = geometries.map((geometry, level) => {
        const mesh = new THREE.InstancedMesh(geometry, material, treeCount);
        mesh.name = 'tree-' + species + (level === 0 ? '-near' : '-far');
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Closed opaque crowns avoid alpha sorting and leaf-card overdraw.
        mesh.castShadow = level === 0;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      });
      const box = geometries[0].boundingBox.clone().union(geometries[1].boundingBox);
      let radius = 0;
      for (const geometry of geometries) {
        const vertices = geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++) {
          radius = Math.max(radius, Math.hypot(vertices.getX(i), vertices.getZ(i)));
        }
      }
      return { species, meshes, box, radius };
    });
    this.treeInstances = [];
    this.lastTreeCamera = new THREE.Vector3(Infinity, Infinity, Infinity);

    const dummy = new THREE.Object3D();
    let placed = 0;

    // Distribute trees across landscape
    const areaRadius = 9000;

    for (let i = 0; i < treeCount * 2 && placed < treeCount; i++) {
      const angle = this.random() * Math.PI * 2;
      const dist = 600 + Math.sqrt(this.random()) * (areaRadius - 600);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Check airport exclusion zone: $|x| < 2400$ and $|z| < 450$
      if (Math.abs(x) < 2400 && Math.abs(z) < 450) {
        continue;
      }
      // Approach path clearance
      if (Math.abs(z) < 250 && Math.abs(x) < 3600) {
        continue;
      }

      const y = this.terrain.getHeight(x, z);
      // Only plant on soil/grass: above water (3.5m) and below alpine scree (280m)
      if (y < 3.5 || y > 280) {
        continue;
      }

      // Random organic scaling
      const scale = 0.75 + this.random() * 0.85;
      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale * (0.85 + this.random() * 0.35), scale);
      dummy.rotation.y = this.random() * Math.PI * 2;
      dummy.updateMatrix();

      const speciesIndex = placed % TREE_SPECIES.length;
      const { box, radius } = this.treeBatches[speciesIndex];
      this.treeInstances.push({
        speciesIndex, matrix: dummy.matrix.clone(), position: dummy.position.clone(), near: false,
        color: new THREE.Color().setScalar(0.86 + Math.abs(Math.sin(x * 7 + z)) * 0.24)
      });
      this.treeData.push({
        x, y, z,
        height: box.max.y * dummy.scale.y,
        radius: radius * scale
      });

      placed++;
    }

    this.treeInstances = this.treeInstances.filter(tree => !inDistrict(tree.position.x, tree.position.z));
    this.treeData = this.treeData.filter(tree => !inDistrict(tree.x, tree.z));
    this.update(new THREE.Vector3());
  }

  setQuality(quality) {
    this.quality = quality;
    const isUltraLow = quality === 'ultraLow';
    for (const batch of this.treeBatches) {
      batch.meshes[0].castShadow = !isUltraLow;
      batch.meshes[1].castShadow = false;
      batch.meshes[0].receiveShadow = !isUltraLow;
      batch.meshes[1].receiveShadow = !isUltraLow;
    }
    this.lastTreeCamera.set(Infinity, Infinity, Infinity);
    this.cityLodCamera.set(Infinity, Infinity, Infinity);
  }

  update(cameraPosition) {
    if (!this.group.visible || this.lastTreeCamera.distanceToSquared(cameraPosition) < 25 * 25) return;
    this.lastTreeCamera.copy(cameraPosition);
    for (const batch of this.treeBatches) for (const mesh of batch.meshes) mesh.count = 0;
    const isUltraLow = this.quality === 'ultraLow';
    const maxDistSq = isUltraLow ? 2200 * 2200 : Infinity;
    for (const tree of this.treeInstances) {
      const distSq = tree.position.distanceToSquared(cameraPosition);
      if (distSq > maxDistSq) continue;
      const threshold = TREE_LOD_DISTANCE + (tree.near ? TREE_LOD_HYSTERESIS : 0);
      tree.near = !isUltraLow && distSq < threshold * threshold;
      const mesh = this.treeBatches[tree.speciesIndex].meshes[tree.near ? 0 : 1];
      mesh.setMatrixAt(mesh.count, tree.matrix);
      mesh.setColorAt(mesh.count, tree.color);
      mesh.count++;
    }
    for (const batch of this.treeBatches) {
      for (const mesh of batch.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        // Repacking changes world bounds, including after an airport teleport.
        mesh.computeBoundingSphere();
      }
    }
  }

  initCities() {
    const buildingCount = 550;
    this.cityAssets = createCityBuildingAssets();
    this.cityLodNearDistance = 1800;
    this.cityLodCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.cityArchetypes = [...this.cityAssets.nearGeometries, ...this.cityAssets.nearGeometries].map((geometry, index) => {
      const near = new THREE.InstancedMesh(geometry, this.cityAssets.nearMaterial, buildingCount);
      const far = new THREE.InstancedMesh(this.cityAssets.farGeometry, this.cityAssets.farMaterial, buildingCount);
      near.name = `city-near-${index}`;
      far.name = `city-far-${index}`;
      // Instances cover separate clusters; a single aggregate bounding sphere
      // would include most of the map and offer no useful frustum culling.
      near.frustumCulled = false;
      far.frustumCulled = false;
      near.count = far.count = 0;
      this.group.add(near, far);
      return { near, far, records: [] };
    });

    const dummy = new THREE.Object3D();
    let placed = 0;

    // City Clusters:
    // 1. East Bay Metropolis: Center (x=2800, z=1400)
    // 2. North Coast Tech Hub: Center (x=-800, z=-2800)
    // 3. Airport Logistics & Business Park: Center (x=900, z=650)
    const clusters = [
      { cx: 2800, cz: 1400, radius: 1200, count: 260, maxH: 140 },
      { cx: -800, cz: -2800, radius: 1000, count: 180, maxH: 85 },
      { cx: 900,  cz: 750,   radius: 600,  count: 110, maxH: 45 }
    ];

    const colorVariants = [
      new THREE.Color(0xdbeafe), // Light glass blue
      new THREE.Color(0xf1f5f9), // White marble/concrete
      new THREE.Color(0x64748b), // Dark slate
      new THREE.Color(0x38bdf8), // Cyan tinted glass
      new THREE.Color(0xe2e8f0)  // Brushed steel
    ];

    clusters.forEach((cluster, clusterIndex) => {
      for (let i = 0; i < cluster.count && placed < buildingCount; i++) {
        const angle = this.random() * Math.PI * 2;
        const r = Math.sqrt(this.random()) * cluster.radius;
        const lot = clusterIndex === 2 ? districtLot(i) : null;
        const x = lot?.x ?? cluster.cx + Math.cos(angle) * r;
        const z = lot?.z ?? cluster.cz + Math.sin(angle) * r;

        // Ensure clear of runway
        if (Math.abs(x) < 2200 && Math.abs(z) < 420) continue;

        let groundY = this.terrain.getHeight(x, z);
        if (groundY < 2.5) continue; // Don't place in ocean

        // Building Dimensions
        const width = 18 + this.random() * 26;
        const depth = 18 + this.random() * 26;
        // Central skyscrapers taller than outskirts
        const distFromCenter = lot ? Math.min(1, Math.hypot(x - cluster.cx, z - DISTRICT.z) / 400) : r / cluster.radius;
        const height = (15 + this.random() * 25) + (1.0 - distFromCenter) * cluster.maxH;

        const rotationY = Math.floor(this.random() * 4) * (Math.PI * 0.5); // Grid aligned
        const worldWidth = Math.abs(Math.cos(rotationY)) * width + Math.abs(Math.sin(rotationY)) * depth;
        const worldDepth = Math.abs(Math.sin(rotationY)) * width + Math.abs(Math.cos(rotationY)) * depth;
        const c = colorVariants[Math.floor(this.random() * colorVariants.length)];
        // Check the full rotated footprint, not only its center.
        if (Math.abs(x) < 2200 + worldWidth / 2 && Math.abs(z) < 420 + worldDepth / 2) continue;

        // Consume the legacy north draw sequence, but replace its unsafe random
        // buildings with terrain-planned lots after generating the south cluster.
        if (clusterIndex === 1) { placed++; continue; }

        let visualY = groundY;
        if (lot) {
          const samples = [-1, 0, 1].flatMap(sx => [-1, 0, 1].map(sz =>
            this.terrain.getHeight(x + sx * worldWidth / 2, z + sz * worldDepth / 2)));
          groundY = Math.min(...samples);
          visualY = Math.max(...samples);
        }
        dummy.position.set(x, visualY, z);
        dummy.scale.set(width, height, depth);
        dummy.rotation.y = rotationY;
        dummy.updateMatrix();
        const archetype = placed % 3 + (lot ? 3 : 0);

        this.buildingData.push({
          x,
          y: groundY,
          z,
          width: worldWidth,
          height: height + visualY - groundY,
          visualY,
          depth: worldDepth,
          localWidth: width,
          localDepth: depth,
          rotationY,
          district: lot ? 'south' : 'east',
          archetype
        });

        const matrix = dummy.matrix.clone();
        dummy.position.y = groundY;
        dummy.scale.y = height + visualY - groundY;
        dummy.updateMatrix();
        const farMatrix = dummy.matrix.clone();
        dummy.scale.y = Math.max(.01, visualY - groundY);
        dummy.updateMatrix();
        this.cityArchetypes[archetype].records.push({ x, y: groundY, z,
          height: height + visualY - groundY, matrix, farMatrix,
          foundationMatrix: lot ? dummy.matrix.clone() : null, color: lot ? c.clone().lerp(new THREE.Color(0xffffff), .8) : c });

        placed++;
      }
    });

    for (const lot of this.northDistrict.lots) {
      const { x, z, width, depth, rotationY, groundY, visualY, height } = lot;
      const c = Math.abs(Math.cos(rotationY)), s = Math.abs(Math.sin(rotationY));
      const archetype = 3 + lot.archetype;
      dummy.position.set(x, visualY, z); dummy.rotation.y = rotationY;
      dummy.scale.set(width, height, depth); dummy.updateMatrix();
      const matrix = dummy.matrix.clone();
      dummy.position.y = groundY; dummy.scale.y = height + visualY - groundY; dummy.updateMatrix();
      const farMatrix = dummy.matrix.clone();
      dummy.scale.y = visualY - groundY; dummy.updateMatrix();
      this.buildingData.push({ x, y: groundY, z, width: c * width + s * depth,
        depth: s * width + c * depth, height: height + visualY - groundY,
        visualY, localWidth: width, localDepth: depth, rotationY, archetype, district: 'north' });
      this.cityArchetypes[archetype].records.push({ x, y: groundY, z,
        height: height + visualY - groundY, matrix, farMatrix,
        foundationMatrix: dummy.matrix.clone(), color: new THREE.Color(0xe2e8f0) });
    }

    const foundationGeometry = new THREE.BoxGeometry(1, 1, 1);
    foundationGeometry.translate(0, .5, 0);
    this.cityFoundations = new THREE.InstancedMesh(foundationGeometry,
      new THREE.MeshStandardMaterial({ color: 0x7d817e, roughness: .95 }),
      DISTRICT.columns * DISTRICT.rows + this.northDistrict.lots.length);
    this.cityFoundations.frustumCulled = false;
    this.cityFoundations.name = 'district-foundations';
    this.group.add(this.cityFoundations);
    this.updateCityLod(new THREE.Vector3());
    this.setTimeOfDay(16.8);
  }

  updateCityLod(cameraPosition) {
    if (this.cityLodCamera.distanceToSquared(cameraPosition) < 80 * 80) return;
    this.cityLodCamera.copy(cameraPosition);
    this.cityFoundations.count = 0;
    const isUltraLow = this.quality === 'ultraLow';
    const nearDistanceSquared = isUltraLow ? 0 : this.cityLodNearDistance ** 2;
    for (const { near, far, records } of this.cityArchetypes) {
      let nearCount = 0;
      let farCount = 0;
      for (const record of records) {
        const dx = cameraPosition.x - record.x;
        const dy = cameraPosition.y - (record.y + record.height / 2);
        const dz = cameraPosition.z - record.z;
        const mesh = nearDistanceSquared > 0 && (dx * dx + dy * dy + dz * dz < nearDistanceSquared) ? near : far;
        const index = mesh === near ? nearCount++ : farCount++;
        mesh.setMatrixAt(index, mesh === near ? record.matrix : record.farMatrix);
        if (mesh === near && record.foundationMatrix) {
          this.cityFoundations.setMatrixAt(this.cityFoundations.count++, record.foundationMatrix);
        }
        mesh.setColorAt(index, record.color);
      }
      near.count = nearCount;
      far.count = farCount;
      near.instanceMatrix.needsUpdate = true;
      far.instanceMatrix.needsUpdate = true;
      if (near.instanceColor) near.instanceColor.needsUpdate = true;
      if (far.instanceColor) far.instanceColor.needsUpdate = true;
    }
    if (this.cityFoundations.count > 0) this.cityFoundations.instanceMatrix.needsUpdate = true;
  }

  setTimeOfDay(hour) {
    this.cityHour = hour;
    this.cityAssets.nearMaterial.emissiveIntensity = cityWindowIntensity(hour);
    if (this.districtLoaded) for (const batch of this.cityArchetypes.slice(3)) {
      batch.near.material.emissiveIntensity = cityWindowIntensity(hour);
    }
  }
}
