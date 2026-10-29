import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

export const PARKED_LIVERIES = {
  korean: { name:'Korean Air', title:'KOREAN AIR', upper:0x94c8df, lower:0xe8edef, tail:0x94c8df, engine:0xe8edef, ink:'#063b70', stripe:0xc91b43 },
  jeju: { name:'Jeju Air', title:'JEJUair', upper:0xf5f6f6, lower:0xe7eaed, tail:0xf47920, engine:0xf47920, ink:'#ee7024' },
  jin: { name:'Jin Air', title:'JIN AIR', upper:0xf6f6f3, lower:0xe5e9e9, tail:0xc6d630, engine:0xf6f6f3, ink:'#602c77' },
  flydubai: { name:'flydubai', title:'flydubai', upper:0xf5f7fa, lower:0xf0f3f6, tail:0x1378b6, engine:0x1378b6, ink:'#0879bb' },
};

function atlas(livery,id) {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=livery.ink;ctx.font='bold 125px Arial, sans-serif';
  ctx.fillText(livery.title,512,128,1000);
  ctx.save();ctx.translate(512,384);
  if(id==='korean') {
    ctx.scale(.48,.48);ctx.rotate(-.2);
    ctx.fillStyle='#d51d44';ctx.beginPath();ctx.arc(0,0,225,Math.PI,0);ctx.arc(112.5,0,112.5,0,Math.PI);ctx.arc(-112.5,0,112.5,0,Math.PI,true);ctx.fill();
    ctx.fillStyle='#084884';ctx.beginPath();ctx.arc(0,0,225,0,Math.PI);ctx.arc(-112.5,0,112.5,Math.PI,0);ctx.arc(112.5,0,112.5,Math.PI,0,true);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=13;ctx.beginPath();ctx.arc(-112.5,0,112.5,Math.PI,0);ctx.arc(112.5,0,112.5,Math.PI,0,true);ctx.stroke();
  } else if(id==='jeju') {
    ctx.fillStyle='#fff';ctx.font='bold 70px Arial';ctx.fillText('JEJU',0,-5,235);
    ctx.lineWidth=10;ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(0,0,95,.2,Math.PI-.2);ctx.stroke();
  } else if(id==='jin') {
    ctx.fillStyle=livery.ink;
    for(const side of [-1,1])for(const row of [-1,1]){ctx.beginPath();ctx.ellipse(side*35,row*36,28,65,side*row*.6,0,Math.PI*2);ctx.fill();}
  } else {
    ctx.fillStyle='#f99c2b';ctx.beginPath();ctx.arc(-12,0,100,-1.2,1.2);ctx.lineTo(-20,0);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 45px Arial';ctx.fillText('flydubai',0,0,240);
  }
  ctx.restore();
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  return texture;
}

