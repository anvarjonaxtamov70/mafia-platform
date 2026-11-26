import {CATALOG,type Keyboard} from '@mafia/bot-core';
export type V2SellerOffer={id:number;seller:number;buyer:number;expires:number;round:number};
const names:Record<string,string>={SHIELD:'Himoya',FAKE_DOC:'Hujjat',VOTE_SHIELD:'Ovozdan himoya',HERO_SHIELD:'Geroydan himoya'};
export function decodeSellerButton(raw:string):{game:number;offer:number;code:string}|null{
 if(raw.length>64)return null;
 const m=/^v2s:(\d+):(\d+):(SHIELD|FAKE_DOC|VOTE_SHIELD|HERO_SHIELD)$/.exec(raw);
 if(!m)return null;
 const game=Number(m[1]),offer=Number(m[2]);
 if(![game,offer].every(x=>Number.isSafeInteger(x)&&x>0))return null;
 return {game,offer,code:m[3]!};
}
export function sellerKeyboard(game:number,offer:number):Keyboard{
 return CATALOG.filter(i=>i.kind==='ARCADE'&&i.price!==null&&Object.hasOwn(names,i.code)).map(i=>{
  const data='v2s:'+game+':'+offer+':'+i.code;
  if(!decodeSellerButton(data))throw Error('invalid seller offer');
  return [{text:i.emoji+' '+names[i.code]+' — '+Math.ceil(i.price!/2)+(i.currency==='DIAMOND'?' 💎':' $'),callback_data:data}];
 });
}

export const SELLER_OFFER_TEXT='🛒 Sotuvchidan 50% chegirmali taklif. Bitta buyum tanlang. Xarid keyingi o‘yinlar inventariga qo‘shiladi.';
export const sellerRef=(game:number,offer:number)=>'v2seller:'+game+':'+offer;
export function sellerChoiceLabel(game:number,offer:number,code:string):string{
 return sellerKeyboard(game,offer).flat().find(b=>'callback_data'in b&&b.callback_data==='v2s:'+game+':'+offer+':'+code)?.text??'Tanlangan buyum';
}
