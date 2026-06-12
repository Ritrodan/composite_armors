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
import { loadConfig, pruneMaterialOrphans, structureWedgeId, REPO } from './config.mjs';

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
// Hybrid floor: the integrated structure lattice that shows through damage holes.
const FLOOR = [['floor.png'], ['floor_33.png'], ['floor_66.png']];
const ROOF = [['roof.png', 'roof_normals.png'], ['roof_33.png', 'roof_normals_33.png'], ['roof_66.png', 'roof_normals_66.png']];
// Wedge external-wall layer: the green lip + its normals along the hypotenuse,
// rendered per-material (see render.mjs). The albedo damage levels composite the
// (undamaged) lip over each level's plating; the lip's normal map never changes
// with damage, so all three levels share the single external_wall_normals.png.
const WEDGE_EXT_WALLS = [
  ['external_walls.png', 'external_wall_normals.png'],
  ['external_walls_33.png', 'external_wall_normals.png'],
  ['external_walls_66.png', 'external_wall_normals.png'],
];

// Shared Graphics + DestroyedEffects + Blueprints body.
// wallFiles: the [[file, normalsFile?],...] list for the Walls DamageLevels.
function graphicsBody(sz, cx, cy, floorComment, wallsLayer = 'walls', wallFiles = PLATE, floorLayer = 'floors', floorFiles = PLATE) {
  return `\t\tGraphics
\t\t{
\t\t\tType = Graphics
\t\t\tLocation = [${cx}, ${cy}]
\t\t\tFloor${floorComment}
\t\t\t{
\t\t\t\tLayer = "${floorLayer}"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(floorFiles, sz)}
\t\t\t\t]
\t\t\t}
\t\t\tWalls
\t\t\t{
\t\t\t\tLayer = "${wallsLayer}"
\t\t\t\tDamageLevels
\t\t\t\t[
${damageLevels(wallFiles, sz)}
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

  // The 1x1 block is the parent catalog part, so it claims the bare material id
  // (Ritrodan.nera); every larger size is a child keyed by its folder
  // (Ritrodan.nera/2x1) and points back at the parent via EditorParentParts.
  const id = isBase ? `Ritrodan.${mat.id}` : `Ritrodan.${partId}`;

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
\tID = ${id}
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

// Per-size wedge geometry, generated for any height. Every modded wedge is 1xN
// (W=1), matching the vanilla armor wedges: a right triangle with vertices
// [1,0], [1,N], [0,N] (the right and bottom edges are external; the hypotenuse
// runs top-right to bottom-left).
function wedgeGeometry(H) {
  if (H < 1) throw new Error(`unsupported wedge height ${H}`);
  if (H === 1) {
    return {
      underlying: structureWedgeId(1, 1),
      flipBlock: '',
      walls: `\tExternalWalls = [TopRight, Right, BottomRight, Bottom, BottomLeft]
\tInternalWalls = [Left, TopLeft, Top]`,
      virtual: `\t\t{ExternalCell=[0, -1]; InternalCell=[1, 0]}
\t\t{ExternalCell=[-1, 0]; InternalCell=[0, 1]}`,
      flipH: '[1, 0, 3, 2]',
      flipV: '[3, 2, 1, 0]',
    };
  }
  // Walls per cell: the top cell exposes the wedge tip, the bottom cell the
  // full base corner, middle cells just the right edge; internal walls mirror
  // along the hypotenuse. Identical to the vanilla 1x2/1x3 layouts and extends
  // naturally to any height.
  const extFor = r => r === 0 ? 'TopRight, Right' : r === H - 1 ? 'Right, BottomRight, Bottom, BottomLeft' : 'Right';
  const intFor = r => r === 0 ? 'BottomLeft, Left, TopLeft, Top' : r === H - 1 ? 'Left, TopLeft' : 'TopLeft, Left, BottomLeft';
  const cell = (r, val) => `\t\t{
\t\t\tKey = [0, ${r}]
\t\t\tValue = [${val}]
\t\t}`;
  const rows = fn => Array.from({ length: H }, (_, r) => cell(r, fn(r))).join('\n');
  return {
    underlying: structureWedgeId(1, H),
    flipBlock: 'FLIP',
    walls: `\tExternalWallsByCell
\t[
${rows(extFor)}
\t]
\tInternalWallsByCell
\t[
${rows(intFor)}
\t]`,
    virtual: `\t\t{ExternalCell=[0, -1]; InternalCell=[1, 0]}
\t\t{ExternalCell=[-1, ${H - 1}]; InternalCell=[0, ${H}]}`,
    flipH: '[0, 3, 2, 1]',
    flipV: '[2, 1, 0, 3]',
  };
}

// Walls for a multi-column WxH wedge (hypotenuse from [W,0] to [0,H]). No
// vanilla part has this shape, so the rules are generalized from the vanilla
// 1xN wedges (the algorithm reproduces all three vanilla samples exactly):
// for each cell, an outer edge is External if the solid triangle touches it
// with positive length, Internal otherwise; edges shared with another solid
// cell get no wall. Corners are External where the hypotenuse passes exactly
// through them or where two External edges meet, Internal next to an Internal
// edge. Cells entirely outside the triangle get no walls at all.
function generalWedgeGeometry(W, H) {
  const d = (x, y) => H * x + W * y - W * H;
  const RING = ['TopRight', 'Right', 'BottomRight', 'Bottom', 'BottomLeft', 'Left', 'TopLeft', 'Top'];
  const isEmptyCell = (x, y) => x >= 0 && y >= 0 && x < W && y < H &&
    Math.max(d(x, y), d(x + 1, y), d(x, y + 1), d(x + 1, y + 1)) <= 0;
  const extByCell = [], intByCell = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const dc = {
      TopLeft: d(cx, cy), TopRight: d(cx + 1, cy),
      BottomLeft: d(cx, cy + 1), BottomRight: d(cx + 1, cy + 1),
    };
    if (Math.max(...Object.values(dc)) <= 0) {
      extByCell.push([cx, cy, ['None']]); intByCell.push([cx, cy, ['None']]);
      continue;
    }
    const ext = new Set(), int_ = new Set();
    const edges = {
      Top: { corners: ['TopLeft', 'TopRight'], outer: cy === 0 || isEmptyCell(cx, cy - 1) },
      Right: { corners: ['TopRight', 'BottomRight'], outer: cx === W - 1 || isEmptyCell(cx + 1, cy) },
      Bottom: { corners: ['BottomLeft', 'BottomRight'], outer: cy === H - 1 || isEmptyCell(cx, cy + 1) },
      Left: { corners: ['TopLeft', 'BottomLeft'], outer: cx === 0 || isEmptyCell(cx - 1, cy) },
    };
    const status = {};
    for (const [name, e] of Object.entries(edges)) {
      if (!e.outer) { status[name] = null; continue; }
      status[name] = Math.max(dc[e.corners[0]], dc[e.corners[1]]) > 0 ? 'ext' : 'int';
      (status[name] === 'ext' ? ext : int_).add(name);
    }
    const partial = Math.min(...Object.values(dc)) < 0;
    const cornerAdj = { TopRight: ['Top', 'Right'], BottomRight: ['Bottom', 'Right'], BottomLeft: ['Bottom', 'Left'], TopLeft: ['Top', 'Left'] };
    for (const [c, [e1, e2]] of Object.entries(cornerAdj)) {
      // A hypotenuse-endpoint corner wall only exists where the hypotenuse
      // actually cuts the cell, not where it merely grazes a solid cell's corner.
      if (dc[c] === 0 && partial) ext.add(c);
      else if (status[e1] === 'ext' && status[e2] === 'ext') ext.add(c);
      else if (status[e1] === 'int' || status[e2] === 'int') int_.add(c);
    }
    extByCell.push([cx, cy, RING.filter(k => ext.has(k))]);
    intByCell.push([cx, cy, RING.filter(k => int_.has(k))]);
  }
  const cell = ([cx, cy, vals]) => `\t\t{
\t\t\tKey = [${cx}, ${cy}]
\t\t\tValue = [${vals.length ? vals.join(', ') : 'None'}]
\t\t}`;
  const mirrorSym = W === H;
  return {
    underlying: structureWedgeId(W, H),
    flipBlock: mirrorSym ? '' : 'FLIP',
    walls: `\tExternalWallsByCell
\t[
${extByCell.map(cell).join('\n')}
\t]
\tInternalWallsByCell
\t[
${intByCell.map(cell).join('\n')}
\t]`,
    virtual: `\t\t{ExternalCell=[${W - 1}, -1]; InternalCell=[${W}, 0]}
\t\t{ExternalCell=[-1, ${H - 1}]; InternalCell=[0, ${H}]}`,
    flipH: mirrorSym ? '[1, 0, 3, 2]' : '[0, 3, 2, 1]',
    flipV: mirrorSym ? '[3, 2, 1, 0]' : '[2, 1, 0, 3]',
  };
}

// Resource list for a wedge as [name, qty] pairs. A 1x2 wedge covers exactly
// one tile, so it uses the full per-tile block recipe; every other shape uses
// the half-block `wedgeRecipe`, scaled by the half-tiles it covers (W*H).
function wedgeResourcePairs(mat, W, H) {
  if (W === 1 && H === 2) return mat.perTile.resources.map(([name, qty]) => [name, qty]);
  return mat.wedgeRecipe.map(([name, qty]) => [name, qty * W * H]);
}

// Sum two [name, qty] resource lists, preserving first-seen order.
function mergeResources(a, b) {
  const out = a.map(([name, qty]) => [name, qty]);
  for (const [name, qty] of b) {
    const hit = out.find(r => r[0] === name);
    if (hit) hit[1] += qty; else out.push([name, qty]);
  }
  return out;
}

const formatResources = pairs => pairs.map(([name, qty]) => `\t\t[${name}, ${qty}]`).join('\n');

function wedgeRules(v, structureCfg) {
  const { material: mat, W, H, keySuffix: suffix, partId, areaTiles, isHybrid } = v;
  const pt = mat.perTile, iv = mat.intensive;
  const g = W === 1 ? wedgeGeometry(H) : generalWedgeGeometry(W, H);

  const cx = n(W / 2), cy = n(H / 2);
  const sz = `[${W}, ${H}]`;
  // Hybrids fold the structural frame into the part itself (vanilla
  // armor_structure_hybrid_*): its steel and HP are added on top of the armor
  // wedge, and there is no separate underlying structure part.
  let resourcePairs = wedgeResourcePairs(mat, W, H);
  let maxHealth = Math.round(pt.maxHealth * areaTiles);
  if (isHybrid) {
    const st = structureCfg.wedgePerLongTile;
    resourcePairs = mergeResources(resourcePairs, st.resources.map(([name, qty]) => [name, qty * W * H]));
    maxHealth += st.maxHealth * W * H;
  }
  const resources = formatResources(resourcePairs);
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
\tEditorReplacementPartID = ${isHybrid ? 'structure' : '""'}
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
\tUnderlyingPart = ${(isHybrid || mat.noUnderlyingStructure) ? '""' : g.underlying}
\tCreatePartPerTileWhenGrabbed = ${isHybrid ? 'structure' : '""'}
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
\t\t\t\t[${W}, 0]
\t\t\t\t[${W}, ${H}]
\t\t\t\t[0, ${H}]
\t\t\t]
\t\t}

${emp.block}${graphicsBody(sz, cx, cy, '', 'external_walls', WEDGE_EXT_WALLS, isHybrid ? 'structure' : 'floors', isHybrid ? FLOOR : PLATE)}
\t}

\tStats
\t{
${emp.stat}\t\tAOEResist = (&~/Part/DamageResistances/explosive) * 100
\t}
}
`;
}

