import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CockpitHudCanvas,
  configureF16HudMesh,
  createB737HudCombiner,
} from '../src/aircraft/CockpitHudCanvas.js';
import { F16 } from '../src/aircraft/F16.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';

const f16Bytes = readFileSync(new URL('../public/models/f-16.glb', import.meta.url));
const f16JsonLength = f16Bytes.readUInt32LE(12);
const f16Gltf = JSON.parse(f16Bytes.subarray(20, 20 + f16JsonLength).toString());

async function loadUntexturedF16Asset() {
  const asset = structuredClone(f16Gltf);
  asset.materials = asset.materials.map(({ name, alphaMode, doubleSided }) => ({ name, alphaMode, doubleSided }));
  delete asset.images;
  delete asset.textures;
  delete asset.samplers;
  const text = Buffer.from(JSON.stringify(asset));
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.from(f16Bytes.subarray(0, 20));
  const binary = f16Bytes.subarray(20 + f16JsonLength);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const buffer = Buffer.concat([header, padded, binary]);
  return new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
}

function createRecordingContext() {
  const calls = { texts: [], strokes: 0, fills: 0, arcs: 0 };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => gradient;
        }
        if (prop === 'fillText') {
          return (text, x, y) => {
            calls.texts.push({ text: String(text), x, y });
          };
        }
        if (prop === 'stroke') {
          return () => {
            calls.strokes += 1;
          };
        }
        if (prop === 'fill' || prop === 'fillRect') {
          return () => {
            calls.fills += 1;
          };
        }
        if (prop === 'arc') {
          return () => {
            calls.arcs += 1;
          };
        }
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

test('CockpitHudCanvas updates telemetry and renders HUD symbology across flight regimes', () => {
  const hud = new CockpitHudCanvas(512, 512, { variant: 'f16' });
  const { ctx, calls } = createRecordingContext();
  hud.ctx = ctx;

  hud.updateData({
    pitchDeg: 12.5,
    rollDeg: -22.0,
    iasKnots: 342.4,
    altitudeFt: 8450,
    headingDeg: -15,
    vsiFpm: 1850,
    gForce: 2.4,
    mach: 0.62,
    alphaDeg: 6.3,
    sideslipDeg: -1.5,
    heightAboveGroundFt: 1200,
    gearState: 0,
    apEngaged: true,
    isStalling: false,
  });
  hud.render();

  assert.equal(hud.headingDeg, 345);
  assert.equal(hud.gearDown, false);
  assert.ok(calls.strokes > 15, 'HUD must stroke horizon, pitch ladder, tapes, and FPV');
  assert.ok(calls.texts.some(t => t.text === '342'), 'Digital IAS readout must render');
  assert.ok(calls.texts.some(t => t.text === '8450'), 'Digital altitude readout must render');
  assert.ok(calls.texts.some(t => t.text === '345'), 'Digital heading readout must render');
  assert.ok(calls.texts.some(t => t.text === 'G 2.4'), 'G-load readout must render');
  assert.ok(calls.texts.some(t => t.text === 'M 0.62'), 'Mach readout must render');
  assert.ok(calls.texts.some(t => t.text === 'RA 1200'), 'Radio altitude readout must render below 2500 ft');
  assert.ok(!calls.texts.some(t => t.text === 'STALL'), 'Stall alert must stay hidden in normal flight');

  calls.texts.length = 0;
  hud.variant = 'b738';
  hud.updateData({
    pitchDeg: -5,
    rollDeg: 10,
    iasKnots: 138,
    altitudeFt: 420,
    headingDeg: 90,
    vsiFpm: -700,
    gearState: 1,
    flapsDeg: 30,
    isStalling: true,
  });
  hud.render();

  assert.ok(calls.texts.some(t => t.text === 'STALL'), 'Stall alert must render when stalling');
  assert.ok(calls.texts.some(t => t.text.includes('GEAR DN')), 'Gear down annunciation must render');
});

