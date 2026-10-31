import { bindText, t, translateDOM } from '../i18n/index.js';
import { flightDuration } from '../core/FlightRecorder.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { scenarioLabelKey } from '../config/scenarioRegistry.js';

const airportKeys = { coastal: 'coastal.airport', incheon: 'incheon.airport', lukla: 'lukla.vnlk',
  neon: 'neon.metropolis', hangang: 'hangang.title' };
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
const g = value => Number.isFinite(value) ? value.toFixed(2) : '—';

export function reportText(report) {
  const m = report.metadata;
  return [`Flight3d / ${t(airportKeys[m.airport] ?? 'coastal.airport')}`,
    `${AIRCRAFT_REGISTRY[m.aircraft]?.name ?? m.aircraft} · ${t(scenarioLabelKey(m.airport, m.scenario) ?? 'lobby.spawn')}`,
    `${t('debrief.duration')} ${flightDuration(report.durationSec)}`,
    `${t('debrief.altitude')} ${number(report.peaks.altitudeFt?.altitudeFt)} FT · ${t('debrief.speed')} ${number(report.peaks.iasKnots?.iasKnots)} KT`,
    `${t('debrief.g')} ${g(report.peaks.gForce?.gForce)} G`,
    `${t('debrief.reason')}: ${t(`debrief.reason.${report.reason}`)}`,
    report.touchdowns.length ? `${t('debrief.sink')} ${number(report.touchdowns.at(-1).sinkRateFpm)} FPM · ${t('debrief.contactG')} ${g(report.touchdowns.at(-1).contactG)} G` : t('debrief.noTouchdown'),
  ].join('\n');
}

