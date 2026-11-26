/** Native Telegram V2 menu layouts. No prices, balances or inventory quantities are invented. */
import {CATALOG,encode,backRow,itemName,formatDate,HERO_V2_PRICE,type InventoryInfo,type CatalogItem,type Keyboard} from '@mafia/bot-core';
import {escapeHtml,t} from '@mafia/localization';
import type {RegistryCore} from './registry-core';
import type {HeroV2Core} from './hero-v2-core';
import type {ParaPair} from './para-core';
type View={text:string;keyboard:Keyboard};
const separator='━━━━━━━━━━━━━━━━━━';
const num=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const title=(emoji:string,label:string)=>emoji+' <b>HYPERNOVA | '+label+'</b>\n'+separator;
const menu=(text:string,section:string)=>({text,callback_data:encode({t:'menu',section})});
const eco=(text:string,op:string,arg='')=>({text,callback_data:encode({t:'eco',op,arg})});
const items=CATALOG.filter(i=>i.kind==='ARCADE');
const price=(i:CatalogItem)=>num(i.price??0)+(i.currency==='DIAMOND'?' 💎':' $');
const quantity=(inv:InventoryInfo,code:string)=>inv.items.find(i=>i.code===code)?.qty??0;
const balance=(inv:InventoryInfo)=>'💵 Dollar: <b>'+(inv.permanentOwner?'∞':num(inv.coins))+' $</b>\n💎 Olmos: <b>'+(inv.permanentOwner?'∞':num(inv.diamonds??0))+'</b>';
const label=(i:CatalogItem)=>i.emoji+' '+itemName(i.code);
export function v2ProfileView(p:NonNullable<ReturnType<RegistryCore['v2ProfileSummary']>>,inv:InventoryInfo,hero:ReturnType<HeroV2Core['view']>,partner:string|null):View{
 const until=inv.tier==='VIP_PRO'?inv.proUntil:inv.vipUntil;
 const tier=inv.permanentOwner?'Egasi':inv.tier==='FREE'?'Oddiy':inv.tier+(until?' · '+formatDate(until):'');
 const rate=p.played?Math.round(p.wins/p.played*100):0;
 const heroLine=hero?escapeHtml(hero.name)+' · '+num(hero.level)+'-daraja':p.heroOwned?'Mavjud · V2 hisobi ochilmagan':'Mavjud emas';
 return {text:title('👤','PROFIL')+'\n<b>'+escapeHtml(p.name)+'</b>\n⭐ '+escapeHtml(tier)+'\n\n'+balance(inv)+'\n\n🏅 <b>Reyting ballari: '+num(p.points)+'</b>\n🎮 O‘yinlar: '+num(p.played)+'\n🏆 G‘alabalar: '+num(p.wins)+' · '+rate+'%\n\n🥷 Geroy: '+heroLine+'\n💞 Para: '+(partner?escapeHtml(partner):'Yo‘q')+'\n\n<i>O‘yin statistikasi barcha saqlangan natijalarni qamrab oladi.</i>',keyboard:[[menu('🎒 Inventar','inventory'),menu('🛒 Do‘kon','shop')],[menu('🥷 Geroy','hero'),menu('🏆 Geroy TOP','herotop')],[menu('📜 Tarix','history'),eco('📊 Rol statistikasi','stats')],[menu('💞 Para','para'),menu('⭐ VIP','vip')],backRow()]};
}
export function v2ShopView(inv:InventoryInfo,heroEnabled:boolean):View{
 return {text:title('🛒','DO‘KON')+'\n'+balance(inv)+'\n\n<b>Himoya buyumlari</b>\n'+items.map(i=>label(i)+' — <b>'+price(i)+'</b>\n   <i>'+t('item_desc.'+i.code)+'</i>\n   Inventarda: '+quantity(inv,i.code)).join('\n\n')+'\n\n🥷 Shaxsiy geroy: '+(heroEnabled?HERO_V2_PRICE+' 💎 (doimiy)':'sinov iqtisodiyoti o‘chiq')+'\n<i>Buyumlar o‘yin sozlamalariga muvofiq ishlaydi.</i>',keyboard:[...items.map(i=>[eco(label(i)+' · '+price(i),'buy',i.code)]),[menu('🥷 Geroy','hero'),menu('⭐ VIP','vip')],[menu('🎒 Inventar','inventory'),menu('👤 Profil','profile')],[menu('💎 Olmos','buy_diamonds'),menu('💵 Dollar','buy_dollars')],backRow()]};
}
export function v2InventoryView(inv:InventoryInfo):View{
 const keyboard:Keyboard=[];
 const lines=items.map(i=>{
  const owned=inv.items.find(x=>x.code===i.code);
  const qty=owned?.qty??0;
  const armed=!!owned?.armed&&qty>0;
  if(qty>0)keyboard.push([eco((armed?'✅ ':'❌ ')+label(i)+' · '+qty,'arm',i.code)]);
  return label(i)+' — <b>'+qty+' dona</b>\n   '+(qty===0?'Mavjud emas':armed?'✅ Faol':'❌ Faol emas');
 });
 keyboard.push([menu('🛒 Do‘kon','shop'),menu('👤 Profil','profile')],backRow());
 return {text:title('🎒','INVENTAR')+'\n'+balance(inv)+'\n\n'+lines.join('\n\n')+'\n\n<i>Faollashtirilgan buyumlar keyingi mos o‘yinda band qilinadi. Ishlatilmagan buyumlar qaytariladi.</i>',keyboard};
}
export function v2BuyView(i:CatalogItem,inv:InventoryInfo):View{
 const enough=inv.permanentOwner||(i.currency==='DIAMOND'?inv.diamonds??0:inv.coins)>=(i.price??0);
 return {text:title('🛒','XARID')+'\n<b>'+label(i)+'</b>\n'+t('item_desc.'+i.code)+'\n\nNarx: <b>'+price(i)+'</b>\nInventarda: '+quantity(inv,i.code)+' dona\n\n'+balance(inv)+'\n\n'+(enough?'Xaridni tasdiqlaysizmi?':'Mablag‘ yetarli emas.'),keyboard:[...(enough?[[eco('✅ Tasdiqlash','buyok',i.code)]]:[]),[eco('⬅️ Do‘konga qaytish','shop')]]};
}

