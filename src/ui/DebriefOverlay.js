import { bindText, t, translateDOM } from '../i18n/index.js';
import { flightDuration } from '../core/FlightRecorder.js';
import { AIRCRAFT_REGISTRY, getAircraftSpecs, classifyLanding } from '../config/aircraftConfigs.js';
import { scenarioLabelKey } from '../config/scenarioRegistry.js';

const airportKeys = { coastal: 'coastal.airport', incheon: 'incheon.airport', lukla: 'lukla.vnlk',
  neon: 'neon.metropolis', valley: 'valley.region' };
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
const g = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const crashName = crash => crash.name ?? t('debrief.reason.crash');
// Collision codes come from CollisionDetector; an unlisted code is shown as-is.
const crashTarget = crash => {
  if (!crash.type) return null;
  const key = `debrief.target.${crash.type}`;
  const text = t(key);
  return text === key ? crash.type : text;
};

export function reportText(report) {
  const m = report.metadata;
  const specs = getAircraftSpecs(m?.aircraft);
  const rawPeakG = report.peaks.gForce?.gForce;
  const peakG = Number.isFinite(rawPeakG)
    ? Math.min(specs.ultimateLoad?.max ?? 3.75, Math.max(specs.ultimateLoad?.min ?? -1.5, rawPeakG))
    : rawPeakG;
  const touchdown = report.touchdowns.at(-1);
  const contactG = touchdown && Number.isFinite(touchdown.contactG)
    ? Math.min(specs.ultimateLoad?.max ?? 3.75, Math.max(0, touchdown.contactG))
    : touchdown?.contactG;
  return [`Flight3d / ${t(airportKeys[m.airport] ?? 'coastal.airport')}`,
    `${AIRCRAFT_REGISTRY[m.aircraft]?.name ?? m.aircraft} · ${t(scenarioLabelKey(m.airport, m.scenario) ?? 'lobby.spawn')}`,
    `${t('debrief.duration')} ${flightDuration(report.durationSec)}`,
    `${t('debrief.altitude')} ${number(report.peaks.altitudeFt?.altitudeFt)} FT · ${t('debrief.speed')} ${number(report.peaks.iasKnots?.iasKnots)} KT`,
    `${t('debrief.g')} ${g(peakG)} G`,
    `${t('debrief.reason')}: ${t(`debrief.reason.${report.reason}`)}`,
    ...(report.crash ? [`${t('debrief.impact')}: ${crashName(report.crash)} · ${number(report.crash.speedKnots)} KT · ${flightDuration(report.crash.timeSec)}`] : []),
    ...(report.crash && crashTarget(report.crash) ? [`${t('debrief.impactTarget')}: ${crashTarget(report.crash)}`] : []),
    report.touchdowns.length ? `${t('debrief.sink')} ${number(touchdown.sinkRateFpm)} FPM · ${t('debrief.contactG')} ${g(contactG)} G` : t('debrief.noTouchdown'),
  ].join('\n');
}

export const SAVE_REPLAY_STATUS = Object.freeze({ tooShort: 'replay.tooShort', tooLong: 'replay.tooLong' });
/** Debrief button id (after `debrief-`) to the `debrief_action` it reports. Camera and fold are autocaptured. */
export const DEBRIEF_ACTIONS = Object.freeze({
  lobby: 'lobby', feedback: 'feedback',
  'watch-replay': 'watch_replay', 'save-replay': 'save_replay', download: 'download',
});

