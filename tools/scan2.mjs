import { decodePNG } from './decode.mjs';
function edge(path){
  const img=decodePNG(path);const{width:W,height:H,data:d}=img;
  console.log('=== '+path.split('/').slice(-2).join('/'));
  // find solid-edge crossing along TL->BR diagonal at 1px steps; report alpha + rgb
  let s='';
  for(let t=20;t<40;t++){const i=(t*W+t)*4;s+=`${t}:(${d[i]},${d[i+1]},${d[i+2]},a${d[i+3]}) `;}
  console.log(' diag t20..39:',s);
}
for(const f of process.argv.slice(2)) edge(f);
