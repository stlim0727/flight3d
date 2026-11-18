// Build high-detail GLTF/GLB missile models for Flight3d (AIM-9X Sidewinder & AIM-120C AMRAAM).
// Regenerate: node scripts/build-missile-assets.mjs
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';

// GLTFExporter uses the browser FileReader API for its binary buffer in Node.js.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const outputDir = new URL('../public/models/missiles/', import.meta.url);
await mkdir(outputDir, { recursive: true });

// Palette & PBR Materials
const MATERIALS = {
  'missile-body': new THREE.MeshStandardMaterial({
    name: 'missile-body',
    color: 0xd0d4d1,
    roughness: 0.44,
    metalness: 0.22,
  }),
  'missile-radome': new THREE.MeshStandardMaterial({
    name: 'missile-radome',
    color: 0xe2e5e1,
    roughness: 0.62,
    metalness: 0.08,
  }),
  'missile-fin': new THREE.MeshStandardMaterial({
    name: 'missile-fin',
    color: 0x969d9f,
    roughness: 0.48,
    metalness: 0.38,
  }),
  'missile-dark': new THREE.MeshStandardMaterial({
    name: 'missile-dark',
    color: 0x23272a,
    roughness: 0.32,
    metalness: 0.65,
  }),
  'missile-glass': new THREE.MeshStandardMaterial({
    name: 'missile-glass',
    color: 0x141b22,
    roughness: 0.12,
    metalness: 0.88,
  }),
  'missile-gold': new THREE.MeshStandardMaterial({
    name: 'missile-gold',
    color: 0xa87c32,
    roughness: 0.25,
    metalness: 0.82,
  }),
  'missile-band-yellow': new THREE.MeshStandardMaterial({
    name: 'missile-band-yellow',
    color: 0xd99b1c,
    roughness: 0.46,
    metalness: 0.08,
  }),
  'missile-band-brown': new THREE.MeshStandardMaterial({
    name: 'missile-band-brown',
    color: 0x7c3f1d,
    roughness: 0.52,
    metalness: 0.08,
  }),
  'missile-steel': new THREE.MeshStandardMaterial({
    name: 'missile-steel',
    color: 0x687178,
    roughness: 0.34,
    metalness: 0.76,
  }),
  'missile-nozzle': new THREE.MeshStandardMaterial({
    name: 'missile-nozzle',
    color: 0x303235,
    roughness: 0.55,
    metalness: 0.72,
  }),
  'missile-nozzle-interior': new THREE.MeshStandardMaterial({
    name: 'missile-nozzle-interior',
    color: 0x121314,
    roughness: 0.88,
    metalness: 0.15,
  }),
};

/**
 * Geometric builder collecting geometries per material key,
 * then merging into optimal multi-material primitives.
 */
class MissileModelBuilder {
  constructor(name) {
    this.name = name;
    this.bins = new Map();
  }

