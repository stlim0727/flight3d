import * as THREE from 'three';
import { DEPARTURE_GATE } from '../config/incheonDeparture.js';
import { applyLogDepthOffset } from './RunwayMarkings.js';

/** Authored G1 stand sign and lead-in, kept distinct from mapped airport data. */
export function createDepartureStand(height) {
  const group = new THREE.Group();
  group.name = 'departure-gate-G1';
  group.position.set(DEPARTURE_GATE.x, height, DEPARTURE_GATE.z);
  group.rotation.y = -DEPARTURE_GATE.heading;
  const yellow = applyLogDepthOffset(new THREE.MeshBasicMaterial({ color: 0xf9cf38 }), 3);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(.2, 40), yellow);
  line.rotation.x = -Math.PI / 2; line.position.set(0, .06, 15); group.add(line);
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(8, .3), yellow);
  stop.rotation.x = -Math.PI / 2; stop.position.set(0, .07, -3); group.add(stop);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 3, 8), new THREE.MeshLambertMaterial({ color: 0x555b65 }));
  pole.position.set(10, 1.5, -5); group.add(pole);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#202938';ctx.fillRect(0,0,256,128);
  ctx.fillStyle = '#ffda49'; ctx.font = 'bold 88px sans-serif';ctx.textAlign = 'center';ctx.fillText('G1',128,95);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3,1.5), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),side:THREE.DoubleSide}));
  sign.position.set(10,3,-5);group.add(sign);
  return group;
}
