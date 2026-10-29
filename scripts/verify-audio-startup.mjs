import assert from 'node:assert/strict';

// chrome-session --project flight3d node scripts/verify-audio-startup.mjs
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5193/';
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) pending.get(message.id)?.(message);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const sequence = ++id;
  const timer = setTimeout(() => { pending.delete(sequence); reject(Error(method)); }, 30000);
  pending.set(sequence, message => {
    clearTimeout(timer); pending.delete(sequence);
    message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
  });
  ws.send(JSON.stringify({ id: sequence, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 160; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Timed out: ${expression}`);
};
try {
  await call('Page.bringToFront');
  await waitFor('Boolean(window.simulator?.hasRenderedFirstFrame) && !document.body.classList.contains("booting")');
  const initial = await evaluate(`(() => {
    const a = window.simulator.audio;
    return { aircraft: window.simulator.currentAircraftId, profile: a.profile.engineType,
      initialized: a.isInitialized, state: a.ctx?.state,
      engine: (a.isPiston ? a.pistonGain : a.engineGain)?.gain.value,
      activated: navigator.userActivation.hasBeenActive };
  })()`);
  console.log('Before any interaction:', initial);
  assert.equal(initial.initialized, true, 'audio graph exists before opening the menu');
  assert.equal(initial.activated, false, 'no gesture has unlocked this page');
  assert.ok(initial.engine > 0, 'engine bus already follows live physics');
  // Autoplay policy may allow immediate playback or suspend it until a gesture.
  assert.ok(['running', 'suspended'].includes(initial.state));
  await evaluate('window.__startupContext = window.simulator.audio.ctx; undefined');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await waitFor('window.simulator.audio.ctx.state === "running"');
  await evaluate(`window.__audioMeter = window.simulator.audio.ctx.createAnalyser();
    window.simulator.audio.makeupGain.connect(window.__audioMeter)`);
  await waitFor(`(() => {
    const samples = new Float32Array(window.__audioMeter.fftSize);
    window.__audioMeter.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > 0.001);
  })()`);
  // A control can consume its pointer event; capture must still unlock audio.
  await evaluate(`window.simulator.renderer.domElement.addEventListener('pointerdown', e => e.stopPropagation(), { once: true });
    window.simulator.audio.ctx.onstatechange = null;
    window.simulator.audio.ctx.suspend()`);
  assert.equal(await evaluate('window.simulator.audio.ctx.state'), 'suspended');
  for (const type of ['mousePressed', 'mouseReleased']) {
    await call('Input.dispatchMouseEvent', { type, x: 600, y: 400, button: 'left', clickCount: 1 });
    if (type === 'mousePressed') await waitFor('window.simulator.audio.ctx.state === "running"');
  }
  assert.equal(await evaluate('window.simulator.audio.ctx === window.__startupContext'), true);
  console.log('PASS: startup graph, keyboard unlock, consumed pointer unlock, context reuse');
} catch (error) {
  console.error(await evaluate('document.getElementById("startup-overlay")?.innerText'));
  throw error;
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
