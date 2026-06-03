# Hull Foundry — adding materials

There are now **two** ways to add a material, and neither requires rewriting the file.

## A. Live, no file editing (best for the Gemini loop)

1. Open Hull Foundry, scroll the left panel to **MATERIAL LAB**.
2. Click **TEMPLATE** to see a working example, or paste a `defineMaterial({…})` block.
3. Click **LOAD MATERIAL**. It registers immediately, gets selected, and renders.
   Errors show in red instead of breaking the app. Re-loading the same `id` replaces it,
   so you can iterate on one material without reloading the page.

This is the safe path for an AI: it only ever writes one ~30-line object. It cannot
touch `surface()`, `buildFields`, the damage/normal/roof pipeline, the dropdown, or
the sliders, because those are no longer where materials live.

## B. Permanent — paste into the file

Add a `defineMaterial({…})` call in the **MATERIALS · the registry** section
(search the file for `MATERIAL_REGISTRY`). It's purely additive: append one block.

---

## The contract (this is all an AI needs)

```js
defineMaterial({
  id:       'unique_id',          // dropdown value, also the re-load key
  label:    'Human Name',         // dropdown text
  defaults: { baseBright:29, grain:9, bevelBright:16, normalStrength:1.0 },
                                  // applied to the shared sliders when selected;
                                  // may also set any of this material's control ids
  controls: [                     // extra sliders, auto-built + auto-read
    { id:'myParam', label:'My Param (px)', min:1, max:30, step:1, value:12 },
  ],
  surface(ctx){ /* runs once per pixel */ return { h, r, g, b, rg, warm }; }
})
```

`ctx` passed to `surface`:

| field        | meaning                                                             |
|--------------|---------------------------------------------------------------------|
| `P`          | all params, including your control values (e.g. `P.myParam`)        |
| `x, y`       | pixel coords, top-left origin                                       |
| `W, H`       | texture size in px (`tilesX*64`, `tilesY*64`)                       |
| `bev`        | bevel factor ~0..1, peaks near the plate border                     |
| `gn, gf`     | coarse / fine grain noise, each in `[-1, 1]`                        |
| `inside`     | 0 at the very edge → 1 in the interior (use to fade patterns in)    |
| `grainV`     | `gn*P.grain + gf*P.grain*0.4` (precomputed)                         |
| `vBase`      | `P.baseBright + bev*P.bevelBright + grainV` (base luminance)        |
| `gauss,smooth`| helpers: `gauss(d,w)`, `smooth(t)`                                 |
| `TILE`       | `64` — the block size in px; the period structural patterns must divide |
| `seamless`   | `true` when the **Seamless tiling** toggle is on                    |
| `fitPeriod`  | `fitPeriod(desired)` → snaps a period so a whole number of repeats fits in 64px (returns `desired` unchanged when seamless is off) |

Return `{ h, r, g, b, rg, warm }`:

- `h` — surface height / relief. `+` raised, `-` recessed. ~`[-2 .. 3]` typical. Drives normal maps.
- `r, g, b` — albedo, roughly `0..255` (clamped downstream). Use `r=g=b` for neutral steel.
- `rg` — roof luminance mask (green channel), ~`150..250`. Higher = brighter roof.
- `warm` — warm/copper offset baked into the roof so it survives ship-color tint. `0` = none.

`surface` must be a **pure function** of `ctx`: same input → same output, no globals, no RNG.
Damage, holes, scorch, normals, blueprints and icon are all applied automatically afterward.

---

## Seamless tiling across blocks

Each Cosmoteer block is 64px. Two adjacent blocks are two separate 64px textures, so a
repeating pattern only lines up across the seam if a **whole number of repeats fits in 64px**
— i.e. the pattern's period evenly divides 64.

The **Seamless tiling** toggle (on by default, in the Material Profile panel) drives this.
Any material makes itself tileable by running each structural period through `ctx.fitPeriod`:

```js
const per = fitPeriod(P.weavePeriod);   // e.g. 13 → 16, 18 → 16, 21 → 21.33
```

`fitPeriod(desired)` returns the value nearest `desired` that divides 64 evenly (when
seamless is on; otherwise it returns `desired` unchanged). Run **every** period that defines
structure through it — spacing, cell size, stripe width, etc. The built-ins show three cases:

- **NERA** snaps both the plate width and the copper-repeat unit; the copper unit is twice
  the plate width, so copper lands on every other seam and still tiles.
- **Hex Plate** snaps column and row spacing independently, so the lattice may stretch a
  hair (a regular hexagon can't tile a square 64 grid exactly), and uses a Voronoi distance
  field so the slightly-stretched cells still shade correctly.
- **Tri-Steel / Riveted Plate** snaps the rivet spacing.

Note: only the **structural** pattern tiles. The fine surface grain (`gn`/`gf`) is
deliberately per-block noise so repeated tiles don't look photocopied; it varies subtly at
seams. Set **Surface grain** to 0 if you want pixel-identical tiles.

---

## Porting a material to render.mjs (node generator)

After designing a material in `hull_foundry.html`, add a matching branch in `render.mjs`'s
`surface()` function:

1. Copy the pixel logic from the `defineMaterial` surface function.
2. Replace `ctx.*` destructuring with the flat parameters (`P`, `W`, `H`, `x`, `y`, `bev`, `gn`, `gf`, `inside`, `vBase`, `grainV`).
3. Use `fitPeriod(desired)` (already defined in `render.mjs`) instead of `ctx.fitPeriod`.
4. Add the material's default control values to the `DEFAULTS` object in `generate.mjs`.
5. Add an entry to the `MATERIALS` table in `generate.mjs` (mirrors `defineMaterial.defaults`).

---

## Prompt you can paste into Gemini (or Claude)

> You are writing one material for a procedural texture generator. Output **only** a single
> JavaScript `defineMaterial({…})` block, no prose, no markdown fences.
>
> Per-pixel function signature: `surface(ctx)` where
> `ctx = { P, x, y, W, H, bev, gn, gf, inside, grainV, vBase, gauss, smooth }`.
> It must return `{ h, r, g, b, rg, warm }`:
> h = relief height (~ -2..3), r/g/b = albedo 0..255 (use r=g=b for steel),
> rg = roof brightness mask ~150..250, warm = warm tint offset (0 unless copper/brass).
> `inside` is 0 at the plate edge and 1 in the interior — multiply pattern detail by it so
> the bevel border stays clean. `surface` must be pure (no globals, no randomness; use gn/gf
> for texture noise). Declare extra sliders in `controls` and read them as `P.<id>`.
> For any repeating structure, snap its period with `ctx.fitPeriod(period)` so it tiles across
> 64px block borders.
>
> Make a material called: **<DESCRIBE IT HERE>**

Then paste the block into MATERIAL LAB → LOAD MATERIAL.
