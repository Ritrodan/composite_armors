import { decodePNG } from './decode.mjs';
function scanDiag(path){
  const img=decodePNG(path);const{width:W,height:H,data:d}=img;
  // perpendicular distance to hypotenuse TR->BL for a wedge with empty TL:
  // line through (W,0)-(0,H): H*x + W*y = W*H ; dist=(W*H - H*x - W*y)/diag (>0 inside toward BR)
  const diag=Math.hypot(W,H);
  // sample along the anti-diagonal center line x=t, y=t (from TL to BR) and report normal/alpha
  console.log('=== '+path.split('/').slice(-2).join('/'));
  let line='';
  for(let t=0;t<W;t+=4){const x=t,y=t;const i=(y*W+x)*4;
    line+=`t${t}:[${d[i]},${d[i+1]},${d[i+2]},a${d[i+3]}] `;}
  console.log(' diag TL->BR:',line);
}
for(const f of process.argv.slice(2)) scanDiag(f);
