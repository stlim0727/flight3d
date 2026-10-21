import * as THREE from 'three';
import { Airport } from './Airport.js';

/** Incheon-inspired training layout. Distances and runway bearing are fictional. */
export class IncheonAirport extends Airport {
  constructor() {
    super();
    this.hangarsData = [];
    this.terminalData.height = 16;
  }

  buildTaxiways(asphalt) {
    super.buildTaxiways(asphalt);
    const yellow = new THREE.MeshBasicMaterial({ color: 0xeac54c });
    const points = [[-25,240], [15,200], [15,140], [-25,100], [-1250,100], [-1350,70], [-1350,0], [-1280,0]];
    const strip = (a, b, width, material, height) => {
      const dx = b[0]-a[0], dz = b[1]-a[1];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(dx,dz), width), material);
      mesh.rotation.set(-Math.PI/2, 0, -Math.atan2(dz,dx));
      mesh.position.set((a[0]+b[0])/2, this.elevation+height, (a[1]+b[1])/2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    for (let i=1;i<points.length;i++) {
      strip(points[i-1], points[i], 28, asphalt, .08);
      strip(points[i-1], points[i], .3, yellow, .1);
    }
    // Two yellow stop bars before the runway protected area.
    strip([-1363,70], [-1337,70], .5, yellow, .12);
    strip([-1363,72], [-1337,72], .5, yellow, .12);
  }

