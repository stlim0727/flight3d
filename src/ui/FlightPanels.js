import { createFlightStrip } from './flightStrip.js';
import { t, bindText, getLanguage, setLanguage } from '../i18n/index.js';
import { toolbarOptionalItems, normalizeToolbarHidden, applyToolbarVisibility } from './toolbarVisibility.js';
import { gearIconName, setToolbarIcon } from './toolbarIcons.js';
import { bindPilotageMapFold } from './pilotageMapFold.js';
import { syncPovResetButton } from './povResetOverlay.js';

export const CAMERA_MODES = [
  [1, 'chase'],
  [6, 'drone'],
  [4, 'flyby'],
  [2, 'wing'],
  [0, 'cockpit'],
  [8, 'hud'],
  [3, 'tower'],
  [5, 'gear'],
  [7, 'auto'],
  [9, 'director'],
];

export function touchLabel(text) {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches
    ? text.replace(/\s*\[[^\]]*\]/g, '') : text;
}

/**
 * The live camera toolbar owns these buttons during both flight and replay.
 */
export function createCameraButtons(onSelectCamera, { idPrefix = 'btn-cam-' } = {}) {
  return CAMERA_MODES.map(([mode, name]) => {
    const button = document.createElement('button');
    if (idPrefix) button.id = `${idPrefix}${name}`;
    button.className = 'btn flight-camera-btn';
    button.type = 'button';
    button.dataset.cameraMode = String(mode);
    if (mode < 9) button.dataset.keyHint = String(mode === 0 ? 1 : mode === 7 ? 8 : mode === 8 ? 9 : mode + 1);
    button.setAttribute('aria-pressed', 'false');
    bindText(button, () => touchLabel(t(`ui.camera.${name}`)));
    bindText(button, () => t(`ui.strip.camera.${name}`), 'data-short-label');
    bindText(button, () => touchLabel(t(`ui.camera.${name}`)), 'aria-label');
    bindText(button, () => touchLabel(t(`ui.camera.${name}`)), 'title');
    button.addEventListener('click', () => {
      onSelectCamera(mode);
      button.blur();
    });
    return button;
  });
}

/** A committed in-flight view choice must release native select keyboard capture. */
export function commitFlightCamera(select, onSelectCamera) {
  onSelectCamera(Number(select.value));
  select.blur();
}

