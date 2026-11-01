import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareTrafficRoute, sampleTrafficPose } from '../geospatial/incheonTraffic.js';

export const TRAFFIC_QUALITY = Object.freeze({
  high: { limit:64, distance:1200 },
  balanced: { limit:40, distance:900 },
  performance: { limit:20, distance:600 },
  ultraLow: { limit:10, distance:400 },
});
const MAX_CARS=64;

function carGeometry() {
  const parts=[];
  const add=(geometry,color,x,y,z)=>{
    geometry.translate(x,y,z);
    const flat=geometry.index?geometry.toNonIndexed():geometry;
    flat.deleteAttribute('uv');
    const c=new THREE.Color(color),values=new Float32Array(flat.attributes.position.count*3);
    for(let i=0;i<values.length;i+=3)values.set([c.r,c.g,c.b],i);
    flat.setAttribute('color',new THREE.BufferAttribute(values,3));parts.push(flat);
    if(flat!==geometry)geometry.dispose();
  };
  add(new THREE.BoxGeometry(1.8,.95,4.2),0xffffff,0,.9,0);
  add(new THREE.BoxGeometry(1.55,.65,2.15),0x263b49,0,1.65,-.1);
  for(const x of [-.9,.9])for(const z of [-1.3,1.3]) {
    const wheel=new THREE.CylinderGeometry(.34,.34,.2,8);wheel.rotateZ(Math.PI/2);
    add(wheel,0x181b1d,x,.34,z);
  }
  const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());return geometry;
}

/** Visual-only traffic. No vehicle collision, intersections, lights or traffic AI. */
export class IncheonTraffic {
  constructor(data,getHeight,isSafe) {
    if(data?.schemaVersion!==1 || !Array.isArray(data.routes) || !data.routes.length)throw new Error('Invalid traffic routes');
    this.routes=data.routes.map(r=>prepareTrafficRoute(r,getHeight,isSafe)).filter(Boolean);
    this.enabled=true;
    this.elapsed=0;
    this.mesh=new THREE.InstancedMesh(carGeometry(),new THREE.MeshLambertMaterial({vertexColors:true}),MAX_CARS);
    this.mesh.name='Incheon local road traffic';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // CPU distance selection packs nearby instances; a stale GPU bound must not cull moving cars.
    this.mesh.frustumCulled=false;
    this.mesh.count=0;
    this.mesh.visible=false;
    this.transform=new THREE.Object3D();
    this.pose={};this.before={};this.after={};
    this.palette=[0xe9ece8,0xaac1d0,0xd9b79f,0x939caa,0xd1cdb5,0xbeb7c8].map(c=>new THREE.Color(c));
    this.cars=this.routes.flatMap((route,r)=>Array.from({length:Math.min(8,Math.floor(route.length/45))},(_,i)=>({
      route,phase:i/Math.min(8,Math.floor(route.length/45)),speed:5+(r%3),color:(r+i)%this.palette.length,
    }))).slice(0,MAX_CARS);
  }

  reset() { this.elapsed=0; }

  update(dt,cameraPosition,quality='balanced',paused=false) {
    if(!paused && Number.isFinite(dt) && dt>0)this.elapsed+=Math.min(dt,.1);
    const config=TRAFFIC_QUALITY[quality]??TRAFFIC_QUALITY.balanced;
    let count=0;
    if(this.enabled)for(const car of this.cars) {
      if(count>=config.limit)break;
      const {route}=car;
      if(Math.hypot(cameraPosition.x-route.center.x,cameraPosition.z-route.center.z)>config.distance+route.radius)continue;
      const distance=car.phase*route.length+this.elapsed*car.speed;
      const pose=sampleTrafficPose(route,distance,this.pose);
      const range=Math.hypot(cameraPosition.x-pose.x,cameraPosition.y-pose.y,cameraPosition.z-pose.z);
      if(range>=config.distance)continue;
      const before=sampleTrafficPose(route,distance-2,this.before),after=sampleTrafficPose(route,distance+2,this.after);
      this.transform.position.set(pose.x,pose.y+.06,pose.z);
      this.transform.rotation.set(Math.atan2(after.y-before.y,4),-Math.atan2(after.x-before.x,-(after.z-before.z)),0,'YXZ');
      // Continuous disappearance at the distance limit avoids a car-size pop.
      this.transform.scale.setScalar(Math.min(1,(config.distance-range)/80));
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(count,this.transform.matrix);
      this.mesh.setColorAt(count,this.palette[car.color]);
      count++;
    }
    this.mesh.count=count;this.mesh.visible=count>0;
    if(count){this.mesh.instanceMatrix.needsUpdate=true;this.mesh.instanceColor.needsUpdate=true;}
    return count;
  }
}
