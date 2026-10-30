import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTreeGeometry } from '../environment/TreeModels.js';
import { roadWidth } from '../geospatial/incheonDressing.js';

export const GROUND_TEXTURE_SIZE = 2048;

function trace(context, points, close = false) {
  context.beginPath(); context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  if (close) context.closePath();
}

/** One bounded city-ground atlas; roads/parking markings do not add draw calls. */
export function createCityGround(patch, dressing, trees, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GROUND_TEXTURE_SIZE;
  const c = canvas.getContext('2d');
  const scale = GROUND_TEXTURE_SIZE / 2000;
  c.setTransform(scale, 0, 0, scale, GROUND_TEXTURE_SIZE/2, GROUND_TEXTURE_SIZE/2);
  c.fillStyle = '#b6b89d'; c.fillRect(-1000,-1000,2000,2000);
  const fill = (ring, color) => { trace(c,ring,true); c.fillStyle=color; c.fill(); };
  const stroke = (points, color, width) => { trace(c,points); c.strokeStyle=color; c.lineWidth=width; c.stroke(); };
  const surfaces = patch.features.filter(f => f.area && f.kind !== 'building' && (['apron','road','runway','taxiway'].includes(f.kind) ? options.roads !== false : options.surfaces !== false));
  for (const feature of surfaces) {
    const colors = { water:'#80a9b3', park:'#78905c', apron:'#b5b8b2', runway:'#5a605e', taxiway:'#9da39c', road:'#666d6a' };
    const land = { grass:'#91a477', commercial:'#c3bfab', tourism:'#c3bfab' };
    for (const ring of feature.parts) fill(ring, colors[feature.kind] ?? land[feature.landuse] ?? '#a8ae90');
  }
  for (const area of dressing.areas) {
    if (area.kind==='airfield') continue;
    if (area.kind==='garden' ? options.surfaces===false : options.roads===false) continue;
    if (area.kind === 'garden') { fill(area.ring,'#78905c'); continue; }
    fill(area.ring,'#666f6d');
    // Longest outline edge gives an illustrative row orientation, not surveyed bays.
    let angle=0, longest=0;
    for (let i=1;i<area.ring.length;i++) {
      const a=area.ring[i-1], b=area.ring[i], length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if (length>longest) { longest=length; angle=Math.atan2(b[1]-a[1],b[0]-a[0]); }
    }
    const cx=area.ring.reduce((s,p)=>s+p[0],0)/area.ring.length;
    const cz=area.ring.reduce((s,p)=>s+p[1],0)/area.ring.length;
    const radius=Math.max(...area.ring.map(p=>Math.hypot(p[0]-cx,p[1]-cz)))+10;
    c.save(); trace(c,area.ring,true); c.clip(); c.translate(cx,cz); c.rotate(angle);
    c.beginPath(); c.lineWidth=.22; c.strokeStyle='#c5c8b8';
    for (let row=-radius;row<radius;row+=16) {
      c.moveTo(-radius,row);c.lineTo(radius,row);
      c.moveTo(-radius,row+5);c.lineTo(radius,row+5);
      for (let x=-radius;x<radius;x+=2.6) { c.moveTo(x,row);c.lineTo(x,row+5); }
    }
    c.stroke(); c.restore();
  }
  const paths = options.roads===false ? [] : patch.features.filter(f=>!f.area && ['road','runway','taxiway'].includes(f.kind));
  const footway = f=>['footway','path','steps','pedestrian'].includes(f.highway);
  for (const feature of paths) for (const points of feature.parts) {
    const width=roadWidth(feature);
    if (feature.kind==='road') stroke(points,footway(feature)?'#c5bfaa':'#b5b9ad',width+1.2);
  }
  for (const feature of paths) for (const points of feature.parts) {
    const width=roadWidth(feature);
    stroke(points,feature.kind==='runway'?'#5a605e':feature.kind==='taxiway'?'#999f98':footway(feature)?'#c9c0a5':'#626c69',width);
  }
  for (const feature of paths) for (const points of feature.parts) {
    if (feature.kind==='taxiway') stroke(points,'#d4ba66',.3);
    else if (feature.kind==='runway') { c.setLineDash([12,12]);stroke(points,'#d8dacf',.6);c.setLineDash([]); }
    else if (['motorway','trunk','primary','secondary','tertiary'].includes(feature.highway)) {
      c.setLineDash([4,6]);stroke(points,'#d6d3b9',.22);c.setLineDash([]);
    }
  }
  // Subtle baked midday contact shade, not a live shadow/lighting simulation.
  if (options.buildings!==false) for (const feature of patch.features.filter(f=>f.kind==='building')) for (const ring of feature.parts) fill(ring.map(([x,z])=>[x+4,z-3]),'#00000022');
  if (options.vegetation!==false) for (const tree of trees) { c.beginPath();c.ellipse(tree.x+2,tree.z-1,2.8*tree.scale,4*tree.scale,-.5,0,Math.PI*2);c.fillStyle='#283a2628';c.fill(); }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;
  return texture;
}

