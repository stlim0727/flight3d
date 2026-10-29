import { Vector3, MathUtils } from 'three';

/** Project a world-space direction, ignoring translation (the sky is at infinity).
 * Aircraft forward is -Z, heading increases toward +X, elevation toward +Y.
 * Return null behind the eye; callers must break paths there instead of wrapping.
 */
export function projectHudDirection(direction, camera, width, height) {
  const local = direction.clone().applyQuaternion(camera.quaternion.clone().invert());
  if (local.z >= -0.001) return null;
  const focal = height / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
  return { x: width / 2 + local.x / -local.z * focal,
    y: height / 2 - local.y / -local.z * focal };
}

export function hudDirection(headingDeg, elevationDeg) {
  const heading = MathUtils.degToRad(headingDeg), elevation = MathUtils.degToRad(elevationDeg);
  return new Vector3(Math.sin(heading) * Math.cos(elevation), Math.sin(elevation),
    -Math.cos(heading) * Math.cos(elevation));
}
