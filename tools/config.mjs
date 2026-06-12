// Shared loader for tools/armors.config.json. Resolves each variant into a
// fully-derived descriptor (dir, suffix, tile dims, material object) used by
// both the rules generator and the texture generator.

import { readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'armors.config.json');

// Folder suffix for a variant. A 1x1 block is "1x1"; other blocks get a WxH
// suffix. Wedges use "wedge" / "WxH_wedge"; hybrids "hybrid_wedge" / "WxH_hybrid_wedge".
export function variantDirSuffix(W, H, shape = 'block') {
  const one = W === 1 && H === 1;
  if (shape === 'wedge') return one ? 'wedge' : `${W}x${H}_wedge`;
  if (shape === 'hybrid_wedge') return one ? 'hybrid_wedge' : `${W}x${H}_hybrid_wedge`;
  return one ? '1x1' : `${W}x${H}`;
}
// Folder/ID naming: variants are nested within material folders.
export function variantDir(materialId, W, H, shape = 'block') {
  return `${materialId}/${variantDirSuffix(W, H, shape)}`;
}
// Suffix used to build NameKeys (no spaces): "", "2x1", "Wedge", "1x2Wedge", "1x2HybridWedge".
export function variantKeySuffix(W, H, shape = 'block') {
  const one = W === 1 && H === 1;
  if (shape === 'wedge') return one ? 'Wedge' : `${W}x${H}Wedge`;
  if (shape === 'hybrid_wedge') return one ? 'HybridWedge' : `${W}x${H}HybridWedge`;
  return one ? '' : `${W}x${H}`;
}
// Suffix used in the human label: "", "2x1", "Wedge", "1x2 Wedge", "1x2 Hybrid Wedge".
export function variantLabelSuffix(W, H, shape = 'block') {
  const one = W === 1 && H === 1;
  if (shape === 'wedge') return one ? 'Wedge' : `${W}x${H} Wedge`;
  if (shape === 'hybrid_wedge') return one ? 'Hybrid Wedge' : `${W}x${H} Hybrid Wedge`;
  return one ? '' : `${W}x${H}`;
}

// The structure part an armor wedge sits on. Vanilla ships wedge structure up
// to 1x3; taller or multi-column wedges use our procedurally generated parts.
export function structureWedgeId(W, H) {
  if (W === 1 && H === 1) return 'cosmoteer.structure_wedge';
  if (W === 1 && H <= 3) return `cosmoteer.structure_1x${H}_wedge`;
  return `Ritrodan.structure_${variantDirSuffix(W, H, 'wedge')}`;
}

// Each armor lives in a material folder whose only contents are the per-variant
// subfolders (1x1, 2x1, wedge, ...). Earlier layouts kept the 1x1's .rules and
// PNGs loose in the material root; after the restructure those became orphans
// that the engine would still try to load. Remove any loose file sitting
// directly in a material root so the parent of every armor stays the 1x1.
// Returns the list of removed paths (repo-relative) for logging.
export function pruneMaterialOrphans(cfg) {
  const removed = [];
  for (const id of [...Object.keys(cfg.materials), 'structure']) {
    const matDir = join(REPO, id);
    if (!existsSync(matDir)) continue;
    for (const entry of readdirSync(matDir)) {
      const abs = join(matDir, entry);
      if (statSync(abs).isDirectory()) continue;
      rmSync(abs);
      removed.push(join(id, entry));
    }
  }
  return removed;
}

// Resolve a structure size into a descriptor (parallel to armor variants, but
// the "material" is the shared structure definition in cfg.structure).
function structureVariant(W, H, isWedge) {
  const shape = isWedge ? 'wedge' : 'block';
  const dirSuffix = variantDirSuffix(W, H, shape);
  const longDim = Math.max(W, H);
  return {
    W, H, isWedge,
    longDim,
    tiles: W * H,
    areaTiles: isWedge ? W * H / 2 : W * H,
    // A bare 1x1 block would produce empty suffixes that collide with vanilla's
    // "Parts/Structure" string keys, so it is always spelled out as 1x1.
    keySuffix: variantKeySuffix(W, H, shape) || '1x1',
    labelSuffix: variantLabelSuffix(W, H, shape) || '1x1',
    dir: `structure/${dirSuffix}`,
    partId: `structure_${dirSuffix}`,
  };
}

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const variants = cfg.variants.map(v => {
    const mat = cfg.materials[v.material];
    if (!mat) throw new Error(`variant references unknown material "${v.material}"`);
    const [W, H] = v.size;
    const shape = v.shape || 'block';
    if (!['block', 'wedge', 'hybrid_wedge'].includes(shape)) {
      throw new Error(`variant has unknown shape "${shape}"`);
    }
    const isWedge = shape !== 'block';
    const isHybrid = shape === 'hybrid_wedge';
    if (isWedge && !mat.wedgeRecipe) {
      throw new Error(`material "${mat.id}" has a wedge variant but no wedgeRecipe`);
    }
    if (isWedge && W > H) {
      throw new Error(`wedges are stored long-axis-vertical; use [${H}, ${W}] instead of [${W}, ${H}] for "${mat.id}"`);
    }
    // Only a 1x1 *block* is a base catalog part; wedges always hang off it.
    const isBase = !isWedge && W === 1 && H === 1;
    const longDim = Math.max(W, H);
    // Effective material area in tiles: a block is W*H; a wedge is half its
    // bounding box (the triangle covers half of it).
    const areaTiles = isWedge ? W * H / 2 : W * H;
    return {
      material: mat,
      W, H, isWedge, isHybrid, isBase,
      longDim,
      tiles: W * H,
      areaTiles,
      keySuffix: variantKeySuffix(W, H, shape),
      labelSuffix: variantLabelSuffix(W, H, shape),
      dir: variantDir(mat.id, W, H, shape),
      // Stable Part ID: the 1x1 is just the material id (so it's the editor
      // parent every variant points at via EditorParentParts); other variants
      // append their key suffix. Must NOT contain the folder slash from `dir`.
      partId: mat.id + (variantKeySuffix(W, H, shape) ? '_' + variantKeySuffix(W, H, shape) : ''),
    };
  });

  // Structure parts: every size listed explicitly under cfg.structure.variants,
  // plus any structure wedge an armor wedge needs as its underlying part but
  // vanilla doesn't ship (heights above 1x3).
  const wanted = new Map();
  const addStructure = (W, H, isWedge) => {
    const key = `${W}x${H}${isWedge ? 'w' : 'b'}`;
    if (!wanted.has(key)) wanted.set(key, structureVariant(W, H, isWedge));
  };
  if (cfg.structure) {
    for (const sv of cfg.structure.variants || []) {
      const [W, H] = sv.size;
      const isWedge = sv.shape === 'wedge';
      if (isWedge && W > H) throw new Error(`structure wedges are stored long-axis-vertical (got ${W}x${H})`);
      addStructure(W, H, isWedge);
    }
  }
  for (const v of variants) {
    if (v.isWedge && !v.isHybrid && !v.material.noUnderlyingStructure && !(v.W === 1 && v.H <= 3)) {
      if (!cfg.structure) throw new Error(`armor wedge ${v.W}x${v.H} needs a generated structure wedge but no "structure" section is configured`);
      addStructure(v.W, v.H, true);
    }
  }
  const structureVariants = [...wanted.values()];

  return { mod: cfg.mod, materials: cfg.materials, variants, structure: cfg.structure, structureVariants };
}
