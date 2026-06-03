// Procedural armor-texture renderer, ported from the HULL FOUNDRY HTML tool.
// Pure pixel math on typed arrays — no DOM. ImageData is replaced by a plain
// { width, height, data: Uint8ClampedArray } object.
//
// DAMAGE-SCALING FIX vs. the original tool:
//   The HTML used a fixed `craters` count regardless of block size, so a 4x1
//   block (256x64) got the same number of holes as a 1x1 (64x64) and looked
//   under-damaged. Here `cratersPerTile` is multiplied by the block's tile area
//   (and halved for wedges), so damage *density* is constant across all sizes
//   while individual crater size stays absolute (a blast hole is a physical
//   size, not relative to the plate).

export const TILE = 64;

export const FILES = [
  ['armor.png', 'armor'],
  ['armor_33.png', 'armor33'],
  ['armor_66.png', 'armor66'],
  ['roof.png', 'roof'],
  ['roof_33.png', 'roof33'],
  ['roof_66.png', 'roof66'],
  ['roof_normals.png', 'rnorm'],
  ['roof_normals_33.png', 'rnorm33'],
  ['roof_normals_66.png', 'rnorm66'],
  ['blueprints.png', 'blue'],
  ['icon.png', 'icon'],
];

function newImage(W, H) { return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }; }

