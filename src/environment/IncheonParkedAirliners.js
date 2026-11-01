import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { loadParkedAirlinerAssets } from './ParkedAirlinerAssets.js';
import { createRunwayMarkingMaterial } from './RunwayMarkings.js';
import { PARKED_RADIUS } from '../geospatial/incheonParking.js';

export const PARKED_QUALITY = {
  high:{limit:48,distance:2200}, balanced:{limit:32,distance:1600}, performance:{limit:16,distance:1000}, ultraLow:{limit:8,distance:600},
};

function standPaint() {
  const line=new THREE.PlaneGeometry(.16,43);line.rotateX(-Math.PI/2);line.translate(0,-3.465,4.5);
  const stop=new THREE.PlaneGeometry(7,.22);stop.rotateX(-Math.PI/2);stop.translate(0,-3.465,-12.5);
  const geometry=mergeGeometries([line,stop],false);line.dispose();stop.dispose();return geometry;
}

/** Static exterior instances. Occupancy and collision remain independent of visual culling. */
export class IncheonParkedAirliners {
  constructor(stands,elevation) {
    this.stands=stands;this.elevation=elevation;this.group=new THREE.Group();this.group.name='incheon-parked-airliners';
    this.loaded=false;this.disposed=false;this.loadError=null;this.visibleCount=0;this.visibleIds=[];
    this.camera=new THREE.Vector3();this.quality='balanced';this.batches=new Map();this.grid=new Map();
    this.localPoint=new THREE.Vector3();this.closest={point:new THREE.Vector3()};
    for(const stand of stands) {
      const key=`${Math.floor(stand.x/100)},${Math.floor(stand.z/100)}`;
      if(!this.grid.has(key))this.grid.set(key,[]);this.grid.get(key).push(stand);
      stand.matrix=new THREE.Matrix4().compose(new THREE.Vector3(stand.x,elevation+3.5,stand.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),stand.yaw),new THREE.Vector3(1,1,1));
    }
  }

  load(baseUrl='/',loader=loadParkedAirlinerAssets) {
    if(this.ready)return this.ready;
    this.ready=loader(baseUrl).then(assets=>{
      this.assets=assets;
      if(this.disposed){this.releaseAssets();return false;}
      this.installAssets(assets);return true;
    }).catch(error=>{this.loadError=error.message;console.warn('Parked airliners unavailable:',error.message);return false;});
    return this.ready;
  }

  installAssets(assets) {
    this.assets=assets;
    const instance=(geometry,material,count,name)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name=name;
      mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow=true;this.group.add(mesh);return mesh;
    };
    for(const [airline,materials] of Object.entries(assets.liveries)) {
      const count=this.stands.filter(s=>s.airline===airline).length;if(!count)continue;
      const body=instance(assets.geometry,materials.body,count,`parked-${airline}-737`);body.castShadow=true;
      const decal=instance(assets.decals,materials.decal,count,`parked-${airline}-titles`);
      this.batches.set(airline,{body,decal});
    }
    this.gearMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65,metalness:.15});
    this.gear=instance(assets.gear,this.gearMaterial,this.stands.length,'parked-737-gear');this.gear.castShadow=true;
    this.paintGeometry=standPaint();this.paintMaterial=createRunwayMarkingMaterial({color:0xe9c34b,roughness:.9});
    this.paint=instance(this.paintGeometry,this.paintMaterial,this.stands.length,'parked-stand-lead-ins');
    const collisionParts=[assets.geometry,assets.gear].map(source=>{
      const g=source.clone();for(const key of Object.keys(g.attributes))if(key!=='position')g.deleteAttribute(key);return g;
    });
    this.collisionGeometry=mergeGeometries(collisionParts,false);collisionParts.forEach(g=>g.dispose());
    this.bvh=new MeshBVH(this.collisionGeometry);
    this.loaded=true;this.update(this.camera,this.quality);
  }

  update(cameraPosition,quality='balanced') {
    this.camera.copy(cameraPosition);this.quality=quality;
    if(!this.loaded||this.disposed)return 0;
    const config=PARKED_QUALITY[quality]??PARKED_QUALITY.balanced;
    const chosen=this.stands.map(stand=>({stand,distance:Math.hypot(cameraPosition.x-stand.x,cameraPosition.z-stand.z)}))
      .filter(row=>row.distance<config.distance).sort((a,b)=>a.distance-b.distance).slice(0,config.limit).map(row=>row.stand);
    const key=quality+':'+chosen.map(s=>s.id).join(',');if(key===this.selectionKey)return this.visibleCount;
    this.selectionKey=key;const counts=new Map();
    for(const pair of this.batches.values()){pair.body.count=0;pair.decal.count=0;pair.body.castShadow=quality!=='performance'&&quality!=='ultraLow';}
    for(const [i,stand] of chosen.entries()) {
      const pair=this.batches.get(stand.airline),index=counts.get(stand.airline)??0;
      pair.body.setMatrixAt(index,stand.matrix);pair.decal.setMatrixAt(index,stand.matrix);
      pair.body.count=pair.decal.count=index+1;counts.set(stand.airline,index+1);
      this.gear.setMatrixAt(i,stand.matrix);this.paint.setMatrixAt(i,stand.matrix);
    }
    this.gear.count=this.paint.count=chosen.length;this.gear.castShadow=quality!=='performance'&&quality!=='ultraLow';
    for(const mesh of this.group.children){mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;}
    this.visibleIds=chosen.map(s=>s.id);this.visibleCount=chosen.length;return chosen.length;
  }

  checkCollision(probes) {
    if(!this.loaded||this.disposed)return null;
    for(const probe of probes) {
      if(probe.pos.y-probe.radius>this.elevation+13 || probe.pos.y+probe.radius<this.elevation)continue;
      const gx=Math.floor(probe.pos.x/100),gz=Math.floor(probe.pos.z/100);
      for(let x=gx-1;x<=gx+1;x++)for(let z=gz-1;z<=gz+1;z++)for(const stand of this.grid.get(`${x},${z}`)??[]) {
        const dx=probe.pos.x-stand.x,dz=probe.pos.z-stand.z;
        if(dx*dx+dz*dz>(PARKED_RADIUS+probe.radius)**2)continue;
        const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw);
        this.localPoint.set(c*dx-s*dz,probe.pos.y-this.elevation-3.5,s*dx+c*dz);
        const nearest=this.bvh.closestPointToPoint(this.localPoint,this.closest,0,probe.radius);
        if(nearest&&nearest.distance<=probe.radius)return {point:probe.pos.clone(),get part(){return probe.desc;}};
      }
    }
    return null;
  }

  releaseAssets() {
    if(!this.assets)return;
    for(const key of ['geometry','decals','gear'])this.assets[key].dispose();
    for(const pair of Object.values(this.assets.liveries)){pair.body.dispose();pair.decal.dispose();}
    for(const texture of this.assets.textures)texture.dispose();this.assets=null;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    for(const mesh of this.group.children)mesh.dispose?.();
    this.group.clear();this.collisionGeometry?.dispose();this.paintGeometry?.dispose();this.paintMaterial?.dispose();this.gearMaterial?.dispose();
    this.releaseAssets();this.visibleCount=0;this.visibleIds=[];
  }
}
