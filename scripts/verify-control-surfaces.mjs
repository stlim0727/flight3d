import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const dir = process.env.ARTIFACT_DIR || path.resolve(".cache/control-surfaces");
fs.mkdirSync(dir, { recursive: true });
// Start Vite on 5173 and headless Chromium with CDP on 9447 first; see ci.md.
const pages = await (await fetch("http://127.0.0.1:9447/json")).json();
const ws = new WebSocket(
  pages.find((p) => p.type === "page").webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map(),
  errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.text);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(
      () => reject(new Error(`timeout ${method}`)),
      60000,
    );
    pending.set(id, (m) => {
      clearTimeout(timeout);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await call("Runtime.enable");
await call("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));
for (let i = 0; i < 60; i++) {
  if (
    await evaluate(
      "window.simulator?.aircraft?.gltfControlSurfaces?.length === 7",
    )
  )
    break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log(
  "loaded",
  await evaluate("window.simulator.aircraft.gltfControlSurfaces.length"),
);
await evaluate(
  "window.simulator.demoDirector.stop(); window.simulator.gameFlow.enterFlight(); window.simulator.cameraSystem.setMode(1);",
);
await call("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "d",
  code: "KeyD",
  windowsVirtualKeyCode: 68,
});
await evaluate("window.simulator.stepSimulation(1);");
const keyboard = await evaluate(
  'JSON.stringify({input:window.simulator.telemetry.aileron,angles:window.simulator.aircraft.gltfControlSurfaces.filter(c=>c.input==="aileron").map(c=>c.pivot.quaternion.toArray())})',
);
console.log("keyboard", keyboard);
assert.ok(JSON.parse(keyboard).input > 0, "native D reaches telemetry");
assert.ok(
  JSON.parse(keyboard).angles.every((q) => Math.abs(q[2]) > 0.01),
  "native D animates both rendered ailerons",
);
await call("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "d",
  code: "KeyD",
  windowsVirtualKeyCode: 68,
});
const results = await evaluate(`(async()=>{
 const {updateGltfControlSurfaces}=await import('/src/aircraft/GltfControlSurfaces.js');
 // Stop the background world render loop during isolated software-rendered captures.
 window.requestAnimationFrame=()=>0;
 const a=window.simulator.aircraft;const states=[];
 for(const value of [1,1,-1,0]){
  a.update(0,{aileron:value,elevator:value,rudder:value,flapDegree:Math.max(0,value)*40});
  states.push(a.gltfControlSurfaces.map(c=>({name:c.name,quaternion:c.pivot.quaternion.toArray(),vertices:c.pivot.children[0].geometry.attributes.position.count})));
 }
 const THREE=window.THREE;
 const scene=new THREE.Scene();scene.background=new THREE.Color(0xc3d5e4);
 const model=a.gltfModel.clone(true);scene.add(model);
 scene.add(new THREE.HemisphereLight(0xffffff,0x657585,3));
 const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(-20,35,-15);scene.add(light);
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1400,900);
 renderer.domElement.style='position:fixed;inset:0;z-index:999999;width:100vw;height:100vh';document.body.append(renderer.domElement);
 const camera=new THREE.PerspectiveCamera(40,1400/900,.1,200);camera.position.set(27,30,39);camera.lookAt(0,0,0);
 const controls=a.gltfControlSurfaces.map(c=>({...c,pivot:model.getObjectByName(c.pivot.name)}));
 window.controlReview={scene,renderer,camera,controls,update:updateGltfControlSurfaces};
 renderer.render(scene,camera);
 return states;
})()`);
assert.equal(results.length, 4);
for (const [i, state] of results.entries()) {
  assert.equal(state.length, 7);
  for (const control of state) {
    assert.ok(control.vertices > 6);
    if (i === 3)
      assert.ok(
        Math.abs(control.quaternion[3] - 1) < 1e-8,
        `${control.name} restores neutral`,
      );
    else if (i < 2 || !control.name.startsWith("flap"))
      assert.ok(
        Math.abs(control.quaternion[3] - 1) > 1e-5,
        `${control.name} responds`,
      );
  }
}
assert.deepEqual(results[0], results[1], "held input is stable");
assert.deepEqual(errors, [], "no page exceptions");
fs.writeFileSync(
  dir + "/browser-results.json",
  JSON.stringify(
    { keyboard: JSON.parse(keyboard), states: results, errors },
    null,
    2,
  ),
);
for (const [name, value] of [
  ["neutral", 0],
  ["deflected", 1],
]) {
  await evaluate(
    `controlReview.update(controlReview.controls,{aileron:${value},elevator:${value},rudder:${value},flapDegree:${value * 40}});controlReview.renderer.render(controlReview.scene,controlReview.camera);`,
  );
  const png = await evaluate(
    "controlReview.renderer.domElement.toDataURL('image/png').split(',')[1]",
  );
  fs.writeFileSync(dir + "/" + name + ".png", Buffer.from(png, "base64"));
}
console.log("states", results.length, "page errors", errors);
await evaluate(
  "controlReview.renderer.domElement.remove();controlReview.renderer.dispose();delete window.controlReview;",
);
// Restore the simulator, including its animation loop, after taking evidence.
await call("Page.reload", { ignoreCache: true });
ws.close();
