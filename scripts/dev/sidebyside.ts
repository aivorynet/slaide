// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const a = PNG.sync.read(readFileSync(process.argv[2]));
const b = PNG.sync.read(readFileSync(process.argv[3]));
const f = 2; // downscale
const ds = (s:PNG)=>{const w=Math.floor(s.width/f),h=Math.floor(s.height/f);const o=new PNG({width:w,height:h});for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=((y*f)*s.width+(x*f))*4,di=(y*w+x)*4;s.data.copy(o.data,di,si,si+4);}return o;};
const A=ds(a),B=ds(b),gap=12;
const W=A.width+B.width+gap,H=Math.max(A.height,B.height);
const out=new PNG({width:W,height:H});
for(let i=0;i<W*H*4;i++)out.data[i]=255;
const place=(img:PNG,ox:number)=>{for(let y=0;y<img.height;y++){const si=y*img.width*4,di=(y*W+ox)*4;img.data.copy(out.data,di,si,si+img.width*4);}};
place(A,0);place(B,A.width+gap);
writeFileSync(process.argv[4],PNG.sync.write(out));
console.log('wrote',process.argv[4]);