export class DebriefOverlay {
  constructor({ onRetry, onLobby }) {
    this.root = document.getElementById('debrief-overlay');
    this.root.innerHTML = `
      <div class="debrief-card">
        <h2 id="debrief-title">Flight3d</h2>
        <p class="debrief-muted" data-i18n="debrief.title"></p>
        <div class="debrief-tabs" role="tablist" data-i18n-aria-label="debrief.title">
          ${['summary', 'record', 'share'].map(name => `<button class="btn" id="debrief-tab-${name}" role="tab" aria-controls="debrief-${name}" data-debrief-label="${name}"></button>`).join('')}
        </div>
        <div class="debrief-panels">
          <section id="debrief-summary" role="tabpanel" aria-labelledby="debrief-tab-summary" tabindex="0">
            <h3 id="debrief-outcome"></h3><p id="debrief-identity" class="debrief-muted"></p>
            <div class="debrief-stats">
              ${['duration', 'altitude', 'speed', 'g'].map(name => `<div data-stat="${name}"><span data-debrief-label="${name}"></span><strong id="debrief-stat-${name}"></strong></div>`).join('')}
              <div data-stat="empty-touchdown" hidden><span data-i18n="debrief.touchdown"></span><strong>—</strong></div>
            </div>
            <div id="debrief-touchdown"><p class="debrief-caption" data-i18n="debrief.touchdown"></p><p id="debrief-contact"></p><p id="debrief-contact-note" class="debrief-caption"></p></div>
            <p id="debrief-insufficient" class="debrief-muted" data-i18n="debrief.insufficient" hidden></p>
            <button class="btn" id="debrief-view-record" data-i18n="debrief.viewRecord"></button>
          </section>
          <section id="debrief-record" role="tabpanel" aria-labelledby="debrief-tab-record" tabindex="0" hidden>
            <h3 data-i18n="debrief.history"></h3><p class="debrief-caption" data-i18n="debrief.altitudeAxis"></p>
            <svg id="debrief-chart" viewBox="0 0 320 90" role="img" data-i18n-aria-label="debrief.altitudeAxis"><path d="M0 85 H320" stroke="#385268"/><polyline fill="none" stroke="#67d5a3" stroke-width="2"/><circle r="3" fill="#e2e8f0"/></svg>
            <div id="debrief-axis" class="debrief-caption"></div>
            <input id="debrief-scrub" type="range" min="0" value="0" step="1" data-i18n-aria-label="debrief.inspect" />
            <output id="debrief-sample" for="debrief-scrub"></output>
            <ol id="debrief-events"></ol><p class="debrief-muted" data-i18n="debrief.inspectHint"></p>
            <button class="btn" data-debrief-tab="share" data-i18n="debrief.shareReport"></button>
          </section>
          <section id="debrief-share" role="tabpanel" aria-labelledby="debrief-tab-share" tabindex="0" hidden>
            <h3 data-i18n="debrief.report"></h3><p id="debrief-preview"></p>
            <button class="btn debrief-primary" id="debrief-copy" data-i18n="debrief.copy"></button>
            <button class="btn" id="debrief-export" data-i18n="debrief.export"></button>
            <button class="btn" id="debrief-native-share" data-i18n="debrief.shareReport" hidden></button>
            <p class="debrief-caption" data-i18n="debrief.shareHint"></p>
            <p id="debrief-status" role="status" aria-live="polite"></p>
            <button class="btn" data-debrief-tab="summary" data-i18n="debrief.back"></button>
          </section>
          <div class="debrief-actions">
            <button class="btn debrief-primary" id="debrief-retry" data-i18n="debrief.retry"></button>
            <button class="btn" id="debrief-lobby" data-i18n="debrief.lobby"></button>
          </div>
        </div>
      </div>`;
    translateDOM(this.root);
    for (const el of this.root.querySelectorAll('[data-debrief-label]')) bindText(el, () => t(`debrief.${el.dataset.debriefLabel}`));
    this.tabs = [...this.root.querySelectorAll('[role="tab"]')];
    for (const [index, tab] of this.tabs.entries()) {
      tab.addEventListener('click', () => this.selectTab(tab.id.replace('debrief-tab-', '')));
      tab.addEventListener('keydown', event => {
        const target = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        this.tabs[target].click(); this.tabs[target].focus();
      });
    }
    for (const button of this.root.querySelectorAll('[data-debrief-tab]')) button.addEventListener('click', () => {
      this.selectTab(button.dataset.debriefTab); this.tabs.find(tab => tab.getAttribute('aria-selected') === 'true').focus();
    });
    this.el('view-record').addEventListener('click', () => { this.selectTab('record'); this.el('tab-record').focus(); });
    this.el('scrub').addEventListener('input', () => this.inspect(Number(this.el('scrub').value)));
    this.el('chart').addEventListener('pointerdown', event => {
      const rect = this.el('chart').getBoundingClientRect();
      const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * this.report.durationSec;
      const index = this.report.samples.reduce((best, sample, i, samples) =>
        Math.abs(sample.timeSec - time) < Math.abs(samples[best].timeSec - time) ? i : best, 0);
      this.inspect(index);
    });
    this.el('retry').addEventListener('click', onRetry);
    this.el('lobby').addEventListener('click', onLobby);
    this.el('copy').addEventListener('click', () => this.copy());
    this.el('native-share').hidden = typeof navigator.share !== 'function';
    this.el('native-share').addEventListener('click', async () => {
      if (!this.report.sufficient) return;
      try { await navigator.share({ title: 'Flight3d', text: reportText(this.report) }); this.status('debrief.shared'); }
      catch (error) { if (error.name !== 'AbortError') this.status('debrief.shareFailed'); }
    });
    this.el('export').addEventListener('click', () => {
      if (!this.report.sufficient) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `flight3d-${this.report.metadata.aircraft}-flight.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status('debrief.exported');
    });
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

  selectTab(name) {
    for (const tab of this.tabs) {
      const active = tab.id === `debrief-tab-${name}`;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    this.el('retry').hidden = name === 'share';
    this.root.querySelector('.debrief-panels').scrollTop = 0;
  }

  show(report) {
    this.report = report;
    const enough = report.sufficient;
    bindText(this.el('outcome'), () => t(enough ? `debrief.outcome.${report.reason}` : 'debrief.empty'));
    bindText(this.el('identity'), () => enough
      ? `${AIRCRAFT_REGISTRY[report.metadata.aircraft]?.name ?? report.metadata.aircraft} · ${t(airportKeys[report.metadata.airport] ?? 'coastal.airport')}\n${t(scenarioLabelKey(report.metadata.airport, report.metadata.scenario) ?? 'lobby.spawn')} · ${t(`debrief.reason.${report.reason}`)}`
      : t('debrief.emptyHint'));
    this.el('stat-duration').textContent = flightDuration(report.durationSec);
    this.el('stat-altitude').textContent = `${number(report.peaks.altitudeFt?.altitudeFt)} FT`;
    this.el('stat-speed').textContent = `${number(report.peaks.iasKnots?.iasKnots)} KT`;
    this.el('stat-g').textContent = `${g(report.peaks.gForce?.gForce)} G`;
    for (const key of ['altitude', 'speed', 'g']) this.root.querySelector(`[data-stat="${key}"]`).hidden = !enough;
    this.root.querySelector('[data-stat="empty-touchdown"]').hidden = enough;
    this.el('touchdown').hidden = !enough;
    const touchdown = report.touchdowns.at(-1);
    bindText(this.el('contact'), () => `${t('debrief.sink')} ${number(touchdown?.sinkRateFpm)} FPM · ${t('debrief.contactG')} ${g(touchdown?.contactG)} G`);
    bindText(this.el('contact-note'), () => t(touchdown ? 'debrief.contactNote' : 'debrief.noTouchdown'));
    this.el('insufficient').hidden = enough;
    this.el('view-record').hidden = !enough;
    for (const id of ['copy', 'export', 'native-share']) this.el(id).disabled = !enough;
    bindText(this.el('preview'), () => enough ? reportText(report) : t('debrief.insufficient'));
    this.status(null);
    this.drawChart();
    this.selectTab('summary');
    this.el('tab-summary').focus();
  }

  drawChart() {
    const { samples, peaks, durationSec, reason } = this.report;
    const low = Math.min(...samples.map(s => s.altitudeFt), 0);
    const high = Math.max(peaks.altitudeFt?.altitudeFt ?? 1, low + 1);
    this.point = s => [s.timeSec / (durationSec || 1) * 320, 80 - (s.altitudeFt - low) / (high - low) * 65];
    this.el('chart').querySelector('polyline').setAttribute('points', samples.map(s => this.point(s).join(',')).join(' '));
    this.el('axis').replaceChildren(...[0, durationSec / 2, durationSec].map(time => {
      const span = document.createElement('span'); span.textContent = flightDuration(time); return span;
    }));
    const events = [[0, 'debrief.started', ''], [peaks.altitudeFt?.timeSec, 'debrief.altitude', `${number(peaks.altitudeFt?.altitudeFt)} FT`],
      [peaks.gForce?.timeSec, 'debrief.g', `${g(peaks.gForce?.gForce)} G`],
      ...this.report.touchdowns.map(contact => [contact.timeSec, 'debrief.touchdown', `${number(contact.sinkRateFpm)} FPM`]),
      [durationSec, `debrief.reason.${reason}`, '']];
    this.el('events').replaceChildren(...events.filter(([time]) => Number.isFinite(time)).sort((a, b) => a[0] - b[0]).map(([time, key, value]) => {
      const li = document.createElement('li'); bindText(li, () => `${flightDuration(time)}   ${t(key)} ${value}`.trim()); return li;
    }));
    this.el('scrub').max = Math.max(0, samples.length - 1);
    this.el('scrub').disabled = !samples.length;
    this.inspect(0);
  }

  inspect(index) {
    this.el('scrub').value = index;
    const sample = this.report.samples[index];
    const circle = this.el('chart').querySelector('circle');
    circle.style.display = sample ? '' : 'none';
    if (!sample) { this.el('sample').textContent = '—'; return; }
    const [x, y] = this.point(sample); circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    this.el('sample').textContent = `${flightDuration(sample.timeSec)} · ${number(sample.altitudeFt)} FT · ${number(sample.iasKnots)} KT · ${g(sample.gForce)} G`;
  }

  async copy() {
    if (!this.report.sufficient) return;
    try { await navigator.clipboard.writeText(reportText(this.report)); this.status('debrief.copied'); }
    catch { this.status('debrief.copyFailed'); }
  }
}
