/**
 * Issue #808: icons for the in-flight top menu (control row). Each icon is a
 * 24×24 stroke drawing used as a CSS mask over `currentColor`, so the button's
 * own colour, the disabled grey/opacity and the idle dimming all apply to it
 * exactly as they did to the text labels. Flaps keep their angle as text under
 * the icon. Controls whose meaning an icon cannot carry clearly (reverser,
 * takeover, fly-by, wing, gear view, HUD) keep their short text labels.
 */
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

// Landing gear: strut and wheel under the fuselage line, with a state mark on the right.
const GEAR_BODY = '<path d="M2.5 4h12"/><path d="M8.5 4v8"/><circle cx="8.5" cy="16" r="4"/><circle cx="8.5" cy="16" r="1" fill="#000"/>';

export const TOOLBAR_ICONS = Object.freeze({
  'gear-down': `${GEAR_BODY}<path d="M19 7v12M16 16l3 3 3-3"/>`,
  'gear-up': `${GEAR_BODY}<path d="M19 19V7M16 10l3-3 3 3"/>`,
  'gear-transit': `${GEAR_BODY}<path d="M19 6v13M16.5 8.5 19 6l2.5 2.5M16.5 16.5 19 19l2.5-2.5"/>`,
  'gear-fail': `${GEAR_BODY}<path d="M19 7v7"/><circle cx="19" cy="18.5" r="1.2" fill="#000" stroke="none"/>`,
  // Flaps: airfoil with the trailing-edge flap lowered; the angle is drawn as text.
  flaps: '<path d="M2 13c0-3 4-5.5 8.5-5.5 3.5 0 6 2 6.5 5.5z"/><path d="M19 14.5l3 4"/>',
  // Spoilers, after the Airbus ECAM flight-control page: a line on the wing while
  // stowed, an up-pointing triangle once the panels are deflected.
  'spoilers-off': '<path d="M2 17h20"/><path d="M8.5 17 12 12l3.5 5"/>',
  'spoilers-on': '<path d="M2 17h20"/><path d="M12 15V9"/><path d="M8 9l4-5.5L16 9z" fill="#000"/>',
  // Chase: the aircraft seen from directly behind.
  'camera-chase': '<circle cx="12" cy="14" r="2.5"/><path d="M2 14h7.5M14.5 14H22M12 11.5V4.5M8.5 9h7"/>',
  // Drone: quadcopter from above.
  'camera-drone': '<rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>',
  // Cockpit: the control yoke on its column.
  'camera-cockpit': '<path d="M4 7v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7"/><path d="M12 13v8M9 21h6"/><circle cx="12" cy="10" r="1.2" fill="#000" stroke="none"/>',
  // Tower: control tower cab, shaft and antenna.
  'camera-tower': '<path d="M5 7h14l-3 5H8z"/><path d="M12 7V3M10 12v9M14 12v9M7 21h10"/>',
  // Auto: the usual automatic-mode mark, an A inside a turning arrow.
  'camera-auto': '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><path d="M9 16l3-8 3 8M10.2 13h3.6"/>',
  // Director: clapperboard.
  'camera-director': '<rect x="3" y="10" width="18" height="11" rx="1.5"/><path d="M3 10 19.5 5.5l-1-3.5L2.2 6.5z"/><path d="m7.5 5.3 2.2 3.2M12.5 3.9l2.2 3.2"/>',
  'fullscreen-enter': '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  'fullscreen-exit': '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
});

/** Camera views drawn as icons; the rest keep their short text label. */
export const CAMERA_ICONS = Object.freeze({
  chase: 'camera-chase',
  drone: 'camera-drone',
  cockpit: 'camera-cockpit',
  tower: 'camera-tower',
  auto: 'camera-auto',
  director: 'camera-director',
});

/** Gear button icon for each `updateControlState` gear state. */
export function gearIconName(state) {
  if (state === 'down' || state === 'up' || state === 'transit') return `gear-${state}`;
  return 'gear-fail';
}

export function spoilerIconName(deployed) {
  return deployed ? 'spoilers-on' : 'spoilers-off';
}

export function toolbarIconUrl(name) {
  const body = TOOLBAR_ICONS[name];
  if (!body) throw new Error(`Unknown toolbar icon: ${name}`);
  return `url("data:image/svg+xml,${encodeURIComponent(`${SVG_OPEN}${body}</svg>`)}")`;
}

/**
 * Draw `name` on the button. `data-icon` switches the CSS from the short text
 * label to the mask; the accessible name (aria-label/title/text) is untouched.
 */
export function setToolbarIcon(button, name) {
  if (!button || button.dataset.icon === name) return;
  button.style.setProperty('--toolbar-icon', toolbarIconUrl(name));
  button.dataset.icon = name;
}