function partRules(v, structureCfg) {
  return v.isWedge ? wedgeRules(v, structureCfg) : blockRules(v);
}

// Procedural structure part (block or wedge) of any size, modeled on the
// vanilla structure / structure_1xN_wedge references. Structure has no walls or
// roof — just the lattice floor on the "structure" layer, a construction
// overlay, and (for wedges) a triangle collider.
function structureRules(sv, st) {
  const { W, H, isWedge, keySuffix: suffix, partId } = sv;
  const sz = `[${W}, ${H}]`;
  const cx = n(W / 2), cy = n(H / 2);
  // Wedge stats scale with covered half-tiles (W*H), matching vanilla's
  // 500 HP / 1 steel per half-tile-pair; blocks scale with full tiles.
  const resourcePairs = isWedge
    ? st.wedgePerLongTile.resources.map(([name, qty]) => [name, qty * W * H])
    : st.perTile.resources.map(([name, qty]) => [name, qty * W * H]);
  const maxHealth = isWedge ? st.wedgePerLongTile.maxHealth * W * H : st.perTile.maxHealth * W * H;

  const flippable = isWedge && W !== H;
  const flipBlock = flippable
    ? `\tIsFlippable = true
\tOtherIDs = [Ritrodan.${partId}_L, Ritrodan.${partId}_R]
\tFlipWhenLoadingIDs = [Ritrodan.${partId}_R]
`
    : '';
  // Rotation: square blocks gain nothing from rotating (vanilla 1x1 structure
  // is non-rotatable); everything else rotates, wedges with the vanilla maps.
  const rotateBlock = isWedge
    ? `\tIsRotateable = true
\tFlipHRotate = ${flippable ? '[0, 3, 2, 1]' : '[1, 0, 3, 2]'}
\tFlipVRotate = ${flippable ? '[2, 1, 0, 3]' : '[3, 2, 1, 0]'}
\tGenerateRectCollider = false`
    : (W === H ? '\tIsRotateable = false' : '\tIsRotateable = true');
  const contiguity = isWedge ? '\tAllowedContiguity = [Right, Bottom]\n' : '';
  // Multi-tile structure builds tile-by-tile via temporary 1x1s, like vanilla wedges.
  const tempConstruction = (W * H > 1 || isWedge) ? '\tTempConstructionPartPerTile = cosmoteer.structure\n' : '';
  const collider = isWedge
    ? `\t\tCollider
\t\t{
\t\t\tType = PolygonCollider
\t\t\tVertices
\t\t\t[
\t\t\t\t[${W}, 0]
\t\t\t\t[${W}, ${H}]
\t\t\t\t[0, ${H}]
\t\t\t]
\t\t}

`
    : '';

  const levels = damageLevels([
    ['structure.png', 'structure_normals.png'],
    ['structure_33.png', 'structure_normals_33.png'],
    ['structure_66.png', 'structure_normals_66.png'],
  ], sz);

  return `Part : <./Data/ships/terran/base_part_terran_structure.rules>/Part
{
\tNameKey = "Parts/Structure${suffix}"
\tIconNameKey = "Parts/Structure${suffix}Icon"
\tID = Ritrodan.${partId}
\tEditorGroup = "Structure"
\tEditorParentParts = [ "cosmoteer.structure" ]
\tEditorReplacementPartID = ""
\tDescriptionKey = "Parts/Structure${suffix}Desc"
${flipBlock}\tResources
\t[
${formatResources(resourcePairs)}
\t]
\tAIValueFactor = 0
\tSize = ${sz}
\tSelectionTypeID = "structure"
${contiguity}\tDensity = .333
\tMaxHealth = ${maxHealth}
\tConstructionWork = 0.25
\tWorkPerRepairedHealth = 0.25 / 1000
\tHealthType = Structural
\tDamageResistances = { thermal=60% }
\tTypeCategories = [structure, non_flammable]
\tReceivableBuffs : ^/0/ReceivableBuffs []
\tUnderlyingPartPerTile = ""
${tempConstruction}\tCreatePartPerTileWhenGrabbed = ""
\tInitialPenetrationResistance = 0
\tContinuingPenetrationResistance = &InitialPenetrationResistance
\tCrewSpeedFactor = 0
\tCellOccupancyFactor = 0.25
\tIsExternal = true
\tExternalWalls = [None]
\tInternalWalls = [All]
${rotateBlock}
\tIsWalled = false
\tIsSelfDestructible = false
\tAllowedDoorLocations = []
\tGeneratorRequiresDoor = false
\tNoAutoDoors = true
\tIgnoreRotationForMirroredSelection = true
\tEditorIcon
\t{
\t\tTexture
\t\t{
\t\t\tFile = "structure.png"
\t\t\tSampleMode = Linear
\t\t}
\t\tSize = [${32 * W}, ${32 * H}]
\t}
\tComponents : ^/0/Components
\t{
${collider}\t\tGraphics
\t\t{
\t\t\tType = Graphics
\t\t\tLocation = [${cx}, ${cy}]
\t\t\tFloor
\t\t\t{
\t\t\t\tLayer = "structure"
\t\t\t\tDamageLevels
\t\t\t\t[
${levels}
\t\t\t\t]
\t\t\t}
\t\t}

\t\tConstructionEffects
\t\t{
\t\t\tType = Sprite
\t\t\tIncludeWhenUnderConstruction = true
\t\t\tIncludeWhenNotUnderConstruction = false
\t\t\tGetColorFrom = ConstructionTracker
\t\t\tLocation = [${cx}, ${cy}]
\t\t\tAtlasSprite
\t\t\t{
\t\t\t\tFile = "structure_mask_combined.png"
\t\t\t\tNormalsFile = "structure_normals.png"
\t\t\t\tSize = ${sz}
\t\t\t}
\t\t\tRandomUVRotation = false
\t\t\tLayer = "structure_construction"
\t\t\tUseConstructionProgressAsDamage = true
\t\t}

\t\tDestroyedEffects
\t\t{
\t\t\tType = DeathEffects
\t\t\tMediaEffects = &/COMMON_EFFECTS/StructureDestroyed
\t\t\tLocation = [${cx}, ${cy}]
\t\t}

\t\tBlueprints
\t\t{
\t\t\tType = BlueprintSprite
\t\t\tFile = "blueprints.png"
\t\t\tSize = ${sz}
\t\t}
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
        const label = `${mat.displayName} ${v.labelSuffix}`;
        const desc = v.isHybrid
          ? `${mat.description} This hybrid variant is built around an integrated structural frame, which stays visible where the armor plating has been blasted away.`
          : mat.description;
        lines.push('');
        lines.push(`\t${mat.nameKey}${v.keySuffix} = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.keySuffix}Icon = "${label}"`);
        lines.push(`\t${mat.nameKey}${v.keySuffix}Desc = "${desc}"`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  if (cfg.structureVariants.length) {
    const desc = 'A lightweight structural frame. Provides no protection, but is cheap, blocks very little weapons fire, and gives armor a skeleton to hang on.';
    const lines = [];
    for (const sv of cfg.structureVariants) {
      const label = `Structure ${sv.labelSuffix}`;
      if (lines.length) lines.push('');
      lines.push(`\tStructure${sv.keySuffix} = "${label}"`);
      lines.push(`\tStructure${sv.keySuffix}Icon = "${label}"`);
      lines.push(`\tStructure${sv.keySuffix}Desc = "${desc}"`);
    }
    blocks.push(lines.join('\n'));
  }
  return `Parts\n{\n${blocks.join('\n\n')}\n}\n`;
}

function modFile(cfg) {
  const m = cfg.mod;
  const adds = [
    ...cfg.variants.map(v => {
      const baseName = v.material.id;
      const variantSuffix = v.keySuffix ? '_' + v.keySuffix : '';
      const filename = `${baseName}${variantSuffix}.rules`;
      return `\t\t\t&<${v.dir}/${filename}>/Part`;
    }),
    ...cfg.structureVariants.map(sv => `\t\t\t&<${sv.dir}/${sv.partId}.rules>/Part`),
  ].join('\n');
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
    outputs.push([join(v.dir, filename), partRules(v, cfg.structure)]);
  }
  for (const sv of cfg.structureVariants) {
    outputs.push([join(sv.dir, `${sv.partId}.rules`), structureRules(sv, cfg.structure)]);
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
