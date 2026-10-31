/** Pace unchanged fixed steps against wall time; rendering never chooses dt.
 * At 60 Hz, approximately two 120 Hz steps run between rendered frames.
 */
export function createRealtimePacer({ now = () => performance.now(),
  nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)) } = {}) {
  let start = null;
  return async (tick, physicsHz) => {
    start ??= now();
    const target = start + tick / physicsHz * 1000;
    while (now() < target) await nextFrame();
  };
}
