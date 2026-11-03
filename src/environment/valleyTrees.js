/** Deterministic foliage placement for the generated valley. Visual-only: nothing
 * in the physics reads this. Placement only asks the terrain where its own
 * analytic surface would tolerate a tree, so the forest always stands on the
 * rock the pilot actually sees and the collision probes actually test. */

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable integer identity for one generated valley, so the same course grows
 * the same forest without the renderer ever being told the seed. */
export function valleySeedFromTerrain(terrain) {
  const bounds = terrain?.bounds;
  const centerline = terrain?.centerline;
  if (!bounds || !Array.isArray(centerline) || centerline.length < 2) return 1;
  let h = 2166136261;
  const mix = value => {
    h = Math.imul(h ^ (Math.round(value * 8) | 0), 16777619);
  };
  mix(bounds.minX); mix(bounds.maxX); mix(bounds.minZ); mix(bounds.maxZ);
  mix(centerline[0].x); mix(centerline[0].z); mix(centerline[0].heading);
  mix(centerline.at(-1).s); mix(centerline.length);
  return (h >>> 0) || 1;
}

export const VALLEY_TREE_RULES = Object.freeze({
  count: 2200,
  attempts: 6600,
  minSpacingM: 19,
  slopeMinNy: 0.70,
  /** Vegetation lives in the green band of the tint; taper to stunted krummholz
   * and stop at the treeline the color already implies. */
  treelineRelYM: 360,
  kneeRelYM: 280,
  /** The flown corridor keeps its bottom clean: gates and the passage line must
   * stay readable, so no trees within this fraction of the local half width. */
  passageClearFraction: 0.78,
  flankFraction: 2.0,
  crestFraction: 2.3,
  species: ['pine', 'spruce'],
});

/** Rejection-sample the analytic surface: a candidate stands only where the
 * measured ground is flat enough, low enough, and outside the flown passage. */
export function planValleyTrees(terrain, options = {}) {
  const rules = { ...VALLEY_TREE_RULES, ...options };
  const centerline = terrain?.centerline;
  if (!Array.isArray(centerline) || centerline.length < 2 ||
      typeof terrain.project !== 'function' || typeof terrain.place !== 'function' ||
      typeof terrain.getHeight !== 'function' || typeof terrain.getNormal !== 'function') {
    return [];
  }
  const random = mulberry32(rules.seed ?? valleySeedFromTerrain(terrain));
  const floorReferenceM = rules.floorReferenceM ?? centerline[0].floor;
  const stepM = (centerline.at(-1).s - centerline[0].s) / (centerline.length - 1);
  const trees = [];
  const occupied = new Map();
  const cellM = rules.minSpacingM;
  const minSpacingSq = rules.minSpacingM * rules.minSpacingM;

  for (let attempt = 0; attempt < rules.attempts && trees.length < rules.count; attempt++) {
    const anchor = centerline[Math.floor(random() * centerline.length)];
    const s = anchor.s + (random() - 0.5) * 6 * stepM;
    if (s < centerline[0].s || s > centerline.at(-1).s) continue;
    const side = random() < 0.5 ? -1 : 1;
    // Bias the flank band (cliff benches and ledges) over the high plateau.
    const fraction = random() < 0.75
      ? rules.passageClearFraction + random() * (rules.flankFraction - rules.passageClearFraction)
      : rules.crestFraction + random() * 1.4;
    const at = terrain.place(s, side * fraction * anchor.halfWidth);
    const here = terrain.project(at.x, at.z);
    const crossAbs = Math.abs(here.crossM);
    const inFlank = crossAbs >= rules.passageClearFraction * here.halfWidthM &&
      crossAbs <= rules.flankFraction * here.halfWidthM;
    const onPlateau = crossAbs >= rules.crestFraction * here.halfWidthM;
    if (!inFlank && !onPlateau) continue;
    const y = terrain.getHeight(at.x, at.z);
    const relY = y - floorReferenceM;
    if (relY > rules.treelineRelYM) continue;
    if (terrain.getNormal(at.x, at.z).y < rules.slopeMinNy) continue;
    const cx = Math.floor(at.x / cellM), cz = Math.floor(at.z / cellM);
    let tooClose = false;
    for (let dx = -1; dx <= 1 && !tooClose; dx++) {
      for (let dz = -1; dz <= 1 && !tooClose; dz++) {
        for (const other of occupied.get(`${cx + dx}|${cz + dz}`) || []) {
          if ((other.x - at.x) ** 2 + (other.z - at.z) ** 2 < minSpacingSq) { tooClose = true; break; }
        }
      }
    }
    if (tooClose) continue;
    const taper = relY > rules.kneeRelYM
      ? 1 - 0.4 * (relY - rules.kneeRelYM) / (rules.treelineRelYM - rules.kneeRelYM) : 1;
    const tree = {
      x: at.x, y: y - 0.3, z: at.z,
      scale: (0.5 + random() * 0.6) * taper,
      rotY: random() * Math.PI * 2,
      species: rules.species[random() < 0.5 ? 0 : 1],
    };
    trees.push(tree);
    const key = `${cx}|${cz}`;
    const bucket = occupied.get(key);
    if (bucket) bucket.push(tree); else occupied.set(key, [tree]);
  }
  return trees;
}