function facade(glass, emission = false) {
  const size=256, pixels=new Uint8Array(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const u=x%64, v=y%128;
    const window = u>10 && u<55 && v>28 && v<104;
    const frame = u<4 || v<5;
    const rgb=emission ? ((glass ? !frame : window) ? [255,255,255] : [0,0,0]) : glass ? (frame?[139,156,158]:[72+(x%13),103+(y%9),113+(x%11)])
      : window?[66,86,91]:[frame?188:208,frame?188:205,frame?179:192];
    pixels.set([...rgb,255],(y*size+x)*4);
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.needsUpdate=true;
  return texture;
}

export function createBuildingMaterials() {
  return {
    glass: new THREE.MeshLambertMaterial({ name:'airport-window-glass', map:facade(true), color:0xc5d1d0, emissiveMap:facade(true,true), emissiveIntensity:0 }),
    masonry: new THREE.MeshLambertMaterial({ name:'airport-window-masonry', map:facade(false), color:0xe6e1d6, emissiveMap:facade(false,true), emissiveIntensity:0 }),
    roof: new THREE.MeshLambertMaterial({ color:0xc4c8c5 }),
  };
}

/** World-meter UVs keep windows at a plausible scale on long terminal walls. */
export function splitBuilding(geometry, floor) {
  const flat=geometry.index?geometry.toNonIndexed():geometry;
  const p=flat.attributes.position, n=flat.attributes.normal;
  const parts={ walls:[], roof:[] }, normals={walls:[],roof:[]}, uvs={walls:[],roof:[]};
  for (let i=0;i<p.count;i+=3) {
    const roof=Math.abs(n.getY(i))>.7;
    const key=roof?'roof':'walls';
    for (let j=i;j<i+3;j++) {
      const x=p.getX(j),y=p.getY(j),z=p.getZ(j);
      parts[key].push(x,y,z);normals[key].push(n.getX(j),n.getY(j),n.getZ(j));
      uvs[key].push(roof?x/12:Math.abs(n.getX(j))>.5?z/8:x/8, roof?z/12:(y-floor)/6);
    }
  }
  if (flat!==geometry) flat.dispose();
  return Object.fromEntries(Object.keys(parts).map(key=> {
    const result=new THREE.BufferGeometry();
    result.setAttribute('position',new THREE.Float32BufferAttribute(parts[key],3));
    result.setAttribute('normal',new THREE.Float32BufferAttribute(normals[key],3));
    result.setAttribute('uv',new THREE.Float32BufferAttribute(uvs[key],2));
    return [key,result];
  }));
}

export function createTexturedBuildings(records, materials) {
  const buckets={ glass:[],masonry:[],roof:[] };
  for (const {feature,geometry,floor} of records) {
    const parts=splitBuilding(geometry,floor);
    const style=feature.id==='relation/3917466'||feature.height.meters>=12?'glass':'masonry';
    buckets[style].push(parts.walls);buckets.roof.push(parts.roof);
  }
  const group=new THREE.Group();
  for (const [style,parts] of Object.entries(buckets)) {
    if (!parts.length) continue;
    const merged=mergeGeometries(parts,false);
    parts.forEach(g=>g.dispose());
    if (!merged) throw new Error('Building facade merge failed');
    group.add(new THREE.Mesh(merged,materials[style]));
  }
  return group;
}

export function createPlantingInstances(trees, getHeight) {
  const geometry=createTreeGeometry('oak',false);
  const material=new THREE.MeshLambertMaterial({vertexColors:true});
  const mesh=new THREE.InstancedMesh(geometry,material,trees.length);
  const transform=new THREE.Object3D();
  trees.forEach((tree,i)=>{
    transform.position.set(tree.x,getHeight(tree.x,tree.z),tree.z);
    transform.scale.setScalar(tree.scale);transform.rotation.y=i*2.399963;
    transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
  return mesh;
}
