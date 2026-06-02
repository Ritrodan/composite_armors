#!/usr/bin/env node
// Config-driven armor-texture generator for the Composite Armors mod.
//
//   node tools/generate.mjs            # regenerate every part in textures.config.json
//   node tools/generate.mjs nera_4x1   # regenerate only the named part(s)
//
// Design textures visually in tools/hull_foundry.html, then transcribe the
// material/size/seed into tools/textures.config.json. The renderer (render.mjs)
// is a pure port of that tool, so the output matches the preview — except crater
// counts now scale with block area (see render.mjs).

import { writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { renderSet, FILES } from './render.mjs';
import { encodePNG } from './png.mjs';
import { loadConfig, REPO } from './config.mjs';

// Baseline params — the HULL FOUNDRY HTML control defaults.
const DEFAULTS = {
  tilesX: 1, tilesY: 1, wedge: false, material: 'vanilla',
  baseBright: 29, grain: 9, grainScale: 9, weavePeriod: 13,
  ballSpacing: 15, ballFill: 0.94,
  bevelBright: 16, bevelWidth: 2, normalStrength: 1.0, normalFlipY: false,
  normalEdgeFade: 6, ballNormalHeight: 2.4,
  dmg33: 1.0, dmg66: 1.9, cratersPerTile: 6, holeSize: 0.62, edgeMargin: 6,
  scorch: true, seed: 1234, tint: '#7d8a99', applyTint: false,
};

// Per-material overrides (mirrors MATERIALS in the HTML tool).
const MATERIALS = {
  vanilla:  { baseBright: 29, grain: 9, bevelBright: 16, normalStrength: 1.0 },
  nera:     { baseBright: 30, grain: 5, bevelBright: 16, normalStrength: 0.85, weavePeriod: 15 },
  compc:    { baseBright: 29, grain: 9, bevelBright: 16, normalStrength: 1.1, ballSpacing: 15, ballFill: 0.94 },
  hardened: { baseBright: 36, grain: 6, bevelBright: 22, normalStrength: 1.3 },
  uranium:  { baseBright: 46, grain: 5, bevelBright: 26, normalStrength: 1.6 },
};

// Build a render-params object for a variant from armors.config.json.
function resolveParams(v) {
  const tex = v.material.texture;          // { material, seed }
  const mat = MATERIALS[tex.material] || {};
  return { ...DEFAULTS, ...mat, material: tex.material, seed: tex.seed, tilesX: v.W, tilesY: v.H, dir: v.dir };
}

function main() {
  const { variants } = loadConfig();
  const filter = process.argv.slice(2);
  const parts = filter.length ? variants.filter(v => filter.includes(v.dir)) : variants;

  if (!parts.length) {
    console.error(filter.length ? `No matching parts for: ${filter.join(', ')}` : 'No parts in config.');
    process.exit(1);
  }

  // Validate up front: a stale/misspelled `dir` must fail loudly rather than
  // silently skip, otherwise "Done" would hide a part whose PNGs never wrote.
  const missing = parts.filter(p => !existsSync(resolve(REPO, p.dir)));
  if (missing.length) {
    console.error(`Error: missing part folder(s): ${missing.map(p => p.dir).join(', ')}`);
    process.exit(1);
  }

  let total = 0;
  for (const part of parts) {
    const dir = resolve(REPO, part.dir);
    const P = resolveParams(part);
    const set = renderSet(P);
    for (const [name] of FILES) {
      writeFileSync(join(dir, name), encodePNG(set[name]));
      total++;
    }
    console.log(`  ✓ ${part.dir.padEnd(22)} ${P.tilesX}x${P.tilesY} ${P.material} (seed ${P.seed})`);
  }
  console.log(`Done — wrote ${total} PNGs across ${parts.length} part(s).`);
}

main();
