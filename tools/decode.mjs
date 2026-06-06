import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
export function decodePNG(path){
  const buf=readFileSync(path); let p=8; let W,H,bd,ct; const idat=[];
  while(p<buf.length){const len=buf.readUInt32BE(p);const type=buf.toString('ascii',p+4,p+8);const data=buf.subarray(p+8,p+8+len);
    if(type==='IHDR'){W=data.readUInt32BE(0);H=data.readUInt32BE(4);bd=data[8];ct=data[9];}
    else if(type==='IDAT')idat.push(data); else if(type==='IEND')break; p+=12+len;}
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const ch=ct===6?4:ct===2?3:ct===0?1:ct===4?2:4; const stride=W*ch; const out=Buffer.alloc(stride*H);
  const pa=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<H;y++){const ft=raw[y*(stride+1)];const row=y*(stride+1)+1;
    for(let i=0;i<stride;i++){const rawv=raw[row+i];const a=i>=ch?out[y*stride+i-ch]:0;const b=y>0?out[(y-1)*stride+i]:0;const c=(i>=ch&&y>0)?out[(y-1)*stride+i-ch]:0;
      let v; if(ft===0)v=rawv;else if(ft===1)v=rawv+a;else if(ft===2)v=rawv+b;else if(ft===3)v=rawv+((a+b)>>1);else v=rawv+pa(a,b,c); out[y*stride+i]=v&255;}}
  // expand to RGBA
  const rgba=new Uint8ClampedArray(W*H*4);
  for(let i=0;i<W*H;i++){if(ch===4){rgba[i*4]=out[i*4];rgba[i*4+1]=out[i*4+1];rgba[i*4+2]=out[i*4+2];rgba[i*4+3]=out[i*4+3];}
    else if(ch===3){rgba[i*4]=out[i*3];rgba[i*4+1]=out[i*3+1];rgba[i*4+2]=out[i*3+2];rgba[i*4+3]=255;}
    else if(ch===2){rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=out[i*2];rgba[i*4+3]=out[i*2+1];}
    else {rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=out[i];rgba[i*4+3]=255;}}
  return {width:W,height:H,data:rgba,colorType:ct};
}
function corners(img,label){const{width:W,height:H,data:d}=img;const g=(x,y)=>{const i=(y*W+x)*4;return `(${d[i]},${d[i+1]},${d[i+2]},${d[i+3]})`;};
  console.log(label,W+'x'+H);
  console.log('  TL',g(0,0),'TR',g(W-1,0));
  console.log('  BL',g(0,H-1),'BR',g(W-1,H-1));
  console.log('  center',g(W>>1,H>>1));
}
const files=process.argv.slice(2);
for(const f of files){corners(decodePNG(f),f.split('/').slice(-2).join('/'));}
