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

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { renderSet, FILES, WALL_FILES } from './render.mjs';
import { structureSet, STRUCTURE_FILES } from './structure_tex.mjs';
import { encodePNG } from './png.mjs';
import { loadConfig, pruneMaterialOrphans, REPO } from './config.mjs';

// Baseline params — the HULL FOUNDRY HTML control defaults.
const DEFAULTS = {
  tilesX: 1, tilesY: 1, wedge: false, material: 'vanilla',
  baseBright: 29, grain: 9, grainScale: 9, weavePeriod: 13,
  ballSpacing: 15, ballFill: 0.94,
  rivetGap: 14, poreScale: 7, porosity: 0.5, fillDepth: 0.6,
  triSize: 0.74, triGroove: 1.0, hammerScale: 11, hammerDepth: 1.0,
  ingotTargetWidth: 32, ingotTargetHeight: 32, hexSize: 8, hexGroove: 0.8,
  aggregateScale: 11, aggregateDensity: 0.55, crackDepth: 0.65,
  bevelBright: 16, bevelWidth: 2, normalStrength: 1.0, normalFlipY: false,
  normalEdgeFade: 0, ballNormalHeight: 2.4, surfaceNormalScale: 1.0,
  dmg33: 1.0, dmg66: 1.9, cratersPerTile: 6, holeSize: 0.62, edgeMargin: 6,
  scorch: true, seed: 1234, tint: '#7d8a99', applyTint: false,
};

// Per-material overrides (mirrors defineMaterial defaults in hull_foundry.html).
const MATERIALS = {
  vanilla:             { baseBright: 29, grain: 9,  bevelBright: 16, normalStrength: 1.0 },
  nera:                { baseBright: 30, grain: 5,  bevelBright: 16, normalStrength: 0.85, weavePeriod: 15 },
  compc:               { baseBright: 29, grain: 9,  bevelBright: 16, normalStrength: 1.1,  ballSpacing: 15, ballFill: 0.94 },
  tristeel:            { baseBright: 38, grain: 7,  bevelBright: 22, normalStrength: 1.2,  triSize: 0.74, triGroove: 1.0 },
  metalfoam_irregular: { baseBright: 24, grain: 4,  bevelBright: 12, normalStrength: 1.4,  poreScale: 7, porosity: 0.5 },
  foam_tristeel:       { baseBright: 26, grain: 4,  bevelBright: 14, normalStrength: 1.35, poreScale: 7, porosity: 0.5, fillDepth: 0.6 },
  gold:                { baseBright: 66, grain: 6,  bevelBright: 28, normalStrength: 1.15, hammerScale: 11, hammerDepth: 1.0 },
  uranium:             { baseBright: 72,  grain: 6, bevelBright: 14, normalStrength: 1.3,  hexSize: 8, hexGroove: 0.8 },
  ceram_honeycomb:     { baseBright: 35, grain: 5,  bevelBright: 16, normalStrength: 1.3, cellScale: 14, wallThick: 1.8 },
  stf_hex_colloid:     { baseBright: 32, grain: 4,  bevelBright: 14, normalStrength: 1.3, chamberSize: 16, fluidGlow: 1.2, fluidVisc: 0.8 },
  concrete:            { baseBright: 92, grain: 11, bevelBright: 6,  normalStrength: 1.35, aggregateScale: 11, aggregateDensity: 0.55, crackDepth: 0.65 },
};

// Build a render-params object for a variant from armors.config.json.
function resolveParams(v) {
  const tex = v.material.texture;          // { material, seed }
  const mat = MATERIALS[tex.material] || {};
  return { ...DEFAULTS, ...mat, material: tex.material, seed: tex.seed, tilesX: v.W, tilesY: v.H, wedge: v.isWedge, dir: v.dir };
}

function main() {
  const cfg = loadConfig();
  const structureSeed = cfg.structure?.texture?.seed ?? 9090;
  const filter = process.argv.slice(2);
  const pick = list => filter.length ? list.filter(v => filter.includes(v.dir)) : list;
  const parts = pick(cfg.variants);
  const structParts = pick(cfg.structureVariants);

  if (!parts.length && !structParts.length) {
    console.error(filter.length ? `No matching parts for: ${filter.join(', ')}` : 'No parts in config.');
    process.exit(1);
  }

  let total = 0;
  const write = (dir, name, img) => { writeFileSync(join(dir, name), encodePNG(img)); total++; };
  for (const part of parts) {
    const dir = resolve(REPO, part.dir);
    mkdirSync(dir, { recursive: true });
    const P = resolveParams(part);
    const set = renderSet(P);
    for (const [name] of FILES) write(dir, name, set[name]);
    if (part.isWedge) {
      for (const name of WALL_FILES) write(dir, name, set[name]);
    }
    if (part.isHybrid) {
      // The hybrid's floor is the integrated structure lattice that shows
      // through damage holes (vanilla armor_structure_hybrid floor.png).
      const sset = structureSet(part.W, part.H, true, structureSeed);
      write(dir, 'floor.png', sset['structure.png']);
      write(dir, 'floor_33.png', sset['structure_33.png']);
      write(dir, 'floor_66.png', sset['structure_66.png']);
    }
    console.log(`  ✓ ${part.dir.padEnd(22)} ${P.tilesX}x${P.tilesY} ${P.material} (seed ${P.seed})`);
  }
  for (const sv of structParts) {
    const dir = resolve(REPO, sv.dir);
    mkdirSync(dir, { recursive: true });
    const set = structureSet(sv.W, sv.H, sv.isWedge, structureSeed);
    for (const name of STRUCTURE_FILES) write(dir, name, set[name]);
    console.log(`  ✓ ${sv.dir.padEnd(22)} ${sv.W}x${sv.H} structure (seed ${structureSeed})`);
  }
  // Drop any stray graphics left loose in a material root (the textures now live
  // in per-variant subfolders), so parent folders never hold orphaned PNGs.
  if (!filter.length) {
    for (const rel of pruneMaterialOrphans(cfg)) console.log(`  ✗ removed orphan ${rel}`);
  }

  console.log(`Done — wrote ${total} PNGs across ${parts.length} part(s).`);
}

main();
