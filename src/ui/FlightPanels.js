import { t, bindText, getLanguage, setLanguage } from '../i18n/index.js';

export function touchLabel(text) {
  return window.matchMedia('(pointer: coarse)').matches
    ? text.replace(/\s*\[[^\]]*\]/g, '') : text;
}

/** One stable set of controls, shared by narrow, touch and desktop layouts. */
export function initFlightPanels({ onCycleCamera }) {
  const hud = document.getElementById('hud-overlay');
  // Let keyboard users scroll the full telemetry row as well as touch users.
  const strip = document.querySelector('.hud-strip');
  strip.tabIndex = 0;
  strip.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') strip.scrollLeft = 0;
    else if (event.key === 'End') strip.scrollLeft = strip.scrollWidth;
    else strip.scrollLeft += event.key === 'ArrowRight' ? 80 : -80;
  });
  const bar = document.createElement('nav');
  bar.className = 'flight-toolbar';
  bindText(bar, () => t('ui.controls'), 'aria-label');
  hud.append(bar);
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
  for (const id of ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser']) {
    bar.append(document.getElementById(id));
  }

  for (const [id, key] of Object.entries({
    'btn-cam-reset': 'center.view.o',
    'btn-yokes': 'hide.yokes.j', 'btn-diag': 'physics',
    'btn-help': 'flight.guide.h.53', 'btn-skip-demo': 'take.control.esc',
  })) {
    bindText(document.getElementById(id), () => touchLabel(t(key)));
  }

  // Remove the legacy containers after moving their controls.
  document.querySelectorAll('.presets-bar, .action-panel').forEach(node => node.remove());
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

  // Measure each side independently: telemetry first, controls second, then below.
  const menu = document.getElementById('menu-toggle');
  const ap = document.getElementById('ap-bar');
  function positionEdgeButtons() {
    if (!strip.getClientRects().length || !bar.getClientRects().length) return;
    // Resolve safe-area calc()/max() values through the positioned buttons.
    const menuLeft = menu.getBoundingClientRect().left;
    const apRight = ap.getBoundingClientRect().right;
    const rows = [strip.getBoundingClientRect(), bar.getBoundingClientRect()];
    for (const [button, fits, property] of [
      [menu, row => row.left >= menuLeft + menu.offsetWidth + 4, '--menu-row-top'],
      [ap, row => row.right <= apRight - ap.offsetWidth - 4, '--ap-row-top'],
    ]) {
      const row = rows.find(fits);
      const top = row ? row.top : rows[1].bottom + 4;
      document.documentElement.style.setProperty(property, `${top}px`);
      if (button === ap) {
        // The dropdown is wider than its trigger; keep it below both strips.
        const panelOffset = Math.max(ap.offsetHeight + 4, rows[1].bottom + 4 - top);
        document.documentElement.style.setProperty('--ap-panel-offset', `${panelOffset}px`);
      }
    }
  }
  const observer = new ResizeObserver(positionEdgeButtons);
  for (const node of [strip, bar, menu, ap, document.documentElement]) observer.observe(node);
  new MutationObserver(positionEdgeButtons).observe(document.body, {
    attributes: true, attributeFilter: ['class', 'data-flow'],
  });
  window.addEventListener('resize', positionEdgeButtons);
  positionEdgeButtons();
}

/** Called from telemetry refresh, including keyboard, demo, reset and resize paths. */
export function updateControlState(telemetry, camera) {
  const set = (id, key, values, pressed, shortLabel) => {
    const button = document.getElementById(id);
    if (!button) return;
    const text = t(key, values);
    if (button.textContent !== text) button.textContent = text;
    if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
    // Keep the full localized state accessible while the strip uses short labels.
    button.setAttribute('aria-label', text);
    button.setAttribute('title', text);
    if (shortLabel !== undefined) button.setAttribute('data-short-label', shortLabel);
  };
  const gear = telemetry.gearState;
  const damage = Object.values(telemetry.gearDamage || {});
  const state = damage.includes('collapsed') ? 'fail' : damage.includes('damaged') ? 'damaged' : gear > .95 ? 'down' : gear < .05 ? 'up' : 'transit';
  set('btn-gear', `ui.gear.${state}`, {}, gear > .95, `${t('ui.strip.gear')}${({down: '↓', up: '↑', transit: '↕', fail: '!', damaged: '!'})[state]}`);
  set('btn-flaps-ret', 'ui.flaps.less', { angle: Math.round(telemetry.flapDegree || 0) }, undefined, `${t('ui.strip.flaps')}−${Math.round(telemetry.flapDegree || 0)}°`);
  set('btn-flaps-ext', 'ui.flaps.more', { angle: Math.round(telemetry.flapDegree || 0) }, undefined, `${t('ui.strip.flaps')}+${Math.round(telemetry.flapDegree || 0)}°`);
  document.getElementById('btn-flaps-ret').disabled = telemetry.flapIndex <= 0;
  document.getElementById('btn-flaps-ext').disabled = telemetry.flapIndex >= 6;
  set('btn-spoilers', telemetry.spoilers > .1 ? 'ui.spoilers.on' : 'ui.spoilers.off', {}, telemetry.spoilers > .1, t('ui.strip.spoilers'));
  set('btn-reverser', telemetry.reverserActive ? 'ui.reverse.on' : 'ui.reverse.off', {}, !!telemetry.reverserActive, t('ui.strip.reverse'));
  const mode = camera.autoSwitch ? 7 : camera.mode;
  const cameraName = ['cockpit', 'chase', 'wing', 'tower', 'flyby', 'gear', 'drone', 'auto'][mode];
  const viewName = t(`ui.camera.${cameraName}`).replace(/ · [1-8]$/, '');
  // Optical zoom only exists in the fixed eye-point views, so chase and drone
  // framing changes stay unlabelled.
  const zoomed = camera.opticalZoom > 1.01;
  const zoomValue = zoomed ? `${camera.opticalZoom.toFixed(1)}×` : '';
  set('open-camera', 'ui.camera.current', { name: zoomed ? `${viewName} · ${zoomValue}` : viewName }, undefined,
    zoomed ? `${t('ui.strip.camera')}${zoomValue}` : t('ui.strip.camera'));
  const toggle = document.getElementById('btn-touch-toggle');
  toggle?.setAttribute('aria-pressed', String(document.body.classList.contains('touch-mode')));
}
