#!/usr/bin/env node
// Generates every part's .rules, strings/en.rules, and mod.rules from
// tools/armors.config.json. Define a material's 1x1 stats once; this scales
// the extensive ones (resources, HP, EMP absorption) by tile count and keeps
// the intensive ones (resistances, density, penetration) constant across sizes.
//
//   node tools/gen_rules.mjs        # regenerate everything
//   node tools/gen_rules.mjs --check  # fail if any file would change (CI-friendly)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, pruneMaterialOrphans, REPO } from './config.mjs';

// Print a JS number without trailing-zero noise: 5 -> "5", 1.2 -> "1.2".
const n = x => String(x);
// Round to one decimal (used for the proportional wedge penetration resistance).
const round1 = x => Math.round(x * 10) / 10;

// Vanilla wedges drop penetration resistance from 7 to 5 vs. the full block —
// a 5/7 proportion we apply to every modded wedge.
const WEDGE_PEN_FACTOR = 5 / 7;

// Damage levels: [[file, normalsFile?], ...] -> the indented rules fragment.
function damageLevels(files, sz) {
  return files.map(([f, nf]) =>
`\t\t\t\t\t{
\t\t\t\t\t\tFile = "${f}"${nf ? `\n\t\t\t\t\t\tNormalsFile = "${nf}"` : ''}
\t\t\t\t\t\tSize = ${sz}
\t\t\t\t\t}`).join('\n');
}
const PLATE = [['armor.png'], ['armor_33.png'], ['armor_66.png']];
const ROOF = [['roof.png', 'roof_normals.png'], ['roof_33.png', 'roof_normals_33.png'], ['roof_66.png', 'roof_normals_66.png']];

// Shared Graphics + DestroyedEffects + Blueprints body (identical for blocks and
// wedges — our procedural textures are full plates, so wedges reuse the same
// floors/walls/roofs layers; the triangle shape comes from the texture alpha and
// the PolygonCollider).
function graphicsBody(sz, cx, cy, floorComment, wallsLayer = 'walls') {
  return `\t\tGraphics
\t\t{
\t\t\tType = Graphics
\t\t\tLocation = [${cx}, ${cy}]
\t\t\tFloor${floorComment}
\t\t\t{
\t\t\t\tLayer = "floors"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(PLATE, sz)}
\t\t\t\t]
\t\t\t}
\t\t\tWalls
\t\t\t{
\t\t\t\tLayer = "${wallsLayer}"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(PLATE, sz)}
\t\t\t\t]
\t\t\t}
\t\t\tRoof
\t\t\t{
\t\t\t\tLayer = "roofs"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(ROOF, sz)}
\t\t\t\t]
\t\t\t}
\t\t}

\t\tDestroyedEffects
\t\t{
\t\t\tType = DeathEffects
\t\t\tMediaEffects = &/COMMON_EFFECTS/SmallPartDestroyedDry
\t\t\tLocation = [${cx}, ${cy}]
\t\t}

\t\tBlueprints
\t\t{
\t\t\tType = BlueprintSprite
\t\t\tFile = "blueprints.png"
\t\t\tSize = ${sz}
\t\t}`;
}

// EMP component + stat. `null` empAbsorb means no EMP sink at all (e.g. uranium):
// we omit both the EmpAbsorber component and the EMPResist stat.
function empParts(empAbsorb, empRecovery) {
  if (empAbsorb == null) return { block: '', stat: '' };
  const rec = empRecovery != null ? empRecovery : 0.1;
  return {
    block: `\t\tEmpAbsorber
\t\t{
\t\t\tType = ExplosiveResourceDrainSink
\t\t\tResourceType = battery
\t\t\tAbsorbsResourceDrain = ${empAbsorb}
\t\t\tRecoveryRate = (&AbsorbsResourceDrain) * ${n(rec)}
\t\t}

`,
    stat: `\t\tEMPResist = (&~/Part/Components/EmpAbsorber/AbsorbsResourceDrain) / 1000\n`,
  };
}

