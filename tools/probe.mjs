import { renderSet } from './render.mjs';
import { encodePNG } from './png.mjs';
import { writeFileSync } from 'node:fs';
const DEFAULTS = { tilesX:1,tilesY:1,wedge:false,material:'vanilla',baseBright:29,grain:9,grainScale:9,weavePeriod:13,ballSpacing:15,ballFill:0.94,rivetGap:14,poreScale:7,porosity:0.5,fillDepth:0.6,triSize:0.74,triGroove:1.0,hammerScale:11,hammerDepth:1.0,ingotTargetWidth:32,ingotTargetHeight:32,hexSize:8,hexGroove:0.8,aggregateScale:11,aggregateDensity:0.55,crackDepth:0.65,bevelBright:16,bevelWidth:2,normalStrength:1.0,normalFlipY:false,normalEdgeFade:0,ballNormalHeight:2.4,surfaceNormalScale:1.0,dmg33:1.0,dmg66:1.9,cratersPerTile:6,holeSize:0.62,edgeMargin:6,scorch:true,seed:1234,tint:'#7d8a99',applyTint:false };
const P = { ...DEFAULTS, wedge:true, tilesX:3, tilesY:1, material:'nera' };
const set = renderSet(P);
for (const k of Object.keys(set)) { writeFileSync('/tmp/probe_'+k, Buffer.from(encodePNG(set[k]))); }
console.log('files:', Object.keys(set).join(', '));
const a=set['armor.png'],W=a.width,H=a.height,d=a.data;
const al=(x,y)=>d[(y*W+x)*4+3];
console.log('dims',W,H);
console.log('TR alpha',al(W-1,0),'BR alpha',al(W-1,H-1));
let f=-1,l=-1; for(let y=0;y<H;y++){if(al(W-1,y)>0){if(f<0)f=y;l=y;}}
console.log('right col solid rows',f,'..',l,'/',H);
