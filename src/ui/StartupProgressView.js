import { bindText, t } from '../i18n/index.js';

/** Bounded, user-facing loading history shared by boot and scene changes. */
export class StartupProgressView {
  constructor({ document = globalThis.document, clock = () => performance.now(),
    schedule = callback => setInterval(callback, 500), cancel = timer => clearInterval(timer) } = {}) {
    Object.assign(this, { document, clock, schedule, cancel });
    this.rows = [];
  }

  element(id) { return this.document.getElementById(`startup-${id}`); }

  reset({ max = 6, steps = 7 } = {}) {
    this.stop();
    this.started = this.clock();
    this.steps = steps;
    this.rows = [];
    this.current = null;
    this.element('log')?.replaceChildren();
    const progress = this.element('progress');
    progress.max = max;
    progress.value = 0;
    progress.hidden = false;
    this.element('overlay')?.setAttribute('aria-busy', 'true');
    this.element('retry').hidden = true;
    this.element('wait').hidden = true;
    this.element('detail').textContent = '';
    this.element('step').textContent = '';
    this.timer = this.schedule(() => this.tick());
    this.tick();
  }

  stage(value, key) {
    const progress = this.element('progress');
    progress.value = value;
    const current = Math.min(this.steps, value + (this.steps > progress.max ? 1 : 0));
    bindText(this.element('step'), () => t('startup.step', { current, total: this.steps }));
    bindText(this.element('status'), () => t(key));
    this.detail(key);
  }

  detail(key) {
    if (this.timer == null || this.current?.key === key) return;
    const now = this.clock();
    this.completeCurrent(now);
    const log = this.element('log');
    const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    const row = this.document.createElement('li');
    const label = this.document.createElement('span');
    label.textContent = t(key);
    const timing = this.document.createElement('span');
    timing.className = 'startup-log-time';
    row.append(label, timing);
    row.dataset.state = 'active';
    log.append(row);
    this.current = { key, started: now, row, timing };
    this.rows.push(this.current);
    if (this.rows.length > 40) this.rows.shift().row.remove();
    bindText(this.element('detail'), () => t(key));
    this.element('detail').hidden = !key.startsWith('startup.detail.');
    this.element('detail').dataset.task = key;
    if (follow) log.scrollTop = log.scrollHeight;
    this.tick();
  }

  seconds(ms) { return (Math.max(0, ms) / 1000).toFixed(1); }

  tick() {
    const now = this.clock();
    const total = this.seconds(now - this.started);
    const current = this.seconds(now - (this.current?.started ?? this.started));
    bindText(this.element('elapsed'), () => t('startup.elapsed', { total, current }));
    if (this.current) this.current.timing.textContent = t('startup.active', { seconds: current });
    this.element('wait').hidden = now - (this.current?.started ?? now) < 8000;
  }

  completeCurrent(now = this.clock(), failed = false) {
    if (!this.current) return;
    this.current.row.dataset.state = failed ? 'failed' : 'done';
    this.current.timing.textContent = t(failed ? 'startup.logFailed' : 'startup.done', {
      seconds: this.seconds(now - this.current.started),
    });
  }

  finish() {
    this.tick();
    this.completeCurrent();
    this.stop();
  }

  fail() {
    this.tick();
    this.completeCurrent(this.clock(), true);
    this.element('details').open = true;
    this.stop();
  }

  stop() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    this.element('overlay')?.setAttribute('aria-busy', 'false');
    const wait = this.element('wait');
    if (wait) wait.hidden = true;
  }
}
