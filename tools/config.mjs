// Shared loader for tools/armors.config.json. Resolves each variant into a
// fully-derived descriptor (dir, suffix, tile dims, material object) used by
// both the rules generator and the texture generator.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'armors.config.json');

// Folder/ID naming: variants are nested within material folders.
// A 1x1 block is "1x1"; other blocks get a WxH suffix. Wedges use "wedge" or "WxH_wedge".
export function variantDir(materialId, W, H, isWedge) {
  let suffix;
  if (isWedge) {
    suffix = (W === 1 && H === 1) ? 'wedge' : `${W}x${H}_wedge`;
  } else {
    suffix = (W === 1 && H === 1) ? '1x1' : `${W}x${H}`;
  }
  return `${materialId}/${suffix}`;
}
// Suffix used to build NameKeys (no spaces): "", "2x1", "Wedge", "1x2Wedge".
export function variantKeySuffix(W, H, isWedge) {
  if (isWedge) return (W === 1 && H === 1) ? 'Wedge' : `${W}x${H}Wedge`;
  return (W === 1 && H === 1) ? '' : `${W}x${H}`;
}
// Suffix used in the human label: "", "2x1", "Wedge", "1x2 Wedge".
export function variantLabelSuffix(W, H, isWedge) {
  if (isWedge) return (W === 1 && H === 1) ? 'Wedge' : `${W}x${H} Wedge`;
  return (W === 1 && H === 1) ? '' : `${W}x${H}`;
}

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const variants = cfg.variants.map(v => {
    const mat = cfg.materials[v.material];
    if (!mat) throw new Error(`variant references unknown material "${v.material}"`);
    const [W, H] = v.size;
    const isWedge = v.shape === 'wedge';
    if (isWedge && !mat.wedgeRecipe) {
      throw new Error(`material "${mat.id}" has a wedge variant but no wedgeRecipe`);
    }
    // Only a 1x1 *block* is a base catalog part; wedges always hang off it.
    const isBase = !isWedge && W === 1 && H === 1;
    const longDim = Math.max(W, H);
    // Effective material area in tiles: a block is W*H; a wedge is half its
    // bounding box (the triangle covers half the long axis).
    const areaTiles = isWedge ? longDim / 2 : W * H;
    return {
      material: mat,
      W, H, isWedge, isBase,
      longDim,
      tiles: W * H,
      areaTiles,
      keySuffix: variantKeySuffix(W, H, isWedge),
      labelSuffix: variantLabelSuffix(W, H, isWedge),
      dir: variantDir(mat.id, W, H, isWedge),
    };
  });
  return { mod: cfg.mod, materials: cfg.materials, variants };
}