function smooth(t) { return t * t * (3 - 2 * t); }
function cellVal(ix, iy, seed) { let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h & 0xffff) / 0xffff; }
function valueNoise(x, y, period, seed) {
  x /= period; y /= period; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const v00 = cellVal(x0, y0, seed), v10 = cellVal(x0 + 1, y0, seed), v01 = cellVal(x0, y0 + 1, seed), v11 = cellVal(x0 + 1, y0 + 1, seed);
  const sx = smooth(fx), sy = smooth(fy); return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function makeFBM(seed, oc, bp) {
  const L = []; let amp = 0.5, tot = 0; for (let o = 0; o < oc; o++) { L.push([seed + o * 101, bp / Math.pow(2, o), amp]); tot += amp; amp *= 0.5; }
  return (x, y) => { let n = 0; for (const [s, p, a] of L) n += valueNoise(x, y, p, s) * a; return n / tot; };
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(d, w) { return Math.exp(-(d * d) / (2 * w * w)); }

// Snap `desired` to the nearest period that divides TILE (64) evenly.
// Matches fitPeriod() in hull_foundry.html (seamless is always on for the generator).
function fitPeriod(desired) { return TILE / Math.max(1, Math.round(TILE / desired)); }

function surface(P, W, H, x, y, bev, gn, gf, inside) {
  const grainV = gn * P.grain + gf * P.grain * 0.4;
  const vBase = P.baseBright + bev * P.bevelBright + grainV;
  if (P.material === 'nera') {
    // Synced with hull_foundry.html v2: fitPeriod-based copper unit
    const unit = fitPeriod(P.weavePeriod * 2);
    const per = unit / 2;
    const p = x - y, c = x + y;
    let pfr = p / per; pfr -= Math.floor(pfr);
    let cuf = c / unit; cuf -= Math.floor(cuf);
    const gw = 0.16;
    const td = (cuf - 0.5) / 0.15; const tube = Math.abs(td) < 1 ? Math.sqrt(1 - td * td) : 0;
    const litedge = gauss(pfr - 0.90, 0.06);
    if (pfr < gw) {
      if (tube > 0.15) {
        const cu = tube * inside;
        return { h: tube * 1.0 * inside - 0.3, r: 18 + cu * 40, g: 16 + cu * 16, b: 12, rg: 165 + cu * 30, warm: cu * 26 };
      }
      const dv = 14 + bev * P.bevelBright * 0.3;
      return { h: -0.6, r: dv, g: dv, b: dv, rg: 150, warm: 0 };
    }
    const shade = (pfr - gw) / (1 - gw);
    const pv = vBase + litedge * 36 * inside + (shade - 0.5) * 6;
    return { h: 1.3 * inside + litedge * 0.5, r: pv, g: pv, b: pv, rg: 210 + litedge * 20 * inside, warm: 0 };
  }
  if (P.material === 'compc') {
    let r = vBase, g = vBase, b = vBase, h = gn * 0.8 + gf * 0.4, rg = 211 + bev * 14 + grainV * 0.66;
    const S = P.ballSpacing, R = S * 0.5 * P.ballFill;
    const Sy = S * 0.8660254;
    const edgeLimit = R * 0.5 + 2;
    const W_active = W - 1 - 2 * edgeLimit;
    const H_active = H - 1 - 2 * edgeLimit;
    const Nx = Math.max(1, Math.floor(W_active / S) + 1);
    const Ny = Math.max(1, Math.floor(H_active / Sy) + 1);
    const x_start = W / 2 - ((Nx - 1) * S) / 2;
    const y_start = H / 2 - ((Ny - 1) * Sy) / 2;
    const approx_row = Math.round((y - y_start) / Sy);
    let best = 1e9, bcx = 0, bcy = 0;
    for (let rr = approx_row - 1; rr <= approx_row + 1; rr++) {
      if (rr < 0 || rr >= Ny) continue;
      const cyc = y_start + rr * Sy;
      const off = (rr & 1) * S * 0.5;
      const approx_col = Math.round((x - x_start - off) / S);
      const col_count = (rr & 1) ? Nx - 1 : Nx;
      for (let cc = approx_col - 1; cc <= approx_col + 1; cc++) {
        if (cc < 0 || cc >= col_count) continue;
        const cxc = x_start + off + cc * S;
        const d = Math.hypot(x - cxc, y - cyc);
        if (d < best) { best = d; bcx = cxc; bcy = cyc; }
      }
    }
    const diagLen = Math.hypot(W, H);
    const getCde = (cx, cy) => {
      if (P.wedge) { const dHyp = (H * cx + W * cy - W * H) / diagLen; return Math.min(W - 1 - cx, H - 1 - cy, dHyp); }
      return Math.min(cx, cy, W - 1 - cx, H - 1 - cy);
    };
    const cde = getCde(bcx, bcy);
    if (best < R && cde > R * 0.5 + 2) {
      const nx = (x - bcx) / R, ny = (y - bcy) / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const Lx = -0.4533, Ly = -0.4533, Lz = 0.7686;
      const Hx = -0.3019, Hy = -0.3019, Hz = 0.9043;
      const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const spec = Math.pow(Math.max(0, nx * Hx + ny * Hy + nz * Hz), 22);
      const mo = gf * 8;
      let bv = 13 + 9 + diff * 42 + spec * 120 + mo;
      const edgeShade = smooth(Math.min(1, (R - best) / 3));
      bv *= 0.5 + 0.5 * edgeShade;
      r = g = b = bv;
      h = nz * P.ballNormalHeight;
      rg = 170 + diff * 40 + spec * 60;
    }
    return { h, r, g, b, rg, warm: 0 };
  }
  if (P.material === 'hardened') {
    // Tri-Steel: heavy riveted steel plate
    const g = fitPeriod(P.rivetGap || 14);
    const rcx = Math.round(x / g) * g, rcy = Math.round(y / g) * g;
    const d = Math.hypot(x - rcx, y - rcy), rad = 2.8;
    let r = vBase, gr = vBase, b = vBase, h = gn * 0.6 + gf * 0.3;
    let rg = 215 + bev * 14;
    if (d < rad) {
      const t = smooth(1 - d / rad), v = vBase + t * 55;
      r = gr = b = v; h += t * 1.8 * inside; rg = 228 + t * 18;
    }
    return { h, r, g: gr, b, rg, warm: 0 };
  }
  if (P.material === 'metalfoam_irregular') {
    // Metal Foam: Worley cellular noise pore matrix
    let h = gn * 0.4 + gf * 0.2, r = vBase, g = vBase, b = vBase, rg = 205 + bev * 10;
    const scale = P.poreScale || 7, nx = x / scale, ny = y / scale;
    const ix = Math.floor(nx), iy = Math.floor(ny);
    let minDist1 = 1e9, minDist2 = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const hx = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
      const hy = Math.sin(cx * 37.103 + cy * 53.641) * 43758.5453;
      const jx = hx - Math.floor(hx), jy = hy - Math.floor(hy);
      const dist = Math.hypot(nx - (cx + jx + gn * 0.25), ny - (cy + jy + gf * 0.25));
      if (dist < minDist1) { minDist2 = minDist1; minDist1 = dist; } else if (dist < minDist2) { minDist2 = dist; }
    }
    const cellWall = minDist2 - minDist1;
    if (inside > 0.15) {
      const li = Math.min(1.0, (inside - 0.15) / 0.25);
      const poreLimit = (P.porosity || 0.5) * 0.55 + gf * 0.05;
      if (minDist1 < poreLimit) {
        const t = smooth(minDist1 / poreLimit), df = 1.0 - t;
        h -= df * 2.8 * li;
        const tb = vBase * (0.15 + 0.85 * t);
        r = r * (1 - li) + tb * li; g = g * (1 - li) + tb * li; b = b * (1 - li) + tb * li;
        rg = rg * (1 - li) + (135 + t * 45) * li;
      } else if (cellWall < 0.22) {
        const bump = (1 - smooth(cellWall / 0.22)) * 0.5 * li;
        h += bump; r += bump * 20; g += bump * 20; b += bump * 20;
      }
    }
    return { h, r, g, b, rg, warm: 0 };
  }
  if (P.material === 'gold') {
    // Gold Shielding: dynamically scaled riveted bullion ingot grid
    let r = vBase * 1.35, g = vBase * 1.10, b = vBase * 0.60;
    let h = gn * 0.3 + gf * 0.15, rg = 230 + bev * 15, warm = 55 * inside;
    const divX = Math.max(1, Math.round(W / (P.ingotTargetWidth || 32)));
    const divY = Math.max(1, Math.round(H / (P.ingotTargetHeight || 32)));
    const subX = W / divX, subY = H / divY;
    const lx = x % subX, ly = y % subY;
    const ingotEdge = Math.min(Math.min(lx, subX - lx), Math.min(ly, subY - ly));
    const grooveW = 2.5;
    if (inside > 0.1) {
      const li = Math.min(1.0, (inside - 0.1) / 0.15);
      if (ingotEdge < grooveW) {
        const t = smooth(ingotEdge / grooveW), sh = 0.4 + 0.6 * t;
        h -= (1 - t) * 1.8 * li; r *= sh; g *= sh; b *= sh;
        rg = rg * (1 - li) + (120 + t * 40) * li;
      } else {
        h += smooth(Math.min(1.0, (ingotEdge - grooveW) / 4.0)) * 0.6 * li;
        const flash = gauss(ingotEdge - subX * 0.2, 6.0) * 15 * li;
        r += flash * 1.2; g += flash;
        const bp = Math.min(8, Math.max(4, Math.min(subX, subY) * 0.2));
        const rdx = Math.min(lx - bp, subX - bp - lx), rdy = Math.min(ly - bp, subY - bp - ly);
        if (rdx >= 0 && rdy >= 0) {
          const cd = Math.hypot(rdx, rdy), rrad = 2.2;
          if (cd < rrad) {
            const rt = smooth(1 - cd / rrad);
            h += rt * 1.4 * li; r += rt * 45 * li; g += rt * 35 * li; b += rt * 15 * li;
            rg = rg * (1 - rt * li) + 250 * rt * li;
          }
        }
      }
    }
    return { h, r, g, b, rg, warm };
  }
  if (P.material === 'uranium') {
    // Depleted Uranium: monolithic chevron-etched heavy plate
    let r = vBase * 0.75, g = vBase * 0.85, b = vBase * 0.70;
    let h = gn * 0.5 + gf * 0.3, rg = 190 + bev * 8, warm = -45 * inside;
    if (inside > 0.05) {
      const ci = smooth(inside);
      const pv = Math.floor((x + y) / (P.chevronWidth || 16)) % 2;
      if (pv === 0) {
        const cf = 0.45 * ci;
        h -= 0.65 * ci; r -= 24 * cf; g -= 20 * cf; b -= 26 * cf; rg -= 45 * ci;
      } else {
        const hf = 0.25 * ci;
        h += 0.2 * ci; r += 12 * hf; g += 15 * hf; b += 10 * hf; rg += 15 * ci;
      }
    }
    return { h, r, g, b, rg, warm };
  }
  const h = gn * 0.8 + gf * 0.4;
  const rg = 211 + bev * 14 + grainV * 0.66;
  return { h, r: vBase, g: vBase, b: vBase, rg, warm: 0 };
}

function edgeDistAt(P, W, H, diagLen, x, y) {
  if (P.wedge) { const dHyp = (H * (x + 0.5) + W * (y + 0.5) - W * H) / diagLen; return Math.min(W - 1 - x, H - 1 - y, dHyp); }
  return Math.min(x, y, W - 1 - x, H - 1 - y);
}

function buildFields(P) {
  const W = P.tilesX * TILE, H = P.tilesY * TILE, N = W * H;
  const fbm = makeFBM(P.seed, 4, P.grainScale), fbmFine = makeFBM(P.seed + 777, 2, 3);
  const bw = P.bevelWidth, diagLen = Math.hypot(W, H);
  const solid = new Uint8Array(N), edge = new Float32Array(N), height = new Float32Array(N);
  const aR = new Float32Array(N), aG = new Float32Array(N), aB = new Float32Array(N), roofG = new Float32Array(N), warm = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let de, isSolid = 1;
    if (P.wedge) { const dHyp = (H * (x + 0.5) + W * (y + 0.5) - W * H) / diagLen; isSolid = dHyp >= 0 ? 1 : 0; de = Math.min(W - 1 - x, H - 1 - y, dHyp); }
    else de = Math.min(x, y, W - 1 - x, H - 1 - y);
    solid[i] = isSolid; edge[i] = de;
    let bev = Math.exp(-Math.pow(de - bw, 2) / (2 * 0.65 * bw * bw)); if (de < 1) bev -= 0.5;
    const gn = (fbm(x, y) - 0.5) * 2, gf = (fbmFine(x, y) - 0.5) * 2;
    const inside = Math.max(0, Math.min(1, (de - 2) / 1.0));
    const s = surface(P, W, H, x, y, bev, gn, gf, inside);
    height[i] = s.h; aR[i] = s.r; aG[i] = s.g; aB[i] = s.b; roofG[i] = s.rg; warm[i] = s.warm;
  }
  return { W, H, N, solid, edge, height, aR, aG, aB, roofG, warm, diagLen };
}

