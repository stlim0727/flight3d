// Original training scenery inspired by the Han River, NOT surveyed bridges.
// Metres, +Y up, travel generally -Z. Geometry and gates share these dimensions.
export const HANGANG_COURSE = {
  id: 'hangang-training-v1', waterLevel: 0,
  spawn: [0, 19, 850], speedMs: 46,
  minHeight: 10, maxHeight: 28, maxVerticalSpeed: 3,
  minSpeedMs: 35, maxSpeedMs: 58, maxBankDeg: 12,
  excursionLimitSec: 8, recoverySec: 4, finishDistanceM: 220,
  bridges: [
    { id: 'west', x: 0, z: 0, yaw: 0, style: 'girder', color: 0x779993 },
    { id: 'central', x: 200, z: -1700, yaw: 0.10, style: 'arch', color: 0xc77153 },
    { id: 'east', x: -120, z: -3500, yaw: -0.08, style: 'tower', color: 0x7591b4 },
  ],
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

// Local bridge X spans the river, Z crosses the deck. Clear central gate 100 x 34 m.
export function bridgeSolids(bridge) {
  const boxes = [{ part: 'deck', center: [0, 38, 0], size: [1200, 4, 22] }];
  for (const x of [-550, -350, -150, -55, 55, 150, 350, 550]) {
    boxes.push({ part: 'pier', center: [x, 18, 0], size: [10, 36, 20] });
  }
  for (const z of [-8, 0, 8]) boxes.push({ part: 'girder', center: [0, 35, z], size: [1200, 2, 1.5] });
  for (const z of [-11, 11]) boxes.push({ part: 'rail', center: [0, 41, z], size: [1200, 2, 0.4] });
  if (bridge.style === 'tower') {
    for (const x of [-150, 150]) boxes.push({ part: 'tower', center: [x, 62, 0], size: [10, 52, 7] });
  }
  return boxes;
}
