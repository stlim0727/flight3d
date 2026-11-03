import * as THREE from 'three';
import { generateValley } from '../src/arena/generatedValley.js';
import { GeneratedValleyTerrain } from '../src/environment/GeneratedValleyTerrain.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 2);
const view = params.get('view') || 'cruise';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaecbe6);
scene.fog = new THREE.Fog(0xaecbe6, 12000, 60000);

const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
sun.position.set(-0.35, 0.92, -0.2).multiplyScalar(12000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd4ee, 0x5a5142, 1.4));

const { course, terrain } = generateValley({ seed });
const rendered = new GeneratedValleyTerrain(terrain, { scene });
rendered.getHeight = terrain.getHeight.bind(terrain);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 60000);
const centerline = terrain.centerline;
const first = centerline[0], last = centerline[centerline.length - 1];
const mid = centerline[Math.floor(centerline.length * 0.45)];
const look = new THREE.Vector3();
const at = (s, cross) => terrain.place(s, cross);
const ground = p => terrain.getHeight(p.x, p.z);

if (view === 'cruise') {
  // Down the middle of the corridor, high enough to see both walls and the floor.
  const here = at(first.s + 40, 0);
  camera.position.set(here.x, ground(here) + 150, here.z);
  const ahead = at(first.s + 1400, 0);
  look.set(ahead.x, ground(ahead) + 40, ahead.z);
} else if (view === 'cliff') {
  // From the floor looking up one wall, to show strata and trees on the ledges.
  const here = at(mid.s, -mid.halfWidth * 0.5);
  camera.position.set(here.x, ground(here) + 40, here.z);
  const wall = at(mid.s + 250, mid.halfWidth * 1.7);
  look.set(wall.x, ground(wall) + 120, wall.z);
} else {
  // High 3/4 aerial looking down the valley: landform, strata walls, forested benches.
  const here = at(mid.s - 1200, -mid.halfWidth * 4.5);
  camera.position.set(here.x, ground(here) + 1500, here.z);
  const inner = at(mid.s + 1600, mid.halfWidth * 0.5);
  look.set(inner.x, ground(inner) + 40, inner.z);
}
camera.lookAt(look);
renderer.render(scene, camera);

const gl = renderer.getContext();
const ext = gl.getExtension('WEBGL_debug_renderer_info');
const trees = (rendered.treeMeshes || []).reduce((n, mesh) => n + mesh.count, 0);
window.__valleyReady = {
  seed, view, trees,
  ribbonRings: rendered.ribbonRings,
  rendererName: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
  drawnPixels: gl.readPixels ? 'checked' : 'missing',
};
// Prove the scene actually rasterised: sample a patch away from the centre line.
const probe = new Uint8Array(4 * 64);
gl.readPixels(Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.7), 8, 8,
  gl.RGBA, gl.UNSIGNED_BYTE, probe);
window.__valleyReady.nonBlank = probe.some((value, index) => index % 4 !== 3 && value > 0);