function blockRules(v) {
  const { material: mat, W, H, isBase, tiles, keySuffix: suffix, partId } = v;
  const pt = mat.perTile, iv = mat.intensive;

  const resources = pt.resources.map(([name, qty]) => `\t\t[${name}, ${qty * tiles}]`).join('\n');
  const cx = n(W / 2), cy = n(H / 2);
  const sz = `[${W}, ${H}]`;

  // Editor wiring differs: the 1x1 is the catalog entry; variants hang off it.
  const editorBlock = isBase
    ? `\tEditorGroups = ["Defenses", "Structure"]
\tDontStackInEditorGroups = ["Structure"]
\tDescriptionKey = "Parts/${mat.nameKey}Desc"`
    : `\tEditorGroup = "Structure"
\tEditorParentParts = [ "Ritrodan.${mat.id}" ]
\tEditorReplacementPartID = Ritrodan.${mat.id}
\tDescriptionKey = "Parts/${mat.nameKey}${suffix}Desc"`;

  const emp = empParts(pt.empAbsorb == null ? null : pt.empAbsorb * tiles, iv.empRecovery);

  const isRotatable = W !== H;
  const rotateBlock = isRotatable
    ? `\tFlipHRotate = [0, 1, 2, 3]
\tFlipVRotate = [0, 1, 2, 3]`
    : `\tIsRotateable = false`;

  const flammableLine = isBase ? '' : '\tFlammable = false\n';
  const isRotateableLine = isRotatable ? '\tIsRotateable = true\n' : '';
  const floorComment = isBase ? ' // This is needed so that armor shows up in ship ghosts.' : '';

  return `Part : <./Data/ships/terran/base_part_terran.rules>/Part
{
\tNameKey = "Parts/${mat.nameKey}${suffix}"
\tIconNameKey = "Parts/${mat.nameKey}${suffix}Icon"
\tID = Ritrodan.${partId}
${editorBlock}
\tResources
\t[
${resources}
\t]
\tAIValueFactor = 0
\tSize = ${sz}
${rotateBlock}
\tSelectionTypeID = "armor"
\tMaxHealth = ${pt.maxHealth * tiles}
\tExplosiveDamageAbsorption = ${iv.explosiveAbsorption}%
\tDamageResistances
\t{
\t\texplosive = ${iv.explosiveResist}%
\t\tthermal = ${iv.thermalResist}%
\t}
\tTypeCategories = [armor, non_flammable]
${flammableLine}\tInitialPenetrationResistance = ${iv.penResist}
\tContinuingPenetrationResistance = &InitialPenetrationResistance
\tCreatePartPerTileWhenGrabbed = ""
${mat.noUnderlyingStructure ? '\tUnderlyingPart = ""\n\tUnderlyingPartPerTile = ""\n' : ''}	\tCrewSpeedFactor = 0
\tDensity = ${n(iv.density)}
${isRotateableLine}\tIsWalled = true
\tIsSelfDestructible = false
\tAllowedDoorLocations = []
\tGeneratorRequiresDoor = false
\tIgnoreRotationForMirroredSelection = true
\tReceivableBuffs : ^/0/ReceivableBuffs []
\tEditorIcon
\t{
\t\tTexture
\t\t{
\t\t\tFile = "icon.png"
\t\t\tSampleMode = Linear
\t\t}
\t\tSize = [${32 * W}, ${32 * H}]
\t}
\tComponents : ^/0/Components
\t{
${emp.block}${graphicsBody(sz, cx, cy, floorComment)}
\t}

\tStats
\t{
${emp.stat}\t\tAOEResist = (&~/Part/DamageResistances/explosive) * 100
\t}
}
`;
}

