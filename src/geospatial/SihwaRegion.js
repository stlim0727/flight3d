import * as THREE from 'three';
import { IncheonTerrain } from './IncheonTerrain.js';

/** A land-only indexed mesh is shared by the renderer and ground contacts. */
export class SihwaRegion {
  constructor(metadata, positions, indices, coreCoastline, features) {
    if (metadata.schemaVersion !== 1 || positions.length % 3 || indices.length % 3
      || !positions.every(Number.isFinite) || !indices.every(i=>i<positions.length/3)) throw new Error('Invalid Sihwa terrain');
    this.metadata=metadata;
    this.additionalSurfaces=[];
    this.overlays={};
    this.features=features;
    this.coreCoastline=coreCoastline;
    this.coreLand=new IncheonTerrain({schemaVersion:1,grids:{}},{},coreCoastline);
    this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices,1));
    this.geometry.computeVertexNormals();
    this.positions=positions;this.indices=indices;
    // Spatial buckets avoid scanning the regional mesh on every wheel query.
    this.cells=new Map();
    for(let i=0;i<indices.length;i+=3) {
      const p=[indices[i]*3,indices[i+1]*3,indices[i+2]*3];
      const minX=Math.floor(Math.min(...p.map(j=>positions[j]))/100),maxX=Math.floor(Math.max(...p.map(j=>positions[j]))/100);
      const minZ=Math.floor(Math.min(...p.map(j=>positions[j+2]))/100),maxZ=Math.floor(Math.max(...p.map(j=>positions[j+2]))/100);
      for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++) {
        const key=`${x},${z}`;
        if(!this.cells.has(key))this.cells.set(key,[]);
        this.cells.get(key).push(i);
      }
    }
  }

  isCoreLand(x,z) {return this.coreLand.isLand(x,z);}

  getHeight(x,z) {
    return Math.max(this.groundHeight(x,z),...this.additionalSurfaces.map(s=>s.getHeight(x,z)));
  }

  groundHeight(x,z) {
    if(![x,z].every(Number.isFinite))throw new Error('Invalid regional coordinate');
    const triangles=this.cells.get(`${Math.floor(x/100)},${Math.floor(z/100)}`)??[];
    const p=this.positions,ids=this.indices;
    for(const i of triangles) {
      const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3;
      const bx=p[b]-p[a],bz=p[b+2]-p[a+2],cx=p[c]-p[a],cz=p[c+2]-p[a+2];
      const det=bx*cz-bz*cx;
      if(Math.abs(det)<1e-8)continue;
      const dx=x-p[a],dz=z-p[a+2],u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;
      if(u>=-1e-5 && v>=-1e-5 && u+v<=1.00001)return p[a+1]*(1-u-v)+p[b+1]*u+p[c+1]*v;
    }
    return 0;
  }
}

export async function loadSihwaRegion(base) {
  const read=async file=>{const r=await fetch(`${base}sihwa/${file}`);if(!r.ok)throw new Error(`Sihwa ${file}: ${r.status}`);return r;};
  const [metadata,coast,features]=await Promise.all(['metadata.json','core-coastline.json','features.json'].map(async f=>(await read(f)).json()));
  const arrays=await Promise.all(['positions','indices'].map(async(name)=>{
    const d=metadata.geometry[name],buffer=await(await read(d.file)).arrayBuffer();
    if(buffer.byteLength!==d.count*4)throw new Error(`Invalid Sihwa ${name} length`);
    const view=new DataView(buffer),array=name==='positions'?new Float32Array(d.count):new Uint32Array(d.count);
    for(let i=0;i<array.length;i++)array[i]=name==='positions'?view.getFloat32(i*4,true):view.getUint32(i*4,true);
    return array;
  }));
  const region=new SihwaRegion(metadata,...arrays,coast,features);
  await Promise.all(Object.entries(metadata.geometry.overlays).map(async([name,d])=>{
    const buffer=await(await read(d.file)).arrayBuffer();
    if(buffer.byteLength!==d.count*4)throw new Error(`Invalid Sihwa ${name} overlay`);
    const view=new DataView(buffer),array=new Float32Array(d.count);
    for(let i=0;i<array.length;i++)array[i]=view.getFloat32(i*4,true);
    region.overlays[name]=array;
  }));
  return region;
}
