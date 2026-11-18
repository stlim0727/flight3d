import { bindText, t } from '../i18n/index.js';

// Reuse the live controls so their handlers, icons and localized states travel
// with them when the compact toolbar changes groups.
export function createMobileFlightToolbar({ query, bar, cameraStrip, cameraToggle, cameraButtons,
  more, moreButton, topActions, mute, hudFold, aircraft, fullscreen, onLayoutChange }) {
  const gaze = document.getElementById('btn-gaze-exit');
  const reset = document.getElementById('btn-reset-pov');
  const pov = document.getElementById('btn-cockpit-pov');
  const povActions = gaze.parentElement;
  const trim = more.querySelector('.flight-trim');
  const trimItems = [...trim.children].slice(1);
  const brake = more.querySelector('#flight-park-brake');
  const extras = [...trimItems, brake];
  const shortLandscape = window.matchMedia('(min-width: 550px) and (max-height: 440px)');
  const apToggle = document.getElementById('btn-ap-toggle');
  const apPanel = document.getElementById('ap-panel');
  const apButtons = [...apPanel.querySelectorAll('button')];
  const apModes = document.getElementById('hud-ap-modes');
  const row = document.createElement('div');
  row.id = 'mobile-flight-items';
  row.className = 'mobile-flight-items';
  const pager = document.createElement('button');
  pager.type = 'button';
  pager.className = 'btn mobile-flight-next';
  pager.textContent = '›';
  bar.append(row, pager);
  let group = '';
  let page = 0;
  let pageCount = 1;
  let enabled = false;
  let lastItems = [];
  let lastWidth = 0;
  const labelPager = () => t('ui.strip.nextPage', { page: page + 1, total: pageCount });
  bindText(pager, labelPager, 'aria-label');
  const trigger = () => group === 'ap' ? apToggle : group === 'more' ? moreButton : cameraToggle;

  function update() {
    if (!enabled) return;
    const items = [...row.children];
    const available = items.filter(node => !node.hidden
      && !(aircraft.includes(node) && document.body.classList.contains('demo-active')));
    const width = row.clientWidth + (pager.hidden ? 0 : pager.offsetWidth);
    if (width === lastWidth && available.length === lastItems.length
      && available.every((node, index) => node === lastItems[index])) return;
    lastWidth = width;
    lastItems = available;
    const overflow = available.length * 44 > width;
    const scroll = overflow && width >= (shortLandscape.matches ? 156 : 270);
    row.classList.toggle('can-scroll', scroll);
    const pages = [[]];
    if (overflow && !scroll) {
      let used = 0;
      for (const node of available) {
        const nextWidth = 44;
        if (used && used + nextWidth > width - 44) {
          pages.push([]);
          used = 0;
        }
        pages.at(-1).push(node);
        used += nextWidth;
      }
    }
    pageCount = pages.length;
    page = Math.min(page, pageCount - 1);
    pager.hidden = pageCount < 2;
    pager.setAttribute('aria-label', labelPager());
    for (const node of items) {
      node.classList.toggle('mobile-page-hidden', pageCount > 1 && !pages[page].includes(node));
    }
  }

  function setGroup(next) {
    if (!enabled || group === next) return;
    const focus = document.activeElement;
    const previousTrigger = trigger();
    group = next;
    page = 0;
    lastWidth = -1;
    bar.dataset.mobileGroup = group || 'closed';
    moreButton.setAttribute('aria-expanded', String(group === 'more'));
    const selected = cameraButtons.find(node => node.getAttribute('aria-pressed') === 'true' && !node.hidden);
    const views = selected ? [selected, ...cameraButtons.filter(node => node !== selected)] : cameraButtons;
    row.replaceChildren(...(group === 'camera' ? [...views, reset, pov]
      : group === 'more' ? [...aircraft, ...extras, fullscreen, mute, hudFold]
        : group === 'ap' ? apButtons : []));
    if (group !== 'ap') apModes.before(...apButtons);
    if (group !== 'camera') {
      cameraStrip.prepend(...cameraButtons);
      povActions.append(reset, pov);
    }
    if (group !== 'more') {
      bar.prepend(...aircraft);
      trim.append(...trimItems);
      trim.after(brake);
      bar.insertBefore(fullscreen, row);
      topActions.insertBefore(mute, gaze);
      topActions.append(hudFold);
    }
    for (const node of [...aircraft, ...cameraButtons, ...apButtons, ...extras, fullscreen, mute, hudFold, reset, pov]) {
      node.classList.remove('mobile-page-hidden');
    }
    apToggle.setAttribute('aria-expanded', String(group === 'ap'));
    apToggle.setAttribute('aria-controls', row.id);
    apToggle.setAttribute('aria-label', t(group === 'ap' ? 'ap.collapse' : 'ap.expand'));
    onLayoutChange();
    row.scrollLeft = 0;
    update();
    if (focus !== document.body && !focus.getClientRects().length) {
      (group ? trigger() : previousTrigger).focus({ preventScroll: true });
    }
  }

  apToggle.addEventListener('mobile-ap-toggle', () => setGroup(group === 'ap' ? '' : 'ap'));
  pager.addEventListener('click', () => {
    page = (page + 1) % pageCount;
    lastWidth = -1;
    update();
  });
  new ResizeObserver(update).observe(bar);
  const visibility = new MutationObserver(update);
  for (const node of [...cameraButtons, reset, pov, fullscreen]) {
    visibility.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }
  function sync() {
    const useCompactControls = query.matches && document.body.dataset.flow !== 'debrief'
      && !document.body.classList.contains('replaying');
    if (enabled === useCompactControls) return;
    if (enabled) setGroup('');
    enabled = useCompactControls;
    bar.classList.toggle('mobile-flight-toolbar', enabled);
    document.body.classList.toggle('mobile-flight-layout', enabled);
    bar.dataset.mobileGroup = 'closed';
    pager.hidden = true;
    if (enabled) {
      topActions.insertBefore(gaze, mute);
      bar.insertBefore(cameraToggle, cameraStrip);
      cameraToggle.setAttribute('aria-controls', row.id);
      document.getElementById('ap-bar').classList.add('ap-collapsed');
      apPanel.hidden = true;
      apToggle.setAttribute('aria-controls', row.id);
      apToggle.setAttribute('aria-expanded', 'false');
      moreButton.setAttribute('aria-controls', row.id);
      more.hidden = true;
      moreButton.setAttribute('aria-expanded', 'false');
    } else {
      moreButton.setAttribute('aria-controls', more.id);
      apToggle.setAttribute('aria-controls', apPanel.id);
      povActions.append(reset, gaze, pov);
      cameraToggle.removeAttribute('aria-controls');
      cameraStrip.append(cameraToggle);
      bar.append(fullscreen);
      for (const node of [...cameraButtons, ...apButtons, ...extras, reset, pov, fullscreen, mute, hudFold, ...aircraft]) {
        node.classList.remove('mobile-page-hidden');
      }
    }
    onLayoutChange();
  }
  query.addEventListener('change', sync);
  sync();
  return {
    sync,
    active: () => enabled,
    cameraOpen: () => group === 'camera',
    toggleCamera: () => setGroup(group === 'camera' ? '' : 'camera'),
    toggleMore: () => setGroup(group === 'more' ? '' : 'more'),
    close: () => setGroup(''),
    isOpen: () => Boolean(group),
    activeTrigger: trigger,
    update,
  };
}
