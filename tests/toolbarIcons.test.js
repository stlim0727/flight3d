import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_ICONS, TOOLBAR_ICONS, gearIconName, setToolbarIcon, toolbarIconUrl } from '../src/ui/toolbarIcons.js';
import { CAMERA_MODES } from '../src/ui/FlightPanels.js';

test('every gear state maps to a drawn icon, damage included', () => {
  assert.equal(gearIconName('down'), 'gear-down');
  assert.equal(gearIconName('up'), 'gear-up');
  assert.equal(gearIconName('transit'), 'gear-transit');
  assert.equal(gearIconName('fail'), 'gear-fail');
  assert.equal(gearIconName('damaged'), 'gear-fail');
});

test('camera icons name existing views and drawings; ambiguous views keep text', () => {
  const views = new Set(CAMERA_MODES.map(([, name]) => name));
  for (const [view, icon] of Object.entries(CAMERA_ICONS)) {
    assert.ok(views.has(view), `${view} is a camera view`);
    assert.ok(TOOLBAR_ICONS[icon], `${icon} is drawn`);
  }
  for (const view of ['flyby', 'wing', 'hud', 'gear', 'auto']) assert.equal(CAMERA_ICONS[view], undefined);
});

test('icons are self-contained SVG data URLs usable as a CSS mask', () => {
  for (const name of Object.keys(TOOLBAR_ICONS)) {
    const url = toolbarIconUrl(name);
    assert.match(url, /^url\("data:image\/svg\+xml,%3Csvg[^"]*%3C%2Fsvg%3E"\)$/);
    assert.ok(!url.slice(5, -2).includes('"'), `${name} keeps the url() quotes balanced`);
  }
  assert.throws(() => toolbarIconUrl('missing'), /Unknown toolbar icon/);
});

test('setToolbarIcon writes the mask once and tolerates a missing button', () => {
  const writes = [];
  const button = { dataset: {}, style: { setProperty: (key, value) => writes.push([key, value]) } };
  setToolbarIcon(button, 'fullscreen-enter');
  setToolbarIcon(button, 'fullscreen-enter');
  assert.equal(button.dataset.icon, 'fullscreen-enter');
  assert.equal(writes.length, 1);
  setToolbarIcon(button, 'fullscreen-exit');
  assert.equal(button.dataset.icon, 'fullscreen-exit');
  assert.deepEqual(writes.map(([key]) => key), ['--toolbar-icon', '--toolbar-icon']);
  assert.doesNotThrow(() => setToolbarIcon(null, 'gear-down'));
});