  buildTerminal() {
    const glass = new THREE.MeshStandardMaterial({ color: 0x73b9ce, metalness: 0.45, roughness: 0.25 });
    glass.transparent = true;
    glass.opacity = 0.65;
    const white = new THREE.MeshStandardMaterial({ color: 0xe5ebef });
    const floor = new THREE.MeshStandardMaterial({ color: 0x657380 });
    const box = (w, h, d, x, y, z, material, parent = this.group) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const roof = new THREE.MeshStandardMaterial({ color: 0x9bbfc5, metalness: .35, roughness: .5 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x566d79, metalness: .4, roughness: .5 });
    const darkGlass = new THREE.MeshStandardMaterial({ color: 0x294b5d, metalness: .5, roughness: .25 });
    this.terminal = new THREE.Group();
    this.terminal.name = 'incheon-terminal';
    this.group.add(this.terminal);
    const terminalBox = (w, h, d, x, y, z, material) => box(w, h, d, x, y, z, material, this.terminal);
    // Ground service level, boarding floor and recessed departure lounge.
    // Boarding slab top (15.15) continues through the fixed piers to the bridges.
    terminalBox(350, 3, 70, -80, 13.5, 340, floor);
    terminalBox(350, .3, 70, -80, 15, 340, white);
    terminalBox(348, 7, 68, -80, 18.65, 340, darkGlass);
    terminalBox(352, .5, 72, -80, 22.4, 340, white);
    for (let x = -250; x <= 90; x += 10) {
      for (const z of [305.7, 374.3]) {
        terminalBox(.3, 7.2, .45, x, 18.7, z, white);
        terminalBox(1, 3, 1, x, 13.5, z, white);
      }
      // Recessed service doors and clerestory glazing on the apron facade.
      terminalBox(5, 2.2, .15, x + 4, 13.2, 304.9, frame);
    }
    for (const z of [305.5, 374.5]) {
      terminalBox(350, .2, .4, -80, 18, z, frame);
      terminalBox(350, .2, .4, -80, 20.8, z, frame);
    }
    // Shallow barrel roof with visible standing seams, inspired by the reference.
    const roofHeight = z => 23 + 3.5 * (1 - ((z - 340) / 40) ** 2);
    const roofStrip = (x, width, za, zb, material, thickness = .35, lift = 0) => {
      const ya = roofHeight(za), yb = roofHeight(zb);
      const panel = terminalBox(width, thickness, Math.hypot(zb - za, yb - ya), x,
        (ya + yb) / 2 + lift, (za + zb) / 2, material);
      panel.rotation.x = -Math.atan2(yb - ya, zb - za);
    };
    for (let z = 300; z < 380; z += 5) {
      roofStrip(-80, 365, z, z + 5, roof);
      for (let x = -260; x <= 100; x += 20) roofStrip(x, .18, z, z + 5, white, .18, .23);
    }
    for (const x of [-220, -160, -100, -40, 20, 80]) {
      terminalBox(8, .6, 11, x, 26.8, 340, frame);
      terminalBox(7, .2, 10, x, 27.2, 340, glass);
      terminalBox(4, 1, 3, x, roofHeight(365) + .7, 365, white);
    }
    const sign = (label, width, height, x, y, z, parent = this.terminal) => {
      if (typeof document === 'undefined') return;
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#12364d'; ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 56px sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(label, 512, 84);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
      mesh.rotation.y = Math.PI;
      mesh.position.set(x, y, z);
      parent.add(mesh);
    };
    sign('INCHEON · 인천  |  DEPARTURES  출발', 48, 3, -80, 20, 305.1);
    this.gatePiers = [];
    // Aircraft at (-90, 240), heading west: port skin is at z=241.88.
    // The cabin stops at z=242.1, ahead of the wing at the forward door.
    this.jetBridges = [];
    for (const x of [-200, -102, 0]) {
      const pier = new THREE.Group();
      pier.name = `gate-pier-${this.gatePiers.length + 100}`;
      this.terminal.add(pier);
      this.gatePiers.push(pier);
      // Enclosed, level passage from the departure lounge to the bridge pivot.
      box(7, .3, 28, x, 15, 292, white, pier);
      box(8, .45, 29, x, 19.4, 292, roof, pier);
      for (const side of [-1, 1]) {
        box(.15, 4.1, 28, x + side * 3.5, 17.2, 292, glass, pier);
        for (let z = 280; z <= 304; z += 4) {
          box(.25, 4.2, .25, x + side * 3.5, 17.2, z, frame, pier);
        }
        for (const z of [281, 299]) box(.6, 3, .6, x + side * 2.8, 13.5, z, white, pier);
      }
      box(8, .3, 1, x, 15, 278, frame, pier);
      sign(`GATE ${this.gatePiers.length + 99}`, 6, .75, x, 18.5, 277.4, pier);
      const bridge = new THREE.Group();
      bridge.position.set(x, 0, 278);
      this.group.add(bridge);
      box(5, .3, 30, 0, 15, -15, white, bridge);
      box(5, .3, 30, 0, 19, -15, white, bridge);
      box(.15, 4, 30, -2.5, 17, -15, glass, bridge);
      box(.15, 4, 30, 2.5, 17, -15, glass, bridge);
      box(5, 4, 5.8, 0, 17, -33, floor, bridge);
      box(1, 4, 1, 0, 13.5, -27, white, bridge);
      this.jetBridges.push(bridge);
    }
    this.passengers = new THREE.Group();
    this.group.add(this.passengers);
    const clothing = new THREE.MeshStandardMaterial({ color: 0x294c81 });
    for (let i = 0; i < 12; i++) {
      const person = new THREE.Group();
      box(0.5, 1, 0.4, 0, 0.9, 0, clothing, person);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), white);
      head.position.y = 1.65;
      person.add(head);
      person.position.set(-102, 15.15, 274 - i * 2.5);
      this.passengers.add(person);
    }
    this.tug = new THREE.Group();
    this.group.add(this.tug);
    box(4, 1.4, 2.5, 0, 0.7, 0, white, this.tug);
    box(1.5, 1, 2, -0.6, 1.8, 0, glass, this.tug);
    this.tug.visible = false;
  }

  setBoardingProgress(progress) {
    this.passengers.children.forEach((p, i) => {
      p.position.z = 274 - ((i * 2.5 + progress * 30) % 30);
      p.visible = progress < 1;
    });
  }

  setBridgeRetraction(progress) {
    this.jetBridges[1].scale.z = 1 - 0.7 * THREE.MathUtils.clamp(progress, 0, 1);
  }
}