test('F16 binds live CockpitHudCanvas texture and normalizes UVs on F-16-hud_3', async t => {
  const loaded = await loadUntexturedF16Asset();
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => loaded);

  const aircraft = new F16();
  await aircraft.ready;

  assert.ok(aircraft.hudCanvas instanceof CockpitHudCanvas, 'F16 must own a CockpitHudCanvas');
  assert.ok(aircraft.hudMesh instanceof THREE.Mesh, 'F16 must bind its HUD combiner mesh');
  assert.equal(aircraft.hudMesh.name, 'F-16-hud_3');
  assert.equal(aircraft.hudMesh.material.map, aircraft.hudCanvas.texture);
  assert.equal(aircraft.hudMesh.material.transparent, true);
  assert.equal(aircraft.hudMesh.material.depthWrite, false);

  const uvs = aircraft.hudMesh.geometry.attributes.uv;
  const norms = aircraft.hudMesh.geometry.attributes.normal;
  let minPilotU = Infinity;
  let maxPilotU = -Infinity;
  let minPilotV = Infinity;
  let maxPilotV = -Infinity;
  for (let i = 0; i < uvs.count; i++) {
    if (norms.getZ(i) >= 0) {
      minPilotU = Math.min(minPilotU, uvs.getX(i));
      maxPilotU = Math.max(maxPilotU, uvs.getX(i));
      minPilotV = Math.min(minPilotV, uvs.getY(i));
      maxPilotV = Math.max(maxPilotV, uvs.getY(i));
    } else {
      assert.ok(Math.abs(uvs.getX(i) - 0.02) < 1e-5, 'Back-facing HUD vertices sample transparent corner');
    }
  }
  assert.ok(Math.abs(minPilotU - 0) < 1e-4 && Math.abs(maxPilotU - 1) < 1e-4, 'Pilot-facing U spans [0, 1]');
  assert.ok(Math.abs(minPilotV - 0) < 1e-4 && Math.abs(maxPilotV - 1) < 1e-4, 'Pilot-facing V spans [0, 1]');
});

test('Boeing737 mounts 3D overhead HGS combiner in cockpit.group without polluting light-transfer receivers', () => {
  if (typeof document === 'undefined') {
    const noop = () => ({ addColorStop: () => {} });
    const mockCtx = new Proxy({}, { get: () => noop });
    globalThis.document = {
      createElement: () => ({ getContext: () => mockCtx, width: 64, height: 64 }),
    };
  }
  const dummyCanvas = { texture: new THREE.Texture() };
  const b737 = new Boeing737(dummyCanvas, dummyCanvas, dummyCanvas, dummyCanvas, dummyCanvas, dummyCanvas);

  assert.ok(b737.hudCanvas instanceof CockpitHudCanvas, 'Boeing737 must own a CockpitHudCanvas');
  assert.ok(b737.hudCombiner instanceof THREE.Group, 'Boeing737 must own a 3D HGS combiner group');
  assert.ok(b737.cockpit.group.children.includes(b737.hudCombiner), 'HGS combiner must be attached to cockpit.group');
  assert.ok(
    !b737.cockpit.gltfCockpitGroup.children.includes(b737.hudCombiner),
    'HGS combiner must stay outside gltfCockpitGroup to preserve baked radiosity vertex bindings',
  );

  const glassMesh = b737.hudCombiner.userData.glassMesh;
  assert.ok(glassMesh instanceof THREE.Mesh, 'HGS combiner must include the optical combiner glass mesh');
  assert.equal(glassMesh.material.map, b737.hudCanvas.texture);
  assert.equal(glassMesh.material.transparent, true);
  assert.equal(glassMesh.material.depthWrite, false);

  b737.hudCombiner.traverse(node => {
    if (node.isMesh) {
      assert.equal(node.castShadow, false);
      assert.equal(node.receiveShadow, false);
      assert.equal(node.material.isMeshBasicMaterial, true);
    }
  });
});
