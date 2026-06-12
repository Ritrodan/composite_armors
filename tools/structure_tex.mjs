// Structure textures built from the actual vanilla pixels, so generated parts
// are indistinguishable from the vanilla structure family.
//
// - Blocks of any WxH: the vanilla 64px structure tile (frame + 2x2 X-bays) is
//   tiled across the part. Each tile gets a seeded 90°-rotation (the same trick
//   as vanilla's RandomUVRotation) so the crater patterns of the damage levels
//   don't visibly repeat; normal maps are swizzled to match the rotation.
// - Wedges 1x1/1x2/1x3: the vanilla wedge textures are used verbatim.
// - Taller wedges (1x4+): no vanilla counterpart exists, so one is composed
//   from vanilla pixels — the tiled square lattice clipped at the hypotenuse,
//   with a chord bar whose cross-section (albedo, normals, construction mask)
//   is sampled perpendicular to the hypotenuse of the vanilla 1x3 wedge and
//   re-laid along the new slope (normals rotated by the slope difference).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG } from './png.mjs';
import { REPO } from './config.mjs';

const TILE = 64;
const VREF = join(REPO, 'vanilla_references');
const NAMES = [
  'structure.png', 'structure_33.png', 'structure_66.png',
  'structure_normals.png', 'structure_normals_33.png', 'structure_normals_66.png',
  'structure_mask_combined.png',
];
export const STRUCTURE_FILES = [...NAMES, 'blueprints.png'];

const cache = new Map();
function ref(dir, name) {
  const k = `${dir}/${name}`;
  if (!cache.has(k)) cache.set(k, decodePNG(readFileSync(join(VREF, dir, name))));
  return cache.get(k);
}

const newImage = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
const isNormals = name => name.includes('normals');

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Rotate a square RGBA tile k*90° clockwise. For normal maps the encoded
// vector has to rotate with the content: 90° CW maps (nx, ny) -> (-ny, nx).
function rotTile(src, k, normals) {
  k &= 3;
  if (k === 0) return src;
  const S = src.width, out = newImage(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // Source pixel that lands at (x, y) after k CW quarter-turns.
    let sx = x, sy = y;
    for (let r = 0; r < k; r++) { const t = sx; sx = sy; sy = S - 1 - t; }
    const si = (sy * S + sx) * 4, di = (y * S + x) * 4;
    let [r, g, b, a] = [src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]];
    if (normals) {
      for (let q = 0; q < k; q++) { const t = r; r = 255 - g; g = t; }
    }
    out.data[di] = r; out.data[di + 1] = g; out.data[di + 2] = b; out.data[di + 3] = a;
  }
  return out;
}

function blit(dst, tile, ox, oy) {
  for (let y = 0; y < tile.height; y++) {
    dst.data.set(tile.data.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((oy + y) * dst.width + ox) * 4);
  }
}

const clone = img => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

// Blueprint sprite: blue silhouette of the lattice (the vanilla blueprint
// pixels aren't in the reference set, but this matches the armor blueprints).
function blueprintsFrom(img) {
  const out = newImage(img.width, img.height), s = img.data, d = out.data;
  for (let i = 0; i < img.width * img.height; i++) {
    const a = s[i * 4 + 3];
    if (a < 8) continue;
    d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 205; d[i * 4 + 3] = a;
  }
  return out;
}

// --- Chord-bar profiles, measured from the vanilla 1x3 wedge -----------------
// For every pixel of the reference, d = signed perpendicular distance to its
// hypotenuse (>= 0 inside the triangle). Averaging RGBA per 0.5px bin over the
// middle of the chord (away from the corner gussets) gives the bar's
// cross-section. d range [-1, BAR_END): outside that the lattice shows through.
const PROFILE_STEP = 0.5;
const PROFILE_MIN = -1.5;
const BAR_END = 6.5;

