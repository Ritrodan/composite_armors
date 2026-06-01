# Texture tooling

Procedural generation of the armor textures (the 11 PNGs each part folder needs:
`armor`, `armor_33`, `armor_66`, `roof`, `roof_33`, `roof_66`, `roof_normals`,
`roof_normals_33`, `roof_normals_66`, `blueprints`, `icon`).

## Files

| File | Purpose |
|------|---------|
| `hull_foundry.html` | Visual design tool. Open in a browser, tune sliders, find a material + seed you like. |
| `textures.config.json` | Source of truth — one entry per part folder (material, size, seed). |
| `generate.mjs` | Reads the config and writes the PNGs into each part folder. |
| `render.mjs` | Pure renderer ported from `hull_foundry.html` (no browser/DOM). |
| `png.mjs` | Dependency-free PNG encoder (Node built-in `zlib`). |

## Usage

```bash
node tools/generate.mjs            # regenerate every part
node tools/generate.mjs nera_4x1   # regenerate only the named part(s)
```

No `npm install` required — pure Node (>=18).

## Workflow for adding a new variant

1. Create the part folder and its `*.rules` (copy an existing variant, adjust
   `Size`, `Location`, `MaxHealth`, resources, icon size).
2. Add a line to `mod.rules` `ManyToAdd`.
3. Add string keys to `strings/en.rules`.
4. Add an entry to `textures.config.json` (reuse the material family's seed so
   the variant matches its siblings).
5. `node tools/generate.mjs <dir>`.

## Damage scaling

Unlike the original HTML tool — which placed a **fixed** number of craters
regardless of block size — `render.mjs` scales the crater count by the block's
tile area (`cratersPerTile * tilesX * tilesY`, halved for wedges). Crater
*size* stays absolute, so a blast hole looks the same on a 1×1 and a 4×1; only
the *count* grows, keeping damage density constant across all sizes.
