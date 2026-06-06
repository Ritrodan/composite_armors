import { decodePNG } from './decode.mjs';

// Extract profile arrays at d_out = -dHyp (outward from boundary), step 0.5, 26 entries (0..12.5px)
function extractProfile(dir, file, channel) {
  const img = decodePNG(dir+'/'+file);
  const { width: W, height: H, data: d } = img;
  const diag = Math.hypot(W, H);
  const N = 26; // 0..12.5 in steps of 0.5
  const sum = new Float64Array(N), cnt = new Float64Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const straight = Math.min(W-1-x, H-1-y);
    if (straight < 10 || x < 6 || y < 6) continue;
    const dh = (H*(x+0.5) + W*(y+0.5) - W*H) / diag;
    const d_out = -dh; // positive = outside
    if (d_out < 0 || d_out > 12.5) continue;
    const k = Math.round(d_out * 2); // index
    if (k >= N) continue;
    const i4 = (y*W+x)*4;
    let v;
    if (channel === 'R') v = d[i4];
    else if (channel === 'G') v = d[i4+1];
    else if (channel === 'B') v = d[i4+2];
    else v = d[i4+3]; // A
    sum[k] += v; cnt[k]++;
  }
  return Array.from({length: N}, (_, i) => cnt[i] > 0 ? Math.round(sum[i]/cnt[i]) : null);
}

const refs = [
  ['../vanilla_references/armor_wedge', 1],
  ['../vanilla_references/armor_1x2_wedge', 2],
  ['../vanilla_references/armor_1x3_wedge', 3],
];

for (const [dir, key] of refs) {
  const W = key === 1 ? 64 : 64, H = key === 1 ? 64 : key === 2 ? 128 : 192;
  console.log(`\n// === key=${key} (${dir.split('/').pop()}) ===`);
  for (const [file, ch] of [
    ['armor.png','G'], ['armor.png','R'], ['armor.png','A'],
    ['external_wall_normals.png','R'], ['external_wall_normals.png','G'],
    ['external_wall_normals.png','B'], ['external_wall_normals.png','A'],
    ['blueprints.png','R'], ['blueprints.png','B'], ['blueprints.png','A'],
  ]) {
    const label = file.replace('.png','').replace('external_wall_normals','nrm').replace('blueprints','bp') + '_' + ch;
    const arr = extractProfile(dir, file, ch);
    console.log(`  ${label}: [${arr.map(v=>v===null?'null':v).join(', ')}]`);
  }
}
