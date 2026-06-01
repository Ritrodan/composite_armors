// Shared loader for tools/armors.config.json. Resolves each variant into a
// fully-derived descriptor (dir, suffix, tile dims, material object) used by
// both the rules generator and the texture generator.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'armors.config.json');

// Folder/ID naming: 1x1 is the base part (bare id); others get a WxH suffix.
export function variantDir(materialId, W, H) {
  return (W === 1 && H === 1) ? materialId : `${materialId}_${W}x${H}`;
}
export function variantSuffix(W, H) {
  return (W === 1 && H === 1) ? '' : `${W}x${H}`;
}

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const variants = cfg.variants.map(v => {
    const mat = cfg.materials[v.material];
    if (!mat) throw new Error(`variant references unknown material "${v.material}"`);
    const [W, H] = v.size;
    const isBase = W === 1 && H === 1;
    return {
      material: mat,
      W, H, isBase,
      tiles: W * H,
      suffix: variantSuffix(W, H),
      dir: variantDir(mat.id, W, H),
    };
  });
  return { mod: cfg.mod, materials: cfg.materials, variants };
}
