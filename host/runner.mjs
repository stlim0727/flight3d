import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, mkdtemp, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfig, findChrome } from './config.mjs';
import { serveHost } from './http.mjs';
import { connectCdp, until, delay } from '../scripts/lib/cdpClient.mjs';
import { getFreePort } from '../scripts/lib/browserHarness.mjs';
import { newRoom, validRoom, inviteUrl } from '../src/multiplayer/roomCode.js';
import { RoomDirectoryClient } from '../src/multiplayer/RoomDirectoryClient.js';

export async function runCli({ readAsset, args = process.argv.slice(2) }) {
  const manifest = JSON.parse(await readAsset('manifest.json', 'utf8'));
  const config = readConfig(args);
  if (config.flags.has('help')) {
    console.log(`flight3d-ghost-host ${manifest.version}\n\nRun a normal multiplayer host without a GPU or game checkout. Requires installed Chrome/Chromium. Native releases include Node; the portable JavaScript package requires Node 22.23.2+.\n\nOptions:\n  --name NAME          Pilot name (default Maverick)\n  --state-dir DIR      Persistent room state\n  --room CODE          Optional six-character room code\n  --public-url URL     Game URL used for invitations\n  --chrome PATH        Installed browser executable\n  --signal-url URL     PeerServer URL matching the guest deployment\n  --ice-servers JSON   ICE configuration matching the guest deployment\n  --directory URL      Public room directory API URL\n  --public             Register room in public directory\n  --version            Release and compatibility information\n  --check              Validate configuration/browser without starting a room\n  --help               Show this help\n\nConfiguration can also use GHOST_NAME, GHOST_STATE_DIR, GHOST_ROOM, GHOST_PUBLIC_URL, CHROME_PATH, GHOST_SIGNAL_URL, GHOST_ICE_SERVERS, GHOST_DIRECTORY_URL and GHOST_PUBLIC.`);
  } else if (config.flags.has('version')) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    const chrome = findChrome(config.chrome);
    if (config.flags.has('check')) console.log(JSON.stringify({ ...manifest, chrome, stateDir: config.stateDir }, null, 2));
    else await run(chrome);
  }
  async function run(chrome) {
    const stateDir = config.stateDir;
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const statePath = join(stateDir, 'room.json');
    let saved;
    try { saved = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (saved?.schema !== undefined && saved.schema !== manifest.configSchema) throw new Error('Unsupported room-state schema; use a compatible host release.');
    const code = config.room || saved?.room || newRoom();
    if (!validRoom(code)) throw new Error(`Invalid saved room in ${statePath}; preserve or explicitly replace it with --room CODE.`);
    const invite = inviteUrl(code, config.publicUrl);
    const stateTmp = join(stateDir, `room.${process.pid}.tmp`);
    await writeFile(stateTmp, JSON.stringify({ schema: 1, room: code, invite, name: config.name }, null, 2) + '\n', { mode: 0o600 });
    await rename(stateTmp, statePath); await chmod(statePath, 0o600);
    const profile = await mkdtemp(join(tmpdir(), 'flight3d-ghost-'));
    let browser, server, client, watchdog, directoryClient;
    let stopping = false, polling = false, chromeLog = '', status = { state: 'starting', registered: false };
    const log = value => console.log(JSON.stringify(value));
    async function stop() {
      if (stopping) return;
      stopping = true; clearInterval(watchdog);
      if (directoryClient) {
        directoryClient.stopHeartbeat();
        await directoryClient.unregister().catch(() => {});
      }
      try { await Promise.race([client?.send('Browser.close').catch(() => {}), delay(1000)]); } catch { /* Browser may already have exited. */ }
      client?.close(); browser?.kill('SIGTERM');
      server?.closeAllConnections();
      await new Promise(resolve => server ? server.close(resolve) : resolve());
      await delay(300); await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
    process.on('SIGTERM', () => { void stop(); }); process.on('SIGINT', () => { void stop(); });
    try {
      server = await serveHost(readAsset, () => ({ ready: Boolean(!stopping && status.registered && status.state !== 'ended'), ...manifest, state: status.state }));
      const port = server.address().port, cdpPort = await getFreePort();
      browser = spawn(chrome, [
        '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
        '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
        '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--autoplay-policy=no-user-gesture-required', '--disable-webgl', '--disable-software-rasterizer',
        ...(config.noSandbox ? ['--no-sandbox'] : []), 'about:blank',
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      browser.stderr.on('data', data => { chromeLog = (chromeLog + data).slice(-4000); });
      browser.on('error', error => { console.error(error.message); process.exitCode = 1; void stop(); });
      browser.on('exit', () => { if (!stopping) { process.exitCode = 1; void stop(); } });
      await until(async () => {
        if (stopping) throw new Error('Browser failed to start');
        try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; }
      }, 'host browser');
      const tab = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/`)}`, { method: 'PUT' })).json();
      client = await connectCdp(tab.webSocketDebuggerUrl); await client.send('Runtime.enable');
      await until(() => client.evaluate('typeof window.startGhostHost === "function"'), 'host bundle');
      await client.evaluate(`window.startGhostHost(${JSON.stringify({ room: code, name: config.name, options: config.options })})`);
      await until(async () => {
        status = await client.evaluate('JSON.parse(JSON.stringify(window.ghostHost))');
        if (status?.transportError === 'unavailable-id') throw new Error('Room code is already in use. Stop the other host or choose another --room code.');
        return status?.registered;
      }, 'signaling registration', 60000);
      log({ event: 'ready', name: config.name, room: code, invite, ...manifest,
        statePath, healthUrl: `http://127.0.0.1:${port}/health`, cdpEndpoint: `http://127.0.0.1:${cdpPort}` });
      let registering = false, lastDirectoryAttempt = 0;
      async function syncDirectory() {
        if (!config.isPublic || !config.directoryUrl || stopping || !status?.registered || status?.state === 'ended') return;
        if (directoryClient?.isRegistered || registering) return;
        const now = Date.now();
        if (now - lastDirectoryAttempt < 10000) return;
        lastDirectoryAttempt = now;
        registering = true;
        try {
          const reg = await directoryClient.register({
            roomCode: code,
            name: config.name,
            airport: 'coastal',
            aircraft: 'B738',
            scenario: 'cruise',
            currentPlayers: status.remoteName ? 2 : 1,
            maxPlayers: 2,
            status: status.state === 'flying' ? 'flying' : (status.remoteName ? 'full' : 'waiting'),
            protocolMajor: manifest.protocolVersion,
            flightRevision: manifest.flightRevision,
          });
          if (stopping) {
            if (reg?.ok) {
              await directoryClient.unregisterLease(reg.registration).catch(() => {});
            }
            return;
          }
          if (reg?.ok) {
            log({ event: 'directory-registered', id: reg.registration.id, directory: config.directoryUrl });
            directoryClient.startHeartbeat({
              intervalMs: 15000,
              getStatus: () => {
                const cur = status;
                const currentPlayers = cur?.remoteName ? 2 : 1;
                const roomStatus = cur?.state === 'flying' ? 'flying' : (cur?.remoteName ? 'full' : 'waiting');
                return { currentPlayers, maxPlayers: 2, status: roomStatus };
              },
            });
          } else {
            console.warn(`[GhostHost] Directory registration failed: ${reg?.error} (continuing flight process)`);
          }
        } catch (err) {
          console.warn(`[GhostHost] Directory registration error: ${err.message} (continuing flight process)`);
        } finally {
          registering = false;
        }
      }
      if (config.isPublic && config.directoryUrl) {
        directoryClient = new RoomDirectoryClient({ directoryUrl: config.directoryUrl });
        await syncDirectory();
      }
      if (stopping) return;
      let previous = '', lastSimulationTime, lastProgressAt = Date.now();
      watchdog = setInterval(async () => {
        if (polling || stopping) return;
        polling = true;
        try {
          status = await client.evaluate('JSON.parse(JSON.stringify(window.ghostHost))');
          if (client.errors.length || !status) throw new Error(client.errors.join('\n') || 'missing-host');
          if (status.state !== 'flying' || status.simSeconds !== lastSimulationTime) lastProgressAt = Date.now();
          else if (Date.now() - lastProgressAt > 15000) throw new Error('Host simulation stalled');
          lastSimulationTime = status.simSeconds;
          const summary = JSON.stringify({ state: status.state, generation: status.generation, reason: status.reason, compatibilityFailure: status.compatibilityFailure });
          if (summary !== previous) { log({ event: 'state', ...JSON.parse(summary) }); previous = summary; }
          await syncDirectory();
        } catch (error) { if (!stopping) { console.error(error.message); process.exitCode = 1; await stop(); } }
        finally { polling = false; }
      }, 2000);
    } catch (error) {
      console.error(error.message, chromeLog); process.exitCode = 1; await stop();
    }
  }
}
