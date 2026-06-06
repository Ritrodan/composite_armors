import { decodePNG } from './decode.mjs';
// Measure cross-section vs signed dHyp along the hypotenuse, isolating it from
// the straight (right/bottom) edges. dHyp>0 = inside solid (toward BR).
function measure(dir, file){
  const img=decodePNG(dir+'/'+file); const{width:W,height:H,data:d}=img;
  const diag=Math.hypot(W,H);
  const buckets=new Map();
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    // stay away from straight edges and the acute tips
    const straight=Math.min(W-1-x,H-1-y);
    if(straight<12) continue;
    if(x<6||y<6) continue;
    const dh=(H*(x+0.5)+W*(y+0.5)-W*H)/diag;
    if(dh<-13||dh>13) continue;
    const k=Math.round(dh*2)/2; const i=(y*W+x)*4;
    let e=buckets.get(k); if(!e){e=[0,0,0,0,0];buckets.set(k,e);}
    e[0]+=d[i];e[1]+=d[i+1];e[2]+=d[i+2];e[3]+=d[i+3];e[4]++;
  }
  const ks=[...buckets.keys()].sort((a,b)=>a-b);
  console.log(`\n=== ${dir.split('/').pop()}/${file} (W=${W},H=${H}) ===`);
  for(const k of ks){const e=buckets.get(k);if(e[4]<3)continue;
    console.log(` dHyp=${k.toFixed(1).padStart(5)}: rgba(${(e[0]/e[4]).toFixed(0).padStart(3)},${(e[1]/e[4]).toFixed(0).padStart(3)},${(e[2]/e[4]).toFixed(0).padStart(3)},${(e[3]/e[4]).toFixed(0).padStart(3)}) n=${e[4]}`);}
}
const refs=['../vanilla_references/armor_wedge','../vanilla_references/armor_1x2_wedge','../vanilla_references/armor_1x3_wedge'];
for(const r of refs){ measure(r,'armor.png'); }
