// Deterministic vector fallback artwork plus checked-in cinematic JPEG/GIF overrides. No network.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const W=512,H=320;
const font={
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/11011/10001',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',0:'01110/10001/10011/10101/11001/10001/01110',1:'00100/01100/00100/00100/00100/00100/01110',2:'01110/10001/00001/00010/00100/01000/11111',3:'11110/00001/00001/01110/00001/00001/11110',4:'00010/00110/01010/10010/11111/00010/00010',5:'11111/10000/10000/11110/00001/00001/11110',6:'01110/10000/10000/11110/10001/10001/01110',7:'11111/00001/00010/00100/01000/01000/01000',8:'01110/10001/10001/01110/10001/10001/01110',9:'01110/10001/10001/01111/00001/00001/01110'
};
const palette={CITY:[88,194,221],MAFIA:[238,76,96],NEUTRAL:[194,151,243],SPECIAL:[247,195,104],BRAND:[241,181,75]};
// Each role has its own deliberately drawn emblem (coordinate polylines on 0..100).
const roles=[
 ['CITIZEN','CITY','FUQARO',['18,82 18,44 50,20 82,44 82,82 18,82','40,82 40,56 60,56 60,82']],
 ['COMMISSAR','CITY','KOMISSAR',['50,12 82,25 78,58 65,78 50,89 35,78 22,58 18,25 50,12','50,32 56,44 70,46 60,56 62,70 50,63 38,70 40,56 30,46 44,44 50,32']],
 ['DOCTOR','CITY','DOKTOR',['39,17 61,17 61,39 83,39 83,61 61,61 61,83 39,83 39,61 17,61 17,39 39,39 39,17']],
 ['SHERIFF','CITY','SHERIF',['50,10 61,37 90,37 67,54 76,84 50,66 24,84 33,54 10,37 39,37 50,10','50,34 56,46 69,48 59,56 61,69 50,62 39,69 41,56 31,48 44,46 50,34']],
 ['BODYGUARD','CITY','QORIQCHI',['50,12 82,24 78,59 67,77 50,89 33,77 22,59 18,24 50,12','50,30 50,72','29,50 71,50']],
 ['DETECTIVE','CITY','DETEKTIV',['22,24 38,15 57,18 70,30 75,48 67,65 51,75 31,72 17,59 12,41 22,24','65,65 89,89','34,29 46,25 57,31']],
 ['JOURNALIST','CITY','JURNALIST',['18,16 68,16 82,30 82,84 18,84 18,16','68,16 68,30 82,30','29,40 70,40','29,53 70,53','29,66 61,66']],
 ['JUDGE','CITY','SUDYA',['26,22 44,11 67,41 48,53 26,22','49,48 78,85','18,80 59,80','14,89 64,89']],
 ['MAYOR','CITY','MER',['14,32 32,52 50,17 68,52 86,32 76,76 24,76 14,32','24,86 76,86']],
 ['WATCHER','CITY','KUZATUVCHI',['10,50 29,31 50,24 71,31 90,50 71,69 50,76 29,69 10,50','50,37 63,50 50,63 37,50 50,37']],
 ['PRIEST','CITY','RUHONIY',['50,13 50,86','26,34 74,34','35,86 65,86','50,20 58,27 50,34 42,27 50,20']],
 ['AVENGER','CITY','QASOSKOR',['55,9 23,56 47,56 39,91 79,40 54,40 55,9']],
 ['ENGINEER','CITY','MUHANDIS',['50,12 61,21 76,20 80,35 90,45 80,58 78,76 63,77 50,89 37,77 22,76 20,58 10,45 20,35 24,20 39,21 50,12','50,34 66,43 66,59 50,68 34,59 34,43 50,34']],
 ['MAFIOSO','MAFIA','MAFIYA',['15,44 30,24 70,24 85,44 15,44','8,51 92,51','25,64 42,59 50,66 58,59 75,64 68,78 58,78 50,72 42,78 32,78 25,64']],
 ['DON','MAFIA','DON',['12,27 31,49 50,13 69,49 88,27 77,74 23,74 12,27','24,85 76,85','42,56 50,48 58,56 50,64 42,56']],
 ['CONSIGLIERE','MAFIA','MASLAHATCHI',['20,22 80,22 80,67 56,67 35,84 35,67 20,67 20,22','33,38 67,38','33,51 67,51']],
 ['LAWYER','MAFIA','ADVOKAT',['50,15 50,81','18,33 82,33','18,33 8,58 28,58 18,33','82,33 72,58 92,58 82,33','29,84 71,84']],
 ['SPY','MAFIA','JOSUS',['15,50 29,33 50,25 71,33 85,50 71,67 50,75 29,67 15,50','22,80 80,20','50,40 60,50 50,60 40,50 50,40']],
 ['FORGER','MAFIA','SOXTAKOR',['18,14 64,14 80,30 80,86 18,86 18,14','64,14 64,30 80,30','30,67 70,27 79,36 39,76 30,78 30,67']],
 ['BLOCKER','MAFIA','BLOKLOVCHI',['18,18 82,18 82,82 18,82 18,18','18,18 82,82','82,18 18,82']],
 ['MAFIA_GUARD','MAFIA','MAFIYA QORIQCHISI',['50,12 82,25 78,62 50,89 22,62 18,25 50,12','30,40 50,56 70,40','30,55 50,71 70,55']],
 ['SERIAL_KILLER','NEUTRAL','MANYAK',['17,42 32,22 68,22 83,42 77,66 61,75 61,86 39,86 39,75 23,66 17,42','31,45 43,45 43,57 31,57 31,45','57,45 69,45 69,57 57,57 57,45']],
 ['THIEF','NEUTRAL','OGRI',['12,34 37,41 50,32 63,41 88,34 80,69 61,76 50,63 39,76 20,69 12,34','23,50 41,53 33,61 23,50','77,50 59,53 67,61 77,50']],
 ['JESTER','NEUTRAL','MASXARABOZ',['18,61 17,28 37,47 50,13 63,47 83,28 82,61 68,78 32,78 18,61','35,61 43,68 57,68 65,61','50,13 50,6']],
 ['HUNTER','NEUTRAL','OVCHI',['50,12 74,22 88,50 74,78 50,88 26,78 12,50 26,22 50,12','50,12 50,37','50,63 50,88','12,50 37,50','63,50 88,50']],
 ['WIZARD','NEUTRAL','SEHRGAR',['20,76 50,13 80,76 20,76','10,85 90,85','50,38 56,50 69,52 59,61 61,73 50,67 39,73 41,61 31,52 44,50 50,38']],
 ['LONE_WOLF','NEUTRAL','YOLGIZ BORI',['15,12 37,31 63,31 85,12 81,57 68,76 50,91 32,76 19,57 15,12','28,49 41,55','72,49 59,55','44,70 50,77 56,70']],
 ['CUPID','SPECIAL','KUPIDON',['50,83 16,50 12,30 26,17 42,20 50,31 58,20 74,17 88,30 84,50 50,83','16,80 84,12','67,12 84,12 84,29']],
 ['TWIN','SPECIAL','EGIZAK',['14,20 53,20 53,66 14,66 14,20','47,34 86,34 86,80 47,80 47,34']],
 ['PHOENIX','SPECIAL','FENIKS',['50,12 58,35 81,18 74,52 90,43 77,69 59,76 50,90 41,76 23,69 10,43 26,52 19,18 42,35 50,12','50,42 50,72']]
];
const brand=['50,8 58,35 86,24 68,48 93,61 62,62 58,91 45,67 18,82 29,55 7,38 38,37 50,8','50,34 62,50 50,66 38,50 50,34'];
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
function canvas(w,h,accent){
 const data=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const glow=Math.max(0,1-Math.hypot((x-w*.5)/w,(y-h*.44)/h)*2.2);
  const t=glow*.14+((x+y)%8===0?.013:0);
  const c=mix([10,15,25],accent,t);
  const i=(y*w+x)*3;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];
 }
 const pixel=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=w||y>=h)return;const i=(y*w+x)*3;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];};
 const rect=(x,y,ww,hh,c)=>{for(let yy=Math.floor(y);yy<y+hh;yy++)for(let xx=Math.floor(x);xx<x+ww;xx++)pixel(xx,yy,c);};
 const dot=(x,y,r,c)=>{for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if((xx-x)**2+(yy-y)**2<=r*r)pixel(xx,yy,c);};
 const line=(x1,y1,x2,y2,c,th=1)=>{const len=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)));for(let i=0;i<=len;i++){const f=i/len;dot(x1+(x2-x1)*f,y1+(y2-y1)*f,th/2,c);}};
 const ring=(x,y,r,c,th=1)=>{for(let a=0;a<360;a+=2){const v=a*Math.PI/180;dot(x+Math.cos(v)*r,y+Math.sin(v)*r,th/2,c);}};
 const text=(s,x,y,scale,c,align='center')=>{s=s.toUpperCase();const width=(s.length*6-1)*scale;let start=align==='center'?Math.round(x-width/2):x;for(const ch of s){const g=font[ch]?.split('/');if(g)g.forEach((row,yy)=>[...row].forEach((v,xx)=>{if(v==='1')rect(start+xx*scale,y+yy*scale,scale,scale,c);}));start+=6*scale;}};
 return {data,pixel,rect,dot,line,ring,text};
}
function art(title,category,number,paths){
 const c=palette[category], dim=mix([16,23,34],c,.40), light=mix(c,[255,255,255],.42);
 const b=canvas(W,H,c);
 b.rect(0,0,W,5,c);b.rect(0,H-4,W,4,c);
 for(const [x,y,dx,dy] of [[17,17,1,1],[W-17,17,-1,1],[17,H-17,1,-1],[W-17,H-17,-1,-1]]){b.line(x,y,x+dx*26,y,c,2);b.line(x,y,x,y+dy*26,c,2);}
 b.text('HYPERNOVA',28,26,2,[227,232,243],'left');b.text('MAFIA',28,43,2,c,'left');
 b.text(number,W-54,28,2,light);
 b.ring(W/2,142,77,dim,1);b.ring(W/2,142,68,dim,2);
 for(let a=0;a<360;a+=30){const v=a*Math.PI/180;b.dot(W/2+Math.cos(v)*77,142+Math.sin(v)*77,2,c);}
 for(const path of paths){const pts=path.split(' ').map(p=>p.split(',').map(Number));for(let i=1;i<pts.length;i++){const [a,z]=[pts[i-1],pts[i]];b.line(196+a[0]*1.2,82+a[1]*1.2,196+z[0]*1.2,82+z[1]*1.2,dim,9);b.line(196+a[0]*1.2,82+a[1]*1.2,196+z[0]*1.2,82+z[1]*1.2,light,4);}}
 b.line(90,232,422,232,dim,1);b.dot(90,232,2,c);b.dot(422,232,2,c);
 const scale=title.length>19?3:4;b.text(title,256,246,scale,[240,242,247]);
 b.text(category==='BRAND'?'HYPERNOVA SERIES':category,256,286,2,c);
 return b.data;
}
const crcTable=Array.from({length:256},(_,i)=>{let v=i;for(let k=0;k<8;k++)v=(v>>>1)^((v&1)?0xedb88320:0);return v>>>0;});
function chunk(name,data){
 const n=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);let crc=0xffffffff;
 for(const v of Buffer.concat([n,data]))crc=(crc>>>8)^crcTable[(crc^v)&255];tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,n,data,tail]);
}
function png(rgb,w=W,h=H){
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 const stride=w*3, raw=Buffer.alloc((stride+1)*h);
 for(let y=0;y<h;y++){raw[y*(stride+1)]=1;for(let x=0;x<stride;x++){const i=y*stride+x;raw[y*(stride+1)+1+x]=(rgb[i]-(x>=3?rgb[i-3]:0)+256)&255;}}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
// GIF89a; use short clear-code runs so code width is always 5 bits.
function gif(scene='intro'){
 const w=scene==='intro'?256:192,h=scene==='intro'?144:108,colors=[[10,15,25],[20,25,36],[35,34,42],[58,46,44],[81,58,45],[118,84,48],[163,117,54],[205,150,60],[241,181,75],[255,211,122],[255,235,177],[240,242,247],[99,109,130],[48,57,76],[16,20,30],[0,0,0]];
 if(scene==='v2_night')colors.splice(0,16,...[[8,13,25],[14,22,42],[22,34,58],[31,49,78],[40,65,102],[57,88,135],[83,113,159],[113,145,189],[156,183,219],[200,219,246],[239,244,255],[235,239,247],[78,89,115],[25,32,50],[13,18,31],[0,0,0]]);
 if(scene==='v2_dawn')colors.splice(0,16,...[[18,20,35],[34,30,49],[56,39,61],[80,48,70],[108,61,75],[145,78,75],[182,99,76],[217,133,83],[242,171,101],[255,210,138],[255,239,188],[245,243,235],[93,68,82],[40,35,55],[25,24,39],[0,0,0]]);
 if(scene==='v2_vote')colors.splice(0,16,...[[11,17,30],[19,28,48],[29,43,65],[40,59,86],[57,78,111],[74,100,135],[97,128,164],[132,165,196],[173,205,231],[211,231,246],[241,247,255],[235,242,250],[115,139,165],[35,50,69],[17,24,39],[0,0,0]]);
 const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
 const pieces=[Buffer.from('GIF89a'),u16(w),u16(h),Buffer.from([0xf3,0,0]),Buffer.from(colors.flat()),Buffer.from([0x21,0xff,11]),Buffer.from('NETSCAPE2.0'),Buffer.from([3,1,0,0,0])];
 const frames=scene==='intro'?8:12;
 for(let frame=0;frame<frames;frame++){
  const b=canvas(w,h,colors[8]);
  if(scene==='intro'){
  b.ring(128,58,37,colors[6],2);b.ring(128,58,29,colors[4],1);
  for(const p of brand){const pts=p.split(' ').map(q=>q.split(',').map(Number));for(let i=1;i<pts.length;i++)b.line(100+pts[i-1][0]*.56,30+pts[i-1][1]*.56,100+pts[i][0]*.56,30+pts[i][1]*.56,colors[8],2);}
  const a=frame*Math.PI/4;b.dot(128+Math.cos(a)*37,58+Math.sin(a)*37,4,colors[10]);
  b.text('HYPERNOVA',128,106,3,colors[11]);b.text('MAFIA',128,130,1,colors[8]);
  }else{
   const cx=w/2,cy=43,a=frame*2*Math.PI/frames;
   // Layered skyline, illuminated horizon and drifting fog, kept within a small GIF budget.
   for(let y=0;y<78;y++){
    const color=scene==='v2_dawn'?colors[Math.min(8,1+Math.floor(y/10))]:colors[Math.min(4,Math.floor(y/18))];
    b.rect(0,y,w,1,color);
   }
   const skyline=(layer,base,color)=>{for(let i=0;i<15;i++){
    const x=i*14-6,ht=8+(i*17+layer*11)%24;
    b.rect(x,base-ht,12,ht,color);
    if(i%4===0)b.line(x+6,base-ht-6,x+6,base-ht,color,1);
    for(let j=base-ht+4;j<base-2;j+=6)if((i+j+layer)%3===0)b.rect(x+3,j,2,2,colors[5]);
   }};
   for(let i=0;i<6;i++){const x=(i*39+frame*3)%240-24;b.line(x,19+i*5,x+22,19+i*5,colors[2],1);}
   b.rect(0,0,w,2,colors[7]);b.rect(0,h-2,w,2,colors[7]);
   b.text('HYPERNOVA',cx,8,1,colors[11]);
   if(scene==='v2_night'){
    b.dot(cx,cy-5,23,colors[7]);b.dot(cx,cy-5,21,colors[10]);b.dot(cx+10,cy-12,20,colors[2]);
    for(let i=0;i<7;i++){const x=18+(i*29)%156,y=22+(i*13)%39;b.dot(x,y,(i+frame)%4===0?2:1,colors[8+(i+frame)%3]);}
    skyline(0,72,colors[3]);skyline(1,76,colors[0]);
    b.rect(0,77,w,31,colors[0]);b.text('TUN',cx,81,3,colors[11]);
   }else if(scene==='v2_dawn'){
    const y=63-Math.round(17*(1-Math.cos(a))/2);
    b.dot(cx,y,20,colors[10]);b.rect(0,64,w,10,colors[1]);b.line(16,64,w-16,64,colors[8],2);
    for(let i=0;i<7;i++){const ang=Math.PI+i*Math.PI/6;b.line(cx+Math.cos(ang)*24,y+Math.sin(ang)*24,cx+Math.cos(ang)*29,y+Math.sin(ang)*29,colors[7],2);}
    skyline(0,72,colors[3]);skyline(1,76,colors[0]);
    b.rect(0,77,w,31,colors[0]);b.text('TONG',cx,81,3,colors[11]);
   }else if(scene==='v2_vote'){
    b.ring(cx,cy,32,colors[5],1);b.ring(cx,cy,29,colors[3],1);
    b.rect(61,54,70,17,colors[2]);b.rect(66,49,60,21,colors[4]);b.rect(75,45,42,4,colors[0]);b.line(66,69,126,69,colors[7],1);
    const y=24+Math.round(7*(1-Math.cos(a))/2);
    b.rect(84,y,24,20,colors[9]);b.line(89,y+9,94,y+14,colors[2],2);b.line(94,y+14,103,y+5,colors[2],2);
    b.rect(0,77,w,31,colors[0]);b.text('OVOZ',cx,81,3,colors[11]);
   }else{
    b.ring(cx,cy,26,colors[6],2);b.line(cx-21,cy-14,cx-11,cy+11,colors[9],3);b.line(cx-11,cy+11,cx+11,cy+11,colors[9],3);b.line(cx+11,cy+11,cx+21,cy-14,colors[9],3);b.line(cx-21,cy-14,cx-9,cy-3,colors[9],3);b.line(cx-9,cy-3,cx,cy-18,colors[9],3);b.line(cx,cy-18,cx+9,cy-3,colors[9],3);b.line(cx+9,cy-3,cx+21,cy-14,colors[9],3);
    for(let i=0;i<5;i++){const ang=a+i*Math.PI*2/5;b.dot(cx+Math.cos(ang)*33,cy+Math.sin(ang)*29,2,colors[10]);}
    b.ring(cx,cy,29,colors[4],1);b.rect(0,77,w,31,colors[0]);b.text('YAKUN',cx,81,3,colors[11]);
   }
   b.line(65,101,127,101,colors[6],1);
  }
  const bytes=[];let bits=0,nb=0;const emit=n=>{bits|=n<<nb;nb+=5;while(nb>=8){bytes.push(bits&255);bits>>>=8;nb-=8;}};
  for(let i=0;i<w*h;i++){if(i%12===0)emit(16);let best=0,score=Infinity;for(let j=0;j<colors.length;j++){const d=colors[j];const q=(b.data[i*3]-d[0])**2+(b.data[i*3+1]-d[1])**2+(b.data[i*3+2]-d[2])**2;if(q<score){best=j;score=q;}}emit(best);}
  emit(17);if(nb)bytes.push(bits&255);
  pieces.push(Buffer.from([0x21,0xf9,4,4,scene==='intro'?12:10,0,0,0,0x2c]),u16(0),u16(0),u16(w),u16(h),Buffer.from([0,4]));
  for(let i=0;i<bytes.length;i+=255){const block=Buffer.from(bytes.slice(i,i+255));pieces.push(Buffer.from([block.length]),block);}pieces.push(Buffer.from([0]));
 }
 pieces.push(Buffer.from([0x3b]));return Buffer.concat(pieces);
}
// Original V2 noir character collection, independent of the legacy role artwork.
// Each role has a costume silhouette and its own foreground emblem.
const v2Portraits=[
 ['citizen','TINCH AHOLI','CITY','coat','house'],
 ['don','DON','MAFIA','hat','crown'],
 ['mafia','MAFIA','MAFIA','hat','diamond'],
 ['manyak','MANYAK','SOLO','hood','blade'],
 ['komissar','KOMISSAR','CITY','cap','star'],
 ['doktor','DOKTOR','CITY','medic','cross'],
 ['serjant','SERJANT','CITY','cap','chevrons'],
 ['daydi','DAYDI','CITY','hood','eye'],
 ['frozen','FROZEN','CITY','hood','snow'],
 ['advokat','ADVOKAT','MAFIA','coat','scales'],
 ['suidsid','SUIDSID','NEUTRAL','hood','hourglass'],
 ['killer','KILLER','MAFIA','mask','target'],
 ['kamikaze','KAMIKAZE','CITY','coat','burst'],
 ['grench','GRENCH','NEUTRAL','mask','coin'],
 ['minior','MINIOR','SOLO','helmet','burst'],
 ['shpion','SHPION','MAFIA','hat','eye'],
 ['zombi','ZOMBI','ZOMBIE','mask','scar'],
 ['kimyogar','KIMYOGAR','MAFIA','medic','flask'],
 ['tentak','TENTAK','CITY','cap','spiral'],
 ['buqalamun','BUQALAMUN','NEUTRAL','hood','split'],
 ['sotuvchi','SOTUVCHI','NEUTRAL','coat','coin'],
 ['krampous','KRAMPOUS','SOLO','horns','chain'],
 ['omadli','OMADLI','CITY','coat','clover'],
 ['klaus','KLAUS','NEUTRAL','winter','gift'],
 ['sehrgar','SEHRGAR','NEUTRAL','wizard','star'],
 ['mergan','MERGAN','SOLO','helmet','target'],
 ['janob','JANOB','CITY','top','medal'],
];
const noirPalette={CITY:[77,151,184],MAFIA:[176,48,67],SOLO:[199,103,55],NEUTRAL:[174,137,78],ZOMBIE:[97,157,99]};
function noirPortrait(title,faction,costume,symbol,index){
 const w=448,h=560,accent=noirPalette[faction],gold=[210,175,105],black=[9,12,19],edge=mix(black,accent,.48),light=mix(accent,[245,240,224],.58);
 const b=canvas(w,h,accent);
 const poly=(pts,color)=>{
  const ys=pts.map(p=>p[1]);
  for(let y=Math.ceil(Math.min(...ys));y<=Math.max(...ys);y++){
   const xs=[];
   for(let i=0;i<pts.length;i++){const a=pts[i],z=pts[(i+1)%pts.length];if((a[1]<=y&&z[1]>y)||(z[1]<=y&&a[1]>y))xs.push(a[0]+(y-a[1])*(z[0]-a[0])/(z[1]-a[1]));}
   xs.sort((a,z)=>a-z);for(let i=0;i+1<xs.length;i+=2)b.rect(Math.ceil(xs[i]),y,Math.max(0,Math.floor(xs[i+1])-Math.ceil(xs[i])+1),1,color);
  }
 };
 const line=(a,z,c=light,n=3)=>b.line(a[0],a[1],z[0],z[1],c,n);
 const path=(pts,c=light,n=3)=>{for(let i=1;i<pts.length;i++)line(pts[i-1],pts[i],c,n);};
 b.rect(0,0,w,5,gold);b.rect(0,h-5,w,5,gold);
 for(let i=0;i<13;i++){const x=15+i*35,ht=32+(i*47+index*19)%112;b.rect(x,361-ht,25,ht,mix(black,accent,.13));for(let y=371-ht;y<351;y+=17)if((i+y)%3===0)b.rect(x+6,y,3,7,edge);}
 b.ring(224,213,130,edge,2);b.ring(224,213,121,mix(black,accent,.27),1);
 b.text('HYPERNOVA',224,27,3,gold);b.text('MAFIA',224,53,2,light);
 b.text(String(index+1).padStart(2,'0'),402,28,2,gold);
 // Angular tailored body, backlight, contrasting planes.
 poly([[62,394],[80,314],[145,278],[190,264],[258,264],[306,278],[368,314],[386,394]],edge);
 poly([[68,394],[92,322],[160,284],[200,273],[224,345],[247,273],[289,284],[356,322],[380,394]],black);
 poly([[160,284],[195,273],[224,345],[180,333],[147,304]],mix(black,accent,.33));
 poly([[289,284],[253,273],[224,345],[268,333],[301,304]],mix(black,accent,.2));
 poly([[205,276],[243,276],[224,340]],light);
 poly([[224,288],[233,298],[228,332],[224,340],[220,332],[215,298]],accent);
 poly([[181,196],[183,262],[204,283],[244,283],[266,262],[267,196],[247,168],[201,168]],mix(black,accent,.42));
 poly([[224,168],[247,168],[267,196],[266,262],[244,283],[224,268]],mix(black,accent,.2));
 b.line(199,219,213,217,light,2);b.line(236,217,250,219,light,2);b.line(224,221,221,243,edge,2);
 if(costume==='hat'||costume==='top'||costume==='cap'){
  const top=costume==='top'?108:costume==='cap'?155:143;
  poly([[169,190],[185,top],[259,top],[279,190]],black);
  b.rect(180,176,88,10,accent);poly([[148,192],[299,192],[288,200],[161,200]],edge);
 }else if(costume==='hood'||costume==='wizard'||costume==='horns'){
  poly([[151,262],[155,171],[224,costume==='wizard'?91:122],[293,171],[297,262],[260,285],[267,195],[224,158],[181,195],[188,285]],black);
  path([[151,262],[155,171],[224,costume==='wizard'?91:122],[293,171],[297,262]],edge,4);
  if(costume==='horns'){poly([[168,170],[134,105],[179,135],[195,158]],accent);poly([[280,170],[314,105],[269,135],[253,158]],accent);}
 }else if(costume==='medic'||costume==='mask'||costume==='helmet'){
  poly([[176,205],[180,162],[224,142],[268,162],[272,205]],black);
  if(costume==='medic'){b.rect(202,162,44,24,light);b.rect(221,164,6,20,accent);b.rect(214,171,20,6,accent);}
  else b.line(180,196,268,196,accent,5);
  poly([[183,232],[224,242],[265,232],[253,266],[224,278],[195,266]],edge);
 }else if(costume==='winter'){
  poly([[172,189],[187,147],[249,127],[279,183]],accent);b.dot(249,127,10,light);b.rect(168,182,112,13,light);
  poly([[187,238],[224,249],[261,238],[250,275],[224,298],[198,275]],light);
 }else{
  poly([[177,203],[180,166],[210,149],[248,151],[269,174],[270,205],[249,181],[203,181]],black);
 }
 // Individual heraldic emblem below the portrait.
 const cx=224,cy=365; b.dot(cx,cy,33,black);b.ring(cx,cy,33,gold,2);
 const l=(x,y,z,q)=>b.line(cx+x,cy+y,cx+z,cy+q,light,3);
 const P=pts=>path(pts.map(([x,y])=>[cx+x,cy+y]),light,3);
 switch(symbol){
 case 'house':P([[-19,0],[0,-18],[19,0],[15,0],[15,18],[-15,18],[-15,0]]);break;
 case 'crown':P([[-19,-10],[-10,0],[0,-17],[10,0],[19,-10],[14,16],[-14,16],[-19,-10]]);break;
 case 'diamond':P([[0,-21],[19,0],[0,21],[-19,0],[0,-21]]);break;
 case 'blade':P([[-14,18],[14,-18],[19,-14],[-6,18],[-14,18]]);l(-18,7,0,20);break;
 case 'star':for(let i=0;i<5;i++){const a=i*2*Math.PI/5-Math.PI/2,z=(i+2)*2*Math.PI/5-Math.PI/2;l(Math.cos(a)*19,Math.sin(a)*19,Math.cos(z)*19,Math.sin(z)*19);}break;
 case 'cross':l(0,-20,0,20);l(-20,0,20,0);break;
 case 'chevrons':P([[-18,-10],[0,3],[18,-10]]);P([[-18,3],[0,16],[18,3]]);break;
 case 'eye':P([[-22,0],[0,-13],[22,0],[0,13],[-22,0]]);b.ring(cx,cy,6,light,3);break;
 case 'snow':for(let i=0;i<6;i++){const a=i*Math.PI/3;l(0,0,Math.cos(a)*21,Math.sin(a)*21);}break;
 case 'scales':l(0,-20,0,20);l(-18,-9,18,-9);P([[-18,-9],[-25,9],[-11,9],[-18,-9]]);P([[18,-9],[11,9],[25,9],[18,-9]]);break;
 case 'hourglass':P([[-16,-19],[16,-19],[-16,19],[16,19],[-16,-19]]);break;
 case 'target':b.ring(cx,cy,19,light,3);b.ring(cx,cy,8,light,2);l(-25,0,-11,0);l(11,0,25,0);l(0,-25,0,-11);l(0,11,0,25);break;
 case 'burst':for(let i=0;i<8;i++){const a=i*Math.PI/4;l(Math.cos(a)*7,Math.sin(a)*7,Math.cos(a)*22,Math.sin(a)*22);}break;
 case 'coin':b.ring(cx,cy,21,light,3);b.text('D',cx,cy-10,3,light);break;
 case 'scar':P([[-14,-20],[-4,-5],[-12,0],[8,21]]);P([[3,-20],[13,-5],[5,0],[20,20]]);break;
 case 'flask':P([[-8,-20],[8,-20],[8,-5],[20,17],[-20,17],[-8,-5],[-8,-20]]);l(-13,7,13,7);break;
 case 'spiral':P([[-19,-19],[19,-19],[19,19],[-19,19],[-19,-6],[6,-6],[6,7],[-6,7]]);break;
 case 'split':P([[0,-21],[19,0],[0,21],[-19,0],[0,-21]]);l(0,-21,0,21);break;
 case 'chain':b.ring(cx-8,cy-8,12,light,3);b.ring(cx+8,cy+8,12,light,3);break;
 case 'clover':for(const [x,y] of [[-10,-10],[10,-10],[-10,10],[10,10]])b.dot(cx+x,cy+y,10,light);l(0,8,0,23);break;
 case 'gift':P([[-19,-9],[19,-9],[19,18],[-19,18],[-19,-9]]);l(0,-9,0,18);P([[0,-9],[-15,-19],[-15,-7],[0,-9],[15,-19],[15,-7],[0,-9]]);break;
 case 'medal':P([[-13,-22],[0,-3],[13,-22]]);b.ring(cx,cy+9,12,light,3);break;
 }
 b.rect(0,407,w,148,black);b.line(38,418,w-38,418,gold,1);
 b.text(title,224,445,title.length>12?3:4,[238,232,220]);
 const factionText={CITY:'TINCH AHOLI',MAFIA:'MAFIA',SOLO:'YAKKA ROL',NEUTRAL:'BETARAF',ZOMBIE:'ZOMBI'}[faction];
 b.text(factionText,224,497,2,accent);
 b.text('V2 CHARACTER SERIES',224,530,1,gold);
 return png(b.data,w,h);
}

const assets={};
roles.forEach(([code,category,title,paths],i)=>{assets['role_'+code.toLowerCase()]=png(art(title,category,String(i+1).padStart(2,'0'),paths));});
for(const [key,title,category] of [['game_start','OYIN BOSHLANDI','BRAND'],['game_city','SHAHAR GALABA','CITY'],['game_mafia','MAFIYA GALABA','MAFIA'],['game_serial_killer','MANYAK GALABA','NEUTRAL'],['game_draw','DURRANG','BRAND']])assets[key]=png(art(title,category,'V5',brand));
assets.intro=gif();
for(const key of ['v2_night','v2_dawn','v2_vote','v2_end'])assets[key]=gif(key);
v2Portraits.forEach(([id,title,faction,costume,symbol],i)=>{assets['v2portrait_'+id]=noirPortrait(title,faction,costume,symbol,i);});
assets.v2hero=noirPortrait('SHAXSIY GEROY','NEUTRAL','helmet','medal',27);
if(v2Portraits.length!==27||Object.keys(assets).length!==68||new Set(Object.values(assets).map(b=>createHash('sha256').update(b).digest('hex'))).size!==68)throw new Error('visual manifest incomplete or duplicated');
// Curated premium assets are actual Git binaries, not remote links or generated placeholders.
const premium=JSON.parse(readFileSync(new URL('../assets/premium/manifest.json',import.meta.url),'utf8'));
const premiumPhases=new Set(['v2_night','v2_dawn','v2_vote','v2_end']);
const premiumMenus=new Set(['v2home','v2profile','v2hero','v2shop','v2inventory','v2para']);
const premiumKeys=new Set();
let premiumBytes=0;
for(const [file,expected] of Object.entries(premium)){
 const m=/^(v2[a-z_]+)\.(jpg|gif)$/.exec(file);if(!m)throw Error('invalid premium filename '+file);
 const [,key,ext]=m;
 if(premiumKeys.has(key))throw Error('duplicate premium key '+key);
 if(ext==='gif'?!premiumPhases.has(key):!premiumMenus.has(key)&&!(key.startsWith('v2portrait_')&&Object.hasOwn(assets,key)))throw Error('unknown premium asset '+file);
 const bytes=readFileSync(new URL('../assets/premium/'+file,import.meta.url));
 const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(actual!==expected)throw Error('premium integrity mismatch '+file);
 const valid=ext==='gif'?bytes.subarray(0,6).toString()==='GIF89a'&&bytes.at(-1)===0x3b:bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
 if(!valid||bytes.length<100||bytes.length>(ext==='gif'?160000:110000))throw Error('invalid premium media '+file);
 assets[key]=bytes;premiumKeys.add(key);premiumBytes+=bytes.length;
}
if(premiumKeys.size!==24||premiumBytes>2000000||Object.keys(assets).length!==73)throw Error('premium asset inventory or size budget mismatch');
if(new Set(Object.values(assets).map(b=>createHash('sha256').update(b).digest('hex'))).size!==Object.keys(assets).length)throw Error('duplicate final media');
for(const [name,bytes] of Object.entries(assets))if(bytes.length>750000||bytes.length<100)throw new Error('bad asset size '+name);
const dest=new URL('../src/generated/',import.meta.url);mkdirSync(dest,{recursive:true});
writeFileSync(new URL('visual-assets.ts',dest),'// Generated deterministically by scripts/generate-visuals.mjs. Do not edit.\nexport const VISUAL_ASSETS: Readonly<Record<string, string>> = '+JSON.stringify(Object.fromEntries(Object.entries(assets).map(([k,b])=>[k,b.toString('base64')])) )+';\n');
console.log('Hypernova visuals: '+Object.keys(assets).length+' assets, '+Object.values(assets).reduce((s,b)=>s+b.length,0)+' bytes');
