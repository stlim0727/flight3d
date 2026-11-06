import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadIncheonTerrain } from '../geospatial/IncheonTerrain.js';
import { drapeSurface, placeBuilding, terrainGeometry } from './incheonGeometry.js';
import { generatePlanting, roadWidth } from '../geospatial/incheonDressing.js';
import { createCityGround, createBuildingMaterials, createTexturedBuildings, createPlantingInstances, GROUND_TEXTURE_SIZE } from './incheonCityAssets.js';
import { applyLogDepthOffset } from '../environment/RunwayMarkings.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');

function footprint(points) {
  // Shape XY becomes world XZ after rotation: shape Y = -world Z.
  return new THREE.Shape(points.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, -z)));
}

function ribbon(points, width, y) {
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const nx = -dz / length * width / 2;
    const nz = dx / length * width / 2;
    const p = [a[0] + nx, y, a[1] + nz];
    const q = [a[0] - nx, y, a[1] - nz];
    const r = [b[0] + nx, y, b[1] + nz];
    const s = [b[0] - nx, y, b[1] - nz];
    vertices.push(...p, ...r, ...q, ...q, ...r, ...s);
  }
  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

async function start() {
  const response = await fetch(`${import.meta.env.BASE_URL}scenery/incheon/patch.json`);
  if (!response.ok) throw new Error(`지도 데이터 요청 실패 (${response.status})`);
  const data = await response.json();
  if (data.schemaVersion !== 1 || !data.features?.length) throw new Error('지도 데이터 형식을 확인해 주세요.');
  const assetBase = `${import.meta.env.BASE_URL}scenery/incheon/`;
  const terrain = await loadIncheonTerrain(assetBase);
  const dressingResponse = await fetch(`${assetBase}dressing.json`);
  if (!dressingResponse.ok) throw new Error(`주차장 데이터 요청 실패 (${dressingResponse.status})`);
  const dressing = await dressingResponse.json();
  if (dressing.schemaVersion!==1 || !Array.isArray(dressing.areas)) throw new Error('Invalid city dressing data');
  const trees = generatePlanting(data,dressing);
  const landMask = await new THREE.TextureLoader().loadAsync(`${assetBase}land-mask.png`);
  landMask.colorSpace = THREE.NoColorSpace;
  const getHeight = (x, z) => terrain.getHeight(x, z);
  let naturalMode = false;
  let cityMode = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0xd9e1df);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 5, 40000);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 80;
  controls.maxDistance = 28000;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  canvas.tabIndex = 0;
  controls.listenToKeyEvents(canvas);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x809189, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-1400, 2500, 900);
  scene.add(sun);
  const groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, alphaMap: landMask, alphaTest: 0.5 });
  const grounds = [terrainGeometry(12000, 240, getHeight, true), terrainGeometry(2000, 160, getHeight)];
  const groundMeshes = [];
  for (const geometry of grounds) {
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i)/12000 + 0.5, 0.5 - positions.getZ(i)/12000);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3));
    const mesh = new THREE.Mesh(geometry, groundMaterial);
    groundMeshes.push(mesh);scene.add(mesh);
  }
  const lowColor = new THREE.Color(0xbcc5a6);
  const highColor = new THREE.Color(0x557d54);
  function updateGround() {
    for (const geometry of grounds) {
      const positions = geometry.attributes.position;
      const colors = geometry.attributes.color;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i); const z = positions.getZ(i);
        const height = naturalMode ? terrain.getNaturalHeight(x, z) : getHeight(x, z);
        positions.setY(i, height);
        const color = lowColor.clone().lerp(highColor, THREE.MathUtils.smoothstep(height, 12, 160));
        colors.setXYZ(i, color.r, color.g, color.b);
      }
      positions.needsUpdate = true; colors.needsUpdate = true;
      geometry.computeVertexNormals();
    }
  }
  updateGround();
  const cityGroundGeometry = grounds[1].clone();
  const cityUV=cityGroundGeometry.attributes.uv;
  for (let i=0;i<cityUV.count;i++) cityUV.setXY(i,cityGroundGeometry.attributes.position.getX(i)/2000+.5,
    .5-cityGroundGeometry.attributes.position.getZ(i)/2000);
  let cityTexture=createCityGround(data,dressing,trees);
  const cityGroundMaterial=new THREE.MeshLambertMaterial({map:cityTexture});
  const cityGround = new THREE.Mesh(cityGroundGeometry,cityGroundMaterial);
  scene.add(cityGround);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshLambertMaterial({ color: 0x83afbd, depthWrite: false }));
  sea.rotation.x = -Math.PI / 2;
  sea.renderOrder = -1; // Background water must not fight zero-height inland DSM pixels.
  scene.add(sea);
  const borderPoints = [];
  const corners = [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000], [-1000, -1000]];
  for (let edge = 1; edge < corners.length; edge++) {
    for (let i = 0; i < 80; i++) {
      const x = THREE.MathUtils.lerp(corners[edge-1][0], corners[edge][0], i/80);
      const z = THREE.MathUtils.lerp(corners[edge-1][1], corners[edge][1], i/80);
      borderPoints.push(new THREE.Vector3(x, getHeight(x, z) + 1.5, z));
    }
  }
  const patchBorder = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(borderPoints), new THREE.LineBasicMaterial({ color: 0xc78638 }));
  scene.add(patchBorder);

  const layers = Object.fromEntries(['roads', 'surfaces', 'buildings','vegetation'].map(name => [name, new THREE.Group()]));
  Object.values(layers).forEach(layer => scene.add(layer));
  const batches = new Map();
  const counts = {};
  const buildingFloors = [];
  const buildingRecords = [];
  function batch(layer, color, geometry) {
    if (!geometry) return;
    const key = `${layer}:${color}`;
    if (!batches.has(key)) batches.set(key, { layer, color, geometries: [] });
    // Uniform, non-indexed layout permits merging ribbons, shapes and extrusions.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    batches.get(key).geometries.push(flat);
    if (flat !== geometry) geometry.dispose();
  }
  for (const feature of data.features) {
    counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
    for (const points of feature.parts) {
      if (feature.kind === 'building') {
        const geometry = new THREE.ExtrudeGeometry(footprint(points), { depth: feature.height.meters, bevelEnabled: false, steps: 1 });
        geometry.rotateX(-Math.PI / 2);
        const placed = placeBuilding(geometry, getHeight, feature.height.meters);
        buildingFloors.push({ id: feature.id, floorM: placed.floor });
        buildingRecords.push({feature,geometry:geometry.clone(),floor:placed.floor});
        batch('buildings', feature.height.source === 'placeholder' ? 0xc9aa79 : 0x659cb7, geometry);
      } else if (feature.area) {
        const geometry = new THREE.ShapeGeometry(footprint(points));
        geometry.rotateX(-Math.PI / 2);
        const colors = { water: 0x8db8c7, park: 0x8daa7f, apron: 0xaab1ae, runway: 0x5b6569, taxiway: 0x77817e, road: 0x77817e };
        const land = { grass: 0x9bb88b, forest: 0x829d78, commercial: 0xc3beb1, industrial: 0xbcbcb1, residential: 0xc7c9b6 };
        const color = colors[feature.kind] ?? land[feature.landuse] ?? 0xb2beaa;
        const airportSurface = ['apron', 'runway', 'taxiway', 'road'].includes(feature.kind);
        batch(airportSurface ? 'roads' : 'surfaces', color, drapeSurface(geometry, getHeight, 0.35, 12.5));
      } else {
        const color = feature.kind === 'runway' ? 0x5b6569 : feature.kind === 'taxiway' ? 0x89938c
          : ['footway', 'path', 'steps'].includes(feature.highway) ? 0xe0d7bf : 0x697773;
        const geometry = ribbon(points, roadWidth(feature), 0);
        if (geometry) batch('roads', color, drapeSurface(geometry, getHeight, 0.6, 12.5));
      }
    }
  }
  for (const { layer, color, geometries } of batches.values()) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error('지도 도형 병합에 실패했습니다.');
    const material = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide,
      polygonOffset: layer !== 'buildings', polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (layer !== 'buildings') applyLogDepthOffset(material, layer === 'roads' ? 4 : 2);
    layers[layer].add(new THREE.Mesh(geometry, material));
    geometries.forEach(g => g.dispose());
  }
  const decoratedBuildings=createTexturedBuildings(buildingRecords,createBuildingMaterials());
  buildingRecords.forEach(record=>record.geometry.dispose());
  scene.add(decoratedBuildings);
  const planting=createPlantingInstances(trees,getHeight);
  layers.vegetation.add(planting);
  const labels = new THREE.Group();
  scene.add(labels);
  const terminal = data.features.find(f => f.id === 'relation/3917466');
  if (terminal) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512; labelCanvas.height = 96;
    const context = labelCanvas.getContext('2d');
    context.fillStyle = '#ffffffed'; context.fillRect(0, 0, 512, 96);
    context.font = 'bold 34px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#254a42';
    context.fillText('제1여객터미널 · T1', 256, 61);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), depthTest: false }));
    const points = terminal.parts.flat();
    label.position.set(points.reduce((s, p) => s + p[0], 0) / points.length, 95,
      points.reduce((s, p) => s + p[1], 0) / points.length);
    label.scale.set(310, 58, 1);
    labels.add(label);
  }

  let pending = false;
  function render() {
    pending = false;
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    document.querySelector('#render-info').textContent = `${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} triangles · 조작할 때만 렌더링`;
    window.incheonPreview = { ready: true, counts, render: { ...renderer.info.render },
      city: { enabled:cityMode, trees:trees.length, parkingAreas:dressing.areas.filter(a=>a.kind==='parking').length,
        groundTextureSize:GROUND_TEXTURE_SIZE, groundTextureBytesRGBA8:Math.round(GROUND_TEXTURE_SIZE**2*4*4/3),
        memory:{...renderer.info.memory} },
      terrain: { naturalMode, worldSize: 12000, origin: terrain.metadata.origin,
        minM: terrain.metadata.grids['regional-natural'].minM, maxM: terrain.metadata.grids['regional-natural'].maxM,
        changedSamples: terrain.metadata.grading.changedSamples,
        outsideUnmodified: getHeight(-3000, 0) === terrain.getNaturalHeight(-3000, 0),
        sourceCenterM: terrain.getNaturalHeight(0, 0), gradedCenterM: getHeight(0, 0),
        coastlineChecks: terrain.metadata.coast.checkpoints.map(p => ({ ...p, observed: terrain.isLand(p.x, p.z) })),
        buildingFloors, geometryCount: renderer.info.memory.geometries },
      renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER) };
  }
  function invalidate() { if (!pending) { pending = true; requestAnimationFrame(render); } }
  function view(top, regional = false) {
    controls.target.set(0, 0, 0);
    camera.position.set(regional ? 9500 : top ? 0 : 1550, regional ? 10500 : top ? 3100 : 2000,
      regional ? 12500 : top ? 0.1 : 2050);
    controls.update(); invalidate();
  }
  controls.addEventListener('change', invalidate);
  new ResizeObserver(invalidate).observe(canvas.parentElement);
  document.querySelector('#top').addEventListener('click', () => view(true));
  document.querySelector('#oblique').addEventListener('click', () => view(false));
  document.querySelector('#regional').addEventListener('click', () => view(false, true));
  document.querySelector('#close').addEventListener('click',()=>{
    controls.target.set(100,12,650);camera.position.set(650,190,1200);controls.update();invalidate();
  });
  const checked = layer=>document.querySelector(`[data-layer="${layer}"]`).checked;
  function updateVisibility() {
    for (const input of document.querySelectorAll('[data-layer]')) {
      input.disabled=naturalMode || (input.dataset.layer==='vegetation' && !cityMode);
      layers[input.dataset.layer].visible=!naturalMode && input.checked && (input.dataset.layer==='vegetation' ? cityMode : !cityMode);
    }
    decoratedBuildings.visible=!naturalMode && cityMode && checked('buildings');
    cityGround.visible=!naturalMode && cityMode;
    groundMeshes[1].visible=naturalMode || !cityMode;
    document.querySelector('#height-legend').hidden=naturalMode || cityMode;
  }
  document.querySelector('#city-mode').addEventListener('change',event=>{
    cityMode=event.target.checked;updateVisibility();invalidate();
  });
  document.querySelector('#natural-dsm').addEventListener('change', event => {
    naturalMode = event.target.checked;
    updateVisibility();
    labels.visible = !naturalMode;
    patchBorder.visible = !naturalMode;
    updateGround(); invalidate();
  });
  for (const input of document.querySelectorAll('[data-layer]')) {
    input.addEventListener('change', () => {
      const old=cityTexture;
      cityTexture=createCityGround(data,dressing,trees,Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(i=>[i.dataset.layer,i.checked])));
      cityGroundMaterial.map=cityTexture;old.dispose();
      updateVisibility();invalidate();
    });
  }
  const levels = data.features.filter(f => f.height?.source === 'levels-estimate').length;
  for (const [name, value] of [['주변 지형', '12 × 12 km'], ['도시 상세', '2 × 2 km'], ['도로 객체', counts.road], ['건물 객체', counts.building],
    ['주차장 윤곽',dressing.areas.filter(a=>a.kind==='parking').length],['모형 식재',`${trees.length}그루`], ['높이 미상', `${counts.building - levels}개`]]) {
    const dt = document.createElement('dt'); dt.textContent = name;
    const dd = document.createElement('dd'); dd.textContent = value;
    document.querySelector('#counts').append(dt, dd);
  }
  document.querySelector('#coverage').textContent = `구멍이 있거나 불완전한 복합 도형 ${data.stats.excludedRelations}개는 제외했습니다. 원본 데이터와 한계는 문서에 기록했습니다.`;
  status.textContent = '실제 배치에 지면·외벽·식재 표현을 더했습니다. 도시 표현을 끄면 이전 단계와 비교할 수 있습니다.';
  updateVisibility();
  // Review-only sampling measures isolated draw work at the exact current camera.
  window.incheonReview={groundSignature:()=>{
    const pixels=cityTexture.image.getContext('2d').getImageData(0,0,GROUND_TEXTURE_SIZE,GROUND_TEXTURE_SIZE).data;
    let hash=2166136261;
    for(let i=0;i<pixels.length;i+=13) hash=Math.imul(hash^pixels[i],16777619)>>>0;
    return hash;
  },measure:async(count=40)=>{
    if (!Number.isInteger(count)||count<10||count>100) throw new Error('Invalid sample count');
    const gl=renderer.getContext(),samples=[];
    for(let i=0;i<5;i++){renderer.render(scene,camera);gl.finish();}
    for(let i=0;i<count;i++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const start=performance.now();renderer.render(scene,camera);gl.finish();samples.push(performance.now()-start);
    }
    render();
    return {samplesMs:samples,render:{...renderer.info.render},memory:{...renderer.info.memory},
      camera:camera.position.toArray(),target:controls.target.toArray(),viewport:[canvas.width,canvas.height]};
  }};
  view(false, true);
}

start().catch(error => { status.textContent = `미리보기를 불러오지 못했습니다: ${error.message}`; console.error(error); });