/** One stable set of controls, shared by narrow, touch and desktop layouts. */
export function initFlightPanels({ onSelectCamera, onAdjustTrim, onToggleParkingBrake, onMapUnfold, onMapFold, toolbarHidden, onToolbarHiddenChange }) {
  const hud = document.getElementById('hud-overlay');
  const map = document.getElementById('pilotage-map');
  bindPilotageMapFold(map, {
    onUnfold: onMapUnfold,
    onFold: onMapFold,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null,
  });
  map.addEventListener('pointerdown', event => event.target.setPointerCapture(event.pointerId));
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mousemove', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click', 'wheel']) {
    map.addEventListener(type, event => event.stopPropagation());
  }
  // Releases still clear a camera drag or flight key held before entering the map.
  map.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
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
  setToolbarIcon(fullscreen, fullscreen.getAttribute('aria-pressed') === 'true' ? 'fullscreen-exit' : 'fullscreen-enter');
  const ap = document.getElementById('ap-bar');
  const apPanel = document.getElementById('ap-panel');
  const hudFold = document.createElement('button');
  hudFold.id = 'btn-hud-fold';
  hudFold.className = 'btn btn-hud-fold';
  hudFold.type = 'button';
  bindText(hudFold, () => t('ui.foldHud'), 'aria-label');
  bindText(hudFold, () => t('ui.foldHud'), 'title');
  hudFold.innerHTML = '<span class="fold-glyph" aria-hidden="true">👁</span>';
  topActions.append(ap, mute, hudFold);
  if (apPanel) hud.append(apPanel);
  const hudUnfold = document.createElement('button');
  hudUnfold.id = 'btn-hud-unfold';
  hudUnfold.className = 'ui-unfold-pill hud-unfold-pill';
  hudUnfold.type = 'button';
  hudUnfold.hidden = true;
  bindText(hudUnfold, () => t('ui.unfoldHud'), 'aria-label');
  bindText(hudUnfold, () => t('ui.unfoldHud'), 'title');
  hudUnfold.innerHTML = '<span class="unfold-icon">👁</span><span class="unfold-caption" data-i18n="ui.unfoldHud"></span><span class="unfold-glyph" aria-hidden="true">▴</span>';
  hud.append(hudUnfold);
  const setHudFolded = (folded, focus = true) => {
    const isFolded = Boolean(folded);
    document.body.classList.toggle('hud-folded', isFolded);
    hudUnfold.hidden = !isFolded;
    if (focus) {
      if (isFolded) hudUnfold.focus();
      else (hudFold.getClientRects().length ? hudFold : moreButton).focus();
    }
  };
  hudFold.addEventListener('click', () => setHudFolded(true));
  hudUnfold.addEventListener('click', () => setHudFolded(false));
  const menu = document.getElementById('menu-toggle');
  if (menu) topBar.append(menu);
  topBar.append(strip, topActions);
  hud.prepend(topBar);

  const bar = document.createElement('nav');
  bar.className = 'flight-toolbar';
  bindText(bar, () => t('ui.controls'), 'aria-label');
  hud.append(bar);
  let flightStrip;
  let cameraStripCollapsed = false;
  try {
    const saved = localStorage.getItem('flight3d_camera_strip_collapsed');
    if (saved !== null) {
      cameraStripCollapsed = saved === 'true';
    } else if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1024px)')?.matches) {
      cameraStripCollapsed = true;
    }
  } catch {}

  const setCameraStripCollapsed = (collapsed) => {
    cameraStripCollapsed = Boolean(collapsed);
    try {
      localStorage.setItem('flight3d_camera_strip_collapsed', String(cameraStripCollapsed));
    } catch {}
    updateCameraToggleState();
  };

  const cameraButtons = createCameraButtons(mode => {
    if (flightStrip?.active()) {
      if (flightStrip.isOpen('camera')) {
        onSelectCamera(mode);
        flightStrip.close();
        cameraToggleBtn.focus({ preventScroll: true });
      }
    } else if (cameraStripCollapsed) {
      setCameraStripCollapsed(false);
    } else {
      onSelectCamera(mode);
    }
  });
  const defaultCam = cameraButtons.find(b => b.dataset.cameraMode === '1');
  if (defaultCam) defaultCam.setAttribute('aria-pressed', 'true');

  const cameraStrip = document.createElement('div');
  cameraStrip.id = 'camera-strip';
  cameraStrip.className = 'flight-camera-strip';
  cameraStrip.setAttribute('role', 'group');
  bindText(cameraStrip, () => t('ui.camera.select'), 'aria-label');
  cameraStrip.append(...cameraButtons);

  const cameraToggleBtn = document.createElement('button');
  cameraToggleBtn.id = 'btn-camera-toggle';
  cameraToggleBtn.className = 'btn flight-camera-btn flight-camera-toggle-btn';
  cameraToggleBtn.type = 'button';
  // Issue #880: in flight the trigger is a camera icon; its panel names each view.
  // The legacy replay strip keeps its chevron and hides this mask.
  setToolbarIcon(cameraToggleBtn, 'camera');
  cameraStrip.append(cameraToggleBtn);

  const updateCameraToggleState = () => {
    const collapsed = flightStrip?.active() ? !flightStrip.isOpen('camera') : cameraStripCollapsed;
    cameraStrip.classList.toggle('is-collapsed', collapsed && !flightStrip?.active());
    bar.classList.toggle('camera-strip-collapsed', collapsed);
    cameraToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    if (flightStrip?.active()) return;
    const titleKey = collapsed ? 'ui.camera.expand' : 'ui.camera.collapse';
    cameraToggleBtn.title = t(titleKey);
    cameraToggleBtn.setAttribute('aria-label', t(titleKey));
    cameraToggleBtn.setAttribute('data-short-label', collapsed ? '›' : '‹');
    cameraToggleBtn.innerHTML = collapsed
      ? '<span class="camera-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></span>'
      : '<span class="camera-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></span>';
    positionEdgeButtons();
  };

  cameraToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (flightStrip?.active()) {
      flightStrip.toggle('camera');
      return;
    }
    setCameraStripCollapsed(!cameraStripCollapsed);
    cameraToggleBtn.blur();
  });
  // Taking over must remain available when the guide is collapsed or yields to
  // warnings. Keep the existing button/handler outside the notification tree.
  const skipDemoButton = document.getElementById('btn-skip-demo');
  const demoBanner = document.getElementById('demo-banner');
  const demoPill = document.getElementById('btn-demo-open');
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
    </div><button id="flight-park-brake" class="btn" type="button" aria-pressed="false" data-flight-label="hud.brake"></button>
    <button id="btn-open-cockpit-pov" class="btn" type="button" aria-controls="cockpit-pov-panel" aria-expanded="false" data-flight-label="ui.camera.cockpitPov" hidden></button>`;
  for (const node of more.querySelectorAll('[data-flight-label]')) bindText(node, () => t(node.dataset.flightLabel));
  for (const [id, sign, key] of [['flight-trim-less', -1, 'hud.trim.less'], ['flight-trim-more', 1, 'hud.trim.more']]) {
    const button = more.querySelector(`#${id}`);
    bindText(button, () => t(key), 'aria-label');
    button.addEventListener('click', () => onAdjustTrim(sign * .2));
  }
  more.querySelector('#flight-park-brake').addEventListener('click', () => onToggleParkingBrake());
  hud.append(more);
  const setMoreOpen = open => {
    more.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) more.querySelector('button').focus({ preventScroll: true });
  };
  moreButton.addEventListener('click', () => {
    if (flightStrip?.active()) flightStrip.toggle('aux');
    else setMoreOpen(more.hidden);
  });
  document.addEventListener('pointerdown', event => {
    if (flightStrip?.active()) return;
    if (!event.target.closest('#flight-more-panel, #open-flight-more')) setMoreOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (flightStrip?.active() || more.hidden) return;
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
  for (const [mode, name] of CAMERA_MODES) {
    const option = document.createElement('option');
    option.value = String(mode);
    bindText(option, () => touchLabel(t(`ui.camera.${name}`)));
    cameraSelect.append(option);
  }
  cameraSelect.addEventListener('change', () => onSelectCamera(Number(cameraSelect.value)));
  cameraLabel.append(caption, cameraSelect);
  const lobbyCameraBtn = document.createElement('button');
  lobbyCameraBtn.id = 'btn-lobby-open-camera-settings';
  lobbyCameraBtn.className = 'btn';
  lobbyCameraBtn.type = 'button';
  bindText(lobbyCameraBtn, () => t('ui.lobbyCamera.openSettings'));
  settings?.append(cameraLabel, lobbyCameraBtn);
  // Issue #798: the pilot chooses which optional top-menu buttons stay visible.
  // The camera select above always lists every view, so a hidden one stays reachable.
  const optionalItems = toolbarOptionalItems(CAMERA_MODES.map(([, name]) => name));
  const toolbarOptions = document.createElement('details');
  toolbarOptions.id = 'toolbar-options';
  toolbarOptions.className = 'toolbar-options';
  const toolbarSummary = document.createElement('summary');
  const toolbarHint = document.createElement('p');
  toolbarHint.className = 'toolbar-options-hint';
  bindText(toolbarHint, () => t('toolbar.custom.hint'));
  const toolbarList = document.createElement('div');
  toolbarList.className = 'toolbar-options-list';
  const toolbarChecks = optionalItems.map(id => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.toolbarItem = id;
    const text = document.createElement('span');
    bindText(text, () => (id === 'fullscreen' ? t('fullscreen.enter') : touchLabel(t(`ui.camera.${id.slice(4)}`))));
    label.append(input, text);
    toolbarList.append(label);
    return input;
  });
  const toolbarReset = document.createElement('button');
  toolbarReset.id = 'toolbar-options-reset';
  toolbarReset.className = 'btn';
  toolbarReset.type = 'button';
  bindText(toolbarReset, () => t('toolbar.custom.reset'));
  toolbarOptions.append(toolbarSummary, toolbarHint, toolbarList, toolbarReset);
  const showToolbarItems = hidden => {
    const hiddenItems = normalizeToolbarHidden(hidden, optionalItems);
    applyToolbarVisibility(hiddenItems, optionalItems);
    for (const input of toolbarChecks) input.checked = !hiddenItems.includes(input.dataset.toolbarItem);
    bindText(toolbarSummary, () => t('toolbar.custom.title', {
      shown: optionalItems.length - hiddenItems.length, total: optionalItems.length,
    }));
    return hiddenItems;
  };
  const chooseToolbarItems = hidden => {
    onToolbarHiddenChange?.(showToolbarItems(hidden));
    positionEdgeButtons();
  };
  for (const input of toolbarChecks) {
    input.addEventListener('change', () => chooseToolbarItems(
      toolbarChecks.filter(check => !check.checked).map(check => check.dataset.toolbarItem)));
  }
  toolbarReset.addEventListener('click', () => chooseToolbarItems([]));
  settings.append(cameraLabel, toolbarOptions);
  for (const selector of ['#btn-gaze-reset', '.language-control[for="render-quality"]', '.language-control[for="cockpit-quality"]', '#btn-sound', '.language-control[for="engine-volume"]', '#btn-touch-toggle', '#touch-btn-gyro', '#gyro-settings', '#btn-cam-reset', '#btn-yokes', '#btn-diag', '#btn-joystick-check', '#btn-help']) {
    const node = document.querySelector(selector);
    if (node) settings.append(node);
  }
  const aircraft = ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser']
    .map(id => document.getElementById(id));
  const mapButton = document.createElement('button');
  mapButton.id = 'btn-pilotage-map';
  mapButton.className = 'btn';
  mapButton.type = 'button';
  mapButton.hidden = map.hidden;
  mapButton.setAttribute('aria-controls', map.id);
  mapButton.setAttribute('aria-expanded', String(map.open));
  bindText(mapButton, () => t('ui.mapShortcut'), 'title');
  bindText(mapButton, () => t('hud.map'), 'aria-label');
  setToolbarIcon(mapButton, 'map');
  mapButton.addEventListener('click', () => map.querySelector('summary').click());
  map.addEventListener('toggle', () => mapButton.setAttribute('aria-expanded', String(map.open)));
  bar.append(...aircraft, mapButton);
  // Trim and parking brake are aircraft controls, so their overflow button stays
  // beside the control group in both orientations. The row is anchored to the right
  // edge, so the aircraft actions that follow takeover unfold leftwards.
  bar.append(moreButton, skipDemoButton, cameraStrip, fullscreen);
  updateCameraToggleState();
  showToolbarItems(toolbarHidden);
  for (const [id, key] of Object.entries({ 'btn-gear': 'G', 'btn-flaps-ret': 'V', 'btn-flaps-ext': 'F', 'btn-spoilers': 'B', 'btn-reverser': 'R', 'flight-trim-less': 'T', 'flight-trim-more': 'Y', 'flight-park-brake': '.' })) {
    document.getElementById(id)?.setAttribute('data-key-hint', key);
  }

  // Issue #638: the wrapped portrait control row dims while the pilot watches
  // the scene, then returns to full opacity on any pointer, key or focus input.
  let controlsIdleTimer = 0;
  const wakeControls = () => {
    bar.classList.remove('controls-idle');
    clearTimeout(controlsIdleTimer);
    controlsIdleTimer = setTimeout(() => bar.classList.add('controls-idle'), 2500);
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'focusin']) {
    document.addEventListener(type, wakeControls, { passive: true });
  }
  wakeControls();

  for (const [id, key] of Object.entries({
    'btn-cam-reset': 'center.view.o',
    'btn-yokes': 'hide.yokes.j', 'btn-diag': 'physics',
    'btn-help': 'flight.guide.h.53', 'btn-skip-demo': 'take.control.esc',
  })) {
    bindText(document.getElementById(id), () => touchLabel(t(key)));
  }
  const povResetTarget = document.getElementById('pov-reset-label') || document.getElementById('btn-reset-pov');
  if (povResetTarget) {
    bindText(povResetTarget, () => touchLabel(t('reset.pov')));
  }

  // Remove the legacy containers after moving their controls.
  document.querySelectorAll('.presets-bar, .action-panel').forEach(node => node.remove());
  const compact = window.matchMedia('(max-width: 1024px)');
  const touch = window.matchMedia('(pointer: coarse)');
  function layout() {
    document.body.classList.toggle('compact-ui', compact.matches);
    document.body.classList.toggle('touch-input', touch.matches);
    setLanguage(getLanguage());
    updateCameraToggleState();
  }
  compact.addEventListener('change', layout);
  touch.addEventListener('change', layout);
  layout();

  // Keep the top header bar, control dock, AP panel, and notice slot aligned.
  function positionEdgeButtons() {
    if (!strip.getClientRects().length || !bar.getClientRects().length) return;
    // Stack the camera strip onto a second row only when the first row cannot
    // fit the visible camera buttons (at most three are required) alongside the
    // fixed flight/utility controls. With every camera hidden there is one row.
    const maxToolbarWidth = Number.parseFloat(getComputedStyle(bar).maxWidth)
      || (document.documentElement.clientWidth - 16);
    let fixedWidth = 2;
    for (const child of bar.children) {
      if (child === cameraStrip || getComputedStyle(child).display === 'none') continue;
      fixedWidth += child.getBoundingClientRect().width;
    }
    const buttonWidth = moreButton.getBoundingClientRect().width || 44;
    const isCollapsed = cameraStrip.classList.contains('is-collapsed');
    const visibleCameras = isCollapsed ? 1 : cameraButtons.filter(button => !button.hidden).length;
    const stackCameraStrip = !flightStrip?.active() && !isCollapsed && visibleCameras > 0
      && (maxToolbarWidth - fixedWidth) < buttonWidth * Math.min(3, visibleCameras);
    bar.classList.toggle('camera-strip-stacked', stackCameraStrip);
    // 320px-class rows cannot hold the five aircraft controls, overflow and
    // fullscreen (7 x 44px) either. Fullscreen then closes the second row instead
    // of wrapping onto a third one or pushing the gear out of a scrolled row.
    const fullscreenShown = getComputedStyle(fullscreen).display !== 'none';
    bar.classList.toggle('fullscreen-wrapped', !flightStrip?.active() && fullscreenShown && fixedWidth > maxToolbarWidth + 0.5);
    // The folded compact notice narrows this row. Keep takeover visible there;
    // elsewhere pin the camera/fullscreen/overflow end to the right edge.
    const foldedCompactDemo = document.body.classList.contains('demo-active')
      && compact.matches
      && document.getElementById('btn-demo-open')?.style.display === 'inline-flex';
    if (!flightStrip?.active()) bar.scrollLeft = foldedCompactDemo ? 0 : bar.scrollWidth;
    const topBarRect = topBar.getBoundingClientRect();
    const controlsBottom = bar.getBoundingClientRect().bottom;
    const noticeTop = Math.max(topBarRect.bottom, controlsBottom) + 6;
    document.documentElement.style.setProperty('--menu-row-top', `${topBarRect.top}px`);
    document.documentElement.style.setProperty('--ap-row-top', `${topBarRect.top}px`);
    const demoPillTop = flightStrip?.active() ? noticeTop : topBarRect.bottom + 4;
    document.documentElement.style.setProperty('--demo-pill-top', `${demoPillTop}px`);
    document.documentElement.style.setProperty('--demo-row-top', `${noticeTop}px`);
    document.documentElement.style.setProperty('--flight-panels-top', `${noticeTop}px`);
    // The demo guide owns the notice row under the controls: the expanded banner
    // always, the folded pill only on wide layouts (compact ones dock it beside the
    // first strip). The POV pills then take the row beneath it. Height alone is
    // reserved because the guide's own offset already follows warnings.
    const guide = [demoBanner, demoPill].find(node => node?.getClientRects().length);
    const guideSpace = guide && (guide === demoBanner || !compact.matches)
      ? guide.getBoundingClientRect().height + 6 : 0;
    document.documentElement.style.setProperty('--demo-guide-space', `${guideSpace}px`);
  }
  const observer = new ResizeObserver(positionEdgeButtons);
  for (const node of [topBar, strip, bar, menu, ap, demoBanner, demoPill, document.documentElement]) {
    if (node) observer.observe(node);
  }
  new MutationObserver(() => {
    flightStrip?.sync();
    if (document.body.dataset.flow !== 'flight') {
      map.open = false;
      setMoreOpen(false);
      flightStrip?.close();
      setHudFolded(false, false);
    }
    positionEdgeButtons();
  }).observe(document.body, {
    attributes: true, attributeFilter: ['class', 'data-flow'],
  });
  window.addEventListener('resize', positionEdgeButtons);
  flightStrip = createFlightStrip({
    hud, topBar, topActions, bar, cameraStrip, cameraToggle: cameraToggleBtn,
    more, moreButton, mute, hudFold, fullscreen, apPanel,
    onLayoutChange: updateCameraToggleState,
  });
  flightStrip.sync();
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
  setToolbarIcon(gearBtn, gearIconName(state));
  if (gearBtn) gearBtn.disabled = disabled;
  // Flaps keep their angle as text under the icon (`data-icon-value`).
  const flapAngle = Math.round(telemetry.flapDegree || 0);
  for (const [id, sign] of [['btn-flaps-ret', '−'], ['btn-flaps-ext', '+']]) {
    const button = document.getElementById(id);
    if (!button) continue;
    setToolbarIcon(button, 'flaps');
    button.setAttribute('data-icon-value', `${sign}${flapAngle}°`);
  }
  const flapsRetBtn = document.getElementById('btn-flaps-ret');
  if (flapsRetBtn) flapsRetBtn.disabled = disabled || telemetry.flapIndex <= 0;
  const flapsExtBtn = document.getElementById('btn-flaps-ext');
  if (flapsExtBtn) flapsExtBtn.disabled = disabled || telemetry.flapIndex >= 6;
  set('btn-spoilers', telemetry.spoilers > .1 ? 'ui.spoilers.on' : 'ui.spoilers.off', {}, telemetry.spoilers > .1, t('ui.strip.spoilers'));
  set('btn-reverser', telemetry.reverserActive ? 'ui.reverse.on' : 'ui.reverse.off', {}, !!telemetry.reverserActive, t('ui.strip.reverse'));
  const spoilersBtn = document.getElementById('btn-spoilers');
  setToolbarIcon(spoilersBtn, 'spoilers');
  if (spoilersBtn) {
    spoilersBtn.disabled = disabled;
    spoilersBtn.hidden = options.spoilersSupported === false;
  }
  const reverserBtn = document.getElementById('btn-reverser');
  if (reverserBtn) {
    reverserBtn.disabled = disabled;
    reverserBtn.hidden = options.reverserSupported === false;
  }
  const mode = camera.autoSwitch ? 7 : camera.mode;
  const cameraSelect = document.getElementById('camera-select');
  if (cameraSelect) cameraSelect.value = String(mode);
  // Optical zoom only exists in the fixed eye-point views, so chase and drone
  // framing changes stay unlabelled.
  const zoomed = camera.opticalZoom > 1.01;
  const zoomValue = zoomed ? `${camera.opticalZoom.toFixed(1)}×` : '';
  for (const [camMode, name] of CAMERA_MODES) {
    const camButton = document.getElementById(`btn-cam-${name}`);
    if (!camButton) continue;
    const active = camMode === mode;
    camButton.setAttribute('aria-pressed', String(active));
    const fullLabel = touchLabel(t(`ui.camera.${name}`));
    const viewName = t(`ui.camera.${name}`).replace(/ · [0-9]$/, '');
    const titleText = active
      ? t('ui.camera.current', { name: zoomed ? `${viewName} · ${zoomValue}` : viewName })
      : fullLabel;
    camButton.setAttribute('title', titleText);
    if (active && document.body.classList.contains('flight-strip-v2')) {
      // The icon carries no text, so the current view stays in its name and tooltip.
      const trigger = document.getElementById('btn-camera-toggle');
      trigger?.setAttribute('aria-label', titleText);
      trigger?.setAttribute('title', titleText);
    }
  }
  const toggle = document.getElementById('btn-touch-toggle');
  toggle?.setAttribute('aria-pressed', String(document.body.classList.contains('touch-mode')));
  syncPovResetButton(camera);
  const gazeExitBtn = document.getElementById('btn-gaze-exit');
  if (gazeExitBtn) {
    const gazeActive = Boolean(camera && typeof camera.isGazeActive === 'function' && camera.isGazeActive());
    gazeExitBtn.hidden = !gazeActive;
    if (gazeActive) {
      const labelEl = document.getElementById('gaze-exit-label');
      const targetLabel = typeof camera.getGazeTargetLabel === 'function' ? camera.getGazeTargetLabel() : '';
      if (labelEl) {
        labelEl.textContent = targetLabel ? t('gaze.exit.target', { target: targetLabel }) : t('gaze.exit');
      }
    }
  }
  const isCockpit = Boolean(camera && camera.mode === 0);
  const povAdjustBtn = document.getElementById('btn-open-cockpit-pov');
  if (povAdjustBtn) povAdjustBtn.hidden = !isCockpit;
  const povPillBtn = document.getElementById('btn-cockpit-pov');
  if (povPillBtn) povPillBtn.hidden = !isCockpit;
  if (!isCockpit) {
    const povPanel = document.getElementById('cockpit-pov-panel');
    if (povPanel && !povPanel.hidden) {
      povPanel.hidden = true;
      povAdjustBtn?.setAttribute('aria-expanded', 'false');
      povPillBtn?.setAttribute('aria-expanded', 'false');
    }
  }
}