// Per-size wedge geometry. Every modded wedge is 1xN (W=1), matching the vanilla
// armor wedges: a right triangle with vertices [1,0], [1,N], [0,N] (the right and
// bottom edges are external; the hypotenuse runs top-right to bottom-left).
function wedgeGeometry(H) {
  if (H === 1) {
    return {
      underlying: 'cosmoteer.structure_wedge',
      flipBlock: '',
      walls: `\tExternalWalls = [TopRight, Right, BottomRight, Bottom, BottomLeft]
\tInternalWalls = [Left, TopLeft, Top]`,
      virtual: `\t\t{ExternalCell=[0, -1]; InternalCell=[1, 0]}
\t\t{ExternalCell=[-1, 0]; InternalCell=[0, 1]}`,
      flipH: '[1, 0, 3, 2]',
      flipV: '[3, 2, 1, 0]',
    };
  }
  if (H === 2) {
    return {
      underlying: 'cosmoteer.structure_1x2_wedge',
      flipBlock: 'FLIP',
      walls: `\tExternalWallsByCell
\t[
\t\t{
\t\t\tKey = [0, 0]
\t\t\tValue = [TopRight, Right]
\t\t}
\t\t{
\t\t\tKey = [0, 1]
\t\t\tValue = [Right, BottomRight, Bottom, BottomLeft]
\t\t}
\t]
\tInternalWallsByCell
\t[
\t\t{
\t\t\tKey = [0, 0]
\t\t\tValue = [BottomLeft, Left, TopLeft, Top]
\t\t}
\t\t{
\t\t\tKey = [0, 1]
\t\t\tValue = [Left, TopLeft]
\t\t}
\t]`,
      virtual: `\t\t{ExternalCell=[0, -1]; InternalCell=[1, 0]}
\t\t{ExternalCell=[-1, 1]; InternalCell=[0, 2]}`,
      flipH: '[0, 3, 2, 1]',
      flipV: '[2, 1, 0, 3]',
    };
  }
  if (H === 3) {
    return {
      underlying: 'cosmoteer.structure_1x3_wedge',
      flipBlock: 'FLIP',
      walls: `\tExternalWallsByCell
\t[
\t\t{
\t\t\tKey = [0, 0]
\t\t\tValue = [TopRight, Right]
\t\t}
\t\t{
\t\t\tKey = [0, 1]
\t\t\tValue = [Right]
\t\t}
\t\t{
\t\t\tKey = [0, 2]
\t\t\tValue = [Right, BottomRight, Bottom, BottomLeft]
\t\t}
\t]
\tInternalWallsByCell
\t[
\t\t{
\t\t\tKey = [0, 0]
\t\t\tValue = [BottomLeft, Left, TopLeft, Top]
\t\t}
\t\t{
\t\t\tKey = [0, 1]
\t\t\tValue = [TopLeft, Left, BottomLeft]
\t\t}
\t\t{
\t\t\tKey = [0, 2]
\t\t\tValue = [Left, TopLeft]
\t\t}
\t]`,
      virtual: `\t\t{ExternalCell=[0, -1]; InternalCell=[1, 0]}
\t\t{ExternalCell=[-1, 2]; InternalCell=[0, 3]}`,
      flipH: '[0, 3, 2, 1]',
      flipV: '[2, 1, 0, 3]',
    };
  }
  throw new Error(`unsupported wedge height ${H} (only 1x1, 1x2, 1x3 wedges are defined)`);
}

// Resource list for a wedge. A 1x2 wedge covers exactly one tile, so it uses the
// full per-tile block recipe; the 1x1 and 1x3 wedges use the half-block
// `wedgeRecipe`, scaled by the long axis (x1 and x3 respectively).
function wedgeResources(mat, H) {
  const src = (H === 2) ? mat.perTile.resources : mat.wedgeRecipe;
  const mult = (H === 2) ? 1 : H;
  return src.map(([name, qty]) => `\t\t[${name}, ${qty * mult}]`).join('\n');
}

