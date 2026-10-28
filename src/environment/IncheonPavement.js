import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function ring(points) { return new THREE.Shape(points.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,-z))); }

export function pavementRibbon(points,width,dashed=false) {
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

export function pavementSurfaceGeometry(surface) {
  if (!surface.area) return pavementRibbon(surface.points,surface.width);
  const outline=ring(surface.points);
  for(const hole of surface.holes??[])outline.holes.push(new THREE.Path(hole.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,-z))));
  const geometry=new THREE.ShapeGeometry(outline);geometry.rotateX(-Math.PI/2);return geometry;
}

const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
const bounds=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[2])),maxZ:Math.max(...points.map(p=>p[2]))});
const overlaps=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
function triangles(geometry) {
  const p=geometry.attributes.position,index=geometry.index,result=[];
  for(let i=0;i<(index?.count??p.count);i+=3)result.push([0,1,2].map(j=>{
    const k=index?index.getX(i+j):i+j;return [p.getX(k),p.getY(k),p.getZ(k)];
  }));
  return result;
}

function halfPlane(polygon,a,b,sign,inside) {
  const output=[];
  for(let i=0;i<polygon.length;i++) {
    const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign;
    const keepP=inside?dp>=0:dp<=0,keepQ=inside?dq>=0:dq<=0;
    if(keepP)output.push(p);
    if(keepP!==keepQ) {
      const t=dp/(dp-dq);output.push(p.map((v,j)=>v+(q[j]-v)*t));
    }
  }
  return output;
}

/** Subtract the rendered runway triangles, retaining every outside polygon.
 * This changes only the visible color partition, never the paved union or Y.
 */
function excludeRunways(geometry,masks) {
  let polygons=triangles(geometry);
  for(const mask of masks) {
    const next=[];
    for(const polygon of polygons) {
      if(!overlaps(bounds(polygon),mask.bounds)){next.push(polygon);continue;}
      let candidate=polygon;
      for(let i=0;i<3&&candidate.length>=3;i++) {
        const a=mask.points[i],b=mask.points[(i+1)%3];
        const outside=halfPlane(candidate,a,b,mask.sign,false);
        if(outside.length>=3)next.push(outside);
        candidate=halfPlane(candidate,a,b,mask.sign,true);
      }
    }
    polygons=next;
  }
  const vertices=[];
  for(const polygon of polygons)for(let i=1;i<polygon.length-1;i++) {
    if(Math.abs(cross(polygon[0],polygon[i],polygon[i+1]))>1e-8)vertices.push(...polygon[0],...polygon[i],...polygon[i+1]);
  }
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));result.computeVertexNormals();
  geometry.dispose();return result;
}

export function createIncheonPavement(field) {
  const group=new THREE.Group();group.name='incheon-pavement';
  const surfaces=field.surfaces.map(surface=>({surface,geometry:pavementSurfaceGeometry(surface)}));
  const masks=surfaces.filter(({surface})=>surface.kind==='runway').flatMap(({geometry})=>triangles(geometry))
    .filter(points=>Math.abs(cross(...points))>1e-8).map(points=>({points,bounds:bounds(points),sign:Math.sign(cross(...points))}));
  const batches=new Map();
  const batch=(name,color,geometry)=>{
    const flat=geometry.index?geometry.toNonIndexed():geometry;flat.deleteAttribute('uv');
    if(flat!==geometry)geometry.dispose();
    if(!batches.has(name))batches.set(name,{color,parts:[]});batches.get(name).parts.push(flat);
  };
  for(const {surface,geometry:source} of surfaces) {
    const runway=surface.kind==='runway';
    const geometry=runway?source:excludeRunways(source,masks);
    geometry.translate(0,field.elevationM+.015,0);
    batch(runway?'runway':'taxiway',runway?0x55595a:0x92968e,geometry);
    if(!surface.area) {
      const line=pavementRibbon(surface.points,runway?.7:.3,runway);
      line.translate(0,field.elevationM+.03,0);
      batch(runway?'runway-marking':'taxiway-marking',runway?0xffffff:0xeac75b,line);
    }
  }
  for(const [name,{color,parts}] of batches) {
    const geometry=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());
    const mesh=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));
    mesh.name=`incheon-${name}-pavement`;group.add(mesh);
  }
  return group;
}