function chordProfile(name) {
  const k = `profile:${name}`;
  if (cache.has(k)) return cache.get(k);
  const img = ref('structure_1x3_wedge', name);
  const W = img.width, H = img.height, diag = Math.hypot(W, H);
  const nBins = Math.round((BAR_END - PROFILE_MIN) / PROFILE_STEP) + 1;
  const acc = Array.from({ length: nBins }, () => [0, 0, 0, 0, 0]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = (H * (x + 0.5) + W * (y + 0.5) - W * H) / diag;
    if (d < PROFILE_MIN || d >= BAR_END) continue;
    // Position along the chord (0 at top, 1 at bottom); skip the gusseted ends.
    const t = (y + 0.5) / H;
    if (t < 0.15 || t > 0.85) continue;
    const bin = Math.min(nBins - 1, Math.max(0, Math.round((d - PROFILE_MIN) / PROFILE_STEP)));
    const i4 = (y * W + x) * 4;
    const a = acc[bin];
    a[0] += img.data[i4]; a[1] += img.data[i4 + 1]; a[2] += img.data[i4 + 2]; a[3] += img.data[i4 + 3]; a[4]++;
  }
  const prof = acc.map(a => a[4] ? [a[0] / a[4], a[1] / a[4], a[2] / a[4], a[3] / a[4]] : [0, 0, 0, 0]);
  cache.set(k, prof);
  return prof;
}

function sampleProfile(prof, d) {
  const f = (d - PROFILE_MIN) / PROFILE_STEP;
  const i = Math.floor(f);
  if (i < 0) return prof[0];
  if (i >= prof.length - 1) return prof[prof.length - 1];
  const t = f - i;
  return prof[i].map((v, c) => v + (prof[i + 1][c] - v) * t);
}

// --- Midpoint gusset tab ------------------------------------------------------
// Every vanilla wedge carries a connector plate at the middle of its
// hypotenuse, sitting normal to it (the wedge counterpart of the tabs at the
// edge midpoints of the square tile). The averaged chord profile smears it
// away, so it is re-sampled directly from the vanilla 1x3 wedge in
// chord-aligned coordinates (s along the chord from its midpoint, d
// perpendicular) and re-laid at the target chord's midpoint.
const TAB_S = 9.5;        // half-extent along the chord (px)
const TAB_D_MIN = -3, TAB_D_MAX = 8;
const TAB_FEATHER = 2;    // blend back into the plain bar at the ends