  addGeometry(matKey, geometry) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv) {
      // Default dummy UVs for glTF compatibility
      const count = geometry.attributes.position.count;
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    let list = this.bins.get(matKey);
    if (!list) {
      list = [];
      this.bins.set(matKey, list);
    }
    list.push(nonIndexed);
  }

  /**
   * Cylinder along Z axis.
   * In Three.js, CylinderGeometry is aligned with Y axis.
   * We rotate by +Math.PI / 2 so that:
   *   top (+Y) -> -Z (forward)
   *   bottom (-Y) -> +Z (aft)
   */
  addCylinder(matKey, { rTop, rBottom, height, zCenter, radialSegments = 24, openEnded = false }) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, height, radialSegments, 1, openEnded);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, zCenter);
    this.addGeometry(matKey, geo);
  }

  /**
   * Smooth aerodynamic tangent ogive for missile nose.
   * Lofts a curve from apex at zApex to base at zBase.
   */
  addOgive(matKey, { rBase, zApex, zBase, axialSegments = 16, radialSegments = 24 }) {
    const length = Math.abs(zBase - zApex);
    const points = [];
    for (let i = 0; i <= axialSegments; i++) {
      const u = i / axialSegments; // 0 at apex, 1 at base
      // Tangent ogive formula approximation:
      // r(u) = rBase * sqrt(u) * (1.1 - 0.1 * u)
      const r = rBase * Math.sin((u * Math.PI) / 2);
      const z = zApex + (zBase - zApex) * u;
      // LatheGeometry rotates 2D points (x, y) around Y axis.
      // We create profile with (radius, y = z) then rotate to align with -Z.
      points.push(new THREE.Vector2(Math.max(0.0005, r), -z));
    }
    // LatheGeometry expects profile points ordered with non-decreasing Y
    // (from bottom to top) to generate outward-facing normals.
    // -z decreases as u increases from 0 (apex) to 1 (base), so reverse the array.
    points.reverse();
    const geo = new THREE.LatheGeometry(points, radialSegments);
    geo.rotateX(-Math.PI / 2);
    this.addGeometry(matKey, geo);
  }

  /**
   * Hemispherical seeker dome pointing forward (-Z).
   */
  addDome(matKey, { radius, zCenter, widthSegments = 24, heightSegments = 12 }) {
    // SphereGeometry phi/theta: half sphere
    const geo = new THREE.SphereGeometry(radius, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2);
    // Apex is +Y, rotate to -Z
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, zCenter);
    this.addGeometry(matKey, geo);
  }

  /**
   * 4-fin cruciform ring with beveled leading/trailing edges and realistic sweep.
   */
  addFinRing(matKey, {
    zCenter,
    radius,
    rootChord,
    tipChord,
    span,
    sweepAngle = 0.45,
    thickness = 0.008,
    phase = 0,
    hasActuatorBlister = true,
  }) {
    // Build a single fin polygon profile in 3D:
    // Root chord extends from -rootChord/2 to +rootChord/2 along Z.
    // Tip is offset outwards by span in Y, and swept backward by deltaZ along +Z.
    const deltaZ = span * Math.tan(sweepAngle);
    const zRootLeading = -rootChord / 2;
    const zRootTrailing = rootChord / 2;
    const zTipLeading = zRootLeading + deltaZ;
    const zTipTrailing = zTipLeading + tipChord;

    // We create a prism mesh with beveled leading/trailing edges:
    // Vertices for upper (+X half) and lower (-X half) faceted wedge:
    const tHalf = thickness / 2;
    const tMid = tHalf;
    const tEdge = thickness * 0.15; // sharp edge bevel

    // Construct fin as an indexed BufferGeometry for clean smoothing
    for (let i = 0; i < 4; i++) {
      const angle = phase + (i * Math.PI) / 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Fin vertices in local (x', y', z') where y' is outward from fuselage:
      // We will rotate to (x, y) = (x'*cos - y'*sin, x'*sin + y'*cos)
      const finPoints = [];
      const yRoot = radius;
      const yTip = radius + span;

      // 8-vertex beveled fin shape:
      // 0: Root leading edge (sharp)
      // 1: Root mid-body top (+x)
      // 2: Root mid-body bot (-x)
      // 3: Root trailing edge (sharp)
      // 4: Tip leading edge (sharp)
      // 5: Tip mid-body top (+x)
      // 6: Tip mid-body bot (-x)
      // 7: Tip trailing edge (sharp)
      const baseVertices = [
        [0, yRoot, zRootLeading],
        [tMid, yRoot, zRootLeading + rootChord * 0.35],
        [-tMid, yRoot, zRootLeading + rootChord * 0.35],
        [tEdge, yRoot, zRootTrailing],
        [-tEdge, yRoot, zRootTrailing],
        [0, yTip, zTipLeading],
        [tMid * 0.7, yTip, zTipLeading + tipChord * 0.35],
        [-tMid * 0.7, yTip, zTipLeading + tipChord * 0.35],
        [tEdge * 0.7, yTip, zTipTrailing],
        [-tEdge * 0.7, yTip, zTipTrailing],
      ];

      // Transform to world coords:
      const positions = [];
      const addVertex = ([lx, ly, lz]) => {
        const wx = lx * Math.cos(angle + Math.PI / 2) - ly * Math.sin(angle + Math.PI / 2);
        const wy = lx * Math.sin(angle + Math.PI / 2) + ly * Math.cos(angle + Math.PI / 2);
        const wz = zCenter + lz;
        positions.push(wx, wy, wz);
      };

      // Triangles for fin faces:
      // We can use a BoxGeometry or lofted shape.
      // To ensure perfectly watertight valid buffer geometry across Three.js,
      // create a multi-box/wedge or lofted BufferGeometry.
      const finGeo = new THREE.BufferGeometry();

      // Create faceted fin faces (leading wedge, center body, trailing wedge)
      // Winding order is counter-clockwise when viewed from outside so all face normals point outward.
      const v = baseVertices;
      const tris = [
        // Leading face (+x side)
        v[0], v[5], v[1],
        v[1], v[5], v[6],
        // Leading face (-x side)
        v[0], v[2], v[5],
        v[2], v[7], v[5],
        // Center top face (+x side)
        v[1], v[6], v[3],
        v[3], v[6], v[8],
        // Center bot face (-x side)
        v[2], v[4], v[7],
        v[4], v[9], v[7],
        // Trailing edge faces (+z side)
        v[3], v[8], v[4],
        v[4], v[8], v[9],
        // Tip cap (+y side)
        v[5], v[7], v[6],
        v[6], v[7], v[8],
        v[7], v[9], v[8],
      ];

      for (const pt of tris) {
        addVertex(pt);
      }

      finGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      finGeo.computeVertexNormals();
      this.addGeometry(matKey, finGeo);

      // Actuator blister at root
      if (hasActuatorBlister) {
        const bGeo = new THREE.CylinderGeometry(thickness * 1.8, thickness * 1.8, rootChord * 0.45, 8);
        bGeo.rotateX(Math.PI / 2);
        bGeo.translate(0, radius + thickness * 0.4, zCenter + zRootLeading + rootChord * 0.4);
        bGeo.rotateZ(angle + Math.PI / 2);
        this.addGeometry('missile-steel', bGeo);
      }
    }
  }

  /**
   * Top longitudinal conduit / raceway strip.
   */
  addConduit(matKey, { radius, zStart, zEnd, width = 0.016, height = 0.01 }) {
    const length = Math.abs(zEnd - zStart);
    const zCenter = (zStart + zEnd) / 2;
    const geo = new THREE.BoxGeometry(width, height, length);
    geo.translate(0, radius + height / 2, zCenter);
    this.addGeometry(matKey, geo);
  }

  /**
   * Suspension rail lugs on upper spine (+Y).
   */
  addSuspensionLugs(matKey, { radius, zPositions, width = 0.02, height = 0.022, length = 0.045 }) {
    for (const z of zPositions) {
      const geo = new THREE.BoxGeometry(width, height, length);
      geo.translate(0, radius + height / 2, z);
      this.addGeometry(matKey, geo);

      // Small central pin
      const pin = new THREE.CylinderGeometry(0.005, 0.005, height * 1.2, 8);
      pin.translate(0, radius + height / 2, z);
      this.addGeometry('missile-dark', pin);
    }
  }

  /**
   * Flush proximity sensor windows (OTD or RF antenna strips) around circumference.
   */
  addWindows(matKey, { radius, zCenter, count = 4, phase = 0, width = 0.02, length = 0.04 }) {
    for (let i = 0; i < count; i++) {
      const angle = phase + (i * Math.PI * 2) / count;
      const geo = new THREE.BoxGeometry(width, 0.004, length);
      geo.translate(0, radius + 0.001, 0);
      geo.rotateZ(angle);
      geo.translate(0, 0, zCenter);
      this.addGeometry(matKey, geo);
    }
  }

  /**
   * Exhaust nozzle with realistic recessed cavity and exit rim.
   */
  addNozzle({ radius, length = 0.12, zExit, throatRatio = 0.65, lipThickness = 0.008 }) {
    const zFront = zExit - length;
    const rOuter = radius * 0.94;
    const rLip = radius * 0.88;
    const rThroat = radius * throatRatio;

    // Outer nozzle bell
    const outerGeo = new THREE.CylinderGeometry(rOuter, rLip, length, 24, 1, true);
    outerGeo.rotateX(Math.PI / 2);
    outerGeo.translate(0, 0, zFront + length / 2);
    this.addGeometry('missile-nozzle', outerGeo);

    // Nozzle exit ring rim
    const rimGeo = new THREE.RingGeometry(rLip - lipThickness, rLip, 24);
    rimGeo.translate(0, 0, zExit);
    this.addGeometry('missile-steel', rimGeo);

    // Recessed convergent interior cone
    const innerGeo = new THREE.CylinderGeometry(rThroat, rLip - lipThickness, length * 0.8, 24, 1, true);
    innerGeo.rotateX(Math.PI / 2);
    innerGeo.translate(0, 0, zExit - (length * 0.8) / 2);
    this.addGeometry('missile-nozzle-interior', innerGeo);

    // Back interior throat plate
    const plateGeo = new THREE.CircleGeometry(rThroat, 16);
    plateGeo.translate(0, 0, zExit - length * 0.8);
    this.addGeometry('missile-dark', plateGeo);
  }

  /**
   * Jet vanes for thrust vector control (TVC).
   */
  addTvcVanes({ radius, zExit, count = 4, phase = Math.PI / 4 }) {
    for (let i = 0; i < count; i++) {
      const angle = phase + (i * Math.PI) / 2;
      const vane = new THREE.BoxGeometry(0.004, 0.016, 0.025);
      vane.translate(0, radius * 0.68, zExit + 0.01);
      vane.rotateZ(angle);
      this.addGeometry('missile-dark', vane);
    }
  }

  /**
   * Assemble all bins into a Three.js Group ready for GLTF export.
   */
  buildGroup() {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [matKey, geometries] of this.bins.entries()) {
      if (geometries.length === 0) continue;
      const merged = mergeGeometries(geometries, false);
      const mat = MATERIALS[matKey] || MATERIALS['missile-body'];
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${this.name}_${matKey}`;
      mesh.castShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/**
 * Build High-Detail AIM-9X Sidewinder Model
 */
export function buildAim9xModel() {
  const spec = MISSILE_TYPES.AIM9X;
  const length = spec.lengthM; // 3.02m
  const radius = spec.diameterM / 2; // 0.0635m
  const zNose = -length / 2; // -1.51m
  const zTail = length / 2; // +1.51m

  const builder = new MissileModelBuilder('AIM9X');

  // 1. Seeker Dome (Sapphire optical hemisphere at apex)
  const domeRadius = radius * 0.96;
  builder.addDome('missile-glass', {
    radius: domeRadius,
    zCenter: zNose + domeRadius,
    widthSegments: 28,
    heightSegments: 14,
  });

  // 1b. Internal IR detector sensor gimbal inside the transparent dome
  const sensorGeo = new THREE.SphereGeometry(radius * 0.42, 16, 12);
  sensorGeo.translate(0, 0, zNose + domeRadius * 0.85);
  builder.addGeometry('missile-gold', sensorGeo);

  const gimbalRing = new THREE.TorusGeometry(radius * 0.58, 0.005, 8, 20);
  gimbalRing.translate(0, 0, zNose + domeRadius * 0.85);
  builder.addGeometry('missile-dark', gimbalRing);

  // 2. Seeker Retaining Collar / Gimbal Bezel
  builder.addCylinder('missile-dark', {
    rTop: domeRadius,
    rBottom: radius,
    height: 0.045,
    zCenter: zNose + domeRadius + 0.0225,
    radialSegments: 28,
  });

  // 3. Guidance Unit Body
  const zGuidanceStart = zNose + domeRadius + 0.045;
  const guidanceLength = 0.38;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius,
    height: guidanceLength,
    zCenter: zGuidanceStart + guidanceLength / 2,
    radialSegments: 28,
  });

  // Fine joint ring behind guidance
  builder.addCylinder('missile-steel', {
    rTop: radius * 1.008,
    rBottom: radius * 1.008,
    height: 0.012,
    zCenter: zGuidanceStart + guidanceLength,
    radialSegments: 28,
  });

  // 4. Optical Target Detector (OTD) proximity fuse windows
  builder.addWindows('missile-glass', {
    radius,
    zCenter: zGuidanceStart + 0.16,
    count: 4,
    phase: 0,
    width: 0.018,
    length: 0.04,
  });

  // 5. Forward Steering Canards / Strakes (4 cruciform at 45 deg)
  builder.addFinRing('missile-fin', {
    zCenter: zGuidanceStart + 0.28,
    radius,
    rootChord: 0.21,
    tipChord: 0.08,
    span: 0.115,
    sweepAngle: 0.55,
    thickness: 0.007,
    phase: Math.PI / 4,
    hasActuatorBlister: true,
  });

  // 6. Hazard Identification Warning Bands
  // Live HE warhead band (Yellow) and Solid rocket motor band (Brown)
  // Both sit on top of the continuous fuselage tube as collars (no fuselage gap).
  const zBands = zGuidanceStart + guidanceLength;
  builder.addCylinder('missile-band-yellow', {
    rTop: radius * 1.006,
    rBottom: radius * 1.006,
    height: 0.065,
    zCenter: zBands + 0.05,
    radialSegments: 28,
  });

  // Solid rocket motor band (Brown)
  builder.addCylinder('missile-band-brown', {
    rTop: radius * 1.006,
    rBottom: radius * 1.006,
    height: 0.055,
    zCenter: zBands + 0.13,
    radialSegments: 28,
  });

  // 7. Rocket Motor Main Body Tube (continuous from guidance section to aft control section)
  const zMotorStart = zBands;
  const zMotorEnd = zTail - 0.28;
  const motorLength = zMotorEnd - zMotorStart;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius,
    height: motorLength,
    zCenter: (zMotorStart + zMotorEnd) / 2,
    radialSegments: 28,
  });

  // Structural ring seams along motor
  for (const frac of [0.35, 0.7]) {
    builder.addCylinder('missile-steel', {
      rTop: radius * 1.005,
      rBottom: radius * 1.005,
      height: 0.008,
      zCenter: zMotorStart + motorLength * frac,
      radialSegments: 28,
    });
  }

  // 8. Longitudinal Electrical Raceway / Conduit on upper spine (+Y)
  builder.addConduit('missile-steel', {
    radius,
    zStart: zGuidanceStart + 0.2,
    zEnd: zTail - 0.24,
    width: 0.015,
    height: 0.009,
  });

  // 9. Launch Rail Suspension Lugs (+Y spine)
  builder.addSuspensionLugs('missile-steel', {
    radius,
    zPositions: [zGuidanceStart + guidanceLength + 0.45, zMotorEnd - 0.35],
    width: 0.018,
    height: 0.02,
    length: 0.042,
  });

  // 10. Aft Control Section & Tail Fins
  const zAftSection = zTail - 0.28;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius * 0.94,
    height: 0.18,
    zCenter: zAftSection + 0.09,
    radialSegments: 28,
  });

  // 4 Aft Wings with clipped sweep profile (at 45 deg)
  builder.addFinRing('missile-fin', {
    zCenter: zTail - 0.18,
    radius: radius * 0.97,
    rootChord: 0.26,
    tipChord: 0.14,
    span: 0.145,
    sweepAngle: 0.42,
    thickness: 0.008,
    phase: Math.PI / 4,
    hasActuatorBlister: true,
  });

  // 11. Rocket Motor Nozzle & TVC Vanes
  builder.addNozzle({
    radius: radius * 0.94,
    length: 0.10,
    zExit: zTail,
    throatRatio: 0.62,
    lipThickness: 0.006,
  });

  builder.addTvcVanes({
    radius: radius * 0.94,
    zExit: zTail,
    count: 4,
    phase: Math.PI / 4,
  });

  return builder.buildGroup();
}

/**
 * Build High-Detail AIM-120C AMRAAM Model
 */
export function buildAim120cModel() {
  const spec = MISSILE_TYPES.AIM120C;
  const length = spec.lengthM; // 3.66m
  const radius = spec.diameterM / 2; // 0.089m
  const zNose = -length / 2; // -1.83m
  const zTail = length / 2; // +1.83m

  const builder = new MissileModelBuilder('AIM120C');

  // 1. Metal Tip Pitot / Lightning Strike Point
  const tipLength = 0.035;
  builder.addCylinder('missile-steel', {
    rTop: 0.002,
    rBottom: 0.008,
    height: tipLength,
    zCenter: zNose + tipLength / 2,
    radialSegments: 16,
  });

  // 2. Aerodynamic Ceramic Tangent Ogive Radome
  const zRadomeBase = zNose + 0.68;
  builder.addOgive('missile-radome', {
    rBase: radius,
    zApex: zNose + tipLength,
    zBase: zRadomeBase,
    axialSegments: 20,
    radialSegments: 28,
  });

  // Radome joint clamp ring
  builder.addCylinder('missile-steel', {
    rTop: radius * 1.008,
    rBottom: radius * 1.008,
    height: 0.015,
    zCenter: zRadomeBase + 0.008,
    radialSegments: 28,
  });

  // 3. Guidance Electronics Section
  const guidanceLength = 0.48;
  const zGuidanceStart = zRadomeBase + 0.015;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius,
    height: guidanceLength,
    zCenter: zGuidanceStart + guidanceLength / 2,
    radialSegments: 28,
  });

  // Target Detection Device (TDD) RF active radar proximity fuze antennas (4 quadrant flush plates)
  builder.addWindows('missile-dark', {
    radius,
    zCenter: zGuidanceStart + 0.22,
    count: 4,
    phase: Math.PI / 4,
    width: 0.032,
    length: 0.065,
  });

  // 4. Warhead Hazard Identification Bands
  const zBands = zGuidanceStart + guidanceLength;
  // Live HE warhead band (Yellow)
  builder.addCylinder('missile-band-yellow', {
    rTop: radius * 1.006,
    rBottom: radius * 1.006,
    height: 0.08,
    zCenter: zBands + 0.05,
    radialSegments: 28,
  });

  // Rocket propellant band (Brown)
  builder.addCylinder('missile-band-brown', {
    rTop: radius * 1.006,
    rBottom: radius * 1.006,
    height: 0.07,
    zCenter: zBands + 0.15,
    radialSegments: 28,
  });

  // 5. Mid-Body Clipped Delta Wings (4 cruciform in + configuration: 0, 90, 180, 270 deg)
  builder.addFinRing('missile-fin', {
    zCenter: -0.05,
    radius,
    rootChord: 0.46,
    tipChord: 0.13,
    span: 0.20,
    sweepAngle: 0.52,
    thickness: 0.011,
    phase: 0,
    hasActuatorBlister: false,
  });

  // 6. Rocket Motor Fuselage Tube (continuous from guidance section to aft control section)
  const zMotorStart = zBands;
  const zMotorEnd = zTail - 0.42;
  const motorLength = zMotorEnd - zMotorStart;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius,
    height: motorLength,
    zCenter: (zMotorStart + zMotorEnd) / 2,
    radialSegments: 28,
  });

  // Panel joint seams
  for (const frac of [0.3, 0.65]) {
    builder.addCylinder('missile-steel', {
      rTop: radius * 1.005,
      rBottom: radius * 1.005,
      height: 0.01,
      zCenter: zMotorStart + motorLength * frac,
      radialSegments: 28,
    });
  }

  // 7. Longitudinal Wire Raceway / Conduit Channel (+Y spine)
  builder.addConduit('missile-steel', {
    radius,
    zStart: zGuidanceStart + 0.1,
    zEnd: zTail - 0.35,
    width: 0.02,
    height: 0.012,
  });

  // 8. Launch Rail Suspension Lugs (+Y spine)
  builder.addSuspensionLugs('missile-steel', {
    radius,
    zPositions: [-0.62, 0.72],
    width: 0.024,
    height: 0.024,
    length: 0.052,
  });

  // 9. Aft Steering Actuator Section & Clipped Control Fins
  const zAftSection = zTail - 0.42;
  builder.addCylinder('missile-body', {
    rTop: radius,
    rBottom: radius * 0.92,
    height: 0.28,
    zCenter: zAftSection + 0.14,
    radialSegments: 28,
  });

  // 4 Aft steerable control fins (+ configuration)
  builder.addFinRing('missile-fin', {
    zCenter: zTail - 0.22,
    radius: radius * 0.95,
    rootChord: 0.34,
    tipChord: 0.14,
    span: 0.22,
    sweepAngle: 0.48,
    thickness: 0.01,
    phase: 0,
    hasActuatorBlister: true,
  });

  // 10. Boat-Tail & Exhaust Nozzle
  builder.addNozzle({
    radius: radius * 0.92,
    length: 0.14,
    zExit: zTail,
    throatRatio: 0.64,
    lipThickness: 0.008,
  });

  return builder.buildGroup();
}

/**
 * Build High-Detail LAU-129 Wingtip Launcher Rail Model
 */
export function buildWingtipPylonModel() {
  const builder = new MissileModelBuilder('LAU129_Wingtip_Pylon');
  const railLength = 2.8;
  const railHeight = 0.08;
  const railWidth = 0.075;

  // Rail body
  const railGeo = new THREE.BoxGeometry(railWidth, railHeight, railLength);
  railGeo.translate(0, railHeight / 2, 0);
  builder.addGeometry('missile-fin', railGeo);

  // Aerodynamic nose wedge at front (-Z)
  const noseGeo = new THREE.ConeGeometry(railWidth * 0.7, 0.22, 4);
  noseGeo.rotateX(-Math.PI / 2);
  noseGeo.rotateZ(Math.PI / 4);
  noseGeo.translate(0, railHeight / 2, -railLength / 2 - 0.11);
  builder.addGeometry('missile-body', noseGeo);

  // Bottom empty missile launch guide slot (recessed dark channel)
  const slotGeo = new THREE.BoxGeometry(0.026, 0.016, railLength * 0.88);
  slotGeo.translate(0, 0.008, 0);
  builder.addGeometry('missile-dark', slotGeo);

  // Empty detent shoes (forward and aft)
  for (const z of [-0.65, 0.65]) {
    const shoeGeo = new THREE.BoxGeometry(railWidth * 0.92, 0.02, 0.065);
    shoeGeo.translate(0, 0.01, z);
    builder.addGeometry('missile-steel', shoeGeo);
  }

  // Aft cable bumper
  const aftGeo = new THREE.BoxGeometry(railWidth * 0.85, railHeight * 0.85, 0.14);
  aftGeo.translate(0, railHeight / 2, railLength / 2 + 0.07);
  builder.addGeometry('missile-steel', aftGeo);

  // Wingtip adapter mounting flange
  const adapterGeo = new THREE.BoxGeometry(0.035, railHeight * 1.1, railLength * 0.45);
  adapterGeo.translate(railWidth * 0.45, railHeight / 2, 0.1);
  builder.addGeometry('missile-body', adapterGeo);

  return builder.buildGroup();
}

/**
 * Build High-Detail F-16 Underwing Pylon & Launcher Rail Model
 */
export function buildUnderwingPylonModel() {
  const builder = new MissileModelBuilder('F16_Underwing_Pylon');
  const railLength = 3.0;
  const railHeight = 0.08;
  const railWidth = 0.08;

  // 1. Bottom LAU-129 launcher rail
  const railGeo = new THREE.BoxGeometry(railWidth, railHeight, railLength);
  railGeo.translate(0, railHeight / 2, 0);
  builder.addGeometry('missile-fin', railGeo);

  // Aerodynamic nose wedge (-Z)
  const noseGeo = new THREE.ConeGeometry(railWidth * 0.7, 0.22, 4);
  noseGeo.rotateX(-Math.PI / 2);
  noseGeo.rotateZ(Math.PI / 4);
  noseGeo.translate(0, railHeight / 2, -railLength / 2 - 0.11);
  builder.addGeometry('missile-body', noseGeo);

  // Empty launch guide track
  const slotGeo = new THREE.BoxGeometry(0.028, 0.016, railLength * 0.88);
  slotGeo.translate(0, 0.008, 0);
  builder.addGeometry('missile-dark', slotGeo);

  // Empty launch detents
  for (const z of [-0.7, 0.7]) {
    const shoeGeo = new THREE.BoxGeometry(railWidth * 0.95, 0.022, 0.075);
    shoeGeo.translate(0, 0.011, z);
    builder.addGeometry('missile-steel', shoeGeo);
  }

  // Sway brace pads flanking the rail
  for (const z of [-0.55, 0.55]) {
    for (const side of [-1, 1]) {
      const padGeo = new THREE.BoxGeometry(0.02, 0.045, 0.035);
      padGeo.translate(side * (railWidth / 2 + 0.01), railHeight / 2, z);
      builder.addGeometry('missile-steel', padGeo);
    }
  }

  // 2. Swept underwing pylon strut
  const strutHeight = 0.42;
  const strutChord = 1.25;
  const strutThickness = 0.085;
  const strutCenterY = railHeight + strutHeight / 2;

  const strutGeo = new THREE.BoxGeometry(strutThickness, strutHeight, strutChord);
  strutGeo.translate(0, strutCenterY, 0.05);
  builder.addGeometry('missile-body', strutGeo);

  // Wing mounting upper flange
  const flangeGeo = new THREE.BoxGeometry(strutThickness * 1.5, 0.02, strutChord * 1.2);
  flangeGeo.translate(0, railHeight + strutHeight + 0.01, 0);
  builder.addGeometry('missile-steel', flangeGeo);

  // Aft fairing
  const aftGeo = new THREE.BoxGeometry(railWidth * 0.85, railHeight * 0.85, 0.15);
  aftGeo.translate(0, railHeight / 2, railLength / 2 + 0.075);
  builder.addGeometry('missile-steel', aftGeo);

  return builder.buildGroup();
}

async function exportGlb(group, filename) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(group, { binary: true });
  const buffer = Buffer.from(arrayBuffer);
  const filePath = new URL(filename, outputDir);
  await writeFile(filePath, buffer);

  let triangles = 0;
  group.traverse(node => {
    if (node.isMesh && node.geometry) {
      const pos = node.geometry.attributes.position;
      triangles += node.geometry.index ? node.geometry.index.count / 3 : pos.count / 3;
    }
  });

  console.log(`Exported ${filename}: ${buffer.length.toLocaleString()} bytes, ${triangles} triangles, ${group.children.length} meshes`);
  return { filename, bytes: buffer.length, triangles };
}

// Build missile models
const aim9xGroup = buildAim9xModel();
const aim120cGroup = buildAim120cModel();
const wingtipPylonGroup = buildWingtipPylonModel();
const underwingPylonGroup = buildUnderwingPylonModel();

await exportGlb(aim9xGroup, 'aim-9x.glb');
await exportGlb(aim120cGroup, 'aim-120c.glb');
await exportGlb(wingtipPylonGroup, 'pylon-wingtip.glb');
await exportGlb(underwingPylonGroup, 'pylon-underwing.glb');

// Also export aim-9x as default missile.glb in public/models/
const defaultMissilePath = new URL('../public/models/missile.glb', import.meta.url);
const defaultBuffer = await new GLTFExporter().parseAsync(aim9xGroup, { binary: true });
await writeFile(defaultMissilePath, Buffer.from(defaultBuffer));
console.log(`Exported public/models/missile.glb: ${defaultBuffer.byteLength.toLocaleString()} bytes`);
