import { t, bindText, getLanguage, setLanguage } from '../i18n/index.js';

export function touchLabel(text) {
  return window.matchMedia('(pointer: coarse)').matches
    ? text.replace(/\s*\[[^\]]*\]/g, '') : text;
}

/** One stable set of controls, shared by narrow, touch and desktop layouts. */
export function initFlightPanels({ onCycleCamera, onSelectCamera, onToggleAutoCamera, onAdjustTrim, onToggleParkingBrake }) {
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
  const topBar = document.createElement('div');
  topBar.className = 'hud-top-bar';
  const topActions = document.createElement('div');
  topActions.className = 'hud-top-actions';
  const mute = document.createElement('button');
  mute.id = 'btn-mute';
  mute.className = 'btn quick-mute';
  mute.type = 'button';
  mute.setAttribute('aria-pressed', 'false');
  bindText(mute, () => t('ui.mute'), 'aria-label');
  mute.textContent = '🔊';
  const fullscreen = document.getElementById('btn-fullscreen');
  fullscreen.setAttribute('data-short-label', '⛶');
  const ap = document.getElementById('ap-bar');
  const apPanel = document.getElementById('ap-panel');
  topActions.append(ap, mute);
  if (apPanel) hud.append(apPanel);
  const menu = document.getElementById('menu-toggle');
  if (menu) topBar.append(menu);
  topBar.append(strip, topActions);
  hud.prepend(topBar);

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
  // Taking over must remain available when the guide is collapsed or yields to
  // warnings. Keep the existing button/handler outside the notification tree.
  const skipDemoButton = document.getElementById('btn-skip-demo');
  const autoCameraButton = document.createElement('button');
  autoCameraButton.id = 'btn-auto-camera';
  autoCameraButton.className = 'btn';
  autoCameraButton.type = 'button';
  autoCameraButton.addEventListener('click', () => onToggleAutoCamera());
  const moreButton = document.createElement('button');
  moreButton.id = 'open-flight-more';
  moreButton.className = 'btn';
  moreButton.type = 'button';
  moreButton.textContent = '⋯';
  moreButton.setAttribute('aria-controls', 'flight-more-panel');
  moreButton.setAttribute('aria-expanded', 'false');
  bindText(moreButton, () => t('ui.more'), 'aria-label');
  const more = document.createElement('section');
  more.id = 'flight-more-panel';
  more.className = 'flight-more-panel';
  more.hidden = true;
  bindText(more, () => t('ui.more'), 'aria-label');
  more.innerHTML = `<div class="flight-trim">
    <span data-flight-label="hud.trim"></span><output id="flight-trim-value"></output>
    <button id="flight-trim-less" class="btn" type="button">−</button>
    <button id="flight-trim-more" class="btn" type="button">+</button>
    </div><button id="flight-park-brake" class="btn" type="button" aria-pressed="false" data-flight-label="hud.brake"></button>`;
  for (const node of more.querySelectorAll('[data-flight-label]')) bindText(node, () => t(node.dataset.flightLabel));
  for (const [id, sign, key] of [['flight-trim-less', -1, 'hud.trim.less'], ['flight-trim-more', 1, 'hud.trim.more']]) {
    const button = more.querySelector(`#${id}`);
    bindText(button, () => t(key), 'aria-label');
    button.addEventListener('click', () => onAdjustTrim(sign * .2));
  }
  more.querySelector('#flight-park-brake').addEventListener('click', () => onToggleParkingBrake());
  more.append(autoCameraButton);
  hud.append(more);
  const setMoreOpen = open => {
    more.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) more.querySelector('button').focus({ preventScroll: true });
  };
  moreButton.addEventListener('click', () => setMoreOpen(more.hidden));
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#flight-more-panel, #open-flight-more')) setMoreOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || more.hidden) return;
    event.preventDefault(); event.stopPropagation();
    setMoreOpen(false);
    moreButton.focus({ preventScroll: true });
  }, true);
  // Settings belong to the main menu, not the in-flight HUD.
  const settings = document.getElementById('lobby-settings');
  const cameraLabel = document.createElement('label');
  cameraLabel.className = 'language-control';
  cameraLabel.htmlFor = 'camera-select';
  const caption = document.createElement('span');
  bindText(caption, () => t('ui.camera.select'));
  const cameraSelect = document.createElement('select');
  cameraSelect.id = 'camera-select';
  cameraSelect.className = 'btn';
  // Match the quick cycle, then list specialist views and automatic viewing.
  for (const [mode, name] of [[1, 'chase'], [6, 'drone'], [4, 'flyby'],
    [2, 'wing'], [0, 'cockpit'], [8, 'hud'], [3, 'tower'], [5, 'gear'], [7, 'auto']]) {
    const option = document.createElement('option');
    option.value = String(mode);
    bindText(option, () => touchLabel(t(`ui.camera.${name}`)));
    cameraSelect.append(option);
  }
  cameraSelect.addEventListener('change', () => onSelectCamera(Number(cameraSelect.value)));
  cameraLabel.append(caption, cameraSelect);
  settings.append(cameraLabel);
  for (const selector of ['.language-control[for="render-quality"]', '.language-control[for="cockpit-quality"]', '#btn-sound', '#btn-touch-toggle', '#touch-btn-gyro', '#btn-cam-reset', '#btn-yokes', '#btn-diag', '#btn-help']) {
    const node = document.querySelector(selector);
    if (node) settings.append(node);
  }
  for (const id of ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser']) {
    bar.append(document.getElementById(id));
  }
  // The row is anchored to the right edge, so the aircraft actions that follow
  // takeover unfold leftwards instead of shifting the primary group.
  bar.append(skipDemoButton, cameraButton, fullscreen, moreButton);

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

  // Keep the top header bar, control dock, AP panel, and notice slot aligned.
  function positionEdgeButtons() {
    if (!strip.getClientRects().length || !bar.getClientRects().length) return;
    // Keep the camera/fullscreen/overflow end pinned to the right edge; the
    // aircraft actions that overflow are reached by swiping the row left.
    bar.scrollLeft = bar.scrollWidth;
    const topBarRect = topBar.getBoundingClientRect();
    const controlsBottom = bar.getBoundingClientRect().bottom;
    const noticeTop = Math.max(topBarRect.bottom, controlsBottom) + 6;
    document.documentElement.style.setProperty('--menu-row-top', `${topBarRect.top}px`);
    document.documentElement.style.setProperty('--ap-row-top', `${topBarRect.top}px`);
    document.documentElement.style.setProperty('--demo-pill-top', `${topBarRect.bottom + 4}px`);
    document.documentElement.style.setProperty('--demo-row-top', `${noticeTop}px`);
    document.documentElement.style.setProperty('--flight-panels-top', `${noticeTop}px`);
  }
  const observer = new ResizeObserver(positionEdgeButtons);
  for (const node of [topBar, strip, bar, menu, ap, document.documentElement]) observer.observe(node);
  new MutationObserver(() => {
    if (document.body.dataset.flow !== 'flight') setMoreOpen(false);
    positionEdgeButtons();
  }).observe(document.body, {
    attributes: true, attributeFilter: ['class', 'data-flow'],
  });
  window.addEventListener('resize', positionEdgeButtons);
  positionEdgeButtons();
}

