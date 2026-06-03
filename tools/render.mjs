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
    // `litedge` is used only as a HEIGHT ridge at the plate overlap, never baked
    // into albedo — so the bevel is lit by the depth normal map and stays correct
    // when the part is rotated.
    const litedge = gauss(pfr - 0.90, 0.06);
    if (pfr < gw) {
      if (tube > 0.15) {
        const cu = tube * inside;   // tube cross-section is radially symmetric
        return { h: tube * 1.0 * inside - 0.3, r: 18 + cu * 40, g: 16 + cu * 16, b: 12, rg: 165 + cu * 30, warm: cu * 26 };
      }
      const dv = 14 + bev * P.bevelBright * 0.3;
      return { h: -0.6, r: dv, g: dv, b: dv, rg: 150, warm: 0 };
    }
    const pv = vBase;   // flat plate albedo; relief lives in the height field
    return { h: 1.3 * inside + litedge * 0.7, r: pv, g: pv, b: pv, rg: 210, warm: 0 };
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
      const mo = gf * 8;
      // Symmetric dome shading: brightest at the crown (nz=1), dimming radially
      // to the rim. No fixed light direction — the sphere's 3D look is carried by
      // the height field (h = nz * height) and relit by the normal map at runtime.
      let bv = 13 + 9 + nz * 62 + mo;
      const edgeShade = smooth(Math.min(1, (R - best) / 3));
      bv *= 0.5 + 0.5 * edgeShade;
      r = g = b = bv;
      h = nz * P.ballNormalHeight;
      rg = 170 + nz * 55;
    }
    return { h, r, g, b, rg, warm: 0 };
  }
  if (P.material === 'tristeel') {
    // Tri-Steel: hardened blue-cyan plate with a recessed recursive-triangle
    // emblem (three raised corner faces around a sunken central triangle). One
    // emblem per 64px block, so it tiles natively. All relief is in the height
    // field; shading is symmetric (survives rotation).
    const teal = (v) => ({ r: v * 0.80, g: v * 1.00, b: v * 1.13 });
    const triSize = P.triSize ?? 0.74, triGroove = P.triGroove ?? 1.0;
    const cx = (Math.floor(x / TILE) + 0.5) * TILE, cy = (Math.floor(y / TILE) + 0.5) * TILE;
    const px = x - cx, py = y - cy;
    const Rad = TILE * 0.5 * triSize, s3 = 0.8660254;
    const v0x = 0, v0y = -Rad, v1x = -Rad * s3, v1y = Rad * 0.5, v2x = Rad * s3, v2y = Rad * 0.5;
    const m0x = (v1x + v2x) / 2, m0y = (v1y + v2y) / 2, m1x = (v0x + v2x) / 2, m1y = (v0y + v2y) / 2, m2x = (v0x + v1x) / 2, m2y = (v0y + v1y) / 2;
    const segD = (ax, ay, bx, by) => {
      const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay;
      const tt = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      return Math.hypot(px - (ax + ex * tt), py - (ay + ey * tt));
    };
    const sideF = (ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const inTri = (ax, ay, bx, by, ccx, ccy) => {
      const d1 = sideF(ax, ay, bx, by), d2 = sideF(bx, by, ccx, ccy), d3 = sideF(ccx, ccy, ax, ay);
      return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
    };
    const inBig = inTri(v0x, v0y, v1x, v1y, v2x, v2y);
    const inCentre = inTri(m0x, m0y, m1x, m1y, m2x, m2y);
    const dGroove = Math.min(
      segD(v0x, v0y, v1x, v1y), segD(v1x, v1y, v2x, v2y), segD(v2x, v2y, v0x, v0y),
      segD(m0x, m0y, m1x, m1y), segD(m1x, m1y, m2x, m2y), segD(m2x, m2y, m0x, m0y)
    );
    const depth = triGroove, grooveW = 2.0, chamfer = 2.4;
    let v = vBase, h = gn * 0.55 + gf * 0.3, rg = 212 + bev * 14 + grainV * 0.6;
    if (inBig) { v += inCentre ? -7 : 5 * inside; h += (inCentre ? -1.0 : 1.0) * 0.9 * inside; rg += inCentre ? -16 : 10; }
    if (dGroove < grooveW) {
      const cut = 1 - smooth(dGroove / grooveW);
      h -= cut * 1.4 * depth * inside; v -= cut * 16 * depth * inside; rg -= cut * 34 * depth;
    } else if (dGroove < grooveW + chamfer) {
      const ct = smooth((dGroove - grooveW) / chamfer);
      h += 0.5 * ct * inside; v += 3 * ct * inside;
    }
    const tc = teal(v);
    return { h, r: tc.r, g: tc.g, b: tc.b, rg, warm: 0 };
  }
  if (P.material === 'foam_tristeel') {
    // Composite Metal Foam: open-cell metal foam with its cavities cast full of
    // tri-steel — dark steel struts hold bright saturated teal slugs. Relief is in
    // the height field; shading is symmetric (survives rotation).
    const teal = (v) => ({ r: v * 0.66, g: v * 1.00, b: v * 1.32 });
    const scale = P.poreScale ?? 7, nx = x / scale, ny = y / scale;
    const ix = Math.floor(nx), iy = Math.floor(ny);
    let d1 = 1e9, d2 = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const hx = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
      const hy = Math.sin(cx * 37.103 + cy * 53.641) * 43758.5453;
      const jx = hx - Math.floor(hx), jy = hy - Math.floor(hy);
      const dist = Math.hypot(nx - (cx + jx + gn * 0.25), ny - (cy + jy + gf * 0.25));
      if (dist < d1) { d2 = d1; d1 = dist; } else if (dist < d2) { d2 = dist; }
    }
    const cellWall = d2 - d1;
    let h = gn * 0.4 + gf * 0.2, v = vBase, rg = 200 + bev * 10, tealMix = 0;
    if (inside > 0.15) {
      const li = Math.min(1.0, (inside - 0.15) / 0.25);
      const poreLimit = (P.porosity ?? 0.5) * 0.55 + gf * 0.05;
      if (d1 < poreLimit) {
        const t = smooth(d1 / poreLimit), dome = 1 - t * t, seam = smooth(Math.max(0, (t - 0.70) / 0.30));
        h += (-(P.fillDepth ?? 0.6) * 1.6 + dome * 0.8) * li;
        const fillV = vBase * (0.95 + 0.75 * dome) + 30 * dome - seam * 14;
        v = v * (1 - li) + fillV * li;
        rg = rg * (1 - li) + (150 + dome * 60 - seam * 34) * li;
        tealMix = li;
      } else if (cellWall < 0.22) {
        const bump = (1 - smooth(cellWall / 0.22)) * 0.5 * li;
        h += bump; v += bump * 22; rg += bump * 6;
      }
    }
    let r = v, g = v, b = v;
    if (tealMix > 0) {
      const tc = teal(v);
      r = v * (1 - tealMix) + tc.r * tealMix; g = v * (1 - tealMix) + tc.g * tealMix; b = v * (1 - tealMix) + tc.b * tealMix;
    }
    return { h, r, g, b, rg, warm: 0 };
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
    // Gold Plating: hand-beaten gold — an offset lattice of shallow concave
    // dimples. The bowls live in the height field (symmetric), so the hammer
    // marks read from the normal map and stay correct under rotation. Colour is a
    // warm gold tint of the luminance.
    const hammerScale = P.hammerScale ?? 11, hammerDepth = P.hammerDepth ?? 1.0;
    const colW = fitPeriod(hammerScale), rowH = fitPeriod(hammerScale * 0.866);
    const r0 = Math.round(y / rowH);
    let d0 = 1e9;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const cy = r * rowH, off = (r & 1) ? colW * 0.5 : 0, c0 = Math.round((x - off) / colW);
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const cx = c * colW + off, d = Math.hypot(x - cx, y - cy);
        if (d < d0) d0 = d;
      }
    }
    const R = colW * 0.5;
    const t = Math.min(1, d0 / R);                 // 0 at dimple centre, 1 at the rim
    const bowl = 1 - t * t;                          // concave floor
    const rim = smooth(Math.max(0, (t - 0.78) / 0.22)); // proud ridge where bowls meet
    const depth = hammerDepth;
    const h = (-bowl * 1.3 * depth + rim * 0.6 * depth) * inside + gn * 0.45 + gf * 0.25;
    const v = vBase - bowl * 6 * depth * inside + rim * 10 * depth * inside + (gn * 0.5 + gf * 0.35) * 4;
    const r = v * 1.08 + 40, g = v * 0.82 + 16, b = v * 0.30 + 2;
    const rg = 206 + bev * 16 + rim * 14 * depth - bowl * 8 * depth + grainV * 0.5;
    const warm = 30 + rim * 6 - bowl * 4;            // strong warm cast, survives ship colour
    return { h, r, g, b, rg, warm };
  }
  if (P.material === 'uranium') {
    // Depleted Uranium: hex plate geometry with green-olive tint
    const S = P.hexSize || 8;
    const colW = fitPeriod(S * 1.7320508), rowH = fitPeriod(S * 3.0) / 2;
    const r0 = Math.round(y / rowH);
    const cells = [];
    for (let rr = r0 - 1; rr <= r0 + 1; rr++) {
      const cy = rr * rowH, off = (rr & 1) ? colW * 0.5 : 0, c0 = Math.round((x - off) / colW);
      for (let cc = c0 - 1; cc <= c0 + 1; cc++) cells.push([cc * colW + off, cy]);
    }
    let d0 = 1e9, cx0 = 0, cy0 = 0;
    for (const [cx, cy] of cells) { const d = Math.hypot(x - cx, y - cy); if (d < d0) { d0 = d; cx0 = cx; cy0 = cy; } }
    // All hex shading below is symmetric (depth-based AO + radial dome); the
    // groove/chamfer/face relief lives in the height field so lighting comes
    // from the depth normal map and survives rotation.
    let insideDist = 1e9;
    for (const [cx, cy] of cells) {
      const dx = cx - cx0, dy = cy - cy0, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const dn = Math.hypot(x - cx, y - cy), ed = (dn * dn - d0 * d0) / (2 * len);
      if (ed < insideDist) insideDist = ed;
    }
    const lx2 = x - cx0, ly2 = y - cy0, dc = Math.hypot(lx2, ly2);
    const grainV2 = gn * P.grain + gf * P.grain * 0.4;
    const vBase2 = P.baseBright + bev * P.bevelBright + grainV2;
    const depth = P.hexGroove || 0.8;
    const grooveW2 = Math.max(1.0, S * 0.12), chamfer = Math.max(1.4, S * 0.24), faceStart = grooveW2 + chamfer;
    const apothem = colW * 0.5;
    const tint = (v) => ({ r: v * 0.80, g: v * 1.12, b: v * 0.70 });
    if (insideDist < grooveW2) {
      const t = Math.max(0, insideDist / grooveW2), gv = vBase2 * 0.40 - depth * 8 * (1 - smooth(t));
      const tc = tint(gv); return { h: -depth * 1.3 * (1 - smooth(t)), r: tc.r, g: tc.g, b: tc.b, rg: 160 + t * 30, warm: 0 };
    }
    if (insideDist < faceStart) {
      const t = smooth((insideDist - grooveW2) / chamfer);   // symmetric: dark at groove → base at face
      const lum = vBase2 * (0.55 + 0.45 * t);
      const tc = tint(lum); return { h: 0.7 * t, r: tc.r, g: tc.g, b: tc.b, rg: 200 + t * 12, warm: 0 };
    }
    const studR = Math.max(1.6, S * 0.17);
    if (dc < studR) {
      const nx = lx2 / studR, ny = ly2 / studR, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lum = vBase2 * 0.72 + nz * 50;   // symmetric dome (crown brightest)
      const tc = tint(lum); return { h: (1.2 + 1.0 * nz) * inside, r: tc.r, g: tc.g, b: tc.b, rg: 205 + nz * 38, warm: 0 };
    }
    const fr = Math.min(1, (insideDist - faceStart) / Math.max(1, apothem - faceStart));
    const dome = 1 - (1 - fr) * (1 - fr);
    const fv = vBase2 + 4 * inside + grainV2 * 0.3;
    const fh = 0.7 + dome * 0.5 + (gn * 0.5 + gf * 0.3);
    const tc = tint(fv); return { h: fh * inside + 0.2, r: tc.r, g: tc.g, b: tc.b, rg: 214 + bev * 10 + grainV2 * 0.6, warm: 0 };
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
    let nx = gx * s, ny = gy * s * flip, nz = 1.0;
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