function liveryMaterial(base,livery) {
  const material=new THREE.MeshStandardMaterial({map:base.map,roughness:.4,metalness:.12,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    for(const key of ['upper','lower','tail','engine','stripe'])shader.uniforms['parked_'+key]={value:new THREE.Color(livery[key]??livery.upper)};
    shader.uniforms.parked_hasStripe={value:livery.stripe?1:0};
    shader.vertexShader='varying vec3 vParkedPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvParkedPosition=position;');
    shader.fragmentShader='varying vec3 vParkedPosition; uniform vec3 parked_upper,parked_lower,parked_tail,parked_engine,parked_stripe; uniform float parked_hasStripe;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 p=vParkedPosition;
      bool green=diffuseColor.g>diffuseColor.r*1.4 && diffuseColor.g>diffuseColor.b*1.25;
      bool detail=max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b)<0.28 && !green;
      bool body=abs(p.x)<2.1 && p.z>-19.1 && p.z<17.8;
      bool tail=p.y>2.0 && p.z>10.5;
      bool engine=abs(p.x)>3.8 && abs(p.x)<6.5 && p.y< -1.0 && p.z> -6.8 && p.z< -3.1;
      if(tail) diffuseColor.rgb=parked_tail;
      else if(body && (!detail || green || p.y< -0.8)) {
        diffuseColor.rgb=p.y> -0.32?parked_upper:parked_lower;
        if(parked_hasStripe>0.5 && abs(p.y+0.32)<0.035)diffuseColor.rgb=parked_stripe;
      } else if(engine && (!detail || green))diffuseColor.rgb=parked_engine;
      else if(!body && !engine && (green || (diffuseColor.b>diffuseColor.r*1.5 && diffuseColor.b>diffuseColor.g*1.2)))diffuseColor.rgb=parked_lower;
    `);
  };
  material.customProgramCacheKey=()=> 'parked-737-livery-v1';return material;
}

function decalGeometry(body) {
  const parts=[];
  for(const side of [-1,1])for(const tail of [false,true]) {
    const projected=new DecalGeometry(body,new THREE.Vector3(side*(tail?.18:1.85),tail?5.7:.95,tail?15.3:-5.5),
      new THREE.Euler(0,side*Math.PI/2,0),new THREE.Vector3(tail?3.5:9.5,tail?3.5:1.15,tail?.8:1.25));
    const visible=[];
    for(let i=0;i<projected.attributes.position.count;i+=3) {
      const n=projected.attributes.normal;
      if((n.getX(i)+n.getX(i+1)+n.getX(i+2))*side>0)visible.push(i,i+1,i+2);
    }
    const g=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(projected.attributes)) {
      const values=visible.flatMap(i=>Array.from({length:attribute.itemSize},(_,j)=>attribute.getComponent(i,j)));
      g.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));
    }
    projected.dispose();
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) {
      p.setXYZ(i,p.getX(i)+n.getX(i)*.008,p.getY(i)+n.getY(i)*.008,p.getZ(i)+n.getZ(i)*.008);
      uv.setXY(i,tail?.375+uv.getX(i)*.25:uv.getX(i),tail?uv.getY(i)*.5:.5+uv.getY(i)*.5);
    }
    parts.push(g);
  }
  const result=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());return result;
}

function gearGeometry() {
  const parts=[];
  const add=(geometry,color,x,y,z)=>{
    geometry.translate(x,y,z);const g=geometry.index?geometry.toNonIndexed():geometry;g.deleteAttribute('uv');
    const c=new THREE.Color(color),colors=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3)colors.set([c.r,c.g,c.b],i);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);if(g!==geometry)geometry.dispose();
  };
  const wheel=(x,y,z,r)=>{
    const tire=new THREE.CylinderGeometry(r,r,.24,16);tire.rotateZ(Math.PI/2);add(tire,0x202326,x,y,z);
    const rim=new THREE.CylinderGeometry(r*.55,r*.55,.255,12);rim.rotateZ(Math.PI/2);add(rim,0xb6bfc6,x,y,z);
  };
  for(const side of [-1,1]){
    wheel(side*.22,-3.12,-12.5,.38);
    for(const offset of [-.28,.28])wheel(side*3.2+offset,-3.02,1.8,.48);
    add(new THREE.CylinderGeometry(.1,.13,1.9,10),0xb5b9be,side*3.2,-2.07,1.8);
    add(new THREE.BoxGeometry(.3,.16,.5),0xe3af25,side*.42,-3.42,-12.5+.55);
  }
  add(new THREE.CylinderGeometry(.085,.12,1.37,10),0xb5b9be,0,-2.435,-12.5);
  const result=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());return result;
}

/** Load only the shared exterior once. No cockpit, avionics or aircraft physics. */
export async function loadParkedAirlinerAssets(baseUrl='/') {
  const gltf=await new GLTFLoader().loadAsync(`${baseUrl}models/b737-800.glb`);
  gltf.scene.rotation.y=Math.PI/2;gltf.scene.updateMatrixWorld(true);
  const parts=[],textures=new Set();let base;
  gltf.scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.material.map)textures.add(mesh.material.map);
    if(mesh.name==='B737')base=mesh.material;
    const g=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),flat=g.index?g.toNonIndexed():g;
    if(flat!==g)g.dispose();parts.push(flat);
  });
  if(!base)throw new Error('Parked 737 exterior mesh missing');
  for(const texture of textures)if(texture!==base.map){texture.dispose();textures.delete(texture);}
  const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
  const body=new THREE.Mesh(geometry,base);body.updateMatrixWorld(true);
  const decals=decalGeometry(body),gear=gearGeometry(),liveries={};
  for(const [id,livery] of Object.entries(PARKED_LIVERIES)) {
    const map=atlas(livery,id);textures.add(map);
    liveries[id]={body:liveryMaterial(base,livery),decal:new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.05,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-8,roughness:.4})};
  }
  gltf.scene.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();mesh.material.dispose();}});
  return {geometry,decals,gear,liveries,textures};
}