// Crater count scales with block tile area so damage density is size-independent.
function craterCount(P) {
  const tiles = P.tilesX * P.tilesY * (P.wedge ? 0.5 : 1);
  return Math.max(2, Math.round(P.cratersPerTile * tiles));
}

function buildDamage(P, F, level) {
  const { W, H, N, diagLen } = F;
  const rng = mulberry32(P.seed ^ 0x9e37);
  const intens = level === 1 ? P.dmg33 : P.dmg66;
  const keep = P.edgeMargin;
  const nCraters = craterCount(P);
  const all = [];
  for (let k = 0; k < nCraters; k++) {
    const r = 6 + rng() * 9;
    let cx, cy, ok = false;
    for (let tries = 0; tries < 16; tries++) {
      cx = rng() * W; cy = rng() * H;
      const need = keep + r * intens * P.holeSize * 0.7;
      if (edgeDistAt(P, W, H, diagLen, cx, cy) >= need) { ok = true; break; }
    }
    if (!ok) { cx = P.wedge ? W * 0.62 : W * 0.5; cy = P.wedge ? H * 0.62 : H * 0.5; }
    all.push({ x: cx, y: cy, r, depth: 8 + rng() * 10 });
  }
  const used = all.slice(0, level === 1 ? Math.max(2, Math.round(nCraters * 0.6)) : nCraters);
  const chaos = makeFBM(P.seed ^ 0x55aa, 3, 2.6);
  const hole = new Uint8Array(N), char = new Float32Array(N), dmgHeight = Float32Array.from(F.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let dent = 0, rim = 0, crush = 0, isHole = 0;
    for (const c of used) {
      const rr = c.r * intens, d = Math.hypot(x - c.x, y - c.y);
      if (d < rr * 1.6) {
        const t = Math.max(0, 1 - d / rr); dent += Math.pow(t, 1.3) * c.depth;
        if (d > rr * 0.7 && d < rr * 1.35) rim += (1 - Math.abs(d - rr) / (rr * 0.35)) * c.depth * 0.4;
        crush += t; char[i] += t; if (d < rr * P.holeSize) isHole = 1;
      }
    }
    if (F.edge[i] < keep) isHole = 0;
    hole[i] = isHole;
    if (crush > 0) { const ch = (chaos(x, y) - 0.5) * 2; dmgHeight[i] += -dent + rim + ch * crush * 2.4 * intens; }
    char[i] = Math.min(1, char[i]) * Math.max(0, Math.min(1, (F.edge[i] - 2) / keep));
  }
  return { hole, char, dmgHeight, intens };
}

