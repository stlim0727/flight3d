import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLBAR_ICONS, gearIconName, setToolbarIcon, toolbarIconUrl } from '../src/ui/toolbarIcons.js';

test('every gear state maps to a drawn icon, damage included', () => {
  assert.equal(gearIconName('down'), 'gear-down');
  assert.equal(gearIconName('up'), 'gear-up');
  assert.equal(gearIconName('transit'), 'gear-transit');
  assert.equal(gearIconName('fail'), 'gear-fail');
  assert.equal(gearIconName('damaged'), 'gear-fail');
});

test('camera views keep their text labels; gear, flaps, spoilers, fullscreen and the camera menu are drawn', () => {
  assert.deepEqual(Object.keys(TOOLBAR_ICONS).sort(), [
    'camera', 'flaps', 'fullscreen-enter', 'fullscreen-exit', 'gear-down', 'gear-fail', 'gear-transit', 'gear-up',
    'spoilers',
  ]);
});

test('issue #880: the in-flight camera menu trigger draws the camera icon, not a CAM text label', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/styles/flight-strip.css', import.meta.url), 'utf8');
  const panels = await readFile(new URL('../src/ui/FlightPanels.js', import.meta.url), 'utf8');
  assert.match(panels, /setToolbarIcon\(cameraToggleBtn, 'camera'\)/);
  assert.match(css, /#btn-camera-toggle::after \{[^}]*mask: var\(--toolbar-icon\)/);
  assert.match(css, /#btn-camera-toggle::before \{[^}]*content: "▾"/, 'menu arrow like 보조 ▾');
  assert.doesNotMatch(css, /'CAM /);
  assert.doesNotMatch(panels, /data-(current|compact)-view/);
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
