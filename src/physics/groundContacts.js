// Body coordinates: +X right, +Y up, -Z forward. The loaded profile is sampled
// from public/models/b737-800.glb after its +90 degree Y mounting rotation.
// Several patches per part cover pitch/roll instead of supporting a long body
// at one central point. Damage aggregates work and peak impact per part.
export const BODY_CONTACTS = Object.freeze([
  { id: 'engineL', position: [-5.06, -2.98, -5.4] },
  { id: 'engineR', position: [5.06, -2.98, -5.4] },
  { id: 'belly', position: [0, -2.3, 0] },
  { id: 'nose', position: [0, -2.27, -13] },
  { id: 'tail', position: [0, -0.76, 14.34] },
  { id: 'wingL', position: [-16.85, -0.06, 4.9] },
  { id: 'wingR', position: [16.85, -0.06, 4.9] },
]);
const patches = {
  engineL: [[-5.4, -2.94, -5.4], [-5.4, -2.94, -3.1], [-5.06, -2.99, -3.1], [-6.14, -2.26, -5.4], [-6.14, -2.26, -3.1]],
  engineR: [[5.4, -2.94, -5.4], [5.4, -2.94, -3.1], [5.06, -2.99, -3.1], [6.14, -2.26, -5.4], [6.14, -2.26, -3.1]],
  belly: [[0, -2.27, -10.94], [0, -2.3, -4.55], [0, -2.27, 7.12], [0, -1.94, 9.46]],
  nose: [[0, -2.1, -15.72], [0, -2.21, -14.5], [0, -1.81, -17], [0, -1.39, -18.28]],
  tail: [[0, -1.44, 11.95], [0, 0.48, 18.25]],
  wingL: [[-17.13, 0.05, 5], [-17.13, 0.07, 6.14], [-16.85, -0.01, 6.03], [-8.68, -0.84, 2.83]],
  wingR: [[17.13, 0.05, 5], [17.13, 0.07, 6.14], [16.85, -0.01, 6.03], [8.68, -0.84, 2.83]],
};
export const BODY_SUPPORT_POINTS = Object.freeze(BODY_CONTACTS.flatMap(p =>
  [p.position, ...patches[p.id]].map((position, index, points) =>
    ({ id: p.id, key: `${p.id}:${index}`, position, weight: 1 / points.length }))));

// The procedural fallback has a smaller fuselage and different wing sweep.
export const FALLBACK_BODY_SUPPORT_POINTS = Object.freeze([
  ['engineL', [-5.06, -2.95, -5.22]], ['engineR', [5.06, -2.95, -5.22]],
  ['belly', [0, -1.89, -11.9]], ['belly', [0, -1.89, 0]], ['belly', [0, -1.89, 11.9]],
  ['nose', [0, -1.81, -12]], ['nose', [0, -0.53, -17.4]],
  ['tail', [0, -0.7, 15.75]], ['tail', [0, 0.1, 19.5]],
  ['wingL', [-18.5, 0.5, 0]], ['wingL', [-18.5, 0.5, 2.3]],
  ['wingR', [18.5, 0.5, 0]], ['wingR', [18.5, 0.5, 2.3]],
].map(([id, position], index, points) =>
  ({ id, key: `${id}:${index}`, position, weight: 1 / points.filter(p => p[0] === id).length })));
