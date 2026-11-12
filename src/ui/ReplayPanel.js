import { bindText, t, translateDOM } from '../i18n/index.js';
import { REPLAY_SPEEDS } from '../replay/replayConfig.js';
import { flightDuration } from '../core/FlightRecorder.js';

const CAMERAS = ['cockpit', 'chase', 'wing', 'tower', 'flyby', 'gear', 'drone', 'auto', 'hud', 'director'];

export class ReplayPanel {
  constructor(sim) {
    this.sim = sim;
    this.root = document.getElementById('replay-panel');
    this.library = document.getElementById('replay-library');
    this.root.innerHTML = `
      <header>
        <strong data-i18n="replay.title"></strong>
        <div class="replay-header-actions">
          <button class="btn btn-card-fold replay-fold-btn" data-fold type="button" data-i18n-title="ui.fold" data-i18n-aria-label="ui.fold">
            <span class="fold-glyph" aria-hidden="true">▾</span>
            <span class="fold-caption" data-i18n="ui.fold"></span>
          </button>
          <button class="btn" data-exit data-i18n="replay.exit"></button>
        </div>
      </header>
      <div class="replay-transport">
        <button class="btn" data-step="-1" data-i18n-aria-label="replay.previous">⏮</button>
        <button class="btn" data-play></button>
        <button class="btn" data-step="1" data-i18n-aria-label="replay.next">⏭</button>
        <output data-time></output>
      </div>
      <input data-seek type="range" min="0" max="1" step="0.01" value="0" data-i18n-aria-label="replay.seek">
      <div class="replay-speeds" role="group" data-i18n-aria-label="replay.speed">${REPLAY_SPEEDS.map(speed => `<button class="btn" data-speed="${speed}" aria-pressed="false">${speed * 100}%</button>`).join('')}</div>
      <div class="replay-cameras" role="group" data-i18n-aria-label="replay.camera">${CAMERAS.map((name, mode) => `<button class="btn" data-camera="${mode}" aria-pressed="false"></button>`).join('')}</div>
      <p data-wait role="status" data-i18n="replay.waiting" hidden></p>
      <button class="btn ui-unfold-pill replay-unfold-pill" data-unfold type="button" hidden data-i18n-title="ui.unfold" data-i18n-aria-label="ui.unfold">
        <span class="unfold-icon">▶</span>
        <span class="unfold-caption" data-i18n="replay.title"></span>
        <output data-time-mini></output>
        <span class="unfold-glyph" aria-hidden="true">▴</span>
      </button>`;
    this.library.innerHTML = `<div class="replay-library-card">
      <header><h2 id="replay-library-title" data-i18n="replay.library"></h2><button class="btn" data-close data-i18n="ui.close"></button></header>
      <p data-i18n="replay.storageHint"></p>
      <label class="btn replay-import"><span data-i18n="replay.import"></span><input type="file" accept=".json,application/json" data-import></label>
      <p data-status role="status" aria-live="polite"></p><div data-list></div></div>`;
    translateDOM(this.root); translateDOM(this.library);
    for (const [mode, name] of CAMERAS.entries()) bindText(this.root.querySelector(`[data-camera="${mode}"]`), () => t(`ui.camera.${name}`));
    bindText(this.root.querySelector('[data-play]'), () => t(sim.replayDirector.paused ? 'replay.play' : 'replay.pause'));
    this.root.querySelector('[data-play]').addEventListener('click', () => sim.replayDirector.togglePause());
    this.root.querySelector('[data-exit]').addEventListener('click', () => this.exit());
    this.isFolded = false;
    this.root.querySelector('[data-fold]')?.addEventListener('click', () => this.setFolded(true));
    this.root.querySelector('[data-unfold]')?.addEventListener('click', () => this.setFolded(false));
    this.root.querySelector('[data-seek]').addEventListener('input', e => sim.replayDirector.seek(e.target.value));
    for (const el of this.root.querySelectorAll('[data-step]')) el.addEventListener('click', () => sim.replayDirector.stepFrame(Number(el.dataset.step)));
    for (const el of this.root.querySelectorAll('[data-speed]')) el.addEventListener('click', () => sim.replayDirector.setSpeed(el.dataset.speed));
    for (const el of this.root.querySelectorAll('[data-camera]')) el.addEventListener('click', () => {
      sim.controls.onSelectCamera(Number(el.dataset.camera)); this.refresh();
    });
    this.library.querySelector('[data-close]').addEventListener('click', () => this.closeLibrary());
    this.library.addEventListener('click', e => { if (e.target === this.library) this.closeLibrary(); });
    this.library.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeLibrary(); }
      if (e.key !== 'Tab') return;
      const els = [...this.library.querySelectorAll('button, input')].filter(el => !el.disabled && el.getClientRects().length);
      const target = e.shiftKey && document.activeElement === els[0] ? els.at(-1)
        : !e.shiftKey && document.activeElement === els.at(-1) ? els[0] : null;
      if (target) { e.preventDefault(); target.focus(); }
    });
    this.library.querySelector('[data-import]').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (file.size > 2_000_000) throw new Error('oversized');
        const { entry } = sim.replayStore.importJson(await file.text());
        this.status(entry ? 'replay.imported' : 'replay.importFailed');
        this.track('import', Boolean(entry));
        this.renderList();
      } catch { this.status('replay.importFailed'); this.track('import', false); }
      e.target.value = '';
    });
  }

  status(key) { bindText(this.library.querySelector('[data-status]'), () => key ? t(key) : ''); }
  track(action, ok) { this.sim.analytics?.trackReplayLibraryAction?.({ action, ok }); }

  // A multiplayer room owns the local aircraft pose, so only playback waits for leaving it;
  // the library itself stays reachable for rename, export, delete and import (#642).
  watchBlocked() { return Boolean(this.sim.multiplayer?.active); }

  openLibrary() {
    if (this.sim.startingFlight) return;
    this.previousFocus = document.activeElement;
    this.status(this.watchBlocked() ? 'replay.multiplayerBlocked' : null); this.renderList();
    this.library.hidden = false;
    this.library.querySelector('[data-close]').focus();
  }

  closeLibrary() {
    if (this.library.hidden) return;
    this.library.hidden = true;
    this.previousFocus?.focus();
  }

  renderList() {
    const list = this.library.querySelector('[data-list]');
    list.replaceChildren();
    const entries = this.sim.replayStore.list();
    if (!entries.length) {
      const empty = document.createElement('p'); bindText(empty, () => t('replay.empty')); list.append(empty);
    }
    for (const entry of entries) {
      const row = document.createElement('article'); row.className = 'replay-entry';
      const label = document.createElement('input'); label.value = entry.label; label.maxLength = 64;
      bindText(label, () => t('replay.name'), 'aria-label');
      label.addEventListener('change', () => {
        if (!this.sim.replayStore.rename(entry.id, label.value)) this.status('replay.saveFailed');
        this.renderList();
      });
      const info = document.createElement('p');
      info.className = 'replay-entry-info';
      info.textContent = `${flightDuration(entry.durationSec)} · ${new Date(entry.savedAt).toLocaleString()}`;
      row.append(label, info);
      if (entry.summary) {
        const summaryEl = document.createElement('p');
        summaryEl.className = 'replay-entry-summary';
        const parts = [];
        if (entry.summary.reason) {
          const pillKey = `debrief.pill.${entry.summary.reason}`;
          const reasonKey = `debrief.reason.${entry.summary.reason}`;
          const pillText = t(pillKey);
          if (pillText !== pillKey) {
            parts.push(pillText);
          } else {
            const reasonText = t(reasonKey);
            parts.push(reasonText !== reasonKey ? reasonText : entry.summary.reason);
          }
        }
        if (entry.summary.touchdown?.sinkRateFpm != null) {
          parts.push(`${Math.round(entry.summary.touchdown.sinkRateFpm).toLocaleString('en-US')} FPM`);
        }
        if (entry.summary.touchdown?.contactG != null) {
          parts.push(`${entry.summary.touchdown.contactG.toFixed(2)} G`);
        }
        if (entry.summary.crash?.speedKnots != null) {
          const crashKey = entry.summary.crash.type ? `debrief.target.${entry.summary.crash.type}` : null;
          const target = crashKey ? (t(crashKey) === crashKey ? entry.summary.crash.type : t(crashKey)) : null;
          parts.push(`${target ? target + ' · ' : ''}${Math.round(entry.summary.crash.speedKnots)} KT`);
        }
        if (Number.isFinite(entry.summary.peakG) && entry.summary.touchdown?.contactG == null) {
          parts.push(`${entry.summary.peakG.toFixed(2)} G`);
        }
        if (parts.length) {
          summaryEl.textContent = parts.join(' · ');
          row.append(summaryEl);
        }
      }
      const actions = document.createElement('div'); actions.className = 'replay-entry-actions';
      for (const action of ['watch', 'export', 'delete']) {
        const button = document.createElement('button'); button.className = 'btn'; button.dataset.action = action;
        bindText(button, () => t(`replay.${action}`));
        if (action === 'watch') button.disabled = this.watchBlocked();
        button.addEventListener('click', async () => {
          if (action === 'watch') {
            const saved = this.sim.replayStore.get(entry.id);
            if (!saved) { this.status('replay.loadFailed'); return; }
            button.disabled = true;
            if (await this.watch(saved.track, entry.id)) {
              this.closeLibrary(); this.root.querySelector('[data-play]').focus();
            }
            else this.status('replay.loadFailed');
            button.disabled = false;
          } else if (action === 'export') {
            const json = this.sim.replayStore.exportJson(entry.id);
            this.track('export', Boolean(json));
            if (!json) { this.status('replay.loadFailed'); return; }
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = `flight3d-replay-${entry.id}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } else {
            const removed = this.sim.replayStore.remove(entry.id);
            this.track('delete', removed);
            if (!removed) this.status('replay.saveFailed');
            this.renderList(); this.library.querySelector('[data-close]').focus();
          }
        });
        actions.append(button);
      }
      row.append(actions); list.append(row);
    }
  }

  setFolded(folded) {
    this.isFolded = Boolean(folded);
    this.root.classList.toggle('is-folded', this.isFolded);
    const unfoldBtn = this.root.querySelector('[data-unfold]');
    if (unfoldBtn) unfoldBtn.hidden = !this.isFolded;
    if (this.isFolded) unfoldBtn?.focus();
    else this.root.querySelector('[data-fold]')?.focus();
  }

  /**
   * @param {{returnTo?: () => boolean}} [options] set by the debrief that opened this playback, so
   * leaving goes back to it and its save/share actions stay reachable (#648)
   */
  async watch(track, entryId = null, { returnTo = null } = {}) {
    this.returnTo = null;
    const ok = await this.load(track, entryId);
    if (ok) this.returnTo = returnTo;
    // A library entry has an id; the debrief plays the sortie that just ended.
    this.sim.analytics?.trackReplayWatched?.({ source: entryId ? 'library' : 'debrief', ok,
      metadata: track?.metadata, durationSeconds: track?.durationSec });
    return ok;
  }

  async load(track, entryId) {
    try {
      this.setFolded(false);
      if (!await this.sim.replayDirector.load(track, { entryId })) return false;
      this.sim.replayDirector.play(); this.refresh();
      this.root.querySelector('[data-play]').focus();
      return true;
    } catch (error) {
      console.warn('Replay load failed:', error);
      this.sim.replayDirector.stop();
      this.sim.gameFlow.returnToLobby(false);
      return false;
    }
  }

  exit() {
    this.setFolded(false);
    const returnTo = this.returnTo;
    this.returnTo = null;
    if (returnTo?.()) return;
    // Freeze live physics before releasing pose ownership.
    this.sim.gameFlow.returnToLobby(false);
    this.sim.replayDirector.stop();
    document.getElementById('btn-replays')?.focus();
  }

  refresh() {
    const director = this.sim.replayDirector;
    this.root.hidden = !director.active;
    document.body.classList.toggle('replaying', director.active);
    if (!director.active) return;
    this.root.querySelector('[data-play]').textContent = t(director.paused ? 'replay.play' : 'replay.pause');
    const seek = this.root.querySelector('[data-seek]');
    seek.max = director.durationSec; seek.value = director.progressSec;
    const timeFormatted = `${flightDuration(director.progressSec)} / ${flightDuration(director.durationSec)}`;
    this.root.querySelector('[data-time]').textContent = timeFormatted;
    const timeMini = this.root.querySelector('[data-time-mini]');
    if (timeMini) timeMini.textContent = ` (${timeFormatted})`;
    this.root.querySelector('[data-wait]').hidden = !director.waitingTerrain;
    for (const el of this.root.querySelectorAll('[data-speed]')) el.setAttribute('aria-pressed', String(Number(el.dataset.speed) === director.speed));
    for (const el of this.root.querySelectorAll('[data-camera]')) el.setAttribute('aria-pressed', String(Number(el.dataset.camera) === (this.sim.cameraSystem.autoSwitch ? 7 : this.sim.cameraSystem.mode)));
  }
}
