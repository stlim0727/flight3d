import { createDepartureJetBridge } from './DepartureJetBridge.js';
import * as THREE from 'three';
import { createDepartureStand } from './DepartureStand.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colourIncheonGround, createIncheonGroundTexture } from './IncheonGround.js';
import { IncheonTraffic } from './IncheonTraffic.js';
import { IncheonParkedAirliners } from './IncheonParkedAirliners.js';
import { planParkedAirliners } from '../geospatial/incheonParking.js';
import { createControlTower } from './IncheonControlTower.js';
import { loadIncheonTerrain } from '../geospatial/IncheonTerrain.js';
import { IncheonFlightSurface, INCHEON_AIRFIELD } from '../geospatial/IncheonFlightSurface.js';
import { generatePlanting, pointInRing, segmentDistance } from '../geospatial/incheonDressing.js';
import { terrainGeometry, placeBuilding } from '../previews/incheonGeometry.js';
import { createCityGround, createBuildingMaterials, createTexturedBuildings, createPlantingInstances } from '../previews/incheonCityAssets.js';

function shape(points) { return new THREE.Shape(points.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,-z))); }
function pavementShape(surface) {
  const outline = shape(surface.points);
  for (const ring of surface.holes ?? []) outline.holes.push(new THREE.Path(ring.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,-z))));
  return outline;
}
function ribbon(points,width,dashed=false) {
  const v=[];
  for(let i=1;i<points.length;i++) {
    const [x,z]=points[i-1], [bx,bz]=points[i], length=Math.hypot(bx-x,bz-z);
    if(!length) continue;
    const nx=-(bz-z)/length*width/2,nz=(bx-x)/length*width/2;
    const spans = dashed ? Array.from({length:Math.ceil(length/50)},(_,j)=>[j*50,Math.min(length,j*50+30)]) : [[0,length]];
    for (const [start,end] of spans) {
      const ax=x+(bx-x)*start/length,az=z+(bz-z)*start/length;
      const ex=x+(bx-x)*end/length,ez=z+(bz-z)*end/length;
      v.push(ax+nx,0,az+nz,ex+nx,0,ez+nz,ax-nx,0,az-nz,ax-nx,0,az-nz,ex+nx,0,ez+nz,ex-nx,0,ez-nz);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();return g;
}

export async function loadIncheonAirport(base) {
  const json=async file=> {const r=await fetch(base+file);if(!r.ok)throw new Error(`${file}: ${r.status}`);return r.json();};
  const [source,patch,dressing,mask,trafficData]=await Promise.all([loadIncheonTerrain(base),json('patch.json'),json('dressing.json'),new THREE.TextureLoader().loadAsync(base+'land-mask.png'),json('traffic.json')]);
  const terrain=new IncheonFlightSurface(source);
  terrain.mesh=new THREE.Group();
  const group=new THREE.Group();
  const height=(x,z)=>terrain.getHeight(x,z);
  group.add(createDepartureStand(INCHEON_AIRFIELD.elevationM));
  const departureBridge = createDepartureJetBridge(INCHEON_AIRFIELD.elevationM);
  group.add(departureBridge.group);
  const groundMaterial=new THREE.MeshLambertMaterial({vertexColors:true,map:createIncheonGroundTexture(),alphaMap:mask,alphaTest:.5});
  for(const geometry of [terrainGeometry(12000,480,height,true)]) {
    colourIncheonGround(geometry);
    terrain.mesh.add(new THREE.Mesh(geometry,groundMaterial));
  }
  const trees=generatePlanting(patch,dressing).filter(t=>!terrain.isRunwaySafetyArea(t.x,t.z));
  const local=terrainGeometry(2000,160,height);
  const city=new THREE.Mesh(local,new THREE.MeshLambertMaterial({map:createCityGround(patch,dressing,trees)}));
  terrain.mesh.add(city);
  const records=[],colliders=[];
  for(const feature of patch.features.filter(f=>f.kind==='building')) for(const points of feature.parts) {
    const geometry=new THREE.ExtrudeGeometry(shape(points),{depth:feature.height.meters,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);
    const {floor}=placeBuilding(geometry,height,feature.height.meters);
    records.push({feature,geometry,floor});
    geometry.computeBoundingBox();
    colliders.push({points,top:floor+feature.height.meters,bounds:geometry.boundingBox.clone()});
  }
  const tower = createControlTower(height);
  colliders.push(tower.collider);
  group.add(tower.group);
  group.add(createTexturedBuildings(records,createBuildingMaterials()));
  records.forEach(r=>r.geometry.dispose());
  group.add(createPlantingInstances(trees,height));
  const pavementBatches = new Map();
  const batch = (color, geometry) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    if (flat !== geometry) geometry.dispose();
    if (!pavementBatches.has(color)) pavementBatches.set(color, []);
    pavementBatches.get(color).push(flat);
  };
  for(const surface of INCHEON_AIRFIELD.surfaces) {
    const geometry=surface.area?new THREE.ShapeGeometry(pavementShape(surface)):ribbon(surface.points,surface.width);
    if(surface.area)geometry.rotateX(-Math.PI/2);
    geometry.translate(0,INCHEON_AIRFIELD.elevationM+.015,0);
    batch(surface.kind==='runway'?0x55595a:0x92968e,geometry);
    if(!surface.area) {
      const line=ribbon(surface.points,surface.kind==='runway'?.7:.3,surface.kind==='runway');
      line.translate(0,INCHEON_AIRFIELD.elevationM+.03,0);
      batch(surface.kind==='runway'?0xffffff:0xeac75b,line);
    }
  }
  for (const [color, parts] of pavementBatches) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach(g=>g.dispose());
    group.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide})));
  }
  // Threshold bars identify the mapped endpoints; markings are illustrative.
  for(const surface of INCHEON_AIRFIELD.surfaces.filter(s=>s.kind==='runway')) {
    const a=surface.points[0],b=surface.points.at(-1),yaw=-Math.atan2(b[0]-a[0],a[1]-b[1]);
    for(const [i,p] of [a,b].entries()) {
      const bar=new THREE.Mesh(new THREE.BoxGeometry(surface.width, .025, 3),new THREE.MeshBasicMaterial({color:0xffffff}));
      bar.position.set(p[0],7.04,p[1]);bar.rotation.y=yaw;group.add(bar);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.textAlign='center';context.font='bold 85px sans-serif';
      const ref=surface.ref.split('/')[i];
      context.fillText(ref.slice(0,2),64,110);context.font='bold 75px sans-serif';context.fillText(ref.slice(2),64,205);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const marking=new THREE.Mesh(new THREE.PlaneGeometry(20,40),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
      marking.rotation.set(-Math.PI/2,0,0);
      marking.rotateOnWorldAxis(new THREE.Vector3(0,1,0),yaw+(i?Math.PI:0));
      const direction=i?-1:1,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      marking.position.set(p[0]+direction*(b[0]-a[0])/length*160,7.05,p[1]+direction*(b[1]-a[1])/length*160);
      group.add(marking);
    }
  }
  group.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});
  const traffic=new IncheonTraffic(trafficData,height,(x,z)=>source.isLand(x,z) && !terrain.isOnRunway(x,z)
    && !colliders.some(c=>x>=c.bounds.min.x-1 && x<=c.bounds.max.x+1 && z>=c.bounds.min.z-1 && z<=c.bounds.max.z+1
      && (pointInRing(x,z,c.points) || c.points.slice(1).some((b,i)=>segmentDistance(x,z,c.points[i],b)<1))));
  group.add(traffic.mesh);
  const parked=new IncheonParkedAirliners(planParkedAirliners(INCHEON_AIRFIELD,patch),INCHEON_AIRFIELD.elevationM);
  group.add(parked.group);parked.load(import.meta.env?.BASE_URL??'/');
  return {terrain,group,departureBridge,isOnRunway:(x,z)=>terrain.isOnRunway(x,z),isRunwaySafetyArea:(x,z)=>terrain.isRunwaySafetyArea(x,z),traffic,parked,
    towerCab:tower.cab,
    resetTraffic(){traffic.reset();},
    update(dt,position,time,options={}){traffic.update(dt,options.cameraPosition??position,options.quality,options.paused);parked.update(options.cameraPosition??position,options.quality);},
    checkBuildingCollision(probes) {
      for(const p of probes) for(const c of colliders) {
        if(p.pos.y-p.radius>c.top || p.pos.y+p.radius<c.bounds.min.y
          || p.pos.x<c.bounds.min.x-p.radius || p.pos.x>c.bounds.max.x+p.radius
          || p.pos.z<c.bounds.min.z-p.radius || p.pos.z>c.bounds.max.z+p.radius)continue;
        if(pointInRing(p.pos.x,p.pos.z,c.points)||c.points.slice(1).some((b,i)=>segmentDistance(p.pos.x,p.pos.z,c.points[i],b)<=p.radius))return {point:p.pos.clone(),get part(){return p.desc;}};
      }
      return parked.checkCollision(probes);
    }};
}