function bilinear(img, fx, fy) {
  const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
  const tx = fx - 0.5 - x0, ty = fy - 0.5 - y0;
  const at = (x, y) => {
    x = Math.min(img.width - 1, Math.max(0, x)); y = Math.min(img.height - 1, Math.max(0, y));
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
  const p00 = at(x0, y0), p10 = at(x0 + 1, y0), p01 = at(x0, y0 + 1), p11 = at(x0 + 1, y0 + 1);
  return p00.map((v, c) =>
    (v * (1 - tx) + p10[c] * tx) * (1 - ty) + (p01[c] * (1 - tx) + p11[c] * tx) * ty);
}

function midpointTab(out, H, cosT, sinT) {
  const W = TILE, Ht = H * TILE, diag = Math.hypot(W, Ht);
  const ref3 = ref('structure_1x3_wedge', 'structure.png');
  const W3 = ref3.width, H3 = ref3.height, diag3 = Math.hypot(W3, H3);
  // Chord midpoints and chord-aligned unit vectors (u along, n inward normal).
  const mid = [W / 2, Ht / 2], u = [W / diag, -Ht / diag], nrm = [Ht / diag, W / diag];
  const mid3 = [W3 / 2, H3 / 2], u3 = [W3 / diag3, -H3 / diag3], n3 = [H3 / diag3, W3 / diag3];
  for (const name of NAMES) {
    const src = ref('structure_1x3_wedge', name);
    const img = out[name], d = img.data, normals = isNormals(name);
    for (let y = 0; y < Ht; y++) for (let x = 0; x < W; x++) {
      const px = x + 0.5 - mid[0], py = y + 0.5 - mid[1];
      const s = px * u[0] + py * u[1], dd = px * nrm[0] + py * nrm[1];
      if (Math.abs(s) > TAB_S || dd < TAB_D_MIN || dd > TAB_D_MAX) continue;
      const sx = mid3[0] + s * u3[0] + dd * n3[0], sy = mid3[1] + s * u3[1] + dd * n3[1];
      let [r, g, b, a] = bilinear(src, sx, sy);
      if (normals && a > 8) {
        const nx = r / 127.5 - 1, ny = g / 127.5 - 1;
        r = (nx * cosT - ny * sinT + 1) * 127.5;
        g = (nx * sinT + ny * cosT + 1) * 127.5;
      }
      const fade = Math.min(1, (TAB_S - Math.abs(s)) / TAB_FEATHER);
      const t = (a / 255) * fade, inv = 1 - t;
      const i4 = (y * W + x) * 4;
      d[i4] = Math.round(r * t + d[i4] * inv);
      d[i4 + 1] = Math.round(g * t + d[i4 + 1] * inv);
      d[i4 + 2] = Math.round(b * t + d[i4 + 2] * inv);
      d[i4 + 3] = Math.max(Math.round(a * fade), d[i4 + 3]);
    }
  }
}

// Clip a tiled set at the hypotenuse of a 1xH wedge and lay the vanilla chord
// bar along it. Damage levels use the profile of the matching vanilla level.
function clipAndChord(out, H) {
  const W = TILE, Ht = H * TILE, diag = Math.hypot(W, Ht);
  // Normals near the chord point perpendicular to it; re-laying the 1x3 bar on
  // a steeper slope rotates the content, so the encoded vectors rotate too.
  const ref3 = ref('structure_1x3_wedge', 'structure.png');
  const dTheta = Math.atan2(Ht, W) - Math.atan2(ref3.height, ref3.width);
  const cosT = Math.cos(dTheta), sinT = Math.sin(dTheta);
  for (const name of NAMES) {
    const img = out[name], d = img.data, normals = isNormals(name);
    const prof = chordProfile(name);
    for (let y = 0; y < Ht; y++) for (let x = 0; x < W; x++) {
      const dist = (Ht * (x + 0.5) + W * (y + 0.5) - W * Ht) / diag;
      const i4 = (y * W + x) * 4;
      if (dist >= BAR_END) continue;                       // interior lattice untouched
      if (dist < PROFILE_MIN) { d.fill(0, i4, i4 + 4); continue; }  // outside the triangle
      let [r, g, b, a] = sampleProfile(prof, dist);
      if (normals && a > 8) {
        const nx = r / 127.5 - 1, ny = g / 127.5 - 1;
        r = (nx * cosT - ny * sinT + 1) * 127.5;
        g = (nx * sinT + ny * cosT + 1) * 127.5;
      }
      // Composite the bar over the clipped lattice (the bar is opaque along its
      // body; the blend only matters at its feathered rim).
      const t = a / 255, inv = 1 - t;
      d[i4] = Math.round(r * t + d[i4] * inv);
      d[i4 + 1] = Math.round(g * t + d[i4 + 1] * inv);
      d[i4 + 2] = Math.round(b * t + d[i4 + 2] * inv);
      d[i4 + 3] = Math.max(Math.round(a), Math.round(d[i4 + 3] * (dist >= 0 ? 1 : 0)));
    }
  }
  midpointTab(out, H, cosT, sinT);
}

// Returns { 'structure.png': img, ... } for a structure part of W x H tiles.
export function structureSet(W, H, isWedge, seed) {
  const out = {};
  if (isWedge && H <= 3) {
    const dir = H === 1 ? 'structure_wedge' : `structure_1x${H}_wedge`;
    for (const name of NAMES) out[name] = clone(ref(dir, name));
  } else {
    const rng = mulberry32((seed ^ Math.imul(W, 73856093) ^ Math.imul(H, 19349663) ^ (isWedge ? 0x5bd1e995 : 0)) | 0);
    const rot = Array.from({ length: W * H }, () => Math.floor(rng() * 4));
    for (const name of NAMES) {
      const tile = ref('structure', name);
      const img = newImage(W * TILE, H * TILE);
      for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
        blit(img, rotTile(tile, rot[ty * W + tx], isNormals(name)), tx * TILE, ty * TILE);
      }
      out[name] = img;
    }
    if (isWedge) clipAndChord(out, H);
  }
  out['blueprints.png'] = blueprintsFrom(out['structure.png']);
  return out;
}
