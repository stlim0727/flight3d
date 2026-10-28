// Run under chrome-session with a GPU Chrome already listening on CDP_URL.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.SIM_URL || 'http://127.0.0.1:5286';
const cdp = process.env.CDP_URL || `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const dir = process.env.ARTIFACT_DIR || '.cache/incheon-pavement';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/incheon-pavement.html', '<!doctype html><title>Incheon pavement overlap verification</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
const target = await (await fetch(`${cdp}/json/new?${encodeURIComponent(`${origin}/.cache/incheon-pavement.html`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), errors = [], extensionErrors = [], isolatedContexts = new Set();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault === false) isolatedContexts.add(message.params.context.id);
  if (message.method === 'Runtime.exceptionThrown') { const error=message.params.exceptionDetails; (isolatedContexts.has(error.executionContextId)||error.url?.startsWith('chrome-extension://')?extensionErrors:errors).push(error); }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error' && !isolatedContexts.has(message.params.executionContextId)) errors.push(message.params.args);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');
  const reviewUrl=`${origin}/.cache/incheon-pavement.html`;
  await call('Page.navigate',{url:reviewUrl});
  let ready=false;
  for(let i=0;i<100&&!ready;i++){
    ready=(await call('Runtime.evaluate',{expression:`location.href===${JSON.stringify(reviewUrl)} && document.readyState==='complete'`,returnByValue:true})).result?.value===true;
    if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready);
  const response=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(${async function verify(){
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {mergeGeometries}=await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const {createIncheonPavement,pavementSurfaceGeometry,pavementRibbon}=await import('/src/environment/IncheonPavement.js');
    const {default:field}=await import('/src/config/incheonAirfield.json');
    const fixed=createIncheonPavement(field),baseline=new THREE.Group();
    // Reproduce the original airport's four color batches at identical heights.
    const batches=new Map(),add=(name,color,source)=>{
      const geometry=source.index?source.toNonIndexed():source;geometry.deleteAttribute('uv');
      if(!batches.has(name))batches.set(name,{color,parts:[]});batches.get(name).parts.push(geometry);
    };
    for(const surface of field.surfaces){
      const runway=surface.kind==='runway',g=pavementSurfaceGeometry(surface);g.translate(0,field.elevationM+.015,0);
      add(runway?'runway':'taxiway',runway?0x55595a:0x92968e,g);
      if(!surface.area){const line=pavementRibbon(surface.points,runway?.7:.3,runway);line.translate(0,field.elevationM+.03,0);add(runway?'runway-marking':'taxiway-marking',runway?0xffffff:0xeac75b,line);}
    }
    for(const [name,{color,parts}] of batches){const mesh=new THREE.Mesh(mergeGeometries(parts,false),new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));mesh.name='incheon-'+name+'-pavement';baseline.add(mesh);}
    const reference=new THREE.Group();reference.add(fixed.getObjectByName('incheon-runway-pavement').clone());
    const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,1),baseline,fixed,reference);
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,logarithmicDepthBuffer:true,preserveDrawingBuffer:true});
    const width=960,height=600;renderer.setSize(width,height);renderer.setClearColor(0,0);document.body.append(renderer.domElement);
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
    const camera=new THREE.PerspectiveCamera(50,width/height,.08,45000),center=new THREE.Vector3(465,7.015,-766);
    const rows=[],images={};
    const draw=(group,markings=false)=>{
      for(const g of [baseline,fixed,reference])g.visible=g===group;
      for(const mesh of group.children)mesh.visible=markings||!mesh.name.includes('marking');
      renderer.render(scene,camera);gl.finish();
      const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('WebGL readback failed');return pixels;
    };
    const picture=()=>{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#dce5ef';ctx.fillRect(0,0,width,height);ctx.drawImage(renderer.domElement,0,0);return canvas.toDataURL('image/png').split(',')[1];
    };
    const views=[['cockpit',[35,2,15]],['approach',[90,4,40]],['drone',[100,100,70]],['far',[600,50,400]]];
    for(const [name,offset] of views)for(const jitter of [-.2,-.05,0,.05,.2]){
      camera.position.copy(center).add(new THREE.Vector3(...offset));camera.position.x+=jitter;camera.position.y+=jitter*.1;camera.lookAt(center);camera.updateMatrixWorld(true);
      const expected=draw(reference),before=draw(baseline),after=draw(fixed);
      let count=0,wrongBefore=0,wrongAfter=0;
      for(let i=0;i<expected.length;i+=4)if(expected[i+3]===255){
        count++;const different=p=>Math.abs(p[i]-expected[i])+Math.abs(p[i+1]-expected[i+1])+Math.abs(p[i+2]-expected[i+2])>6;
        if(different(before))wrongBefore++;if(different(after))wrongAfter++;
      }
      rows.push({view:name,jitter,runwayPixels:count,wrongBefore,wrongAfter});
      if(jitter===0){draw(baseline,true);images[name+'-before.png']=picture();draw(fixed,true);images[name+'-after.png']=picture();}
    }
    renderer.dispose();return {gpu,rows,images};
  }.toString()})()`});
  assert.ok(!response.exceptionDetails,JSON.stringify(response.exceptionDetails));
  const {images,...report}=response.result.value;
  report.applicationErrors=errors;report.extensionExceptions=extensionErrors.length;
  for(const [file,data] of Object.entries(images))fs.writeFileSync(path.join(dir,file),Buffer.from(data,'base64'));
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
  assert.equal(errors.length,0,'no application or shader errors');
  assert.ok(report.rows.every(row=>row.runwayPixels>100),'every camera samples rendered runway');
  assert.ok(report.rows.reduce((sum,row)=>sum+row.wrongBefore,0)>500,'baseline reproduces coplanar pavement interference');
  assert.ok(report.rows.every(row=>row.wrongAfter<=Math.max(2,row.runwayPixels*.0005)),'runway matches unobstructed reference across camera motion');
  console.log('PASS',JSON.stringify(report));
} finally {ws.close();await fetch(`${cdp}/json/close/${target.id}`);}