function normalsFromHeight(P, F, height, hole) {
  // `height` is the height field the normals are derived from. In renderSet the
  // base surface is scaled down (surfaceNormalScale) so the weave / spheres /
  // grain read as *subtle* normals like vanilla's rivets rather than tall 3D
  // relief, while damage relief is kept at full strength. The edge fade flattens
  // the bevel near the perimeter so plates don't get cyan/magenta walls.
  const { W, H } = F, out = newImage(W, H), d = out.data, s = P.normalStrength, flip = P.normalFlipY ? -1 : 1;
  const fade = P.normalEdgeFade || 0;
  const at = (x, y) => height[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, i4 = i * 4;
    if (!F.solid[i] || (hole && hole[i])) { d[i4] = 128; d[i4 + 1] = 128; d[i4 + 2] = 255; d[i4 + 3] = 0; continue; }
    const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5, gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
    let nx = -gx * s, ny = -gy * s * flip, nz = 1.0;
    if (fade > 0) { const ef = smooth(Math.min(1, F.edge[i] / fade)); nx *= ef; ny *= ef; }
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    d[i4] = Math.round((nx * 0.5 + 0.5) * 255); d[i4 + 1] = Math.round((ny * 0.5 + 0.5) * 255); d[i4 + 2] = Math.round((nz * 0.5 + 0.5) * 255); d[i4 + 3] = 255;
  }
  return out;
}

