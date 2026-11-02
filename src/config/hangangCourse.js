// Training scenery modelled on three Han River bridges in their real west-to-east order
// (#396): Seogang, Mapo and Hangang Bridge. Spacing, deck widths and longest spans follow
// docs/development/hangang-bridge-survey.md; heights, the remaining pier layout and the
// crossing angles are game choices, so this is a motif, NOT a survey reproduction.
// Metres, +Y up, travel generally -Z. Geometry and collision share these dimensions.
import pavilionHeights from './nodeulPavilionHeights.json' with { type: 'json' };

// Bridge-local pier X: the main span is centred on the river axis, then `side` spans
// repeat outward while they fit inside the deck.
function piers(main, side, length) {
  const out = [main / 2];
  while (out.at(-1) + side < length / 2) out.push(out.at(-1) + side);
  return [...out.map(x => -x).reverse(), ...out];
}

// Six 63.5 m tied arches over the south channel, from Nodeulseom's edge to the bank.
const HANGANG_ARCHES = Array.from({ length: 6 }, (_, i) => ({ from: 95.25 + i * 63.5, to: 158.75 + i * 63.5, rise: 11, radius: 0.9, segments: 16 }));

export const HANGANG_COURSE = {
  id: 'hangang-training-v2', waterLevel: 0,
  spawn: [0, 19, 850], speedMs: 46,
  bridges: [
    // Seogang: 29 m deck, 150 m Nielsen arch whose ribs lean together at the crown.
    // The 90 m approach spans are not surveyed.
    { id: 'seogang', x: 0, z: 0, yaw: 0, color: 0xc77153, glow: 0xcc3300, length: 1200, mainSpan: 150,
      piers: piers(150, 90, 1200), decks: [{ z: 0, width: 29 }],
      arches: [{ from: -75, to: 75, rise: 26, radius: 1.4, segments: 48, crownInset: 11 }] },
    // Mapo: upstream and downstream 22.75 m decks, 70 m spans; 1.08 km east of Seogang.
    { id: 'mapo', x: 60, z: -1080, yaw: 0.10, color: 0x779993, glow: 0x223344, length: 1190, mainSpan: 70,
      piers: piers(70, 70, 1190), decks: [{ z: -13, width: 22.75 }, { z: 13, width: 22.75 }], arches: [] },
    // Hangang Bridge: twin 22 m decks over Nodeulseom, 63.5 m spans; 2.65 km east of Mapo.
    { id: 'hangang', x: 200, z: -3730, yaw: -0.08, color: 0x7591b4, glow: 0x0055bb, length: 1005, mainSpan: 63.5,
      piers: piers(63.5, 63.5, 1005), decks: [{ z: -12.5, width: 22 }, { z: 12.5, width: 22 }], arches: HANGANG_ARCHES },
  ],
  // Island under Hangang Bridge, world-aligned. The GLB builder draws it and
  // HangangCollision collides with it from these numbers. The pavilion model stands on the
  // island top at `scale`, long axis along the river; its collision heightfield is
  // island-relative and rebaked from that GLB by scripts/build-hangang-assets.mjs.
  nodeulseom: {
    x: 200, z: -3730, height: 4, bottomRadius: 75, topRadius: 70, zScale: 2.4,
    pavilion: { scale: 8.5, yaw: Math.PI / 2, heights: pavilionHeights },
  },
};

export function riverCenter(z) {
  const points = [[1200, 0], [0, 0], [-1080, 60], [-3730, 200], [-6500, 200]];
  for (let i = 1; i < points.length; i++) {
    if (z >= points[i][0]) {
      const t = Math.max(0, Math.min(1, (points[i - 1][0] - z) / (points[i - 1][0] - points[i][0])));
      return points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t * t * (3 - 2 * t);
    }
  }
  return points.at(-1)[1];
}

export function hangangHeight(x, z) {
  const d = Math.abs(x - riverCenter(z));
  return d < 450 ? 0 : Math.min(8, (d - 450) * 0.2);
}

// Deck streetlights every 55 m from the bridge centre, at least 50 m from either end.
export function bridgeLampX(bridge) {
  const n = Math.floor((bridge.length / 2 - 50) / 55);
  return Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * 55);
}

// Bridge-local [x, y, z] of an arch rib's centreline, t = 0..1 from one foot to the other.
// Ribs stand 2 m inside a deck edge (`edge` = ±1); leaning ribs close by `crownInset`.
export function archCentre(arch, deck, edge, t) {
  const s = Math.sin(Math.PI * t), rib = deck.width / 2 - 2 - (arch.crownInset ?? 0) * s;
  return [arch.from + (arch.to - arch.from) * t, 41 + arch.rise * s, deck.z + edge * rib];
}

// Clear passage under the main span: between its pier caps' inner faces, below the
// girder soffit and across every deck.
export function bridgeOpening(bridge) {
  return { halfWidth: bridge.mainSpan / 2 - 5, soffit: 34,
    halfDepth: Math.max(...bridge.decks.map(d => Math.abs(d.z) + d.width / 2)) + 1 };
}

// Local bridge X spans the river, Z crosses the decks.
export function bridgeSolids(bridge) {
  const boxes = [], length = bridge.length;
  for (const deck of bridge.decks) {
    const { z, width } = deck, half = width / 2;
    boxes.push({ part: 'deck', center: [0, 38, z], size: [length, 4, width] });
    for (const x of bridge.piers) {
      // Column, and the cap the girders bear on.
      boxes.push({ part: 'pier', center: [x, 15.5, z], size: [8, 31, width - 8] });
      boxes.push({ part: 'pier', center: [x, 32.5, z], size: [10, 3, width - 1] });
    }
    for (const dz of [-(half - 3), 0, half - 3]) boxes.push({ part: 'girder', center: [0, 35, z + dz], size: [length, 2, 1.5] });
    // Cross beams tie the girders, flush with the deck soffit.
    for (let x = -(length / 2 - 10); x <= length / 2 - 10; x += 20) boxes.push({ part: 'crossbeam', center: [x, 35.2, z], size: [0.6, 1.6, width - 6] });
    // Rail boxes are the collision envelope of the open railing drawn inside them.
    for (const edge of [-1, 1]) boxes.push({ part: 'rail', center: [0, 41, z + edge * half], size: [length, 2, 0.4] });
    // Deck streetlights: a pole and a lamp head, drawn and collided as these boxes.
    for (const x of bridgeLampX(bridge)) {
      for (const edge of [-1, 1]) {
        boxes.push({ part: 'lamp', material: 'concrete', center: [x, 41.8, z + edge * (half - 1.5)], size: [0.3, 3.5, 0.3] });
        boxes.push({ part: 'lamp', material: 'light', center: [x, 43.6, z + edge * (half - 1.5)], size: [0.6, 0.4, 0.6] });
      }
    }
    // Arch ribs are drawn through the same rings these boxes are built from: each box
    // bounds one tube segment, a straight chord between rings, padded by the tube radius.
    for (const arch of bridge.arches) {
      for (const edge of [-1, 1]) {
        for (let i = 0; i < arch.segments; i++) {
          const a = archCentre(arch, deck, edge, i / arch.segments), b = archCentre(arch, deck, edge, (i + 1) / arch.segments);
          boxes.push({ part: 'arch', render: false, center: a.map((v, k) => (v + b[k]) / 2),
            size: a.map((v, k) => Math.abs(b[k] - v) + 2 * arch.radius) });
        }
      }
    }
  }
  return boxes;
}
