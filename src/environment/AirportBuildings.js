import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { castFarSunShadow } from './FarSunShadow.js';

export const AIRPORT_KIT_URL = `${import.meta.env?.BASE_URL ?? '/'}models/airport/airport-kit.glb`;
let kitPromise;
export function loadAirportKit() {
  // Concurrent airports share geometry, materials, and a single network request.
  return kitPromise ??= new GLTFLoader().loadAsync(AIRPORT_KIT_URL).then(gltf => {
    validateAirportKit(gltf.scene);
    return gltf.scene;
  }).catch(error => { kitPromise = undefined; throw error; });
}

export function validateAirportKit(kit) {
  for (const name of ['TowerNear', 'TowerFar', 'TerminalBayNear', 'TerminalBayFar',
    'JetBridgeNear', 'JetBridgeFar', 'HangarNear', 'HangarFar', 'Radar', 'Beacon']) {
    if (!kit.getObjectByName(name)) throw new Error(`Airport kit missing ${name}`);
  }
}

export function createAirportBuildings(kit, airport, { terminal = true } = {}) {
  validateAirportKit(kit);
  const group = new THREE.Group(); group.name = 'airport-buildings-glb';
  const lods = [];
  const place = (type, x, y, z) => {
    const lod = new THREE.LOD(); lod.name = type;
    lod.position.set(x, y, z);
    lod.addLevel(kit.getObjectByName(`${type}Near`).clone(true), 0);
    lod.addLevel(kit.getObjectByName(`${type}Far`).clone(true), type === 'Tower' ? 1500 : 800, .1);
    group.add(lod); lods.push(lod); return lod;
  };
  const t = airport.controlTowerData;
  const tower = new THREE.Group(); tower.name = 'control-tower'; tower.position.set(t.x, t.y, t.z);
  const shell = place('Tower', 0, 0, 0); tower.add(shell);
  const radar = kit.getObjectByName('Radar').clone(true); tower.add(radar);
  const anchor = kit.getObjectByName('Beacon').clone(true); tower.add(anchor);
  const beacon = new THREE.PointLight(0xff0000, 3.5, 60); anchor.add(beacon);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  anchor.add(lens); group.add(tower);
  if (terminal) {
    const term = airport.terminalData;
    for (let bay = -3; bay <= 3; bay++) place('TerminalBay', term.x + bay * 50, term.y, term.z);
    for (const x of [-120, -40, 40, 120]) place('JetBridge', term.x + x, term.y, term.z - 46);
    for (const h of airport.hangarsData) place('Hangar', h.x, h.y, h.z);
  }
  group.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  castFarSunShadow(group);
  return { group, tower, radar, beacon, lods };
}
