import fs from 'node:fs';
import path from 'node:path';

const SIM_PORT = 5173;
const CHROME_PORT = 9222;
const SIM_URL = `http://localhost:${SIM_PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/bcd826f8-e1a6-4976-85f2-0b2ca46b22fc';

const SCENARIOS = [
  { timeName: 'sunrise', hour: 6.0, label: '일출 (Sunrise 06:00)' },
  { timeName: 'noon', hour: 12.0, label: '정오 (Noon 12:00)' },
  { timeName: 'sunset', hour: 18.0, label: '황혼 (Sunset 18:00)' },
  { timeName: 'night', hour: 23.0, label: '야간 (Night 23:00)' }
];

const ALTITUDES = [
  {
    altName: 'low_100ft',
    y: 30.5, // 100ft
    label: '저고도 (100ft / 30m)'
  },
  {
    altName: 'high_6000ft',
    y: 1828.8, // 6,000ft
    label: '고고도 (6,000ft / 1,828m)'
  }
];

async function main() {
  console.log('🚀 Connecting to Chrome daemon on port 9222...');
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  // Create new tab in headless Chrome
  const newTabRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?about:blank`, { method: 'PUT' });
  if (!newTabRes.ok) {
    throw new Error(`Failed to create browser tab: ${newTabRes.statusText}`);
  }
  const tab = await newTabRes.json();
  console.log(`🔌 Created browser tab: ${tab.id}`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result?.value;
  };

  const takeScreenshot = async (filename) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
    fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
    console.log(`📸 Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });

    console.log(`🌐 Navigating to simulator: ${SIM_URL}`);
    await send('Page.navigate', { url: SIM_URL });

    console.log('⏳ Waiting for simulator 3D engine to initialize...');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 400));
      const ready = await evalJs('Boolean(typeof window.simulator !== "undefined" && window.simulator && window.simulator.aircraft && window.simulator.sky)');
      if (ready) break;
    }

    // Stop demo flight director to take programmatic control
    await evalJs(`
      if (window.simulator.demoDirector) window.simulator.demoDirector.stop();
      window.simulator.gameFlow?.enterFlight();
      window.simulator.cameraSystem.setMode(1); // Chase mode
    `);
    await new Promise(r => setTimeout(r, 600));

    console.log('\n=================== 4대 시간대 × 고도 2단계 검증 시작 ===================');
    const matrixResults = [];

    for (const time of SCENARIOS) {
      for (const alt of ALTITUDES) {
        console.log(`\n▶ [${time.label}] × [${alt.label}] 설정 및 측정 중...`);

        const state = await evalJs(`
          (() => {
            const sim = window.simulator;
            if (${alt.y} < 100) {
              // Low altitude: just lifted off runway heading East towards hills & bay
              sim.position.set(-800, ${alt.y}, 0);
              sim.linearVelocity.set(72, 2.0, 0);
            } else {
              // High altitude: 6,000ft cruising over coastline overlooking bay and islands
              sim.position.set(-1500, ${alt.y}, 1800);
              sim.linearVelocity.set(110, 0, -45);
            }

            sim.aircraft.group.position.copy(sim.position);
            sim.aircraft.group.updateMatrixWorld(true);
            sim.cameraSystem.snapToTarget(sim.aircraft.group);
            sim.cameraSystem.update(0.016, sim.aircraft.group, sim.telemetry);
            sim.sky.setTimeOfDay(${time.hour}, sim.position, sim.camera.position);

            // Measure GPU frame rendering latency over 15 consecutive frames
            const frameTimes = [];
            for (let f = 0; f < 15; f++) {
              const t0 = performance.now();
              sim.renderer.render(sim.scene, sim.camera);
              frameTimes.push(performance.now() - t0);
            }
            const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

            const fogCol = sim.scene.fog ? sim.scene.fog.color : null;
            const fogDens = sim.scene.fog ? sim.scene.fog.density : 0;
            const exposure = sim.renderer.toneMappingExposure;

            return {
              fogR: fogCol ? fogCol.r.toFixed(3) : 0,
              fogG: fogCol ? fogCol.g.toFixed(3) : 0,
              fogB: fogCol ? fogCol.b.toFixed(3) : 0,
              density: fogDens.toExponential(3),
              exposure: exposure.toFixed(2),
              avgRenderMs: avgMs.toFixed(2),
              sunLightIntensity: sim.sky.sunLight.intensity.toFixed(2),
              ambientLightIntensity: sim.sky.ambientLight.intensity.toFixed(2)
            };
          })()
        `);

        // Wait brief settling time
        await new Promise(r => setTimeout(r, 400));

        const filename = `fog_${time.timeName}_${alt.altName}.png`;
        await takeScreenshot(filename);

        matrixResults.push({
          timeLabel: time.label,
          altLabel: alt.label,
          density: state.density,
          fogColor: `rgb(${Math.round(state.fogR * 255)}, ${Math.round(state.fogG * 255)}, ${Math.round(state.fogB * 255)})`,
          exposure: state.exposure,
          renderMs: state.avgRenderMs,
          sunInt: state.sunLightIntensity,
          ambInt: state.ambientLightIntensity,
          filename
        });
      }
    }

    console.log('\n=================== 📊 매트릭스 측정 결과 요약 ===================\n');
    console.table(matrixResults.map(r => ({
      '시간대': r.timeLabel,
      '고도': r.altLabel,
      '안개 밀도 (Density)': r.density,
      '안개 색상 (RGB)': r.fogColor,
      '노출 (Exposure)': r.exposure,
      '렌더 타임 (ms)': `${r.renderMs} ms`
    })));

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'fog_matrix_benchmark.json'),
      JSON.stringify(matrixResults, null, 2)
    );

    console.log('\n✅ 8대 시나리오 캡처 및 성능 검증 완료!');
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:${CHROME_PORT}/json/close/${tab.id}`).catch(() => {});
  }
}

main().catch(err => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
