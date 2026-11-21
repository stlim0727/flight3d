import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Sections are local metres: centre XYZ, half-width, half-depth and optional
// axial skew. Carry the width axis around bends to avoid twisting the fingers.
function loft(sections, sides) {
  const centers = sections.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const positions = [];
  const indices = [];
  const widthAxis = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < sections.length; i++) {
    const tangent = centers[Math.min(i + 1, centers.length - 1)].clone()
      .sub(centers[Math.max(0, i - 1)]).normalize();
    const depthAxis = tangent.clone().cross(widthAxis).normalize();
    widthAxis.crossVectors(depthAxis, tangent).normalize();
    const [, , , width, depth, skew = 0] = sections[i];
    for (let j = 0; j < sides; j++) {
      const angle = 2 * Math.PI * j / sides;
      const cos = Math.cos(angle);
      const point = centers[i].clone()
        .addScaledVector(widthAxis, width * cos)
        .addScaledVector(depthAxis, depth * Math.sin(angle))
        .addScaledVector(tangent, skew * cos);
      positions.push(point.x, point.y, point.z);
      if (i + 1 < sections.length) {
        const a = i * sides + j;
        const b = i * sides + (j + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
  }
  const end = (sections.length - 1) * sides;
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j + 1, j, end, end + j, end + j + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipsoid(center, radii, tilt) {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  geometry.deleteAttribute('uv');
  geometry.scale(...radii);
  geometry.rotateZ(tilt);
  geometry.translate(...center);
  return geometry;
}

// Body coordinates, including the seated shoulder recline. Folds concentrate
// at the elbow and cuff while the upper arm keeps a continuous silhouette.
function sleeveGeometry() {
  return loft([
    [.202, .476, .220, .033, .038], [.207, .461, .214, .065, .069],
    [.214, .428, .200, .081, .083], [.219, .393, .170, .084, .078],
    [.224, .354, .127, .078, .068], [.231, .316, .080, .068, .061],
    [.236, .283, .040, .061, .061, .006], [.235, .274, .023, .066, .065, .009],
    [.235, .268, .011, .058, .053, .010], [.234, .259, -.003, .064, .059, .010],
    [.230, .255, -.019, .061, .053, .010], [.228, .254, -.039, .062, .052, .009],
    [.224, .253, -.071, .057, .052], [.218, .247, -.123, .050, .045],
    [.215, .243, -.156, .046, .041], [.214, .242, -.169, .047, .042, .006],
    [.214, .241, -.177, .041, .036, .005], [.214, .240, -.185, .043, .039, .003],
    [.214, .240, -.195, .040, .036], [.214, .240, -.198, .035, .032],
  ], 16);
}

function gloveLeatherGeometry() {
  const palm = loft([
    [.215, .240, -.187, .031, .028], [.218, .240, -.202, .032, .030],
    [.224, .239, -.224, .035, .033], [.230, .236, -.248, .035, .032],
    [.230, .233, -.265, .031, .027], [.226, .231, -.277, .020, .018],
    [.222, .231, -.282, .009, .010],
  ], 14);
  const wristBand = loft([
    [.217, .240, -.202, .032, .029], [.217, .240, -.203, .034, .031],
    [.219, .240, -.211, .035, .032], [.219, .240, -.213, .033, .030],
  ], 14);
  const parts = [palm, wristBand, ellipsoid([.202, .259, -.246], [.012, .014, .029], -.34)];
  for (let i = 0; i < 4; i++) {
    const y = .260 - i * .013;
    const z = -.272 + i * .003;
    parts.push(loft([
      [.246, y, z + .016, .008, .008], [.245, y, z, .009, .009],
      [.237, y, z - .011, .009, .009], [.223, y, z - .014, .008, .008],
      [.209, y - .002, z - .009, .007, .007], [.202, y - .003, z - .003, .004, .005],
    ], 8));
  }
  return mergeGeometries(parts);
}

export function addPilotArms(body, materials) {
  const sleeve = sleeveGeometry();
  // Thin epaulet resting on the sleeve crown, in the same body frame.
  const epaulet = loft([
    [.207, .485, .145, .019, .002], [.207, .491, .160, .022, .002],
    [.207, .493, .180, .022, .002], [.207, .488, .200, .022, .002],
    [.207, .480, .220, .022, .002], [.207, .468, .250, .019, .002],
  ], 10);
  const gloveBack = ellipsoid([.240, .247, -.233], [.021, .027, .043], -.33);
  const gloveLeather = gloveLeatherGeometry();
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? 'R' : 'L';
    const arm = new THREE.Group();
    arm.scale.x = side;
    body.add(arm);
    const cloth = new THREE.Mesh(sleeve, materials.suit);
    cloth.name = 'Pilot_Body_Sleeve_' + suffix;
    arm.add(cloth);
    const tab = new THREE.Mesh(epaulet, materials.harness);
    tab.name = 'Pilot_Body_Epaulet_' + suffix;
    arm.add(tab);

    // Roll the left hand over the broader throttle grip around its wrist.
    const hand = new THREE.Group();
    const wrist = new THREE.Vector3(.215, .240, -.191);
    hand.position.copy(wrist);
    if (side < 0) hand.rotation.z = 1.1;
    arm.add(hand);
    const back = new THREE.Mesh(gloveBack, materials.glovesNomex);
    back.name = 'Pilot_Body_Glove_' + suffix;
    const leather = new THREE.Mesh(gloveLeather, materials.glovesLeather);
    leather.name = 'Pilot_Body_Glove_Palm_' + suffix;
    back.position.copy(wrist).negate();
    leather.position.copy(back.position);
    hand.add(back, leather);
  }
}

// Torso-pivot coordinates. The strap follows the shoulder yoke, passes inside
// the vest pouches and disappears under the central buckle at the final section.
export function harnessGeometry(side) {
  // Keep the webbing just outside the yoke's 85 mm radius all the way
  // around the crown, including the chords between consecutive sections.
  const shoulder = [];
  for (let i = 0; i <= 7; i++) {
    const angle = Math.PI * (-.06 + .72 * i / 7);
    shoulder.push([.126, .44 + .090 * Math.sin(angle), -.05 + .090 * Math.cos(angle)]);
  }
  const profile = [
    ...shoulder,
    [.123, .509, -.127], [.118, .495, -.152], [.113, .483, -.160],
    [.108, .450, -.163], [.091, .422, -.169], [.071, .393, -.179],
    [.056, .362, -.178], [.048, .304, -.176], [.042, .245, -.175],
    [.029, .196, -.176], [.009, .152, -.180],
  ];
  return loft(profile.map(([x, y, z]) => [side * x, y, z, .023, .003]), 8);
}
