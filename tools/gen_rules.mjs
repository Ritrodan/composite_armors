#!/usr/bin/env node
// Generates every part's .rules, strings/en.rules, and mod.rules from
// tools/armors.config.json. Define a material's 1x1 stats once; this scales
// the extensive ones (resources, HP, EMP absorption) by tile count and keeps
// the intensive ones (resistances, density, penetration) constant across sizes.
//
//   node tools/gen_rules.mjs        # regenerate everything
//   node tools/gen_rules.mjs --check  # fail if any file would change (CI-friendly)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, REPO } from './config.mjs';

// Print a JS number without trailing-zero noise: 5 -> "5", 1.2 -> "1.2".
const n = x => String(x);

function partRules(mat, W, H) {
  const isBase = W === 1 && H === 1;
  const suffix = isBase ? '' : `${W}x${H}`;
  const dir = isBase ? mat.id : `${mat.id}_${W}x${H}`;
  const tiles = W * H;
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

  const isRotatable = W !== H;
  const rotateBlock = isRotatable
    ? `\tFlipHRotate = [0, 1, 2, 3]
\tFlipVRotate = [0, 1, 2, 3]`
    : `\tIsRotateable = false`;

  const flammableLine = isBase ? '' : '\tFlammable = false\n';
  const isRotateableLine = isRotatable ? '\tIsRotateable = true\n' : '';
  const floorComment = isBase ? ' // This is needed so that armor shows up in ship ghosts.' : '';

  const damageLevels = (files) => files.map(([f, nf]) =>
`\t\t\t\t\t{
\t\t\t\t\t\tFile = "${f}"${nf ? `\n\t\t\t\t\t\tNormalsFile = "${nf}"` : ''}
\t\t\t\t\t\tSize = ${sz}
\t\t\t\t\t}`).join('\n');

  const plate = [['armor.png'], ['armor_33.png'], ['armor_66.png']];
  const roof = [['roof.png', 'roof_normals.png'], ['roof_33.png', 'roof_normals_33.png'], ['roof_66.png', 'roof_normals_66.png']];

  return `Part : <./Data/ships/terran/base_part_terran.rules>/Part
{
\tNameKey = "Parts/${mat.nameKey}${suffix}"
\tIconNameKey = "Parts/${mat.nameKey}${suffix}Icon"
\tID = Ritrodan.${dir}
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
\tCrewSpeedFactor = 0
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
\t\tEmpAbsorber
\t\t{
\t\t\tType = ExplosiveResourceDrainSink
\t\t\tResourceType = battery
\t\t\tAbsorbsResourceDrain = ${pt.empAbsorb * tiles}
\t\t\tRecoveryRate = (&AbsorbsResourceDrain) * 0.1
\t\t}

\t\tGraphics
\t\t{
\t\t\tType = Graphics
\t\t\tLocation = [${cx}, ${cy}]
\t\t\tFloor${floorComment}
\t\t\t{
\t\t\t\tLayer = "floors"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(plate)}
\t\t\t\t]
\t\t\t}
\t\t\tWalls
\t\t\t{
\t\t\t\tLayer = "walls"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(plate)}
\t\t\t\t]
\t\t\t}
\t\t\tRoof
\t\t\t{
\t\t\t\tLayer = "roofs"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(roof)}
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
\t\t}
\t}

\tStats
\t{
\t\tEMPResist = (&~/Part/Components/EmpAbsorber/AbsorbsResourceDrain) / 1000
\t\tAOEResist = (&~/Part/DamageResistances/explosive) * 100
\t}
}
`;
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
        const label = `${mat.displayName} ${v.suffix}`;
        lines.push('');
        lines.push(`\t${mat.nameKey}${v.suffix} = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.suffix}Icon = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.suffix}Desc = "${mat.description}"`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return `Parts\n{\n${blocks.join('\n\n')}\n}\n`;
}

function modFile(cfg) {
  const m = cfg.mod;
  const adds = cfg.variants.map(v => `\t\t\t&<${v.dir}/${v.dir}.rules>/Part`).join('\n');
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
    outputs.push([join(v.dir, `${v.dir}.rules`), partRules(v.material, v.W, v.H)]);
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

  if (check) {
    if (changed) { console.error(`${changed} file(s) out of date — run: node tools/gen_rules.mjs`); process.exit(1); }
    console.log('All generated files up to date.');
  } else {
    console.log(`Done — ${changed} file(s) written, ${outputs.length - changed} unchanged.`);
  }
}

main();
