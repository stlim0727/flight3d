import { Ray, Triangle, Vector3 } from 'three';

// Coordinates in the footprint are local (east, south) metres. Use the actual
// short-edge midpoints: both roof halves stay inside even a slightly skewed quad.
export function buildGeographicGable(ring, ridge, heightM) {
  if (ring.length !== 4) return null;
  const edges = ring.map((p, i) => ring[(i + 1) % 4].clone().sub(p));
  const lengths = edges.map(edge => edge.length());
  const first = lengths[0] + lengths[2] >= lengths[1] + lengths[3] ? 0 : 1;
  const width = (lengths[(first + 1) % 4] + lengths[(first + 3) % 4]) / 2;
  if (Math.min(lengths[first], lengths[first + 2]) < 1.4 * width || width <= 0) return null;
  // All four turns must be convex and within 15 degrees of a right angle.
  const winding = Math.sign(edges[0].cross(edges[1]));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (winding * edges[i].cross(edges[j]) <= 0 ||
        Math.abs(edges[i].dot(edges[j])) > 0.259 * lengths[i] * lengths[j]) return null;
  }
  // The source height includes the roof. A 30-degree pitch is capped so
  // the upper third of a low building is the most the roof can occupy.
  const eave = ridge - Math.min(width * 0.5 / Math.sqrt(3), heightM / 3);
  const [a, b, c, d] = Array.from({ length: 4 }, (_, i) => {
    const p = ring[(first + i) % 4];
    return new Vector3(p.x, eave, p.y);
  });
  const tip = (p, q) => new Vector3((p.x + q.x) / 2, ridge, (p.z + q.z) / 2);
  const left = tip(d, a);
  const right = tip(b, c);
  // Positive footprint winding in XZ points downward in Three.js.
  const face = (p, q, r) => winding > 0 ? new Triangle(p, r, q) : new Triangle(p, q, r);
  return {
    eave,
    slopes: [face(a, b, right), face(a, right, left), face(left, right, c), face(left, c, d)],
    ends: [face(b, c, right), face(d, a, left)],
  };
}

const nearest = new Vector3();
const upward = new Ray(new Vector3(), new Vector3(0, 1, 0));

// The ordinary footprint prism covers the solid up to the eave. Above it,
// test the same six triangles used for rendering and the volume under them.
export function intersectsGable({ pos, radius }, gable) {
  upward.origin.copy(pos);
  for (const triangle of gable.slopes) {
    if (pos.y >= gable.eave && upward.intersectTriangle(triangle.a, triangle.b, triangle.c, false, nearest)) return true;
    if (triangle.closestPointToPoint(pos, nearest).distanceToSquared(pos) <= radius * radius) return true;
  }
  return gable.ends.some(triangle =>
    triangle.closestPointToPoint(pos, nearest).distanceToSquared(pos) <= radius * radius);
}
