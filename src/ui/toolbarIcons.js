/**
 * Issue #808: icons for the in-flight top menu (control row). Each icon is a
 * 24×24 stroke drawing used as a CSS mask over `currentColor`, so the button's
 * own colour, the disabled grey/opacity and the idle dimming all apply to it
 * exactly as they did to the text labels. Flaps keep their angle as text under
 * the icon. The reverser (`REV`, as cockpits print it), takeover and the camera
 * views keep their short text labels; the in-flight camera menu trigger is a
 * camera icon whose panel names each view (issue #880).
 */
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

// Landing gear: strut and wheel under the fuselage line, with a state mark on the right.
const GEAR_BODY = '<path d="M2.5 4h12"/><path d="M8.5 4v8"/><circle cx="8.5" cy="16" r="4"/><circle cx="8.5" cy="16" r="1" fill="#000"/>';

// Full airfoil for the spoiler icon.
const WING = '<path d="M2 16c0-3.2 4-5.5 9-5.5 5 0 9 2 11 5.5z"/>';

export const TOOLBAR_ICONS = Object.freeze({
  'gear-down': `${GEAR_BODY}<path d="M19 7v12M16 16l3 3 3-3"/>`,
  'gear-up': `${GEAR_BODY}<path d="M19 19V7M16 10l3-3 3 3"/>`,
  'gear-transit': `${GEAR_BODY}<path d="M19 6v13M16.5 8.5 19 6l2.5 2.5M16.5 16.5 19 19l2.5-2.5"/>`,
  'gear-fail': `${GEAR_BODY}<path d="M19 7v7"/><circle cx="19" cy="18.5" r="1.2" fill="#000" stroke="none"/>`,
  // Flaps: airfoil with the trailing-edge flap lowered; the angle is drawn as text.
  flaps: '<path d="M2 13c0-3 4-5.5 8.5-5.5 3.5 0 6 2 6.5 5.5z"/><path d="M19 14.5l3 4"/>',
  // Spoilers: the same airfoil family as the flap icon with its upper-surface
  // panel always drawn raised; the pressed button state shows whether they are out.
  spoilers: `${WING}<path d="M10 10.5 16 4"/>`,
  // Issue #880: the in-flight view menu trigger. The open panel lists every view by name.
  camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3l1.5-2.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  'fullscreen-enter': '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  'fullscreen-exit': '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
});

/** Gear button icon for each `updateControlState` gear state. */
export function gearIconName(state) {
  if (state === 'down' || state === 'up' || state === 'transit') return `gear-${state}`;
  return 'gear-fail';
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
