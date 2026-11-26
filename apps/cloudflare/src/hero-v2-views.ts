import {HERO_V2_PRICE,HERO_V2_XP_PACKS,HERO_V2_RENAME_PRICE,heroV2Threshold,type Keyboard} from '@mafia/bot-core';
import {escapeHtml} from '@mafia/localization';
import type {HeroV2Core,HeroV2Purchase,HeroV2Quote,HeroV2BuyResult} from './hero-v2-core';
type View={text:string;keyboard:Keyboard};
const names:Record<HeroV2Purchase,string>={BUY:'Geroy sotib olish',XP500:'500 ball',XP1000:'1000 ball',RESTORE:'Himoyani to‘ldirish',RELOAD:'O‘qni to‘ldirish',RENAME:'Nomni o‘zgartirish'};
const home={text:'⬅️ Geroy',callback_data:'hv2:home'};
const quote=(op:Exclude<HeroV2Purchase,'RENAME'>,label:string)=>[{text:label,callback_data:'hv2:q:'+op}];
export function decodeHeroV2Button(raw:string):{kind:'HOME'}|{kind:'QUOTE';op:Exclude<HeroV2Purchase,'RENAME'>}|{kind:'CONFIRM'|'CANCEL';id:number}|null{
 if(raw==='hv2:home')return {kind:'HOME'};
 const q=/^hv2:q:(BUY|XP500|XP1000|RESTORE|RELOAD)$/.exec(raw);
 if(q)return {kind:'QUOTE',op:q[1] as Exclude<HeroV2Purchase,'RENAME'>};
 const c=/^hv2:(c|x):(\d{1,16})$/.exec(raw);
 const id=c?Number(c[2]):0;
 return Number.isSafeInteger(id)&&id>0?{kind:c?.[1]==='c'?'CONFIRM':'CANCEL',id}:null;
}
export function heroV2Profile(a:ReturnType<HeroV2Core['view']>):View{
 const header='🧪 <b>GEROY V2 — ICHKI SINOV</b>';
 if(!a)return {text:header+'\n\nBitta doimiy shaxsiy geroy. Boshlang‘ich daraja 1.\nNarx: '+HERO_V2_PRICE+' 💎',keyboard:[quote('BUY','Geroy olish · '+HERO_V2_PRICE+' 💎')]};
 const start=heroV2Threshold(a.level);
 const progress=Math.max(0,Math.min(10,Math.floor((a.points-start)/(a.nextPoints-start)*10)));
 const keyboard:Keyboard=[
  quote('XP500','+500 ball · '+HERO_V2_XP_PACKS[0].diamonds+' 💎'),
  quote('XP1000','+1000 ball · '+HERO_V2_XP_PACKS[1].diamonds+' 💎'),
  ...(a.defense<a.maxDefense?[quote('RESTORE','Himoyani tiklash · '+a.restorePrice+' $')]:[]),
  ...(a.charges<a.maxCharges?[quote('RELOAD','O‘qni to‘ldirish · '+a.reloadPrice+' $')]:[]),
  [home],
 ];
 return {text:header+'\n\n<b>'+escapeHtml(a.name)+'</b> · '+a.level+'-daraja\n'+
  '⭐ Ball: '+a.points+' / '+a.nextPoints+'\n'+
  '▰'.repeat(progress)+'▱'.repeat(10-progress)+'\n'+
  '⚔️ Zarar: '+a.damage+' HP\n🛡 Himoya: '+a.defense+' / '+a.maxDefense+'\n'+
  '🔋 O‘q: '+a.charges+' / '+a.maxCharges+'\n🏅 O‘ldirish: '+a.killPoints+' ball\n\n'+
  'Nomni o‘zgartirish: /herov2name Yangi nom ('+HERO_V2_RENAME_PRICE+' $)\n'+
  'Daraja oshishi himoya va o‘qni avtomatik to‘ldirmaydi.',keyboard};
}
export function heroV2Confirm(q:HeroV2Quote):View{
 return {text:'<b>Xaridni tasdiqlang</b>\n\n'+names[q.op]+(q.op==='RENAME'?' · '+escapeHtml(q.argument):'')+
  '\nNarx: '+q.price+(q.currency==='DIAMOND'?' 💎':' $')+'\nTaklif 2 daqiqa amal qiladi.',keyboard:[[{text:'✅ Tasdiqlash',callback_data:'hv2:c:'+q.id},{text:'❌ Bekor',callback_data:'hv2:x:'+q.id}]]};
}
export function heroV2Status(s:HeroV2BuyResult):string{
 return {OK:'✅ Xarid tasdiqlandi.',UNAVAILABLE:'Taklif mavjud emas yoki siz o‘yindasiz.',INSUFFICIENT:'Mablag‘ yetarli emas.',FULL:'Bu buyum yoki resurs allaqachon to‘la.',INVALID:'Noto‘g‘ri qiymat.',CONFLICT:'Narx yoki taklif o‘zgardi. Yangidan oching.'}[s];
}
