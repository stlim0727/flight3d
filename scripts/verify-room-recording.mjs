// Task 2 acceptance: production recorder/controller/store/library with a deterministic peer
// fixture. This is not two-peer WebRTC or multi-aircraft playback acceptance (Task 3).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';
import { until } from './lib/cdpClient.mjs';

process.env.GPU_ANGLE = process.platform === 'win32' ? 'd3d11' : 'vulkan';
process.env.CHROME_PATH ||= process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/home/stlim/.local/bin/chrome-headless';
const output = resolve('review-artifacts/room-recording');
await mkdir(output, { recursive: true });
await withBrowserSession({ width: 1280, height: 800 }, async ({ origin, cdpPort, send, evaluate, screenshot, exceptions }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: `${output}/gpu.json` }, stdio: 'inherit', windowsHide: true,
  });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `${origin}/?airport=coastal&aircraft=C172&instant=1` });
  await until(() => evaluate('!!window.simulator && !document.body.classList.contains("booting")'), 'boot', 90000);
  const result = await evaluate(async () => {
    const s = window.simulator;
    const { RoomReplaySession } = await import('/src/replay/RoomReplaySession.js');
    const { MultiplayerController } = await import('/src/multiplayer/MultiplayerController.js');
    const { sampleTrack, sampleRemote } = await import('/src/replay/TrackSampler.js');
    const { setLanguage } = await import('/src/i18n/index.js');
    setLanguage('ko');
    const defaultDisabled = s.multiplayer.roomReplay === null;
    Object.assign(s.lobby, { airport: 'coastal', aircraft: 'C172', preset: 'cruise' });
    await s.fly();
    let now = 0, remoteX = 100;
    const recorder = new RoomReplaySession(s.replayStore, { now: () => now });
    recorder.start({ airport: 'coastal', aircraft: 'C172', scenario: 'cruise', timeOfDay: 12,
      room: { local: { name: '내 기체', slot: 0, aircraft: 'C172' } } },
    [{ name: '상대 기체', slot: 1, aircraft: 'C172' }]);
    const controller = Object.assign(Object.create(MultiplayerController.prototype), {
      sim: s, roomReplay: recorder, dialog: { open: false }, preparing: false,
      room: { session: { state: 'flying', round: 1, epoch: 0,
        track: { sample: () => ({ p: [remoteX, 900, 0], q: [0, 0, 0, 1], round: 1, epoch: 0,
          gear: 1, flaps: 0, held: false, crashed: false, stale: false }) } } },
    });
    for (let i = 0; i < 30; i++) {
      s.stepSimulation(0.2); now += 200; remoteX += 10; controller.recordReplay();
    }
    s.gameFlow.pause(); controller.dialog.open = true;
    for (let i = 0; i < 15; i++) { now += 200; remoteX += 10; controller.recordReplay(); }
    now += 5000; remoteX += 1000; controller.recordReplay();
    now += 200; controller.recordReplay();
    const saved = recorder.finish('left');
    const duplicate = recorder.finish('pagehide');
    if (!saved?.entry) throw new Error(`room save failed: ${saved?.error}`);
    const track = s.replayStore.get(saved.entry.id).track;
    const exported = s.replayStore.exportJson(saved.entry.id);
    const imported = s.replayStore.importJson(exported);
    if (!imported.entry) throw new Error('room import failed');
    s.replayStore.rename(imported.entry.id, '함께 비행 · 보관 사본');
    s.replayPanel.openLibrary();
    return { defaultDisabled, duplicateIgnored: duplicate === null, held: sampleTrack(track, 8).held,
      remoteMoved: sampleRemote(track, 0, 8).x > sampleRemote(track, 0, 6).x,
      gap: !sampleTrack(track, 11).visible && !sampleRemote(track, 0, 11).visible,
      metadataPreserved: JSON.stringify(track.metadata.room) === JSON.stringify(s.replayStore.get(imported.entry.id).track.metadata.room),
      roomCount: s.replayStore.list().filter(entry => entry.metadata.room).length,
      blocked: [...document.querySelectorAll('[data-action="watch"]')].every(button => button.disabled),
      namesVisible: document.getElementById('replay-library').textContent.includes('상대 기체') };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, name === 'roomCount' ? 2 : true, name);
  await screenshot(`${output}/library.png`);
  await evaluate('window.roomReloadMarker = true');
  await send('Page.reload');
  await until(() => evaluate('!window.roomReloadMarker && !!window.simulator && !document.body.classList.contains("booting")'), 'reload', 90000);
  assert.equal(await evaluate('window.simulator.replayStore.list().filter(entry => entry.metadata.room).length'), 2);
  assert.deepEqual(exceptions, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ ...result, persistedAfterReload: true, exceptions }, null, 2));
  console.log('Room recording controller fixture, storage, import/export and library acceptance passed.');
});
