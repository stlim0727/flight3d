// Original training scenery inspired by the Han River, NOT surveyed bridges.
// Metres, +Y up, travel generally -Z. Geometry and collision share these dimensions.
import pavilionHeights from './nodeulPavilionHeights.json' with { type: 'json' };

export const HANGANG_COURSE = {
  id: 'hangang-training-v1', waterLevel: 0,
  spawn: [0, 19, 850], speedMs: 46,
  bridges: [
    { id: 'west', x: 0, z: 0, yaw: 0, style: 'girder', color: 0x779993 },
    { id: 'central', x: 200, z: -1700, yaw: 0.10, style: 'arch', color: 0xc77153 },
    { id: 'east', x: -120, z: -3500, yaw: -0.08, style: 'tower', color: 0x7591b4 },
  ],
  // Island under the central bridge, world-aligned. The GLB builder draws it and
  // HangangCollision collides with it from these numbers. The pavilion model stands on the
  // island top at `scale`, long axis along the river; its collision heightfield is
  // island-relative and rebaked from that GLB by scripts/build-hangang-assets.mjs.
  nodeulseom: {
    x: 200, z: -1700, height: 4, bottomRadius: 75, topRadius: 70, zScale: 2.4,
    pavilion: { scale: 8.5, yaw: Math.PI / 2, heights: pavilionHeights },
  },
};

export function riverCenter(z) {
  const points = [[1200, 0], [0, 0], [-1700, 200], [-3500, -120], [-6500, -120]];
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

export const BRIDGE_PIER_X = [-550, -350, -150, -55, 55, 150, 350, 550];
export const BRIDGE_LAMP_X = Array.from({ length: 21 }, (_, i) => -550 + i * 55);

// Above-deck arch on 'arch' bridges: two tubes rising from the deck to 76 m (77.4 m
// with the tube radius) over bridge-local x = -150..150, one over each deck edge.
export const BRIDGE_ARCH = { halfSpan: 150, base: 41, rise: 35, radius: 1.4, z: [-9, 9], segments: 96 };

// Bridge-local [x, y] of the arch centreline, t = 0..1 from one foot to the other.
export function archCentre(t) {
  const { halfSpan, base, rise } = BRIDGE_ARCH;
  return [-halfSpan + 2 * halfSpan * t, base + rise * Math.sin(Math.PI * t)];
}

// Local bridge X spans the river, Z crosses the deck. Clear central opening 100 x 34 m,
// bounded by the gate pier caps' inner faces and the girder soffit.
export function bridgeSolids(bridge) {
  const boxes = [{ part: 'deck', center: [0, 38, 0], size: [1200, 4, 22] }];
  for (const x of BRIDGE_PIER_X) {
    // Column, and the cap the girders bear on.
    boxes.push({ part: 'pier', center: [x, 15.5, 0], size: [8, 31, 14] });
    boxes.push({ part: 'pier', center: [x, 32.5, 0], size: [10, 3, 21] });
  }
  for (const z of [-8, 0, 8]) boxes.push({ part: 'girder', center: [0, 35, z], size: [1200, 2, 1.5] });
  // Cross beams tie the girders, flush with the deck soffit.
  for (let x = -590; x <= 590; x += 20) boxes.push({ part: 'crossbeam', center: [x, 35.2, 0], size: [0.6, 1.6, 16] });
  // Rail boxes are the collision envelope of the open railing drawn inside them.
  for (const z of [-11, 11]) boxes.push({ part: 'rail', center: [0, 41, z], size: [1200, 2, 0.4] });
  // Deck streetlights: a pole and a lamp head, drawn and collided as these boxes.
  for (const x of BRIDGE_LAMP_X) {
    for (const z of [-9.5, 9.5]) {
      boxes.push({ part: 'lamp', material: 'concrete', center: [x, 41.8, z], size: [0.3, 3.5, 0.3] });
      boxes.push({ part: 'lamp', material: 'light', center: [x, 43.6, z], size: [0.6, 0.4, 0.6] });
    }
  }
  if (bridge.style === 'tower') {
    for (const x of [-150, 150]) boxes.push({ part: 'tower', center: [x, 62, 0], size: [10, 52, 7] });
  }
  // The arch tube is drawn through the same rings these boxes are built from: each box
  // bounds one tube segment, a straight chord between rings, padded by the tube radius.
  if (bridge.style === 'arch') {
    const { segments, radius, z: sides } = BRIDGE_ARCH;
    for (const z of sides) {
      for (let i = 0; i < segments; i++) {
        const [x0, y0] = archCentre(i / segments), [x1, y1] = archCentre((i + 1) / segments);
        boxes.push({ part: 'arch', render: false, center: [(x0 + x1) / 2, (y0 + y1) / 2, z],
          size: [Math.abs(x1 - x0) + 2 * radius, Math.abs(y1 - y0) + 2 * radius, 2 * radius] });
      }
    }
  }
  return boxes;
}
