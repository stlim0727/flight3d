import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { withBrowserSession } from './lib/browserHarness.mjs';

// Linux hardware path; never allow the harness to silently choose software.
if (process.platform === 'linux') {
  await access('/dev/dri/renderD128', constants.R_OK | constants.W_OK);
  process.env.GPU_ANGLE = 'vulkan';
}
const out = process.env.ARTIFACT_DIR || '.cache/flight-layout';
await mkdir(out, { recursive: true });
await withBrowserSession({ path: '/?airport=coastal&aircraft=B738&scenario=runway' }, async ({ evaluate, send, delay, screenshot, exceptions }) => {
  const gpu = await evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debug) throw new Error('Renderer diagnostics unavailable');
    const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    if (/swiftshader|llvmpipe|softpipe|lavapipe|software/i.test(renderer)) throw new Error(renderer);
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}'],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1,0,0,1);}'],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { renderer, pixel: [...pixel] };
  });
  assert.deepEqual(gpu.pixel, [255, 0, 0, 255], 'hardware shader drawing and readback');
  console.log('GPU', gpu);
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(500);
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup');
  assert.equal(await evaluate('document.getElementById("open-camera") === null'), true, 'camera dropdown replaced by strip buttons');
  assert.equal(await evaluate('document.querySelectorAll(".flight-toolbar .flight-camera-btn").length'), 10, 'all views, Auto and Director are selectable on the strip');
  assert.equal(await evaluate('document.getElementById("btn-auto-camera") === null'), true, 'no duplicate Scenic Auto button');
  await evaluate(() => {
    const autoBtn = document.getElementById('btn-cam-auto');
    autoBtn.focus();
    autoBtn.click();
  });
  assert.ok(await evaluate('window.simulator.cameraSystem.autoSwitch'), 'strip Auto enables automatic framing');
  assert.ok(await evaluate('document.activeElement !== document.getElementById("btn-cam-auto")'), 'clicked camera button releases keyboard focus');
  await evaluate(() => {
    document.getElementById('btn-cam-chase').click();
  });
  assert.equal(await evaluate('window.simulator.cameraSystem.autoSwitch'), false, 'explicit strip view returns to manual');
  await evaluate(() => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.enterFlight();
    s.integratePhysics = () => {}; // Fixed-pose layout evidence, not flight acceptance.
  });
  let touch = false;
  const click = async selector => {
    const point = await evaluate(sel => {
      const node = document.querySelector(sel);
      if (node.closest('.flight-more-panel, .ap-panel, .flight-toolbar')) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, w: r.width, h: r.height, hit: node.contains(document.elementFromPoint(x, y)) };
    }, selector);
    assert.ok(point.w >= 44 && point.h >= 44 && point.hit, `${selector}: reachable 44px target ${JSON.stringify(point)}`);
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    await delay(100);
  };
  const results = [];
  for (const [width, height] of [[1440, 900], [926, 428], [390, 660], [390, 844], [320, 568], [568, 320], [320, 400]]) {
    touch = width <= 1024;
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile: touch, deviceScaleFactor: 1 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
    await evaluate(enabled => { const s = window.simulator; enabled ? s.touchControls.enable() : s.touchControls.disable(); }, touch);
    let baseline;
    for (const mode of [1, 0, 8, 6, 4, 2, 3, 5, 0]) {
      await evaluate(mode => window.simulator.controls.onSelectCamera(mode), mode);
      await delay(150);
      const layout = await evaluate(() => {
        const bar = document.querySelector('.flight-toolbar');
        const box = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const chrome = ['.menu-toggle', '.hud-strip', '#btn-ap-toggle', '#btn-mute', '.flight-toolbar']
          .map(sel => ({ sel, ...box(document.querySelector(sel)) }));
        const buttons = [...bar.querySelectorAll('button, select')].filter(n => getComputedStyle(n).display !== 'none').map(n => {
          const cs = getComputedStyle(n), r = n.getBoundingClientRect();
          return { sel: `#${n.id}`, ...box(n), center: `${cs.display}/${cs.alignItems}/${cs.justifyContent}`,
            hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        });
        return { chrome, buttons, strip: box(document.getElementById('camera-strip')), stacked: bar.classList.contains('camera-strip-stacked'),
          pinned: Math.ceil(bar.scrollLeft + bar.clientWidth) >= bar.scrollWidth,
          fits: bar.scrollWidth <= bar.clientWidth + 1 };
      });
      const bounds = [...layout.chrome, ...layout.buttons];
      assert.ok(layout.chrome.every(r => r.x >= 0 && r.x + r.w <= width + 1 && r.y >= 0 && r.y + r.h <= height), JSON.stringify(layout.chrome));
      assert.ok(bounds.every(r => r.h >= 44 && (r.sel === '.hud-strip' || r.w >= 44)), 'minimum targets');
      assert.equal(new Set(layout.buttons.map(b => Math.round(b.y))).size, layout.stacked ? 2 : 1,
        `toolbar stays on ${layout.stacked ? 'two' : 'one'} row(s): ${JSON.stringify(layout.buttons)}`);
      assert.ok(layout.buttons.every(b => b.center === 'flex/center/center'), `labels centred in their buttons: ${layout.buttons.map(b => b.center)}`);
      // Overflow (trim, parking brake) sits beside the aircraft controls and
      // fullscreen closes the row; only the camera strip scrolls horizontally
      // when the viewport is narrower than all buttons.
      const order = layout.buttons.map(b => b.sel);
      assert.equal(order.indexOf('#open-flight-more'), order.indexOf('#btn-reverser') + 1, `overflow follows the aircraft controls: ${order}`);
      assert.equal(order.at(-1), '#btn-fullscreen', `fullscreen closes the row: ${order}`);
      const primary = layout.buttons.filter(b => ['#open-flight-more', '#btn-fullscreen'].includes(b.sel));
      assert.ok(layout.pinned, 'toolbar scrolled to its right end');
      assert.ok(primary.every(b => b.x >= 0 && b.x + b.w <= width + 1 && b.hit), `primary group reachable: ${JSON.stringify(primary)}`);
      const row = layout.chrome.find(r => r.sel === '.flight-toolbar');
      assert.ok(width - (row.x + row.w) <= 16, `toolbar hugs the right edge: ${JSON.stringify(row)}`);
      if (baseline) assert.deepEqual(bounds, baseline, `stable controls across camera ${mode}`);
      // Camera buttons scrolled past the strip's edge are clipped by it, so only
      // their visible part can overlap a neighbour such as a wrapped fullscreen.
      const targets = bounds.filter(r => r.sel !== '.flight-toolbar').map(r => {
        if (!r.sel.startsWith('#btn-cam-')) return r;
        const x = Math.max(r.x, layout.strip.x), right = Math.min(r.x + r.w, layout.strip.x + layout.strip.w);
        return { ...r, x, w: Math.max(0, right - x) };
      }).filter(r => r.w > 0);
      for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i], b = targets[j];
        assert.ok(a.x + a.w <= b.x + .5 || b.x + b.w <= a.x + .5 || a.y + a.h <= b.y + .5 || b.y + b.h <= a.y + .5, `${a.sel} overlaps ${b.sel}`);
      }
      baseline = bounds;
      if ([0, 8].includes(mode)) await screenshot(`${out}/${width}x${height}-camera-${mode}.png`);
    }
    // The cockpit eyepoint pill follows the measured bottom of the control
    // rows; its panel is docked along the bottom edge so the windshield, horizon
    // and HUD stay clear while the eyepoint is adjusted. Cockpit entry waits for
    // the interior to load, so wait for the view itself: a pill that never
    // appeared must not count as clear.
    await evaluate(() => window.simulator.controls.onSelectCamera(0));
    for (let i = 0; i < 80 && await evaluate('window.simulator.cameraSystem.mode') !== 0; i++) await delay(250);
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 0, 'cockpit view entered once its interior loaded');
    await delay(150);
    const pov = await evaluate(() => {
      const box = n => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; };
      const pill = document.getElementById('btn-cockpit-pov');
      const result = { height: innerHeight, toolbarBottom: document.querySelector('.flight-toolbar').getBoundingClientRect().bottom, pill: box(pill) };
      pill.click();
      result.panel = box(document.getElementById('cockpit-pov-panel'));
      document.getElementById('btn-cockpit-pov-close').click();
      return result;
    });
    assert.ok(pov.pill.h > 0 && pov.pill.top >= pov.toolbarBottom + 4, `cockpit POV pill clears the control rows: ${JSON.stringify(pov)}`);
    assert.ok(pov.panel.h > 0 && pov.panel.top >= pov.toolbarBottom + 4, `cockpit POV panel clears the control rows: ${JSON.stringify(pov)}`);
    assert.ok(pov.panel.top > pov.height * .35 && pov.panel.bottom >= pov.height - 40,
      `cockpit POV panel stays in the lower console band, out of the forward sight: ${JSON.stringify(pov)}`);
    if (touch) {
      // With live controls (no demo guide) even a warning row keeps the pill
      // above every touch card beneath it. During the demo the guide can push it
      // over those cards, but they are inert then and the guide leaves on takeover.
      await evaluate(() => { const s = window.simulator; s.telemetry.warnings = [{ text: 'BANK ANGLE', priority: 50 }]; s.updateHUD(); });
      await delay(350);
      const live = await evaluate(() => {
        const p = document.getElementById('btn-cockpit-pov').getBoundingClientRect();
        const cards = [...document.querySelectorAll('.touch-throttle-card, .touch-rudder-card, #touch-btn-brake, .touch-stick-card')]
          .map(n => n.getBoundingClientRect()).filter(r => r.height && r.left < p.right && r.right > p.left);
        return { pillTop: p.top, pillBottom: p.bottom, warningBottom: document.getElementById('hud-warning').getBoundingClientRect().bottom,
          cardsTop: Math.min(...cards.map(r => r.top)) };
      });
      await evaluate(() => { const s = window.simulator; s.telemetry.warnings = []; s.updateHUD(); });
      await delay(350);
      assert.ok(live.pillTop >= live.warningBottom + 4, `cockpit POV pill clears the warning: ${JSON.stringify(live)}`);
      assert.ok(live.pillBottom + 4 <= live.cardsTop, `cockpit POV pill clears the live touch controls under a warning: ${JSON.stringify(live)}`);
    }
    await click('#btn-ap-toggle');
    assert.ok(await evaluate('!document.getElementById("ap-panel").hidden'), 'AP opens');
    await click('#btn-ap');
    assert.ok(await evaluate('window.simulator.autopilot.master'), 'AP master accepts native input inside relocated panel');
    const warning = await evaluate(() => {
      const alert = document.getElementById('hud-warning');
      alert.textContent = 'STALL — LOWER NOSE'; alert.hidden = false;
      const a = alert.getBoundingClientRect(), p = document.getElementById('ap-panel').getBoundingClientRect();
      const result = { top: a.top, bottom: a.bottom, panelTop: p.top, toolbarBottom: document.querySelector('.flight-toolbar').getBoundingClientRect().bottom };
      alert.hidden = true;
      return result;
    });
    assert.ok(warning.top >= warning.toolbarBottom + 4 && warning.panelTop >= warning.bottom + 4, `urgent warning clears toolbar and AP: ${JSON.stringify(warning)}`);
    await click('#btn-ap');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert.ok(await evaluate('document.getElementById("ap-panel").hidden && document.body.dataset.flow === "flight"'), 'Escape closes AP without pausing');
    await click('#btn-fullscreen');
    await delay(150);
    assert.ok(await evaluate('Boolean(document.fullscreenElement)'), 'native click enters fullscreen');
    await screenshot(`${out}/${width}x${height}-fullscreen.png`);
    await click('#btn-fullscreen');
    await delay(150);
    assert.ok(await evaluate('!document.fullscreenElement'), 'native click exits fullscreen');
    await click('#open-flight-more');
    assert.equal(await evaluate('document.querySelector("#flight-more-panel button").id'), 'flight-trim-less', 'trim is the first overflow action');
    const trim = await evaluate('window.simulator.aero.pitchTrim');
    await click('#flight-trim-more');
    assert.ok(Math.abs(await evaluate('window.simulator.controls.pitchTrim') - trim - .2) < .001, 'trim');
    await click('#flight-park-brake');
    assert.ok(await evaluate('window.simulator.controls.parkingBrake'), 'parking brake');
    await click('#flight-park-brake');
    await screenshot(`${out}/${width}x${height}-more.png`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert.ok(await evaluate('document.getElementById("flight-more-panel").hidden && document.body.dataset.flow === "flight"'), 'Escape closes more without pausing');
    const muted = await evaluate('window.simulator.audio.isMuted');
    await click('#btn-mute');
    assert.equal(await evaluate('window.simulator.audio.isMuted'), !muted, 'mute');
    await click('#btn-mute');
    if (touch) {
      for (const [selector, expression] of [
        ['#touch-rudder-track', 'window.simulator.controls.touchRudder'],
        ['#touch-stick-zone', 'window.simulator.controls.touchAileron'],
      ]) {
        const r = await evaluate(selector => document.querySelector(selector).getBoundingClientRect().toJSON(), selector);
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width * .8, y: r.y + r.height / 2 }] });
        assert.ok(await evaluate(expression) > .2, `${selector} remains uncovered and responds`);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await evaluate(expression), 0, `${selector} centers on release`);
      }
    }
    await evaluate(() => { window.simulator.demoDirector.start('coastal'); window.simulator.cameraSystem.setMode(1); window.simulator.updateHUD(); });
    await delay(150);
    const demo = await evaluate(() => {
      const b = document.getElementById('demo-banner').getBoundingClientRect(), t = document.querySelector('.flight-toolbar').getBoundingClientRect();
      return { top: b.top, toolbarBottom: t.bottom, width: b.width, locked: document.getElementById('btn-gear').disabled && document.getElementById('flight-trim-more').disabled,
        row: [...document.querySelectorAll('.flight-toolbar button, .flight-toolbar select')].filter(n => getComputedStyle(n).display !== 'none').map(n => n.id) };
    });
    assert.ok(demo.width && demo.top >= demo.toolbarBottom + 4 && demo.locked, `demo clearance and lockout: ${JSON.stringify(demo)}`);
    assert.deepEqual(demo.row, [
      'open-flight-more', 'btn-skip-demo',
      'btn-cam-chase', 'btn-cam-drone', 'btn-cam-flyby', 'btn-cam-wing', 'btn-cam-cockpit',
      'btn-cam-hud', 'btn-cam-tower', 'btn-cam-gear', 'btn-cam-auto', 'btn-cam-director',
      'btn-fullscreen',
    ], `demo row: ${demo.row}`);
    await screenshot(`${out}/${width}x${height}-demo.png`);
    // Warnings coexist with both guide states, without covering demo controls.
    await evaluate(() => {
      const s = window.simulator;
      s.telemetry.warnings = [{ text: 'BANK ANGLE', priority: 50 }];
      s.updateHUD();
    });
    await delay(350);
    const demoCheck = await evaluate(() => {
      const guide = document.getElementById('demo-banner');
      const warning = document.getElementById('hud-warning');
      const pill = document.getElementById('btn-cockpit-pov');
      return { visibility: getComputedStyle(guide).visibility,
        guideTop: guide.getBoundingClientRect().top, guideBottom: guide.getBoundingClientRect().bottom,
        warningBottom: warning.getBoundingClientRect().bottom,
        cockpit: window.simulator.cameraSystem.mode === 0, pillTop: pill.getBoundingClientRect().top, pillHeight: pill.getBoundingClientRect().height };
    });
    assert.ok(demoCheck.visibility === 'visible' && demoCheck.guideTop >= demoCheck.warningBottom + 4,
      `expanded demo stays visible below the warning at ${width}x${height}: ${JSON.stringify(demoCheck)}`);
    // The demo keeps the cockpit view chosen above, so the eyepoint pill is on
    // screen and has to take the row beneath the guide.
    assert.ok(demoCheck.cockpit && demoCheck.pillHeight > 0 && demoCheck.pillTop >= demoCheck.guideBottom + 4,
      `cockpit POV pill sits below the expanded demo guide at ${width}x${height}: ${JSON.stringify(demoCheck)}`);
    await evaluate(() => window.simulator.demoDirector.closeBanner());
    await delay(350);
    const folded = await evaluate(() => {
      const pill = document.getElementById('btn-demo-open');
      const r = pill.getBoundingClientRect();
      const header = document.querySelector('.hud-top-bar').getBoundingClientRect();
      const toolbar = document.querySelector('.flight-toolbar').getBoundingClientRect();
      return { visible: getComputedStyle(pill).visibility === 'visible', left: r.left,
        top: r.top, bottom: r.bottom, right: r.right, headerLeft: header.left,
        headerBottom: header.bottom, toolbarLeft: toolbar.left,
        pillTop: document.getElementById('btn-cockpit-pov').getBoundingClientRect().top,
        warningBottom: document.getElementById('hud-warning').getBoundingClientRect().bottom };
    });
    assert.ok(folded.visible, 'folded demo stays visible with a warning');
    // Wide layouts keep the folded guide in the notice row; compact ones dock it
    // beside the first strip, which frees that row for the pill.
    assert.ok(folded.pillTop >= (width <= 1024 ? folded.warningBottom : folded.bottom) + 4,
      `cockpit POV pill clears the folded demo guide and warning at ${width}x${height}: ${JSON.stringify(folded)}`);
    if (width <= 1024) {
      assert.equal(folded.left, folded.headerLeft, 'folded demo aligns left in both mobile orientations');
      assert.ok(Math.abs(folded.top - folded.headerBottom - 4) <= 1, 'folded demo sits below first strip');
      assert.ok(folded.right + 4 <= folded.toolbarLeft, 'folded demo clears the second strip');
    }
    await click('#btn-demo-open');
    await delay(350);
    await click('#btn-demo-close');
    await screenshot(`${out}/${width}x${height}-warning-takeover.png`);
    await click('#btn-skip-demo');
    await evaluate(() => { window.simulator.telemetry.warnings = []; window.simulator.updateHUD(); });
    assert.ok(await evaluate('!window.simulator.demoDirector.isActive'), 'take control is reachable');
    results.push({ width, height, cameraModes: 8, bounds: baseline, demo });
    console.log(`${width}x${height}: camera parity, AP, more, trim/brake, mute and demo passed`);
  }
  // Issue #798: the Option-tab checkboxes choose the optional top-menu buttons.
  const CONTROLS = ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser', 'open-flight-more'];
  const CAMERAS = ['chase', 'drone', 'flyby', 'wing', 'cockpit', 'hud', 'tower', 'gear', 'auto', 'director'];
  const chooseToolbar = async shown => {
    await evaluate(shown => {
      for (const input of document.querySelectorAll('#toolbar-options [data-toolbar-item]')) {
        if (input.checked !== shown.includes(input.dataset.toolbarItem)) input.click();
      }
    }, shown);
    await delay(150);
  };
  const toolbarState = () => evaluate(() => {
    const bar = document.querySelector('.flight-toolbar');
    const strip = document.getElementById('camera-strip');
    const visible = [...bar.querySelectorAll('button')].filter(n => n.getClientRects().length);
    return {
      ids: visible.map(n => n.id),
      rows: new Set(visible.map(n => Math.round(n.getBoundingClientRect().y))).size,
      stacked: bar.classList.contains('camera-strip-stacked'),
      fits: bar.scrollWidth <= bar.clientWidth + 1 && (strip.hidden || strip.scrollWidth <= strip.clientWidth + 1),
      small: visible.filter(n => { const r = n.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(n => n.id),
      summary: document.querySelector('#toolbar-options summary').textContent,
      saved: JSON.parse(localStorage.getItem('flight3d.preferences.v1') || '{}').toolbarHidden,
    };
  });
  const seven = CAMERAS.filter(name => !['flyby', 'wing', 'tower'].includes(name));
  for (const [width, height] of [[390, 844], [320, 568], [926, 428]]) {
    const portrait = height > width;
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile: true, deviceScaleFactor: 1 });
    await delay(150);
    await chooseToolbar([]);
    const none = await toolbarState();
    assert.deepEqual(none.ids, CONTROLS, `${width}x${height}: only aircraft controls and overflow remain`);
    assert.ok(none.rows === 1 && !none.stacked && none.fits && !none.small.length,
      `${width}x${height}: an empty selection is one undragged row: ${JSON.stringify(none)}`);
    assert.equal(none.saved.length, 11, 'every optional item is saved as hidden');
    await screenshot(`${out}/${width}x${height}-toolbar-none.png`);
    await chooseToolbar(['cam-chase']);
    const one = await toolbarState();
    assert.deepEqual(one.ids, [...CONTROLS, 'btn-cam-chase'], `${width}x${height}: one camera follows the controls`);
    // A 320px row holds the six fixed buttons only, so its single camera wraps.
    assert.ok(one.rows === (width >= 390 ? 1 : 2) && one.fits, `${width}x${height}: one camera row count: ${JSON.stringify(one)}`);
    // Without cameras, fullscreen alone takes the second 320px row rather than
    // scrolling the gear lever out of the first one.
    await chooseToolbar(['fullscreen']);
    const full = await toolbarState();
    assert.ok(full.rows === (width >= 390 ? 1 : 2) && full.fits && !full.small.length && full.ids.at(-1) === 'btn-fullscreen',
      `${width}x${height}: fullscreen without cameras: ${JSON.stringify(full)}`);
    await chooseToolbar([...seven.map(name => `cam-${name}`), 'fullscreen']);
    const some = await toolbarState();
    assert.deepEqual(some.ids.filter(id => id.startsWith('btn-cam-')), seven.map(name => `btn-cam-${name}`), 'chosen cameras keep toolbar order');
    // At 320px the six fixed buttons plus fullscreen exceed one row, so fullscreen
    // closes the camera row instead of opening a third; only that strip drags.
    assert.equal(some.rows, portrait ? 2 : 1, `${width}x${height}: rows ${JSON.stringify(some)}`);
    if (width >= 390) assert.ok(some.fits, `${width}x${height}: seven cameras need no drag: ${JSON.stringify(some)}`);
    assert.ok(!some.small.length, `minimum targets: ${some.small}`);
    assert.match(some.summary, /8\/11/, 'summary counts the shown items');
    assert.deepEqual(some.saved, ['cam-flyby', 'cam-wing', 'cam-tower'], 'hidden items are saved in toolbar order');
    await screenshot(`${out}/${width}x${height}-toolbar-seven.png`);
    await evaluate(() => window.simulator.controls.onSelectCamera(4));
    await delay(150);
    assert.deepEqual((await toolbarState()).ids, some.ids, 'selecting a hidden camera does not bring its button back');
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 4, 'a hidden camera stays selectable');
  }
  await evaluate(() => document.getElementById('toolbar-options-reset').click());
  await delay(150);
  const all = await toolbarState();
  assert.equal(all.ids.filter(id => id.startsWith('btn-cam-')).length, 10, 'show all restores every camera');
  assert.ok(all.ids.includes('btn-fullscreen') && all.saved.length === 0, 'show all restores fullscreen and saves an empty list');
  // Preserve HUD selection across aircraft resets and menu transitions.
  for (const aircraft of ['C172', 'F16', 'B738']) {
    await evaluate(aircraft => {
      const s = window.simulator;
      s.controls.onSelectCamera(8); s.setAircraft(aircraft); s.setPreset('runway');
    }, aircraft);
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 8);
  }
  await evaluate(() => window.simulator.gameFlow.returnToLobby(true));
  assert.equal(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'), 'none');
  await evaluate(() => { window.simulator.gameFlow.enterFlight(); window.simulator.updateHUD(); });
  assert.notEqual(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'), 'none');
  // Reproduce the user's F16 Sihwa-demo portrait screen with the new controls.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 660, mobile: true, deviceScaleFactor: 1 });
  await evaluate(async () => {
    const s = window.simulator;
    s.setAircraft('F16'); await s.setAirport('incheon');
    s.demoDirector.start('incheon', 'sihwa-tour');
    s.controls.onSelectCamera(1);
    document.getElementById('lobby-lang-ko').click();
  });
  await delay(500);
  await screenshot(`${out}/390x660-f16-sihwa-demo-ko.png`);
  await click('#btn-skip-demo');
  assert.ok(await evaluate('!window.simulator.demoDirector.isActive'), 'Korean take-control in Sihwa demo');
  const heldPosition = await evaluate('window.simulator.position.toArray()');
  await click('#menu-toggle');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'lobby', 'menu button opens main menu directly');
  assert.ok(await evaluate('!document.getElementById("btn-lobby-resume").hidden'), 'main menu offers resume');
  // The menu button is a one-click toggle (1b46d29f): from the main menu it resumes
  // the held sortie rather than starting a new one.
  await evaluate(() => document.getElementById('menu-toggle').click());
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'repeated menu press resumes the held flight');
  assert.deepEqual(await evaluate('window.simulator.position.toArray()'), heldPosition, 'menu toggle resume preserves held position');
  await click('#menu-toggle');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'lobby', 'menu button reopens main menu');
  await click('#btn-lobby-resume');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'resume returns to flight');
  assert.deepEqual(await evaluate('window.simulator.position.toArray()'), heldPosition, 'resume preserves held position');
  await click('#menu-toggle');
  await evaluate(() => {
    const s = window.simulator;
    s.lobby.airport = s.activeAirport;
    s.lobby.aircraft = s.currentAircraftId;
    s.lobby.preset = 'runway';
    s.lobbyScreen.refresh();
    const respawn = s.setPreset;
    s.setPreset = function (...args) { this.__menuStarts = (this.__menuStarts || 0) + 1; return respawn.apply(this, args); };
  });
  // With a held sortie the menu replaces "start new" with an explicit restart
  // (UI state contract, 9596335a).
  assert.ok(await evaluate('document.getElementById("btn-fly").hidden'), 'held sortie hides start new');
  await click('#btn-lobby-restart');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'restart leaves main menu');
  assert.equal(await evaluate('window.simulator.__menuStarts'), 1, 'restart explicitly respawns');
  // A saved selection is restored by startup, before any option is touched.
  await chooseToolbar(['cam-chase', 'cam-cockpit']);
  await send('Page.reload');
  await delay(1000);
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)').catch(() => false)) break;
    await delay(500);
  }
  const restored = await evaluate(() => ({
    cameras: [...document.querySelectorAll('#camera-strip .flight-camera-btn')].filter(n => !n.hidden).map(n => n.id),
    fullscreenHidden: document.getElementById('btn-fullscreen').hidden,
    checked: [...document.querySelectorAll('#toolbar-options [data-toolbar-item]')].filter(n => n.checked).map(n => n.dataset.toolbarItem),
  }));
  assert.deepEqual(restored, { cameras: ['btn-cam-chase', 'btn-cam-cockpit'], fullscreenHidden: true, checked: ['cam-chase', 'cam-cockpit'] },
    `reload restores the selection: ${JSON.stringify(restored)}`);
  assert.deepEqual(exceptions, [], 'no browser exceptions');
  await writeFile(`${out}/results.json`, JSON.stringify({ gpu, results }, null, 2));
});
