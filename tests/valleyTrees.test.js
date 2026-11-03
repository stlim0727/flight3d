import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateValley } from '../src/arena/generatedValley.js';
import { planValleyTrees, valleySeedFromTerrain, VALLEY_TREE_RULES } from '../src/environment/valleyTrees.js';
import { GeneratedValleyTerrain } from '../src/environment/GeneratedValleyTerrain.js';

/** Foliage is visual-only, but it must still be honest: a tree may only stand
 * where the analytic surface the pilot sees and the probes test says a tree can
 * stand, and the same valley must always grow the same forest. */

const reasons = (terrain, tree) => ({
  groundY: terrain.getHeight(tree.x, tree.z),
  normalNy: terrain.getNormal(tree.x, tree.z).y,
  ...terrain.project(tree.x, tree.z),
});

test('the same valley grows the same forest', () => {
  const first = planValleyTrees(generateValley({ seed: 3 }).terrain);
  const second = planValleyTrees(generateValley({ seed: 3 }).terrain);
  assert.ok(first.length > 200, `only ${first.length} trees found a bench`);
  assert.deepEqual(second, first);
  const other = planValleyTrees(generateValley({ seed: 8 }).terrain);
  assert.ok(other.some((tree, i) => !first[i] || tree.x !== first[i].x || tree.z !== first[i].z));
  assert.notEqual(valleySeedFromTerrain(generateValley({ seed: 3 }).terrain),
    valleySeedFromTerrain(generateValley({ seed: 8 }).terrain));
});

test('every tree stands on ground a tree can stand on', () => {
  const rules = VALLEY_TREE_RULES;
  for (const seed of [1, 5, 101]) {
    const { terrain } = generateValley({ seed });
    const trees = planValleyTrees(terrain);
    const referenceFloorM = terrain.centerline[0].floor;
    for (const tree of trees) {
      const here = reasons(terrain, tree);
      assert.ok(Math.abs(tree.y + 0.3 - here.groundY) < 1e-6,
        `seed ${seed}: tree floats off the surface at ${tree.x.toFixed(0)},${tree.z.toFixed(0)}`);
      assert.ok(here.groundY - referenceFloorM <= rules.treelineRelYM,
        `seed ${seed}: tree above the treeline at ${here.groundY}`);
      assert.ok(here.normalNy >= rules.slopeMinNy, `seed ${seed}: tree on a scree slope`);
      const crossAbs = Math.abs(here.crossM);
      const flank = crossAbs >= rules.passageClearFraction * here.halfWidthM &&
        crossAbs <= rules.flankFraction * here.halfWidthM;
      const plateau = crossAbs >= rules.crestFraction * here.halfWidthM;
      assert.ok(flank || plateau,
        `seed ${seed}: tree inside the flown passage (cross ${crossAbs.toFixed(0)} of ${here.halfWidthM.toFixed(0)})`);
    }
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z);
        assert.ok(d >= rules.minSpacingM - 1e-6, `seed ${seed}: trees overlap at ${d.toFixed(1)}m`);
      }
    }
  }
});

test('the renderer plants and clears tree instances', () => {
  const { terrain } = generateValley({ seed: 2 });
  const mockScene = { add() {}, remove() {} };
  const gTerrain = new GeneratedValleyTerrain(terrain, { scene: mockScene });
  const planted = gTerrain.treeMeshes.reduce((n, mesh) => n + mesh.count, 0);
  assert.ok(planted > 200, `renderer mounted only ${planted} trees`);
  assert.equal(new Set(gTerrain.treeMeshes.map(mesh => mesh.name)).size, gTerrain.treeMeshes.length);
  for (const mesh of gTerrain.treeMeshes) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.frustumCulled, false, 'instanced trees must not be culled by the origin geometry');
    assert.ok(mesh.isInstancedMesh);
  }
  gTerrain.dispose({ scene: mockScene });
  assert.deepEqual(gTerrain.treeMeshes, [], 'tree instances survive dispose()');
});

test('a terrain without a centreline grows nothing', () => {
  assert.deepEqual(planValleyTrees(null), []);
  assert.deepEqual(planValleyTrees({ centerline: [] }), []);
});
