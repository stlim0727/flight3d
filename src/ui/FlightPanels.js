import { t, bindText, getLanguage, setLanguage } from '../i18n/index.js';

export function touchLabel(text) {
  return window.matchMedia('(pointer: coarse)').matches
    ? text.replace(/\s*\[[^\]]*\]/g, '') : text;
}

/** One stable set of controls, shared by narrow, touch and desktop layouts. */
export function initFlightPanels({ onCycleCamera }) {
  const hud = document.getElementById('hud-overlay');
  const bar = document.createElement('nav');
  bar.className = 'flight-toolbar';
  bindText(bar, () => t('ui.controls'), 'aria-label');
  hud.append(bar);
  let active;
  const panels = new Map();
  function close(restoreFocus = false) {
    if (!active) return;
    const { panel, trigger } = panels.get(active);
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    hud.classList.remove('panel-open');
    if (restoreFocus) trigger.focus();
    active = null;
  }
  function makePanel(name, selectors) {
    const trigger = document.createElement('button');
    trigger.className = 'btn';
    trigger.type = 'button';
    trigger.id = `open-${name}`;
    trigger.setAttribute('aria-controls', `panel-${name}`);
    trigger.setAttribute('aria-expanded', 'false');
    bindText(trigger, () => t(`ui.${name}`));
    const panel = document.createElement('section');
    panel.id = `panel-${name}`;
    panel.className = 'flight-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', `title-${name}`);
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = `title-${name}`;
    bindText(title, () => t(`ui.${name}`));
    const dismiss = document.createElement('button');
    dismiss.className = 'btn panel-close';
    dismiss.textContent = '×';
    bindText(dismiss, () => t('ui.close'), 'aria-label');
    dismiss.addEventListener('click', () => close(true));
    header.append(title, dismiss);
    const body = document.createElement('div');
    body.className = 'flight-panel-body';
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) body.append(node);
    }
    panel.append(header, body);
    hud.append(panel);
    bar.append(trigger);
    panels.set(name, { panel, trigger, body });
    trigger.addEventListener('click', () => {
      const same = active === name;
      close();
      if (!same) {
        active = name;
        hud.classList.add('panel-open');
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        dismiss.focus({ preventScroll: true });
      }
    });
    return body;
  }
  makePanel('aircraft', ['#btn-gear', '#btn-flaps-ret', '#btn-flaps-ext', '#btn-spoilers', '#btn-reverser']);
  const cameraButton = document.createElement('button');
  cameraButton.id = 'open-camera';
  cameraButton.className = 'btn';
  cameraButton.type = 'button';
  bindText(cameraButton, () => t('change.camera.c'), 'title');
  cameraButton.addEventListener('click', () => onCycleCamera());
  bar.append(cameraButton);
  // Settings belong to the main menu, not the in-flight HUD.
  const settings = document.getElementById('lobby-settings');
  for (const selector of ['.language-control[for="render-quality"]', '#btn-sound', '#btn-touch-toggle', '#touch-btn-gyro', '#btn-cam-reset', '#btn-yokes', '#btn-diag', '#btn-help']) {
    const node = document.querySelector(selector);
    if (node) settings.append(node);
  }
  const mute = document.createElement('button');
  mute.id = 'btn-mute';
  mute.className = 'btn quick-mute';
  mute.type = 'button';
  mute.setAttribute('aria-pressed', 'false');
  bindText(mute, () => t('ui.mute'), 'aria-label');
  mute.textContent = '🔊';
  bar.append(mute);

  for (const [id, key] of Object.entries({
    'btn-cam-reset': 'center.view.o',
    'btn-yokes': 'hide.yokes.j', 'btn-diag': 'physics',
    'btn-help': 'flight.guide.h.53', 'btn-skip-demo': 'take.control.esc',
  })) {
    bindText(document.getElementById(id), () => touchLabel(t(key)));
  }

  // Remove the legacy markup the toolbar panels have replaced.
  document.querySelectorAll('.presets-bar, .action-panel').forEach(node => node.remove());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close(true);
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.flight-panel, .flight-toolbar')) close();
  });
  const compact = window.matchMedia('(max-width: 1024px)');
  const touch = window.matchMedia('(pointer: coarse)');
  function layout() {
    document.body.classList.toggle('compact-ui', compact.matches);
    document.body.classList.toggle('touch-input', touch.matches);
    setLanguage(getLanguage());
  }
  compact.addEventListener('change', layout);
  touch.addEventListener('change', layout);
  layout();
}

/** Called from telemetry refresh, including keyboard, demo, reset and resize paths. */
export function updateControlState(telemetry, camera) {
  const set = (id, key, values, pressed) => {
    const button = document.getElementById(id);
    if (!button) return;
    const text = t(key, values);
    if (button.textContent !== text) button.textContent = text;
    if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
  };
  const gear = telemetry.gearState;
  const damage = Object.values(telemetry.gearDamage || {});
  const state = damage.includes('collapsed') ? 'fail' : damage.includes('damaged') ? 'damaged' : gear > .95 ? 'down' : gear < .05 ? 'up' : 'transit';
  set('btn-gear', `ui.gear.${state}`, {}, gear > .95);
  set('btn-flaps-ret', 'ui.flaps.less', { angle: Math.round(telemetry.flapDegree || 0) });
  set('btn-flaps-ext', 'ui.flaps.more', { angle: Math.round(telemetry.flapDegree || 0) });
  document.getElementById('btn-flaps-ret').disabled = telemetry.flapIndex <= 0;
  document.getElementById('btn-flaps-ext').disabled = telemetry.flapIndex >= 6;
  set('btn-spoilers', telemetry.spoilers > .1 ? 'ui.spoilers.on' : 'ui.spoilers.off', {}, telemetry.spoilers > .1);
  set('btn-reverser', telemetry.reverserActive ? 'ui.reverse.on' : 'ui.reverse.off', {}, !!telemetry.reverserActive);
  const mode = camera.autoSwitch ? 7 : camera.mode;
  const cameraName = ['cockpit', 'chase', 'wing', 'tower', 'flyby', 'gear', 'drone', 'auto'][mode];
  set('open-camera', 'ui.camera.current', { name: t(`ui.camera.${cameraName}`).replace(/ · [1-8]$/, '') });
  const toggle = document.getElementById('btn-touch-toggle');
  toggle?.setAttribute('aria-pressed', String(document.body.classList.contains('touch-mode')));
}
