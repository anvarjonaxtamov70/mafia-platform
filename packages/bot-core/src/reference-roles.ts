/** Draft reference catalogue, NOT the live engine role registry. Do not deploy before parity. */
import { encode } from './callback-data';
import type { Keyboard } from './outbox-types';

export const REFERENCE_ROLES = [
  {
    "id": "citizen",
    "emoji": "👱",
    "name": "Tinch axoli",
    "description": "Mafiyani toping va kunduzgi ovoz berishda uni o‘yindan chiqaring."
  },
  {
    "id": "don",
    "emoji": "🤵🏻",
    "name": "Don",
    "description": "Mafia sardorisiz. Tungi hujum nishonini siz belgilaysiz."
  },
  {
    "id": "mafia",
    "emoji": "🤵🏼",
    "name": "Mafia",
    "description": "Donga bo‘ysunasiz. Don halok bo‘lsa, uning o‘rnini egallashingiz mumkin."
  },
  {
    "id": "manyak",
    "emoji": "🔪",
    "name": "Manyak",
    "description": "Boshqa barcha o‘yinchilarni o‘yindan chiqaring. Faol himoya hujumingizni to‘xtatadi."
  },
  {
    "id": "komissar",
    "emoji": "🕵🏻",
    "name": "Komissar",
    "description": "Shaharning asosiy himoyachisisiz va mafiyaga qarshi kurashasiz."
  },
  {
    "id": "doktor",
    "emoji": "👨🏼‍⚕️",
    "name": "Doktor",
    "description": "Tunda bir o‘yinchini qutqarishingiz mumkin."
  },
  {
    "id": "serjant",
    "emoji": "👮🏻",
    "name": "Serjant",
    "description": "Komissarning yordamchisisiz. Uning harakatlaridan xabardor bo‘lasiz. U halok bo‘lsa, o‘rnini egallaysiz."
  },
  {
    "id": "daydi",
    "emoji": "🧙",
    "name": "Daydi",
    "description": "Bir o‘yinchining uyiga borib, qotillikka guvoh bo‘lishingiz mumkin."
  },
  {
    "id": "frozen",
    "emoji": "❄️",
    "name": "Frozen",
    "description": "Maqsadingiz tirik qolish. Tashrif buyurgan o‘yinchingiz bir kun uxlaydi."
  },
  {
    "id": "advokat",
    "emoji": "👨🏼‍💼",
    "name": "Advokat",
    "description": "Mafia tarafidasiz. Tunda tanlagan mafia a’zongiz Komissarga tinch aholi bo‘lib ko‘rinadi."
  },
  {
    "id": "suidsid",
    "emoji": "🪦",
    "name": "Suidsid",
    "description": "Kunduzgi osish orqali o‘yindan chiqarilsangiz, g‘alaba qozonasiz."
  },
  {
    "id": "killer",
    "emoji": "🥷",
    "name": "убийца",
    "description": "Mafia tarafidasiz. Har tun yashirin hujum qilasiz; Komissarni nishonga olsangiz, o‘zingiz halok bo‘lasiz."
  },
  {
    "id": "kamikaze",
    "emoji": "💣",
    "name": "Kamikaze",
    "description": "Tinchlarga yordam berasiz. Tunda halok bo‘lsangiz, hujumchi ham halok bo‘ladi. Kunduz osilsangiz, bir o‘yinchini tanlab olib ketishingiz mumkin."
  },
  {
    "id": "grench",
    "emoji": "💚",
    "name": "Grench",
    "description": "Betarafsiz. Har tun 50–150 Dollar (o‘nlik qadamda) olasiz. Nishonning puli yetmasa, 50 joni kamayadi; joni tugasa, halok bo‘ladi. Maqsad — tirik qolish."
  },
  {
    "id": "minior",
    "emoji": "☠️",
    "name": "Minior",
    "description": "Erkinsiz. Tunda tanlangan uyga tuzoq qo‘yasiz; o‘sha uyga kelgan sizdan boshqa barcha o‘yinchilar halok bo‘ladi."
  },
  {
    "id": "shpion",
    "emoji": "🦇",
    "name": "Shpion",
    "description": "Mafia tarafidasiz. Tunda bir o‘yinchining rolini bilib, mafiyalarga oshkor qilishingiz mumkin."
  },
  {
    "id": "zombi",
    "emoji": "🧟",
    "name": "Zombi",
    "description": "Shahardagi hammani zombiga aylantirishga harakat qilasiz."
  },
  {
    "id": "kimyogar",
    "emoji": "👨‍🔬",
    "name": "Kimyogar",
    "description": "Mafia tarafidasiz. Tunda mafia a’zosini tanlasangiz, himoya qilasiz; boshqa tarafdagi nishonga hujum qilasiz."
  },
  {
    "id": "tentak",
    "emoji": "👶",
    "name": "Tentak",
    "description": "Tunda tanlagan o‘yinchingiz tinch tarafda bo‘lsa, o‘sha kuni uni osib bo‘lmaydi. Aks holda unga hujum qilasiz."
  },
  {
    "id": "buqalamun",
    "emoji": "🦎",
    "name": "Buqalamun",
    "description": "Tunda bir marta o‘yinchi tanlaysiz va uning tarafida o‘yinni davom ettirasiz."
  },
  {
    "id": "sotuvchi",
    "emoji": "🎁",
    "name": "Sotuvchi",
    "description": "Tunda bir o‘yinchini tanlab, ertasi kuni mahsulotlarni yarim narxda taklif qilasiz. Xarid qilsa, 10% olasiz."
  },
  {
    "id": "krampous",
    "emoji": "😈",
    "name": "Krampous",
    "description": "Har tun takrorlanmaydigan nishon tanlaysiz. O‘zingizni tanlasangiz, avvalgi nishonlar bilan halok bo‘lasiz. Doktor, Kimyogar yoki faol himoya nishonni qutqarishi mumkin. Kamida 3 nishon halok bo‘lsa yutasiz. Erta faollashtirsangiz ham o‘zingiz halok bo‘lasiz. Rolingiz o‘zgarmaydi."
  },
  {
    "id": "omadli",
    "emoji": "🤞🏻",
    "name": "Omadli",
    "description": "Tinch aholisiz. Hujum qilinganda tasodifan omon qolishingiz mumkin."
  },
  {
    "id": "klaus",
    "emoji": "🎅🏻",
    "name": "Klaus",
    "description": "Tunda tanlagan o‘yinchingizga 50–200 Dollar sovg‘a qilasiz."
  },
  {
    "id": "sehrgar",
    "emoji": "🧙",
    "name": "Sehrgar",
    "description": "Kimdir hujum qilsa, uni kechirish yoki kechirmaslikni tanlaysiz. O‘yin oxirigacha tirik qolsangiz, yutasiz."
  },
  {
    "id": "mergan",
    "emoji": "🎯",
    "name": "Mergan",
    "description": "Yakka rollar orasida kuchlisiz. Boshqa yakka rollar sizni o‘ldira olmaydi."
  },
  {
    "id": "janob",
    "emoji": "🎖️",
    "name": "Janob",
    "description": "Kunduzgi ovozingiz ikkita ovozga teng. Ovoz berganda shaxsingiz oshkor bo‘lmaydi."
  },
  {
    "id": "qoy",
    "emoji": "🐑",
    "name": "Qo'y",
    "description": "Suidsidni osishda qatnashgan o‘yinchining roli Qo‘yga aylanadi."
  }
] as const;

export function referenceRolesView(): {text:string;keyboard:Keyboard} {
  const keyboard:Keyboard=[];
  for(let i=0;i<REFERENCE_ROLES.length;i+=2){
    keyboard.push(REFERENCE_ROLES.slice(i,i+2).map(r=>({text:r.emoji+' '+r.name,callback_data:encode({t:'menu',section:'ref_'+r.id})})));
  }
  return {text:"Rollar ro'yhati:",keyboard};
}

/** Telegram callback alerts have a 200-character limit. Longer descriptions are private messages. */
export function referenceRoleDetail(section:string):{text:string;alert:boolean}|null{
  const role=REFERENCE_ROLES.find(r=>'ref_'+r.id===section);
  if(!role)return null;
  const text=role.emoji+' '+role.name+'\n\n'+role.description;
  return {text,alert:text.length<=200};
}