function wedgeRules(v) {
  const { material: mat, W, H, keySuffix: suffix, partId, areaTiles } = v;
  const pt = mat.perTile, iv = mat.intensive;
  const g = wedgeGeometry(H);

  const cx = n(W / 2), cy = n(H / 2);
  const sz = `[${W}, ${H}]`;
  const resources = wedgeResources(mat, H);
  const maxHealth = Math.round(pt.maxHealth * areaTiles);
  const penResist = round1(iv.penResist * WEDGE_PEN_FACTOR);
  const emp = empParts(pt.empAbsorb == null ? null : Math.round(pt.empAbsorb * areaTiles), iv.empRecovery);

  // 1x2/1x3 wedges have mirror (L/R) handedness; the 1x1 wedge is its own mirror.
  const flipBlock = g.flipBlock === 'FLIP'
    ? `\tIsFlippable = true
\tOtherIDs = [Ritrodan.${partId}_L, Ritrodan.${partId}_R]
\tFlipWhenLoadingIDs = [Ritrodan.${partId}_R]
`
    : '';

  return `Part : <./Data/ships/terran/base_part_terran.rules>/Part
{
\tNameKey = "Parts/${mat.nameKey}${suffix}"
\tIconNameKey = "Parts/${mat.nameKey}${suffix}Icon"
\tID = Ritrodan.${partId}
\tEditorGroup = "Structure"
\tEditorParentParts = [ "Ritrodan.${mat.id}" ]
\tEditorReplacementPartID = ""
\tDescriptionKey = "Parts/${mat.nameKey}${suffix}Desc"
${flipBlock}\tResources
\t[
${resources}
\t]
\tAIValueFactor = 0
\tSize = ${sz}
\tAllowedContiguity = [Right, Bottom]
\tSelectionTypeID = "armor"
\tMaxHealth = ${maxHealth}
\tExplosiveDamageAbsorption = ${iv.explosiveAbsorption}%
\tDamageResistances
\t{
\t\texplosive = ${iv.explosiveResist}%
\t\tthermal = ${iv.thermalResist}%
\t}
\tTypeCategories = [armor, non_flammable]
\tFlammable = false
\tReceivableBuffs : ^/0/ReceivableBuffs []
\tUnderlyingPartPerTile = ""
\tUnderlyingPart = ${mat.noUnderlyingStructure ? '""' : g.underlying}
\tCreatePartPerTileWhenGrabbed = ""
\tInitialPenetrationResistance = ${n(penResist)}
\tContinuingPenetrationResistance = &InitialPenetrationResistance
\tCrewSpeedFactor = 0
\tDensity = ${n(iv.density)}
\tIsRotateable = true
\tIsWalled = true
\tIsSelfDestructible = false
${g.walls}
\tVirtualInternalCells
\t[
${g.virtual}
\t]
\tAllowedDoorLocations = []
\tGeneratorRequiresDoor = false
\tFlipHRotate = ${g.flipH}
\tFlipVRotate = ${g.flipV}
\tGenerateRectCollider = false
\tEditorIcon
\t{
\t\tTexture
\t\t{
\t\t\tFile = "icon.png"
\t\t\tSampleMode = Linear
\t\t}
\t\tSize = [${32 * W}, ${32 * H}]
\t}
\tComponents : ^/0/Components
\t{
\t\tCollider
\t\t{
\t\t\tType = PolygonCollider
\t\t\tVertices
\t\t\t[
\t\t\t\t[1, 0]
\t\t\t\t[1, ${H}]
\t\t\t\t[0, ${H}]
\t\t\t]
\t\t}

${emp.block}${graphicsBody(sz, cx, cy, '', 'external_walls')}
\t}

\tStats
\t{
${emp.stat}\t\tAOEResist = (&~/Part/DamageResistances/explosive) * 100
\t}
}
`;
}

