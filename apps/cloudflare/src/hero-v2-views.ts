import {backRow,heroV2Stats,HERO_V2_PRICE,HERO_V2_XP_PACKS,HERO_V2_RENAME_PRICE,heroV2Threshold,type Keyboard} from '@mafia/bot-core';
import {escapeHtml} from '@mafia/localization';
import type {HeroV2Core,HeroV2Purchase,HeroV2Quote,HeroV2BuyResult} from './hero-v2-core';
type View={text:string;keyboard:Keyboard};
const names:Record<HeroV2Purchase,string>={BUY:'Geroy sotib olish',XP500:'500 ball',XP1000:'1000 ball',RESTORE:'Himoyani to‘ldirish',RELOAD:'O‘qni to‘ldirish',RENAME:'Nomni o‘zgartirish'};
const home={text:'⬅️ Geroy',callback_data:'hv2:home'};
const picture={text:'🖼 Geroy rasmi',callback_data:'hv2:art'};
const rename={text:'✏️ Nomini o‘zgartirish',callback_data:'hv2:rename'};
const bar=(value:number,max:number)=>{const n=Math.max(0,Math.min(10,Math.floor(value/Math.max(1,max)*10)));return '▰'.repeat(n)+'▱'.repeat(10-n);};
const number=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const quote=(op:Exclude<HeroV2Purchase,'RENAME'>,label:string)=>[{text:label,callback_data:'hv2:q:'+op}];
export function decodeHeroV2Button(raw:string):{kind:'HOME'}|{kind:'ART'}|{kind:'RENAME_HELP'}|{kind:'QUOTE';op:Exclude<HeroV2Purchase,'RENAME'>}|{kind:'CONFIRM'|'CANCEL';id:number}|null{
 if(raw==='hv2:home')return {kind:'HOME'};
 if(raw==='hv2:art')return {kind:'ART'};
 if(raw==='hv2:rename')return {kind:'RENAME_HELP'};
 const q=/^hv2:q:(BUY|XP500|XP1000|RESTORE|RELOAD)$/.exec(raw);
 if(q)return {kind:'QUOTE',op:q[1] as Exclude<HeroV2Purchase,'RENAME'>};
 const c=/^hv2:(c|x):(\d{1,16})$/.exec(raw);
 const id=c?Number(c[2]):0;
 return Number.isSafeInteger(id)&&id>0?{kind:c?.[1]==='c'?'CONFIRM':'CANCEL',id}:null;
}
export function heroV2Profile(a:ReturnType<HeroV2Core['view']>,visuals=false):View{
 const header='🥷 <b>HYPERNOVA | SHAXSIY GEROY</b>\n<i>V2 · sinov muhiti</i>';
 const separator='━━━━━━━━━━━━━━━━━━';
 if(!a){
  const stats=heroV2Stats(1);
  return {text:header+'\n'+separator+'\n🔒 <b>Geroy hali olinmagan</b>\n\nDoimiy shaxsiy geroy · 1-daraja\n⚔️ Zarar: '+stats.damage+' HP\n🛡 Himoya: '+stats.maxDefense+' / '+stats.maxDefense+'\n🔋 O‘q: '+stats.maxCharges+' / '+stats.maxCharges+'\n⭐ Keyingi daraja: '+number(heroV2Threshold(2))+' ball\n\n<b>Narx: '+HERO_V2_PRICE+' 💎</b>\nDon, Komissar va Mergan tongda bir marta foydalanishi mumkin.',keyboard:[quote('BUY','Geroy olish · '+HERO_V2_PRICE+' 💎'),...(visuals?[[picture]]:[]),backRow()]};
 }
 const start=heroV2Threshold(a.level),inLevel=Math.max(0,a.points-start),needed=Math.max(1,a.nextPoints-start);
 const keyboard:Keyboard=[
  ...(a.defense<a.maxDefense?[quote('RESTORE','🛡 Tiklash · '+a.restorePrice+' $')]:[]),
  ...(a.charges<a.maxCharges?[quote('RELOAD','🔋 To‘ldirish · '+a.reloadPrice+' $')]:[]),
  [...quote('XP500','+500 · '+HERO_V2_XP_PACKS[0].diamonds+' 💎'),...quote('XP1000','+1000 · '+HERO_V2_XP_PACKS[1].diamonds+' 💎')],
  [rename],...(visuals?[[picture]]:[]),
  [home],backRow(),
 ];
 return {text:header+'\n'+separator+'\n👤 <b>'+escapeHtml(a.name)+'</b> · '+number(a.level)+'-daraja\n\n'+
  '⭐ <b>Tajriba</b>\n'+bar(inLevel,needed)+'\n'+number(a.points)+' / '+number(a.nextPoints)+' ball\n'+
  'Keyingi darajagacha: '+number(Math.max(0,a.nextPoints-a.points))+' ball\n\n'+
  '⚔️ <b>Zarar: '+a.damage+' HP</b>\n🏅 O‘ldirish: '+a.killPoints+' ball\n\n'+
  '🛡 <b>Himoya: '+number(a.defense)+' / '+number(a.maxDefense)+'</b>\n'+bar(a.defense,a.maxDefense)+' · '+(a.defense>=a.maxDefense?'To‘la':a.restorePrice+' $ tiklash')+'\n'+
  '🔋 <b>O‘q: '+a.charges+' / '+a.maxCharges+'</b>\n'+bar(a.charges,a.maxCharges)+' · '+(a.charges>=a.maxCharges?'To‘la':a.reloadPrice+' $ to‘ldirish')+'\n\n'+
  separator+'\n💎 <b>Rivojlantirish</b>\n500 ball — '+HERO_V2_XP_PACKS[0].diamonds+' 💎 · 1000 ball — '+HERO_V2_XP_PACKS[1].diamonds+' 💎\nNomni o‘zgartirish — '+HERO_V2_RENAME_PRICE+' $\n<i>Daraja oshishi himoya va o‘qni avtomatik to‘ldirmaydi.</i>',keyboard};
}
export function heroV2RenameHelp():View{
 return {text:'✏️ <b>Geroy nomini o‘zgartirish</b>\n\nYangi nomni buyruq bilan yuboring:\n<code>/herov2name Nova</code>\n\nNarx: '+HERO_V2_RENAME_PRICE+' $\n32 belgigacha. Xarid alohida tasdiqlanadi.',keyboard:[[home]]};
}
export function heroV2Confirm(q:HeroV2Quote):View{
 return {text:'<b>Xaridni tasdiqlang</b>\n\n'+names[q.op]+(q.op==='RENAME'?' · '+escapeHtml(q.argument):'')+
  '\nNarx: '+q.price+(q.currency==='DIAMOND'?' 💎':' $')+'\nTaklif 2 daqiqa amal qiladi.',keyboard:[[{text:'✅ Tasdiqlash',callback_data:'hv2:c:'+q.id},{text:'❌ Bekor',callback_data:'hv2:x:'+q.id}]]};
}
export function heroV2Status(s:HeroV2BuyResult):string{
 return {OK:'✅ Xarid tasdiqlandi.',UNAVAILABLE:'Taklif mavjud emas yoki siz o‘yindasiz.',INSUFFICIENT:'Mablag‘ yetarli emas.',FULL:'Bu buyum yoki resurs allaqachon to‘la.',INVALID:'Noto‘g‘ri qiymat.',CONFLICT:'Narx yoki taklif o‘zgardi. Yangidan oching.'}[s];
}
