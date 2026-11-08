import { bindText, t } from '../i18n/index.js';
import { DEV_SCENARIOS } from '../config/scenarioRegistry.js';

import { BUILD_INFO as build } from '../dev/buildInfo.js';

export class DeveloperPanel {
  constructor(sim) {
    this.sim = sim;
    this.select = document.getElementById('dev-scenario');
    for (const [id, definition] of Object.entries(DEV_SCENARIOS)) {
      const option = document.createElement('option');
      option.value = id;
      bindText(option, () => t(definition.labelKey));
      this.select.append(option);
    }
    document.getElementById('dev-build').textContent = `v${build.version} · ${build.revision} · ${build.builtAt}`;
    document.getElementById('lobby-tab-dev')?.addEventListener('click', () => {
      document.getElementById('lobby-tab-settings')?.click();
    });
    document.getElementById('dev-render-trials').addEventListener('click', () => {
      if (!sim.developerMode.enabled) return;
      sim.devRunner.stop(); sim.demoDirector.stop(); sim.gameFlow.enterFlight();
      sim.renderDiagnosticsPanel.open();
    });
    document.getElementById('dev-enabled').addEventListener('change', event => {
      if (event.target.checked) sim.developerMode.enable();
      else {
        sim.developerMode.disable();
      }
      sim.lobbyScreen.refresh();
      this.refresh();
    });
    this.select.addEventListener('change', () => this.refresh());
    document.getElementById('dev-run').addEventListener('click', () => {
      sim.devRunner.start(this.select.value); this.refresh();
    });
    for (const id of ['dev-restart', 'dev-live-restart']) {
      document.getElementById(id).addEventListener('click', () => sim.devRunner.restart());
    }
    document.getElementById('dev-live-pause').addEventListener('click', () => {
      if (sim.gameFlow.state === 'paused') sim.gameFlow.resume();
      else sim.gameFlow.pause();
    });
    for (const id of ['dev-stop', 'dev-live-stop']) {
      document.getElementById(id).addEventListener('click', () => {
        sim.devRunner.stop(); sim.gameFlow.returnToLobby(true); this.refresh();
      });
    }
    for (const id of ['dev-result', 'dev-live-result']) {
      bindText(document.getElementById(id), () => this.summary());
    }
    bindText(document.getElementById('dev-description'), () => this.description());
    this.refresh();
  }

  description() {
    const d = DEV_SCENARIOS[this.select.value];
    const supported = this.sim.developerMode.canRun(d, this.sim.devRunner.context);
    const a = d.initial;
    const initial = a ? '\n' + t('dev.initial', { gear: a[0], height: a[1],
      sink: a[2], roll: a[3] ?? 0, speed: a[5] ?? 60 }) : '';
    return `${t(`dev.kind.${d.kind}`)} · ${d.aircraft.join(', ')} / ${d.airports.join(', ')}\n`
      + t(d.descriptionKey) + initial + (supported ? '' : `\n${t('dev.unsupported')}`);
  }

  summary() {
    const r = this.sim.devRunner, result = r.result;
    const id = r.active?.id ?? result?.id;
    if (!id) return t('dev.status.idle');
    return `${t(DEV_SCENARIOS[id].labelKey)} · ${t(`dev.status.${r.active ? r.status : 'idle'}`)}`
      + ` · ${(r.status === 'inspecting' ? this.sim.shadowDemo.elapsed : r.elapsed).toFixed(1)} s`
      + (result ? `\n${t(`dev.status.${result.status}`)}: ${t(result.reason)}${result.detail ? ` (${result.detail})` : ''}`
        + `\n${t('dev.metrics', { samples: result.observation.samples, collapsed: result.observation.collapsed,
          speed: result.observation.speed.toFixed(2), crash: result.crashType ?? '—' })}` : '');
  }

  refresh() {
    const sim = this.sim, runner = sim.devRunner;
    const enabled = sim.developerMode.enabled;
    const devEnabledCheckbox = document.getElementById('dev-enabled');
    if (devEnabledCheckbox) devEnabledCheckbox.checked = enabled;
    const devPanel = document.getElementById('lobby-panel-dev');
    if (devPanel) devPanel.hidden = !enabled;
    document.getElementById('dev-live').hidden = !enabled || !runner.active || sim.gameFlow.state === 'lobby';
    document.getElementById('dev-run').disabled = !sim.developerMode.canRun(DEV_SCENARIOS[this.select.value], runner.context);
    for (const id of ['dev-stop', 'dev-restart']) document.getElementById(id).disabled = !runner.active;
    document.getElementById('dev-description').textContent = this.description();
    // Throttled by the host to avoid rebuilding DOM on every physics step.
    for (const id of ['dev-result', 'dev-live-result']) document.getElementById(id).textContent = this.summary();
  }
}
