import { buildSihwaBridges } from '../geospatial/sihwaBridges.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colourIncheonGround, createIncheonGroundTexture } from './IncheonGround.js';
import { SihwaRegion } from '../geospatial/SihwaRegion.js';

/** Source-positioned landmarks, with deliberately lightweight procedural exteriors. */
export function createSihwaScenery(region) {
  const group=new THREE.Group();group.name='Sihwa regional scenery';
  const land=region.geometry;
  const uv=new Float32Array(region.positions.length/3*2);
  for(let i=0;i<uv.length/2;i++){uv[i*2]=(region.positions[i*3]+25000)/50000;uv[i*2+1]=1-(region.positions[i*3+2]+25000)/50000;}
  land.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  colourIncheonGround(land);
  group.add(new THREE.Mesh(land,new THREE.MeshLambertMaterial({vertexColors:true,map:createIncheonGroundTexture(50000)})));
  const batches=new Map(),colliders=[];
  const features=region.features.features;
  const feature=kind=>features.find(f=>f.kind===kind);
  const add=(color,geometry)=>{if(!batches.has(color))batches.set(color,[]);const g=geometry.index?geometry.toNonIndexed():geometry;g.deleteAttribute('uv');batches.get(color).push(g);if(g!==geometry)geometry.dispose();};
  const box=(x,y,z,w,h,d,color,yaw=0)=>{const g=new THREE.BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);add(color,g);};
  const cylinder=(x,y,z,rt,rb,h,color,segments=24)=>{const g=new THREE.CylinderGeometry(rt,rb,h,segments);g.translate(x,y,z);add(color,g);};
  const circle=(x,z,r,n=24)=>Array.from({length:n+1},(_,i)=>[x+r*Math.cos(i/n*Math.PI*2),z+r*Math.sin(i/n*Math.PI*2)]);
  const collider=(points,floor,top)=>colliders.push({points,top,bounds:new THREE.Box3(new THREE.Vector3(Math.min(...points.map(p=>p[0])),floor,Math.min(...points.map(p=>p[1]))),new THREE.Vector3(Math.max(...points.map(p=>p[0])),top,Math.max(...points.map(p=>p[1]))))});
  const pad=kind=>region.metadata.pads.find(p=>p.name===kind).baseM;
  const footprint=(f,height,color,base)=>{
    const s=new THREE.Shape(f.points.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,-z)));
    const g=new THREE.ExtrudeGeometry(s,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,base,0);add(color,g);
    collider(f.points,base,base+height);
  };
  // Frozen overlay vertices lie on the same triangle planes as the land mesh.
  for(const [name,array] of Object.entries(region.overlays)) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(array,3));g.computeVertexNormals();
    add(name==='sand'?0xcdbb8f:0x60656a,g);
  }
  // The generation building follows the actual mapped station footprint.
  const plant=feature('plant'),base=pad('plant');
  footprint(plant,8,0xa5afad,base);
  const pp=plant.points.slice(0,-1),cx=plant.center[0],cz=plant.center[1];
  let xx=0,xz=0,zz=0;
  for(const [x,z] of pp){xx+=(x-cx)**2;xz+=(x-cx)*(z-cz);zz+=(z-cz)**2;}
  const angle=.5*Math.atan2(2*xz,xx-zz),dx=Math.cos(angle),dz=Math.sin(angle);
  const along=pp.map(([x,z])=>(x-cx)*dx+(z-cz)*dz),lo=Math.min(...along),hi=Math.max(...along);
  for(let i=0;i<region.metadata.architecture.generatorUnits;i++) {
    const u=lo+(hi-lo)*(i+.5)/10;
    cylinder(cx+dx*u,base+9.5,cz+dz*u,6,7,3,0x607e91,16);
    cylinder(cx+dx*u,base+11.2,cz+dz*u,3.8,4.5,.5,0xc6d0cf,16);
    collider(circle(cx+dx*u,cz+dz*u,7,16),base+8,base+11.45);
  }
  // Circular footprint from OSM; 75m total height from the official visitor guide.
  const tower=features.find(f=>f.id==='way/1038767380');
  const [tx,tz]=tower.center,tb=pad('plaza'),th=region.metadata.architecture.towerHeightM;
  const radius=Math.sqrt(Math.abs(tower.points.slice(1).reduce((a,p,i)=>a+tower.points[i][0]*p[1]-p[0]*tower.points[i][1],0))/2/Math.PI);
  cylinder(tx,tb+32,tz,3.1,3.7,64,0xc5c7bf);
  box(tx+1.9,tb+33,tz,1,62,3.6,0x476777);
  cylinder(tx,tb+65,tz,radius*.91,3.2,4,0x8d9692);
  cylinder(tx,tb+67.5,tz,radius,radius*.91,1,0xc7cfca);
  cylinder(tx,tb+70.2,tz,radius,radius,4.4,0x324f61,40);
  cylinder(tx,tb+72.7,tz,radius*.96,radius,1,0xbac5c4,40);
  cylinder(tx,tb+73.7,tz,3.5,4.2,1,0x8b9998);
  box(tx,tb+th-.5,tz,2,1,2,0xd4d3c6);
  for(let i=0;i<32;i++) {
    const a=i/32*Math.PI*2;
    box(tx+Math.cos(a)*radius,tb+70.2,tz+Math.sin(a)*radius,.16,4.4,.16,0xb8c7c9);
  }
  collider(circle(tx,tz,3.7),tb,tb+64);
  collider(circle(tx,tz,radius),tb+63,tb+73.2);
  collider(circle(tx,tz,4.2),tb+73.2,tb+th);
  for(const f of features.filter(f=>f.kind==='building' && !['way/1038767380','way/1038767381'].includes(f.id))) {
    const floor=f.id==='way/1038767376'?pad('park'):tb;
    footprint(f,f.id==='way/1038767379'?9:6,0xb1bab6,floor);
  }
  // Only source-tagged bridge spans cross open water. Deck contact triangles are
  // the very same geometry as the visible bridge, with gradual bank approaches.
  const bridges=buildSihwaBridges(region);
  if(bridges.positions.length) {
    const p=bridges.positions,ids=Uint32Array.from({length:p.length/3},(_,i)=>i);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.computeVertexNormals();
    add(0x656b70,geometry);
    region.additionalSurfaces.push(new SihwaRegion(region.metadata,p,ids,region.coreCoastline,{features:[],roads:[]}));
    group.userData.bridgeApproaches=bridges.approaches;
    // Preserve the existing simple pier exteriors beneath the mapped spans.
    for(const road of region.features.roads.filter(r=>r.bridge))for(let i=1;i<road.points.length;i++) {
      const [x,z]=road.points[i-1],[ex,ez]=road.points[i];
      if(Math.hypot(ex-x,ez-z)<=15)continue;
      const y=region.additionalSurfaces.at(-1).getHeight((x+ex)/2,(z+ez)/2);
      cylinder((x+ex)/2,y/2,(z+ez)/2,1.3,1.6,y,0x8c9696,8);
    }
  }
  for(const [color,parts] of batches) {
    const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
    const mesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color}));
    mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData.landmarks={tower:{x:tx,y:tb+th,z:tz},plant:{x:cx,y:base,z:cz},beach:feature('beach').center};
  return {group,colliders};
}