/** Called from telemetry refresh, including keyboard, demo, reset and resize paths. */
export function updateControlState(telemetry, camera, options = {}) {
  const isDemo = Boolean(options.demoActive ?? telemetry?.demoActive);
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
  const disabled = isDemo || Boolean(options.controlsDisabled);
  for (const id of ['flight-trim-less', 'flight-trim-more', 'flight-park-brake']) {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  }
  const trimValue = document.getElementById('flight-trim-value');
  if (trimValue) trimValue.textContent = `${(options.pitchTrim || 0).toFixed(1)}°`;
  document.getElementById('flight-park-brake')?.setAttribute('aria-pressed', String(Boolean(options.parkingBrake)));
  const gear = telemetry.gearState;
  const damage = Object.values(telemetry.gearDamage || {});
  const state = damage.includes('collapsed') ? 'fail' : damage.includes('damaged') ? 'damaged' : gear > .95 ? 'down' : gear < .05 ? 'up' : 'transit';
  set('btn-gear', `ui.gear.${state}`, {}, gear > .95, `${t('ui.strip.gear')}${({down: '↓', up: '↑', transit: '↕', fail: '!', damaged: '!'})[state]}`);
  set('btn-flaps-ret', 'ui.flaps.less', { angle: Math.round(telemetry.flapDegree || 0) }, undefined, `${t('ui.strip.flaps')}−${Math.round(telemetry.flapDegree || 0)}°`);
  set('btn-flaps-ext', 'ui.flaps.more', { angle: Math.round(telemetry.flapDegree || 0) }, undefined, `${t('ui.strip.flaps')}+${Math.round(telemetry.flapDegree || 0)}°`);
  const gearBtn = document.getElementById('btn-gear');
  if (gearBtn) gearBtn.disabled = isDemo;
  const flapsRetBtn = document.getElementById('btn-flaps-ret');
  if (flapsRetBtn) flapsRetBtn.disabled = isDemo || telemetry.flapIndex <= 0;
  const flapsExtBtn = document.getElementById('btn-flaps-ext');
  if (flapsExtBtn) flapsExtBtn.disabled = isDemo || telemetry.flapIndex >= 6;
  set('btn-spoilers', telemetry.spoilers > .1 ? 'ui.spoilers.on' : 'ui.spoilers.off', {}, telemetry.spoilers > .1, t('ui.strip.spoilers'));
  set('btn-reverser', telemetry.reverserActive ? 'ui.reverse.on' : 'ui.reverse.off', {}, !!telemetry.reverserActive, t('ui.strip.reverse'));
  const spoilersBtn = document.getElementById('btn-spoilers');
  if (spoilersBtn) spoilersBtn.disabled = isDemo;
  const reverserBtn = document.getElementById('btn-reverser');
  if (reverserBtn) reverserBtn.disabled = isDemo;
  const mode = camera.autoSwitch ? 7 : camera.mode;
  const cameraSelect = document.getElementById('camera-select');
  if (cameraSelect) cameraSelect.value = String(mode);
  const cameraName = ['cockpit', 'chase', 'wing', 'tower', 'flyby', 'gear', 'drone', 'auto', 'hud'][mode];
  const viewName = t(`ui.camera.${cameraName}`).replace(/ · [1-9]$/, '');
  // Optical zoom only exists in the fixed eye-point views, so chase and drone
  // framing changes stay unlabelled.
  const zoomed = camera.opticalZoom > 1.01;
  const zoomValue = zoomed ? `${camera.opticalZoom.toFixed(1)}×` : '';
  set('open-camera', 'ui.camera.current', { name: zoomed ? `${viewName} · ${zoomValue}` : viewName }, undefined,
    zoomed ? `${t('ui.strip.camera')}${zoomValue}` : t('ui.strip.camera'));
  const autoState = !camera.autoSwitch ? 'start'
    : camera.autoPaused ? 'resume'
    : camera.userLookOverridden ? 'looking' : 'pause';
  const seconds = Math.ceil(camera.touchAutoResumeTimer ?? 0);
  const autoLabel = autoState === 'looking' && seconds > 0 ? 'waiting' : autoState;
  set('btn-auto-camera', `ui.camera.auto.${autoLabel}`, { seconds },
    camera.autoSwitch && !camera.autoPaused && !camera.userLookOverridden,
    t(`ui.camera.auto.${autoLabel}.short`, { seconds }));
  const toggle = document.getElementById('btn-touch-toggle');
  toggle?.setAttribute('aria-pressed', String(document.body.classList.contains('touch-mode')));
}
