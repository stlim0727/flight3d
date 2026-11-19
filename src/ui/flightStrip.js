import { bindText, t } from '../i18n/index.js';

export function createFlightStrip({ hud, topBar, topActions, bar, cameraStrip, cameraToggle,
  more, moreButton, mute, hudFold, fullscreen, apPanel, onLayoutChange }) {
  const apToggle = document.getElementById('btn-ap-toggle');
  const reset = document.getElementById('btn-reset-pov');
  const pov = document.getElementById('btn-cockpit-pov');
  const gaze = document.getElementById('btn-gaze-exit');
  const povActions = gaze.parentElement;
  const settingsToggle = document.createElement('button');
  settingsToggle.type = 'button';
  settingsToggle.className = 'btn flight-display-toggle';
  settingsToggle.textContent = '⚙';
  bindText(settingsToggle, () => t('ui.strip.display'), 'aria-label');
  bindText(settingsToggle, () => t('ui.strip.display'), 'title');
  const settings = document.createElement('section');
  settings.id = 'flight-display-panel';
  settings.className = 'flight-more-panel';
  settings.hidden = true;
  hud.append(settings);
  const desktop = window.matchMedia('(min-width: 1024px)');
  const singleRow = window.matchMedia('(min-width: 667px) and (orientation: landscape), (min-width: 1024px)');
  const groups = {
    ap: [apToggle, apPanel],
    camera: [cameraToggle, cameraStrip],
    aux: [moreButton, more],
    display: [settingsToggle, settings],
  };
  let enabled = false;
  let open = '';

  for (const [trigger, panel] of Object.values(groups)) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn flight-strip-close';
    close.textContent = '×';
    bindText(close, () => t('ui.strip.close'), 'aria-label');
    close.addEventListener('click', () => setOpen('', true));
    panel.prepend(close);
    if (!trigger.hasAttribute('aria-controls')) trigger.setAttribute('aria-controls', panel.id);
  }

  function setOpen(next, restoreFocus = false) {
    const previous = groups[open];
    open = next;
    for (const [name, [trigger, panel]] of Object.entries(groups)) {
      panel.hidden = open !== name;
      trigger.setAttribute('aria-expanded', String(open === name));
    }
    if (restoreFocus) previous?.[0].focus({ preventScroll: true });
  }

  function toggle(group) {
    if (!enabled) return;
    const [trigger, panel] = groups[group];
    setOpen(open === group ? '' : group);
    if (open && trigger.matches(':focus-visible')) {
      panel.querySelector('.flight-strip-close').focus({ preventScroll: true });
    }
  }

  function syncDisplay() {
    if (!enabled) return;
    if (open === 'display') setOpen('');
    settingsToggle.hidden = desktop.matches;
    if (singleRow.matches) topActions.insertBefore(cameraToggle, settingsToggle);
    else bar.append(cameraToggle);
    (desktop.matches ? topActions : settings).append(mute, fullscreen, hudFold);
  }

  function sync() {
    const active = document.body.dataset.flow === 'flight'
      && !document.body.classList.contains('replaying');
    if (enabled === active) {
      if (enabled && (document.body.classList.contains('hud-folded')
        || (open === 'ap' && document.body.classList.contains('demo-active')))) setOpen('');
      return;
    }
    enabled = active;
    document.body.classList.toggle('flight-strip-v2', active);
    setOpen('');
    for (const [, panel] of Object.values(groups)) panel.classList.toggle('flight-strip-panel', active);
    if (active) {
      topBar.insertBefore(bar, topActions);
      hud.append(cameraStrip);
      cameraStrip.append(reset, pov);
      topActions.append(settingsToggle);
      bindText(moreButton, () => t('ui.strip.aux'));
      bindText(moreButton, () => t('ui.strip.aux'), 'aria-label');
      syncDisplay();
    } else {
      hud.append(bar);
      bar.append(cameraStrip, fullscreen);
      cameraStrip.append(cameraToggle);
      cameraStrip.hidden = !cameraStrip.querySelector('[data-camera-mode]:not([hidden])');
      povActions.prepend(reset);
      povActions.append(pov);
      settingsToggle.remove();
      topActions.append(mute, hudFold);
      bindText(moreButton, () => '⋯');
      bindText(moreButton, () => t('ui.more'), 'aria-label');
    }
    onLayoutChange();
  }

  apToggle.addEventListener('flight-strip-ap-toggle', () => toggle('ap'));
  settingsToggle.addEventListener('click', () => toggle('display'));
  pov.addEventListener('click', () => {
    if (open === 'camera') setOpen('', true);
  });
  desktop.addEventListener('change', syncDisplay);
  singleRow.addEventListener('change', syncDisplay);
  document.addEventListener('pointerdown', event => {
    if (!open || gaze.contains(event.target)) return;
    if (!groups[open].some(node => node.contains(event.target))) setOpen('');
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen('', true);
  }, true);

  return { active: () => enabled, isOpen: group => open === group,
    toggle, close: () => { if (open) setOpen(''); }, sync };
}
