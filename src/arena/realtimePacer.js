/** Pace unchanged fixed steps against wall time; rendering never chooses dt.
 * At 60 Hz, approximately two 120 Hz steps run between rendered frames.
 */
export function createRealtimePacer({ now = () => performance.now(),
  nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)) } = {}) {
  let start = null;
  return async (tick, physicsHz) => {
    start ??= now();
    let target = start + tick / physicsHz * 1000;
    // Allow ordinary display-frame batching, but discard wall-time debt after
    // a Worker/render stall instead of replaying it as a burst of physics.
    const overdue = now() - target;
    if (overdue > 50) {
      start += overdue;
      target += overdue;
    }
    while (now() < target) await nextFrame();
  };
}
