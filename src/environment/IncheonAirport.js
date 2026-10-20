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
    // Visible arrivals level and elevated departures / boarding level.
    box(350, 5, 70, -80, 14.5, 340, floor);
    box(350, 9, 70, -80, 21.5, 340, glass);
    box(365, 2, 80, -80, 27, 340, white);
    box(350, 0.5, 72, -80, 17, 340, white);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#12364d'; ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('INCHEON · 인천  |  DEPARTURES  출발', 512, 82);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(90, 11.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
      sign.rotation.y = Math.PI;
      sign.position.set(-80, 23, 304.8);
      this.group.add(sign);
    }
    // Aircraft at (-90, 240), heading west: port skin is at z=241.88.
    // The cabin stops at z=242.1, ahead of the wing at the forward door.
    this.jetBridges = [];
    for (const x of [-200, -102, 0]) {
      box(7, 7, 26, x, 23, 292, glass);
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
