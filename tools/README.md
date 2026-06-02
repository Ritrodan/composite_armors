# Mod tooling

Everything about the mod's parts is defined once in **`armors.config.json`** and
generated from there: the `.rules` files, `strings/en.rules`, `mod.rules`, and
the textures. Change a stat in one place, regenerate, done.

## Files

| File | Role |
|------|------|
| `armors.config.json` | **Single source of truth** — materials (1x1 stats) + the list of size variants. |
| `config.mjs` | Shared loader; resolves each variant's dir/suffix/dims. |
| `gen_rules.mjs` | Generates all `.rules`, `strings/en.rules`, and `mod.rules`. |
| `generate.mjs` | Renders the 11 PNGs for each part. |
| `render.mjs` | Pure renderer ported from `hull_foundry.html` (no DOM). |
| `png.mjs` | Dependency-free PNG encoder (Node built-in `zlib`). |
| `hull_foundry.html` | Visual texture design tool (find a material look + seed). |

No `npm install` — pure Node (>=18).

## Commands

```bash
node tools/gen_rules.mjs           # regenerate .rules + strings + mod.rules
node tools/gen_rules.mjs --check   # CI-friendly: fail if anything is out of date
node tools/generate.mjs            # render all textures
node tools/generate.mjs nera_4x1   # render only the named part(s)
```

## How stats scale

Each material lists its **1x1** stats. The generator scales them per variant:

- **`perTile`** (extensive — scale with tile count `W*H`): `resources`, `maxHealth`, `empAbsorb`.
- **`intensive`** (constant across sizes): `explosiveAbsorption`, `explosiveResist`, `thermalResist`, `penResist`, `density`.

So to retune NERA across every size, edit `materials.nera` once and run
`node tools/gen_rules.mjs`.

## Add a new size variant

1. Add one line to the `variants` array in `armors.config.json`, e.g.
   `{ "material": "nera", "size": [3, 2] }`.
2. Create the part folder: `mkdir nera_3x2`.
3. `node tools/gen_rules.mjs && node tools/generate.mjs nera_3x2`.

That writes the `.rules`, the string keys, the `mod.rules` entry, and the
textures. (Folder naming: `1x1` is the bare material id; others get a `_WxH`
suffix. In-game labels use the material display name plus the bare size, such as
`NERA 2x1`; all size variants reuse the material's base description. Square
parts are generated as non-rotatable because rotation does not change them.)

## Add a new material

Add an entry under `materials` (copy an existing one, set the 1x1 stats, pick a
`texture.material` from `render.mjs`'s library and a `texture.seed`), then add
its `variants` rows and run both generators.

## Damage scaling

Unlike the original HTML tool — which placed a **fixed** crater count regardless
of block size — `render.mjs` scales the crater count by tile area
(`cratersPerTile * tilesX * tilesY`, halved for wedges). Crater *size* stays
absolute, so damage density is constant across all sizes.
