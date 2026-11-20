import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = `${process.env.APP_URL || 'http://127.0.0.1:5281'}/scripts/verify-gear-ground-contact.html`;
const dir = process.env.ARTIFACT_DIR || '.cache/gear-ground-contact';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    // The reusable browser can have extensions; only app exceptions belong to this check.
    if (!details.url?.startsWith('chrome-extension://')) errors.push(details);
  }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};

try {
 await call('Runtime.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,1000));
 const report=await evaluate(`(async()=>{
 const T=await import('/node_modules/three/build/three.module.js');
 const {Cessna172}=await import('/src/aircraft/Cessna172.js');
 const {F16}=await import('/src/aircraft/F16.js');
 const {gearSupportHeight,tireContact}=await import('/src/aircraft/gearVisualContact.js');
 const {CESSNA_172,F16_FALCON}=await import('/src/config/aircraftConfigs.js');
 const scene=new T.Scene();scene.background=new T.Color('#bfd1e0');
 scene.add(new T.HemisphereLight(0xffffff,0x555555,3));
 const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(-5,10,5);scene.add(sun);
 const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(1200,800);document.body.appendChild(renderer.domElement);
 const camera=new T.PerspectiveCamera(45,1.5,.1,100);camera.position.set(-10,1.3,-8);camera.lookAt(0,.5,0);
 scene.add(new T.GridHelper(100,100,0x888888,0x666666));
 const plane=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x555555}));plane.rotation.x=-Math.PI/2;scene.add(plane);
 const report=[];window.gearViews=[];
 for(const [Type,config] of [[Cessna172,CESSNA_172],[F16,F16_FALCON]]){
 const aircraft=new Type();
 // Exercise asynchronous loading after the simulation has already moved the root.
 aircraft.group.position.set(35,12,-70);aircraft.group.rotation.set(.1,.4,-.05);
 while(aircraft.loadingGltf)await new Promise(r=>setTimeout(r,100));
if(!aircraft.modelLoaded)throw new Error('GLB load failed');scene.add(aircraft.group);
 for(const compressions of [{},{nose:.08,mainLeft:.12,mainRight:.04},{}, {nose:.02,mainLeft:.03,mainRight:.03},{}]){
 aircraft.update(0,{gearState:1,compressions});aircraft.group.updateMatrixWorld(true);
 const tires=config.id==='C172'?aircraft.visualGear.map(g=>g.meshes.find(m=>m.userData.tire)):Object.values(aircraft.gearLegs).map(g=>g.children[0]);
 if(tires.length!==3 || tires.some(t=>!t))throw new Error(config.id+' missing tires');
 for(const tire of tires){const geometry=tire.geometry.clone().applyMatrix4(aircraft.group.matrixWorld.clone().invert().multiply(tire.matrixWorld));const point=tireContact(geometry);geometry.dispose();
 const expected=gearSupportHeight(config.landingGear.contacts,compressions,point.x,point.z);
 const error=Math.abs(point.y-expected);if(error>.005)throw new Error(config.id+' tire error '+error);report.push({aircraft:config.id,error,compressions});}
 }
 // Park on the neutral physical contact plane, including its small pitch.
 const [n,l]=config.landingGear.contacts;const slope=((n.localPos.y-n.wheelRadius)-(l.localPos.y-l.wheelRadius))/(n.localPos.z-l.localPos.z);
 aircraft.group.rotation.set(Math.atan(slope),0,0);aircraft.group.position.set(0,0,0);aircraft.group.position.y=-(l.localPos.y-l.wheelRadius-slope*l.localPos.z)/Math.sqrt(1+slope*slope);
 aircraft.group.updateMatrixWorld(true);
 const tires=config.id==='C172'?aircraft.visualGear.map(g=>g.meshes.find(m=>m.userData.tire)):Object.values(aircraft.gearLegs).map(g=>g.children[0]);
 for(const tire of tires){
 const geometry=tire.geometry.clone().applyMatrix4(tire.matrixWorld);geometry.computeBoundingBox();
 if(Math.abs(geometry.boundingBox.min.y)>.005)throw new Error(config.id+' world contact error '+geometry.boundingBox.min.y);geometry.dispose();
 }
 window.gearViews.push({aircraft,scene,camera,renderer});scene.remove(aircraft.group);
 }
 window.showGearView=i=>{for(const v of window.gearViews)scene.remove(v.aircraft.group);scene.add(window.gearViews[i].aircraft.group);renderer.render(scene,camera);};
 return report;
})()`);
 if(report.length!==30)throw new Error('Incomplete contact measurements');
 if(errors.length)throw new Error(JSON.stringify(errors));
 fs.writeFileSync(path.join(dir,'contact-results.json'),JSON.stringify(report,null,2));
 for(const [i,name] of ['C172','F16'].entries()){
 await evaluate(`window.showGearView(${i})`);
 const {data}=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(data,'base64'));
 }
 console.log(JSON.stringify({samples:report.length,maxErrorM:Math.max(...report.map(r=>r.error)),artifacts:dir}));
}finally{ws.close();await fetch(`${endpoint}/json/close/${target.id}`);}
