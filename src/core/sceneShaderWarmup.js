import { Group } from 'three';

/** Three's compile() traverses hidden objects. Warm only this camera's visible scene. */
export function compileVisibleScene(renderer, scene, camera) {
  const visibleScene = new Group();
  // A traversal view preserves original objects/transforms without reparenting them.
  visibleScene.traverse = callback => scene.traverseVisible(object => {
    if (object.layers.test(camera.layers)) callback(object);
  });
  return renderer.compileAsync(visibleScene, camera, scene);
}