function partRules(v) {
  return v.isWedge ? wedgeRules(v) : blockRules(v);
}

function stringsFile(cfg) {
  const blocks = [];
  for (const id of Object.keys(cfg.materials)) {
    const mat = cfg.materials[id];
    const sizes = cfg.variants.filter(v => v.material.id === id);
    const lines = [];
    for (const v of sizes) {
      if (v.isBase) {
        lines.push(`\t${mat.nameKey} = "${mat.displayName}"`);
        lines.push(`\t${mat.nameKey}Icon = "${mat.displayName}"`);
        lines.push(`\t${mat.nameKey}Desc = "${mat.description}"`);
      } else {
        const label = `${mat.displayName} ${v.labelSuffix}`;
        lines.push('');
        lines.push(`\t${mat.nameKey}${v.keySuffix} = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.keySuffix}Icon = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.keySuffix}Desc = "${mat.description}"`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return `Parts\n{\n${blocks.join('\n\n')}\n}\n`;
}

function modFile(cfg) {
  const m = cfg.mod;
  const adds = cfg.variants.map(v => {
    const baseName = v.material.id;
    const variantSuffix = v.keySuffix ? '_' + v.keySuffix : '';
    const filename = `${baseName}${variantSuffix}.rules`;
    return `\t\t\t&<${v.dir}/${filename}>/Part`;
  }).join('\n');
  const games = m.compatibleGameVersions.map(g => `"${g}"`).join(', ');
  return `ID = ${m.id}
Name = "${m.name}"
Version = ${m.version}
CompatibleGameVersions = [${games}]
Author = "${m.author}"
Description = "${m.description}"
ModifiesMultiplayer = ${m.modifiesMultiplayer}
ModifiesGameplay = ${m.modifiesGameplay}
StringsFolder = "${m.stringsFolder}"

Actions
[
\t{
\t\tAction = AddMany
\t\tAddTo = "<ships/terran/terran.rules>/Terran/Parts"
\t\tManyToAdd
\t\t[
${adds}
\t\t]
\t}
]
`;
}

function main() {
  const cfg = loadConfig();
  const check = process.argv.includes('--check');
  const outputs = [];

  for (const v of cfg.variants) {
    const baseName = v.material.id;
    const variantSuffix = v.keySuffix ? '_' + v.keySuffix : '';
    const filename = `${baseName}${variantSuffix}.rules`;
    outputs.push([join(v.dir, filename), partRules(v)]);
  }
  outputs.push([join(cfg.mod.stringsFolder, 'en.rules'), stringsFile(cfg)]);
  outputs.push(['mod.rules', modFile(cfg)]);

  let changed = 0;
  for (const [rel, content] of outputs) {
    const abs = join(REPO, rel);
    const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (prev === content) continue;
    changed++;
    if (check) {
      console.error(`  ✗ ${rel} would change`);
    } else {
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
      console.log(`  ✓ ${rel}`);
    }
  }

  // Loose files in a material root are orphans (the 1x1 now lives in its own
  // subfolder). Flag them under --check; remove them otherwise.
  if (check) {
    let stale = changed;
    for (const id of Object.keys(cfg.materials)) {
      const matDir = join(REPO, id);
      if (!existsSync(matDir)) continue;
      for (const entry of readdirSync(matDir)) {
        if (statSync(join(matDir, entry)).isDirectory()) continue;
        console.error(`  ✗ ${join(id, entry)} is an orphan in a material root`);
        stale++;
      }
    }
    if (stale) { console.error(`${stale} file(s) out of date — run: node tools/gen_rules.mjs`); process.exit(1); }
    console.log('All generated files up to date.');
  } else {
    for (const rel of pruneMaterialOrphans(cfg)) console.log(`  ✗ removed orphan ${rel}`);
    console.log(`Done — ${changed} file(s) written, ${outputs.length - changed} unchanged.`);
  }
}

main();