function clamp8(v, level) { return Math.max(level > 0 ? 0 : 6, Math.min(level > 0 ? 255 : 190, Math.round(v))); }

function renderArmor(P, F, level) {
  const { W, H } = F, out = newImage(W, H), d = out.data; let dmg = null; if (level > 0) dmg = buildDamage(P, F, level);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, i4 = i * 4;
    if (!F.solid[i]) { d[i4 + 3] = 0; continue; }
    if (level > 0 && dmg.hole[i]) { d[i4 + 3] = 0; continue; }
    let r = F.aR[i], g = F.aG[i], b = F.aB[i];
    if (level > 0) { const c = dmg.char[i], f = 1 - c * 0.72; r = r * f - c * 14; g = g * f - c * 14; b = b * f - c * 14; if (P.scorch) b += Math.min(42, c * 9); }
    d[i4] = clamp8(r, level); d[i4 + 1] = clamp8(g, level); d[i4 + 2] = clamp8(Math.min(255, b), level); d[i4 + 3] = 255;
  }
  return { img: out, dmg };
}

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

function renderRoof(P, F, level, dmg) {
  const { W, H } = F, out = newImage(W, H), d = out.data, tint = hexToRgb(P.tint), useTint = P.applyTint;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, i4 = i * 4;
    if (!F.solid[i]) { d[i4 + 3] = 0; continue; }
    if (level > 0 && dmg.hole[i]) { d[i4 + 3] = 0; continue; }
    let g = F.roofG[i]; if (level > 0) g -= dmg.char[i] * 150 * dmg.intens; g = Math.max(0, Math.min(250, g));
    if (useTint) { const f = g / 255; d[i4] = Math.round(tint.r * f); d[i4 + 1] = Math.round(tint.g * f); d[i4 + 2] = Math.round(tint.b * f); }
    else { const rb = g * 0.062, w = F.warm[i]; d[i4] = Math.max(0, Math.min(255, Math.round(rb + w))); d[i4 + 1] = Math.round(g); d[i4 + 2] = Math.max(0, Math.min(255, Math.round(rb - w * 0.4))); }
    d[i4 + 3] = 255;
  }
  return out;
}

function renderBlue(P, F) {
  const { W, H } = F, out = newImage(W, H), d = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, i4 = i * 4;
    if (!F.solid[i]) { d[i4 + 3] = 0; continue; }
    let b = 197 + Math.max(0, Math.min(51, F.roofG[i] - 199)) / 51 * 24; b = Math.max(197, Math.min(221, b));
    d[i4] = 0; d[i4 + 1] = 0; d[i4 + 2] = Math.round(b); d[i4 + 3] = 255;
  }
  return out;
}

// Returns { 'armor.png': imgData, ... } for all 11 files.
export function renderSet(P) {
  const F = buildFields(P);
  const a0 = renderArmor(P, F, 0), a1 = renderArmor(P, F, 1), a2 = renderArmor(P, F, 2);
  const r0 = renderRoof(P, F, 0, null), r1 = renderRoof(P, F, 1, a1.dmg), r2 = renderRoof(P, F, 2, a2.dmg);
  // Normal-map height = (subtle) base surface + full-strength damage relief.
  // Scaling only the base keeps weave/spheres/grain gentle like vanilla rivets
  // while leaving crater dents at full depth.
  const bs = P.surfaceNormalScale;
  const nh = (dmg) => { const a = new Float32Array(F.N); for (let i = 0; i < F.N; i++) a[i] = bs * F.height[i] + (dmg ? dmg.dmgHeight[i] - F.height[i] : 0); return a; };
  const n0 = normalsFromHeight(P, F, nh(null), null), n1 = normalsFromHeight(P, F, nh(a1.dmg), a1.dmg.hole), n2 = normalsFromHeight(P, F, nh(a2.dmg), a2.dmg.hole);
  const blue = renderBlue(P, F);
  const map = { armor: a0.img, armor33: a1.img, armor66: a2.img, roof: r0, roof33: r1, roof66: r2, rnorm: n0, rnorm33: n1, rnorm66: n2, blue: blue, icon: a0.img };
  const out = {};
  for (const [name, key] of FILES) out[name] = map[key];
  return out;
}
