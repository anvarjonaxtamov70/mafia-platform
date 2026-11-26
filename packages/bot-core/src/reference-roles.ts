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
    "description": "Har tun bitta harakat: o‘yinchining aniq rolini tekshirish yoki unga hujum qilish. Serjant harakatlaringizdan xabardor bo‘ladi."
  },
  {
    "id": "doktor",
    "emoji": "👨🏼‍⚕️",
    "name": "Doktor",
    "description": "Tunda tanlangan o‘yinchini barcha hujumlardan qutqarasiz. O‘zingizni o‘yinda bir marta, boshqalarni ketma-ket davolashingiz mumkin."
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
    "description": "Tanlangan uyga borasiz. Qotillikka guvoh bo‘lsangiz, hujumchining ismi va rolini bilasiz."
  },
  {
    "id": "frozen",
    "emoji": "❄️",
    "name": "Frozen",
    "description": "Tinch tarafdasiz. Tanlangan o‘yinchi bir kun barcha harakatlardan mahrum bo‘ladi. O‘zingizni va ayni nishonni ketma-ket tanlay olmaysiz."
  },
  {
    "id": "advokat",
    "emoji": "👨🏼‍💼",
    "name": "Advokat",
    "description": "Mafia tarafidasiz. Tanlangan mafia a’zosi tekshiruvda tinch aholi ko‘rinadi. Himoyangizdagi nomzod osilishdan qutuladi."
  },
  {
    "id": "suidsid",
    "emoji": "🪦",
    "name": "Suidsid",
    "description": "Faqat kunduzgi osish orqali o‘yindan chiqarilsangiz g‘alaba qozonasiz. O‘zingizga ovoz bera olmaysiz."
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
    "description": "Kunduz osilsangiz, bir o‘yinchini olib ketib yutasiz. Tunda halok bo‘lsangiz, barcha hujumchilar ham halok bo‘ladi. Komissar hujum qilgan bo‘lsa yutqazasiz. Tirik qolsangiz ham yutqazasiz. Geroy egasiga qasos tatbiq etilmaydi."
  },
  {
    "id": "grench",
    "emoji": "💚",
    "name": "Grench",
    "description": "Betarafsiz. Tunda nishonga 50–150 Dollar yoki 17% jon berish tanlovini yuborasiz. Javob bo‘lmasa pul olinadi; pul yetmasa 17% jon kamayadi. Tirik qolish — maqsadingiz."
  },
  {
    "id": "minior",
    "emoji": "☠️",
    "name": "Minior",
    "description": "Yakka rol. Bir tun tanlangan uyga tuzoq qo‘yasiz. O‘sha uyga kelgan boshqa personajlar halok bo‘ladi; uy egasi tirik qoladi. Ketma-ket bir uyga qo‘yish mumkin."
  },
  {
    "id": "shpion",
    "emoji": "🦇",
    "name": "Shpion",
    "description": "Mafia tarafida. Tunda bitta o‘yinchining rolini bilib, mafiyalarga oshkor qilishingiz mumkin. Faol hujjat haqiqiy rolni yashiradi."
  },
  {
    "id": "zombi",
    "emoji": "🧟",
    "name": "Zombi",
    "description": "Faqat Zombi rejimida. Tunda bir o‘yinchini zombiga aylantirasiz. Aylanganlar eski qobiliyatlarini yo‘qotadi va boshqalarni zombiga aylantirishi mumkin."
  },
  {
    "id": "kimyogar",
    "emoji": "👨‍🔬",
    "name": "Kimyogar",
    "description": "Mafia tarafidasiz. Mafia a’zosini barcha hujumlardan himoya qilasiz, boshqa tarafdagi nishonga hujum qilasiz. O‘zingizni himoya qila olmaysiz."
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
    "description": "Bir marta o‘yinchi tanlaysiz: tinch taraf bo‘lsa Serjantga, mafia bo‘lsa Mafiyaga, yakka rol bo‘lsa Manyakka aylanasiz. Tanlamaguningizcha betarafsiz."
  },
  {
    "id": "sotuvchi",
    "emoji": "🎁",
    "name": "Sotuvchi",
    "description": "Betaraf. Tunda bir o‘yinchini tanlaysiz; ertasi kuni yarim narxda mahsulot taklif qilasiz. Xarid qilsa 10% olasiz. Tirik qolish — maqsadingiz."
  },
  {
    "id": "krampous",
    "emoji": "😈",
    "name": "Krampous",
    "description": "Har tun takrorlanmaydigan nishon tanlaysiz. O‘zingizni tanlasangiz, avvalgi nishonlar bilan halok bo‘lasiz. Doktor, Kimyogar yoki faol himoya nishonni qutqarishi mumkin. Kamida 3 nishon halok bo‘lsa yutasiz; oldin halok bo‘lgan nishonlar ham hisoblanadi."
  },
  {
    "id": "omadli",
    "emoji": "🤞🏻",
    "name": "Omadli",
    "description": "Tinch tarafdasiz. Birinchi mos hujumdan 100% omon qolasiz. Avval tabiiy omad, keyin sotib olingan himoya ishlaydi."
  },
  {
    "id": "klaus",
    "emoji": "🎅🏻",
    "name": "Klaus",
    "description": "Betaraf. Tunda tanlagan o‘yinchingizga 50–200 Dollar sovg‘a qilasiz. Tirik qolish — maqsadingiz."
  },
  {
    "id": "sehrgar",
    "emoji": "🧙",
    "name": "Sehrgar",
    "description": "Hujumchilarni birgalikda kechirsangiz, hamma tirik qoladi; kechirmasangiz, hujumchilar halok bo‘ladi. Javob bermasangiz, o‘zingiz halok bo‘lasiz. Tirik qolsangiz yutasiz."
  },
  {
    "id": "mergan",
    "emoji": "🎯",
    "name": "Mergan",
    "description": "Har tun hujum qilasiz. Yakka rollar sizni o‘ldira olmaydi; boshqa yakka rollar kabi yakka g‘alaba uchun kurashasiz."
  },
  {
    "id": "janob",
    "emoji": "🎖️",
    "name": "Janob",
    "description": "Kunduzgi ovozingiz ikkita ovozga teng. Ovoz berganda shaxsingiz oshkor bo‘lmaydi."
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