export class DebriefOverlay {
  constructor({ onLobby, onFeedback, onSaveReplay, onWatchReplay, onCycleCamera, getCameraModeName, onAction }) {
    this.getCameraModeName = getCameraModeName;
    this.root = document.getElementById('debrief-overlay');
    this.root.innerHTML = `
      <div class="debrief-overlay" role="dialog" aria-labelledby="debrief-outcome">
        <header class="debrief-header">
          <span id="debrief-pill" class="debrief-header-pill" hidden></span>
          <button class="btn debrief-camera-btn" id="debrief-camera" type="button" data-i18n-title="change.camera.c" data-i18n-aria-label="change.camera.c">
            <span class="debrief-camera-icon" aria-hidden="true">🎥</span>
          </button>
          <button class="btn debrief-feedback-btn" id="debrief-feedback" type="button" data-i18n-title="debrief.feedback" data-i18n-aria-label="debrief.feedback">
            <span class="debrief-feedback-icon" aria-hidden="true">🐞</span>
          </button>
          <button class="btn btn-card-fold debrief-fold-btn" id="debrief-fold" type="button" data-i18n-title="ui.fold" data-i18n-aria-label="ui.fold">
            <span class="fold-glyph" aria-hidden="true">▾</span>
          </button>
        </header>

        <div class="debrief-panels">
          <div class="debrief-outcome"><h3 id="debrief-outcome"></h3><div id="debrief-outcome-tip" role="tooltip" aria-hidden="true" hidden></div></div>
          <p id="debrief-identity" class="debrief-identity"></p>
          <div id="debrief-crash" class="debrief-crash" hidden>
            <strong id="debrief-crash-name"></strong><p id="debrief-crash-desc"></p><p id="debrief-crash-facts" class="debrief-facts"></p>
          </div>
          <div class="debrief-grid">
            <div class="debrief-metric" data-stat="duration"><span data-i18n="debrief.duration"></span><strong id="debrief-stat-duration"></strong></div>
            <div class="debrief-metric" data-stat="altitude"><span data-i18n="debrief.altitude"></span><strong id="debrief-stat-altitude"></strong></div>
            <div class="debrief-metric" data-stat="speed"><span data-i18n="debrief.speed"></span><strong id="debrief-stat-speed"></strong></div>
            <div class="debrief-metric" data-stat="g"><span data-i18n="debrief.g"></span><strong id="debrief-stat-g"></strong></div>
            <div id="debrief-stat-sink-card" class="debrief-metric" data-stat="sink" hidden><span data-i18n="debrief.sink"></span><strong id="debrief-stat-sink"></strong></div>
          </div>
          <div id="debrief-touchdown" class="debrief-touchdown">
            <p id="debrief-contact" class="debrief-facts"></p><p id="debrief-contact-note" class="debrief-contact-note"></p>
          </div>
          <p id="debrief-insufficient" class="debrief-insufficient" data-i18n="debrief.insufficient" hidden></p>

          <div id="debrief-view-record" class="debrief-record-section">
            <svg id="debrief-chart" viewBox="0 0 320 90" role="img" data-i18n-aria-label="debrief.altitudeAxis"><defs><linearGradient id="debrief-altitude-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/></linearGradient></defs><path d="M0 85 H320" stroke="#385268"/><polygon class="debrief-chart-area" fill="url(#debrief-altitude-gradient)"/><polyline fill="none" stroke="#38bdf8" stroke-width="2"/><circle id="debrief-impact-marker" r="4" fill="#ef4444" stroke="#e2e8f0" hidden/><circle id="debrief-cursor" r="3" fill="#e2e8f0"/></svg>
            <input id="debrief-scrub" type="range" min="0" value="0" step="1" data-i18n-aria-label="debrief.inspect" />
            <div id="debrief-axis" class="debrief-axis" aria-hidden="true"></div>
            <p id="debrief-sample" class="debrief-sample" aria-live="polite">—</p>
            <ul id="debrief-events" class="debrief-events"></ul>
          </div>

          <div class="debrief-share-section">
            <p id="debrief-status" role="status" aria-live="polite"></p>
            <textarea id="debrief-preview" readonly aria-hidden="true" tabindex="-1"></textarea>
            <div class="debrief-actions">
              <button class="btn" id="debrief-download"><span class="btn-icon" aria-hidden="true">⬇️</span> <span data-i18n="debrief.download"></span></button>
            </div>
            <div class="debrief-replay-actions">
              <button class="btn" id="debrief-save-replay" hidden><span class="btn-icon" aria-hidden="true">💾</span> <span data-i18n="debrief.saveReplay"></span></button>
              <button class="btn" id="debrief-watch-replay" hidden><span class="btn-icon" aria-hidden="true">▶️</span> <span data-i18n="replay.watch"></span></button>
          </div>
        </div>

        <footer class="debrief-footer">
          <button class="btn debrief-primary debrief-lobby-btn" id="debrief-lobby" type="button" data-i18n-title="debrief.lobby" data-i18n-aria-label="debrief.lobby">
            <span class="debrief-back-glyph" aria-hidden="true">↩</span> <span class="debrief-back-caption" data-i18n="debrief.lobby"></span>
          </button>
        </footer>

        <button id="debrief-unfold" class="ui-unfold-pill debrief-unfold-pill" type="button" hidden data-i18n-title="ui.unfold" data-i18n-aria-label="ui.unfold">
          <span class="unfold-glyph" aria-hidden="true">▴</span>
        </button>
        <button id="debrief-fold-camera" class="ui-unfold-pill debrief-camera-pill" type="button" hidden data-i18n-title="change.camera.c" data-i18n-aria-label="change.camera.c">
          <span class="unfold-icon" aria-hidden="true">🎥</span>
          <span id="debrief-fold-camera-label" class="unfold-caption">CAM</span>
        </button>
      </div>`;
    translateDOM(this.root);
    for (const el of this.root.querySelectorAll('[data-debrief-label]')) bindText(el, () => t(`debrief.${el.dataset.debriefLabel}`));
    this.el('scrub').addEventListener('input', () => this.inspect(Number(this.el('scrub').value)));
    this.el('chart').addEventListener('pointerdown', event => {
      const rect = this.el('chart').getBoundingClientRect();
      const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * this.report.durationSec;
      const index = this.report.samples.reduce((best, sample, i, samples) =>
        Math.abs(sample.timeSec - time) < Math.abs(samples[best].timeSec - time) ? i : best, 0);
      this.inspect(index);
    });
    this.el('watch-replay').addEventListener('click', async () => {
      this.el('watch-replay').disabled = true;
      if (!await onWatchReplay?.()) this.status('replay.loadFailed');
      this.el('watch-replay').disabled = false;
    });
    this.el('lobby').addEventListener('click', onLobby);
    this.el('feedback').addEventListener('click', () => onFeedback?.());
    this.el('camera')?.addEventListener('click', () => {
      onCycleCamera?.();
      this.updateFoldCameraLabel();
    });
    this.el('fold-camera')?.addEventListener('click', () => {
      onCycleCamera?.();
      this.updateFoldCameraLabel();
    });
    this.isFolded = false;
    this.el('fold')?.addEventListener('click', () => this.setFolded(true));
    this.el('unfold')?.addEventListener('click', () => this.setFolded(false));
    this.el('save-replay').addEventListener('click', () => {
      if (this.replaySaved) return;
      const { ok, error } = onSaveReplay?.() ?? { ok: false };
      if (!ok) { this.status(SAVE_REPLAY_STATUS[error] ?? 'replay.saveFailed'); return; }
      // One save per sortie: a second click would only duplicate the row.
      this.replaySaved = true;
      this.el('save-replay').disabled = true;
      this.status('replay.saved');
    });
    // Registered after the handlers above, so telemetry never decides whether an action runs.
    for (const [id, action] of Object.entries(DEBRIEF_ACTIONS)) {
      this.el(id)?.addEventListener('click', () => onAction?.(action, this.report));
    }
    this.el('download').addEventListener('click', () => {
      if (!this.report.sufficient) return;
      const payload = {
        ...this.report,
        ...(this.replay ? { replay: { samples: this.replay.samples, metadata: this.replay.metadata, durationSec: this.replay.durationSec } } : {}),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `flight3d-${this.report.metadata.aircraft}-flight.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status('debrief.downloaded');
    });
    // Issue #370: the headline stays on one line; a clipped one reveals its full text on
    // hover, keyboard focus or tap. The h3 keeps the full text for screen readers.
    const outcome = this.el('outcome');
    outcome.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') this.showOutcomeTip(true); });
    outcome.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch' && document.activeElement !== outcome) this.showOutcomeTip(false);
    });
    outcome.addEventListener('click', () => this.showOutcomeTip(true));
    // Open touch taps on pointerup so they do not depend on the compatibility click.
    outcome.addEventListener('pointerup', event => { if (event.pointerType === 'touch') this.showOutcomeTip(true); });
    outcome.addEventListener('focus', () => this.showOutcomeTip(true));
    outcome.addEventListener('blur', () => this.showOutcomeTip(false));
    document.addEventListener('pointerdown', event => { if (!outcome.contains(event.target)) this.showOutcomeTip(false); });
    // Capture so an open tooltip consumes Escape before the flight ESC chain sees it.
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.el('outcome-tip').hidden) return;
      event.preventDefault(); this.showOutcomeTip(false);
    }, true);
    // Text changes (language) and width changes (viewport) can both change clipping.
    new MutationObserver(() => this.measureOutcome()).observe(outcome, { childList: true, characterData: true, subtree: true });
    new ResizeObserver(() => this.measureOutcome()).observe(outcome);
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const nodes = [...this.root.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
      const target = event.shiftKey && document.activeElement === nodes[0] ? nodes.at(-1)
        : !event.shiftKey && document.activeElement === nodes.at(-1) ? nodes[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    });
  }

  el(name) { return document.getElementById(`debrief-${name}`); }
  status(key) { bindText(this.el('status'), () => key ? t(key) : ''); }

  updateFoldCameraLabel() {
    const label = document.getElementById('debrief-fold-camera-label');
    if (label && this.getCameraModeName) {
      label.textContent = `CAM · ${this.getCameraModeName()}`;
    }
  }

  setFolded(folded) {
    this.isFolded = Boolean(folded);
    this.root.classList.toggle('is-folded', this.isFolded);
    const unfoldBtn = this.el('unfold');
    if (unfoldBtn) unfoldBtn.hidden = !this.isFolded;
    const foldCamBtn = this.el('fold-camera');
    if (foldCamBtn) foldCamBtn.hidden = !this.isFolded;
    if (this.isFolded) {
      this.updateFoldCameraLabel();
      unfoldBtn?.focus();
    } else {
      this.el('fold')?.focus();
    }
  }

  measureOutcome() {
    const outcome = this.el('outcome');
    // Hidden panels report zero widths; the ResizeObserver re-measures once laid out.
    if (!outcome.getClientRects().length) return;
    const clipped = outcome.scrollWidth > outcome.clientWidth + 1;
    outcome.classList.toggle('is-truncated', clipped);
    if (clipped) outcome.tabIndex = 0; else outcome.removeAttribute('tabindex');
    this.el('outcome-tip').textContent = outcome.textContent;
    if (!clipped) this.showOutcomeTip(false);
  }

  showOutcomeTip(open) {
    this.el('outcome-tip').hidden = !(open && this.el('outcome').classList.contains('is-truncated'));
  }

  show(report, replay = null) {
    this.report = report;
    this.replay = replay;
    this.replaySaved = false;
    this.setFolded(false);
    const enough = report.sufficient;
    const crash = report.crash;
    const outcomeEl = this.el('outcome');
    outcomeEl.classList.remove('is-crash', 'is-landed', 'is-ditching', 'is-empty');
    if (!enough) {
      outcomeEl.classList.add('is-empty');
    } else if (crash) {
      outcomeEl.classList.add('is-crash');
    } else if (report.reason === 'ditching') {
      outcomeEl.classList.add('is-ditching');
    } else {
      outcomeEl.classList.add('is-landed');
    }
    const headerPill = this.el('pill');
    if (headerPill) {
      headerPill.hidden = false;
      const stateClass = !enough ? 'is-empty' : crash ? 'is-crash' : report.reason === 'ditching' ? 'is-ditching' : 'is-landed';
      headerPill.className = 'debrief-header-pill ' + stateClass;
      // A 374px-wide phone leaves the title column about 85px, so the pill shows a badge word; the sentence moves to the tooltip.
      const pillState = !enough ? 'empty' : crash ? 'crash' : report.reason;
      bindText(headerPill, () => t(`debrief.pill.${pillState}`));
      bindText(headerPill, () => !enough ? t('debrief.insufficient') : crash ? t('debrief.crashSeverity') : t(`debrief.outcome.${report.reason}`), 'title');
    }
    // A crash headline names the collision; short records keep their own headline, so the block names it.
    bindText(this.el('outcome'), () => !enough ? t('debrief.empty') : crash ? crashName(crash) : t(`debrief.outcome.${report.reason}`));
    this.el('crash').hidden = !crash;
    this.el('crash-name').hidden = enough;
    bindText(this.el('crash-name'), () => crash ? crashName(crash) : '');
    this.el('crash-desc').textContent = crash?.description ?? '';
    this.el('crash-desc').hidden = !crash?.description;
    // Collision target sits on its own line so the speed/time pair keeps its 360px layout.
    const target = crash && crashTarget(crash);
    bindText(this.el('crash-facts'), () => crash
      ? `${target ? `${t('debrief.impactTarget')}  ${crashTarget(crash)}\n` : ''}${t('debrief.impactSpeed')}  ${number(crash.speedKnots)} KT     ${t('debrief.impactTime')}  ${flightDuration(crash.timeSec)}` : '');
    bindText(this.el('identity'), () => enough
      ? `${AIRCRAFT_REGISTRY[report.metadata.aircraft]?.name ?? report.metadata.aircraft} · ${t(airportKeys[report.metadata.airport] ?? 'coastal.airport')}\n${t(scenarioLabelKey(report.metadata.airport, report.metadata.scenario) ?? 'lobby.spawn')} · ${t(`debrief.reason.${report.reason}`)}`
      : t('debrief.emptyHint'));
    const specs = getAircraftSpecs(report.metadata?.aircraft);
    this.el('stat-duration').textContent = flightDuration(report.durationSec);
    this.el('stat-altitude').textContent = `${number(report.peaks.altitudeFt?.altitudeFt)} FT`;
    this.el('stat-speed').textContent = `${number(report.peaks.iasKnots?.iasKnots)} KT`;
    const rawPeakG = report.peaks.gForce?.gForce;
    const clampedPeakG = Number.isFinite(rawPeakG)
      ? Math.min(specs.ultimateLoad?.max ?? 3.75, Math.max(specs.ultimateLoad?.min ?? -1.5, rawPeakG))
      : rawPeakG;
    this.el('stat-g').textContent = `${g(clampedPeakG)} G`;
    for (const key of ['altitude', 'speed', 'g']) this.root.querySelector(`[data-stat="${key}"]`).hidden = !enough;
    const touchdown = report.touchdowns.at(-1);
    const clampedContactG = touchdown && Number.isFinite(touchdown.contactG)
      ? Math.min(specs.ultimateLoad?.max ?? 3.75, Math.max(0, touchdown.contactG))
      : touchdown?.contactG;
    const landingEval = touchdown ? classifyLanding(report.metadata?.aircraft, clampedContactG, touchdown.sinkRateFpm) : null;
    const sinkCard = this.el('stat-sink-card');
    const sinkVal = this.el('stat-sink');
    if (sinkCard && sinkVal) {
      if (enough && touchdown) {
        sinkVal.textContent = `${number(touchdown.sinkRateFpm)} FPM`;
        sinkCard.hidden = false;
      } else {
        sinkCard.hidden = true;
      }
    }
    // After a crash the collision replaces the touchdown block unless a touchdown actually happened.
    this.el('touchdown').hidden = !enough || Boolean(crash && !touchdown);
    bindText(this.el('contact'), () => `${t('debrief.sink')} ${number(touchdown?.sinkRateFpm)} FPM · ${t('debrief.contactG')} ${g(clampedContactG)} G`);
    bindText(this.el('contact-note'), () => {
      if (!touchdown) return t('debrief.noTouchdown');
      if (landingEval?.labelKey) {
        return `${t(landingEval.labelKey)} · ${t('debrief.contactNote')}`;
      }
      return t('debrief.contactNote');
    });
    this.el('insufficient').hidden = enough;
    this.el('view-record').hidden = !enough;
    for (const id of ['download']) {
      const el = this.el(id);
      if (el) {
        el.disabled = !enough;
        el.classList.toggle('is-disabled', !enough);
      }
    }
    // A track the recorder refused to build leaves nothing to keep, so the offer disappears.
    this.el('watch-replay').hidden = !replay;
    this.el('save-replay').hidden = !replay;
    this.el('save-replay').disabled = false;
    bindText(this.el('preview'), () => enough ? reportText(report) : t('debrief.insufficient'));
    this.status(null);
    this.drawChart();
    this.measureOutcome();
  }

  drawChart() {
    const { samples, peaks, durationSec, reason, crash } = this.report;
    const low = Math.min(...samples.map(s => s.altitudeFt), 0);
    const high = Math.max(peaks.altitudeFt?.altitudeFt ?? 1, low + 1);
    this.point = s => [s.timeSec / (durationSec || 1) * 320, 80 - (s.altitudeFt - low) / (high - low) * 65];
    const polylinePoints = samples.map(s => this.point(s).join(',')).join(' ');
    this.el('chart').querySelector('polyline').setAttribute('points', polylinePoints);
    const area = this.el('chart').querySelector('.debrief-chart-area');
    if (area && samples.length) {
      const first = this.point(samples[0]);
      const last = this.point(samples.at(-1));
      area.setAttribute('points', `${first[0]},85 ${polylinePoints} ${last[0]},85`);
    } else if (area) {
      area.removeAttribute('points');
    }
    this.el('axis').replaceChildren(...[0, durationSec / 2, durationSec].map(time => {
      const span = document.createElement('span'); span.textContent = flightDuration(time); return span;
    }));
    // SVG elements have no `hidden` property; toggle the attribute that the card CSS hides.
    const impact = this.el('impact-marker');
    impact.toggleAttribute('hidden', !crash || !samples.length);
    if (crash && samples.length) {
      const [x, y] = this.point(samples.at(-1));
      impact.setAttribute('cx', Math.min(x, 316)); impact.setAttribute('cy', y);
    }
    const events = [[0, () => t('debrief.started')], [peaks.altitudeFt?.timeSec, () => `${t('debrief.altitude')} ${number(peaks.altitudeFt?.altitudeFt)} FT`],
      [peaks.gForce?.timeSec, () => `${t('debrief.g')} ${g(peaks.gForce?.gForce)} G`],
      ...this.report.touchdowns.map(contact => [contact.timeSec, () => `${t('debrief.touchdown')} ${number(contact.sinkRateFpm)} FPM`]),
      [durationSec, () => crash ? `${crashName(crash)} · ${number(crash.speedKnots)} KT` : t(`debrief.reason.${reason}`), Boolean(crash)]];
    this.el('events').replaceChildren(...events.filter(([time]) => Number.isFinite(time)).sort((a, b) => a[0] - b[0]).map(([time, label, isImpact]) => {
      const li = document.createElement('li'); bindText(li, () => `${flightDuration(time)}   ${label()}`);
      li.classList.toggle('debrief-impact', Boolean(isImpact)); return li;
    }));
    this.el('scrub').max = Math.max(0, samples.length - 1);
    this.el('scrub').disabled = !samples.length;
    this.inspect(0);
  }

  inspect(index) {
    this.el('scrub').value = index;
    const sample = this.report.samples[index];
    const circle = this.el('cursor');
    circle.style.display = sample ? '' : 'none';
    if (!sample) { this.el('sample').textContent = '—'; return; }
    const [x, y] = this.point(sample); circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    this.el('sample').textContent = `${flightDuration(sample.timeSec)} · ${number(sample.altitudeFt)} FT · ${number(sample.iasKnots)} KT · ${g(sample.gForce)} G`;
  }

}