/** Consistent native Telegram menus. V1 navigation is not changed. */
export function v2HomeView(name:string):View{
 return {text:title('🌌','MAFIA')+'\nXush kelibsiz, <b>'+escapeHtml(name.slice(0,64)||'do‘st')+'</b>!\n\n🎭 27 ta personaj · 4 ta rejim\n<i>V2 · sinov muhiti</i>',keyboard:[[menu('🎮 O‘ynash','play')],[menu('👤 Profil','profile'),menu('🥷 Geroy','hero')],[menu('🛒 Do‘kon','shop'),menu('🎒 Inventar','inventory')],[menu('🎭 Personajlar','characters'),menu('🏆 Geroy TOP','herotop')],[menu('💞 Para','para'),menu('⭐ VIP','vip')],[menu('🎁 Taklif','invite'),menu('🎁 Kunlik','daily')],[menu('⚙️ Sozlamalar','settings'),menu('❔ Yordam','help')]]};
}
export function v2RulesView():View{
 return {text:title('📖','QOIDALAR')+'\n4–30 o‘yinchi. VS rejimida juft son.\n\n<b>🎩 Classic</b> — tinch aholi, mafia va mustaqil rollar.\n<b>🧟 Zombi</b> — zombilar boshqa o‘yinchilarni aylantiradi.\n<b>🌌 Hypernova</b> — boshlanishda faol rollar.\n<b>⚔️ VS</b> — teng qizil va ko‘k jamoalar.\n\n<b>O‘yin jarayoni</b>\nGuruhda /game. Rejimni guruh admini /settings orqali keyingi o‘yin uchun belgilaydi.\nTungi harakatlar va nomzod tanlash botning shaxsiy chatida. Hukm uchun Ha/Yo‘q ovozi guruhda. Har bir asosiy bosqich 30 soniya; oxirgi so‘z 29 soniya. Maxsus rol javoblari uchun alohida vaqt berilishi mumkin.\n\n<b>Geroy va buyumlar</b>\nGeroydan Don, Komissar va Mergan tongda o‘yinda bir marta foydalanishi mumkin. Buyumlar guruh sozlamalari va rol qoidalariga bog‘liq.\n\n<i>Para o‘yin natijasiga ta’sir qilmaydi.</i>',keyboard:[[menu('🎭 Personajlar','characters'),menu('💞 Para','para')],backRow()]};
}
export function v2ParaView(pair:ParaPair|null,notice?:string):View{
 const body=pair?'💞 <b>Parangiz:</b> '+escapeHtml(pair.partner)+'\n\nSizda bitta faol para mavjud.':'🤍 <b>Hozircha parangiz yo‘q.</b>\n\nGuruhda yoqtirgan insoningiz xabariga javob qilib <code>/para</code> yozing. Taklif faqat uning bot chatiga yuboriladi. U yerda qabul qilishi yoki rad etishi mumkin.';
 return {text:title('💞','PARA')+'\n'+(notice?escapeHtml(notice)+'\n\n':'')+body+'\n\n<i>Para o‘yin rollari, ball va mukofotlarga ta’sir qilmaydi.</i>',keyboard:[...(pair?[[menu('💔 Parani bekor qilish','paraconfirm')]]:[]),[menu('👤 Profil','profile')],backRow()]};
}
export function v2ParaConfirm(pair:ParaPair):View{
 return {text:title('💔','PARANI BEKOR QILISH')+'\n<b>'+escapeHtml(pair.partner)+'</b> bilan parani bekor qilasizmi?\n\nTasdiqlashdan keyin ikkala foydalanuvchining parasi olib tashlanadi.',keyboard:[[eco('✅ Ha','paraq',String(pair.id)),eco('❌ Yo‘q','paranop',String(pair.id))],[menu('⬅️ Para','para')]]};
}
