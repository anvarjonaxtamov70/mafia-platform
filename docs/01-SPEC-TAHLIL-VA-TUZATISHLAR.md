# MAFIA BOT — SPETSIFIKATSIYA TAHLILI VA TUZATISHLAR (v1.0 → v1.1)

Bu hujjat `MAFIA TELEGRAM BOT — MASTER TECHNICAL SPECIFICATION v1.0` ni tahlil qilish natijasi.
Har bir band: **muammo** va **tuzatish (v1.1 qoidasi)**. Tasdiqlangandan keyin bu qoidalar asosiy spetsifikatsiyadan ustun turadi.

Belgilar: 🔴 ziddiyat (matnning ikki joyi bir-biriga zid), 🟡 noaniqlik (kod yozish uchun qoida yetishmaydi), 🔵 texnik kamchilik.

---

## 1. Umumiy baho

Spetsifikatsiya juda yaxshi tuzilgan: GameEngine Telegramdan ajratilgan, NightResolver bosqichlari, idempotentlik, ledger, Stars, restart va xavfsizlik talablari to‘g‘ri qo‘yilgan. 30 ta rol soni to‘g‘ri (13 + 8 + 6 + 3 = 30), §11 jadvalidagi sonlar yig‘indisi to‘g‘ri, profil namunasidagi g‘alaba foizi (129/240 = 53.75%) to‘g‘ri.

Asosiy kamchiliklar uch xil:
1. Bir nechta joyda nomlar va qoidalar bir-biriga zid.
2. Ba’zi rollar uchun chekka holatlar yozilmagan (kod yozishda "taxmin" qilishga to‘g‘ri keladi).
3. Ma’lumotlar bazasi sxemasida bir nechta zarur jadval va maydon yo‘q.

---

## 2. Ziddiyatlar va texnik kamchiliklar

### T1 🔴 Bosqich va holat nomlari mos emas (§5 va §28)
- §5: `WAITING`, `FIRST_NIGHT`, `REGULAR_NIGHT`, `CANCELLED`.
- §28 `Phase`: `LOBBY` (WAITING emas), `CANCELLED` yo‘q. `GameStatus` da esa `WAITING`.

**Tuzatish:**
```ts
type GameStatus = "LOBBY" | "RUNNING" | "FINISHED" | "CANCELLED";
type Phase =
  | "LOBBY" | "READY_CHECK" | "ROLE_ASSIGNMENT"
  | "NIGHT"            // nightNumber = 1 → birinchi tun
  | "DAWN"             // tun hisoblanishi va e’lon
  | "DAY_DISCUSSION" | "DAY_VOTING" | "DAY_VERDICT"
  | "ENDED";
```
`FIRST_NIGHT` / `REGULAR_NIGHT` o‘rniga bitta `NIGHT` va `nightNumber` ishlatiladi. Birinchi tun farqi `nightNumber === 1` orqali aniqlanadi. `CANCELLED` bosqich emas, o‘yin holati (status).

### T2 🔴 "Ranked" rejimi faqat §24 da bor
§4 dagi rejimlar ro‘yxatida RANKED yo‘q, §24 esa "Classic / Ranked" deydi.

**Tuzatish:** RANKED alohida rejim emas, `GameConfig.ranked: boolean` bayrog‘i. U faqat CLASSIC va TOURNAMENT rejimlarida `true` bo‘la oladi (ADVANCED keyinroq, balans testidan o‘tgach). ARCADE, CHAOS, PRIVATE da har doim `false`.

### T3 🔴 Classic'da mustaqil rol bormi?
§4.1: "Shahar jamoasi va Mafia". §11 jadvali va §11.2 da esa 12 o‘yinchilik Classic'da Masxaraboz bor.

**Tuzatish:** Classic'da faqat **xavfsiz mustaqil** rol (Masxaraboz) 12+ o‘yinchida ruxsat etiladi. Hujum qiluvchi mustaqil rollar Classic'da yo‘q.

### T4 🔴 XP formulasi va profil namunasi mos emas (§16)
Namunada: 18-daraja, 12 450 XP. `100 × n²` bo‘yicha 18-darajaga 32 400 XP (yoki qadamlar yig‘indisi bo‘lsa 178 500 XP) kerak. Formula "keyingi darajaga qadam" yoki "jami XP" ekani ham aniq emas.

**Tuzatish:** `totalXpForLevel(L) = 100 × (L − 1)²` (L-darajaga yetish uchun **jami** XP). 1-daraja = 0 XP, 2-daraja = 100, 10-daraja = 8 100, 12-daraja = 12 100. Namunadagi o‘yinchi (12 450 XP) **12-daraja** bo‘ladi. Namuna shunga ko‘ra tuzatiladi.

### T5 🔴 Don qobiliyati takrorlangan
§8.2.4: "Don jamoadoshlari haqida ma’lumotga ega". Lekin §8 boshida barcha Mafia a’zolari bir-birini biladi.

**Tuzatish:** Bu band olib tashlanadi. Donning farqi: Mafia ovozida teng holatni hal qiladi va birinchi navbatdagi hujum ijrochisi.

### T6 🟡 §11 jadvalida oraliq sonlar yo‘q
8, 10, 12, 15, 20, 25, 30 berilgan, 9, 11, 13, 14, 16–19, 21–24, 26–29 uchun qoida yo‘q.

**Tuzatish:** Jadval qadamli ishlaydi. N o‘yinchi uchun N dan kichik yoki teng eng yaqin qator olinadi. Mafia va Mustaqil soni shu qatordan, Shahar = N − Mafia − Mustaqil.
Misol: 14 o‘yinchi → 12-qator → Mafia 3, Mustaqil 1, Shahar 10.

### T7 🟡 Manyak qachon chiqishi aniq emas (§11.1)
**Tuzatish:** Manyak faqat ADVANCED va CHAOS rejimlarida, kamida 15 o‘yinchida chiqadi. Bitta o‘yinda faqat bitta Manyak. Ovchi bilan birga faqat 20+ o‘yinchida.

### T8 🔵 Ma’lumotlar bazasida yetishmayotgan jadval va maydonlar (§27)
| Muammo | Tuzatish |
|---|---|
| `payments.order_id` bor, lekin `orders` jadvali yo‘q (§20 "server buyurtma yaratadi") | `orders` jadvali: `id, user_id, product_id/plan_id, price, currency, status, invoice_payload (unique), created_at` |
| §3.4 asosiy xabarni tahrirlashni talab qiladi, lekin `games` da xabar ID yo‘q | `games.lobby_message_id`, `games.chat_id` (BigInt) |
| "Ketma-ket ikki kecha" cheklovlari, qolgan zaryadlar, Mer ochilgani, Sudya veto ishlatgani saqlanmaydi | `game_players.ability_state` (JSONB): `charges`, `lastTargetIds`, `revealed`, `vetoUsed` va h.k. |
| Oshiqlar, Egizaklar, Ovchi nishoni bog‘lanishi uchun joy yo‘q | `game_links`: `game_id, type (LOVERS/TWINS/HUNTER_TARGET), player_a_id, player_b_id, created_at` |
| Tungi himoya/niqob effektlari (§12.4) saqlanmaydi | `game_effects`: `game_id, night_number, type, owner_id, target_id, remaining_charges, priority, expires_at_phase` |
| `votes` da "Hech kim" tanlovi uchun joy yo‘q | `target_id` nullable + `choice` (`PLAYER` / `NONE`); unique `(game_id, day_number, voter_id)` |
| `products` da §18 dagi `rarity, effect_type, duration, usage_limit, allowed_game_modes` yo‘q | Maydonlar qo‘shiladi |
| `users.is_banned` va `bans` jadvali; `groups.settings_json` va `group_settings` — dublikat | Bitta manba: `bans` jadvali va `group_settings` jadvali. `users.is_banned` olib tashlanadi |
| `user_profiles.rating` bitta, reyting esa 7 xil (§24) | `leaderboard_seasons` + `rating_entries (season_id, scope, scope_ref, user_id, rp)` |
| Pul miqdori turi ko‘rsatilmagan | Coins va Stars faqat butun son (`BigInt`/`Int`), float ishlatilmaydi. `wallet_transactions.idempotency_key` unique, `balance_after` maydoni |
| `referrals.referred_user_id` unique emas | Unique (bitta akkaunt faqat bir marta taklif qilinadi) |
| `game_events.sequence` | Unique `(game_id, sequence)` |
| `/delete_me` va to‘lovlarga bog‘langan FK | O‘chirish = anonimlashtirish (ism/username tozalanadi, to‘lov va audit yozuvlari qoladi) |

### T9 🔵 Texnologiya to‘plami boshlanish uchun haddan tashqari katta
§2.3 da 5 ta app (bot, api, worker, admin-web, mini-app).

**Tuzatish:** Boshida faqat 2 ta app: `apps/bot` (NestJS + grammY, keyin shu yerga REST API ham qo‘shiladi) va `apps/worker` (BullMQ taymerlar va xabar navbati). `admin-web`, `mini-app`, alohida `api` keyingi bosqichlarda. Test framework: **Vitest** (ikkalasidan biri emas, aniq tanlov). Paket menejeri: **pnpm workspaces**. Konfiguratsiya validatsiyasi: **zod**. Log: **pino**.

### T10 🔵 GameEngine deterministik bo‘lishi aniq yozilmagan
**Tuzatish:** `packages/game-engine` — sof TypeScript, Telegram, Prisma, Redis'ga bog‘liq emas. Tasodifiy son generatori tashqaridan beriladi (testda seed bilan, productionda `crypto`). Bir xil holat + bir xil harakatlar = har doim bir xil natija. Shu tufayli simulyatsiya, replay va restartdan keyin tiklash ishonchli ishlaydi.

---

## 3. Rollar va o‘yin mexanikasidagi noaniqliklar

### Q1 🟡 Bloklangan bir martalik qobiliyat zaryadi
Muhandis, Advokat, Soxtakor, Sehrgar, Yolg‘iz bo‘ri, Ovchi hujumi bloklansa, zaryad yo‘qoladimi?

**Tuzatish:** Bloklangan harakat zaryadni **sarflamaydi** va "oxirgi nishon" sifatida yozilmaydi.

### Q2 🟡 Sherif hisoboti va bloklovchilar
§7.4 faqat ijobiy natijani ko‘rsatadi.

**Tuzatish:**
- Nishon faol harakat qilgan bo‘lsa: "Siz tanlagan o‘yinchi shu kecha maxsus harakat qilmoqchi edi."
- Qilmagan bo‘lsa: "Siz tanlagan o‘yinchi shu kecha hech qanday maxsus harakat qilmadi."
- Bloklash harakatlari bir vaqtda qo‘llanadi (§12.2.3). Bloklangan bloklovchining **o‘z bloki baribir ishlaydi**, lekin uning boshqa natijalari (Sherif hisoboti) kelmaydi.

### Q3 🟡 "Tashrif" nimani anglatadi (Detektiv, Kuzatuvchi, Josus)
**Tuzatish:** Boshqa o‘yinchiga qaratilgan, bloklanmagan har qanday faol tungi harakat — tashrif (himoya, tekshiruv, blok, hujum, Amur, Qasoskor belgisi, O‘g‘ri, Soxtakor, Advokat, Ruhoniy). O‘ziga qaratilgan harakat (Sehrgar, Yolg‘iz bo‘ri, Muhandis o‘ziga) tashrif emas. Mafia jamoaviy hujumida faqat ijrochi tashrif qiladi. Ijrochi o‘z shaxsiy harakatini ham qilsa, ikkita tashrif yoziladi.

### Q4 🟡 Qo‘riqchi qurbon bo‘lganda
**Tuzatish:** Hujum Qo‘riqchiga yo‘naltiriladi va Qo‘riqchiga qo‘yilgan himoyalardan o‘tadi (masalan, Doktor Qo‘riqchini davolagan bo‘lsa, Qo‘riqchi ham tirik qoladi). Qo‘riqchining o‘limi tungi hujumdan o‘lim hisoblanadi (Oshiq bo‘lsa yurak ezilishi ishlaydi).

### Q5 🟡 Himoya ustuvorligi to‘liq emas (§12.2.8)
Arcade Qalqoni ro‘yxatda yo‘q.

**Tuzatish (yakuniy tartib):**
1. Muhandis
2. Arcade Qalqoni (faqat ARCADE)
3. Sehrgar Barrier / Yolg‘iz bo‘ri himoyasi
4. Doktor
5. Mafia Qo‘riqchisi
6. Shahar Qo‘riqchisi (qurbon bo‘lish)
7. Feniks qayta tirilishi
8. O‘lim

Demak Doktor Feniksni davolasa, Feniksning tirilishi sarflanmaydi.

### Q6 🟡 Ruhoniy qaysi aldovlarni bekor qiladi, Konsilyeriga nima ta’sir qiladi
**Tuzatish:**
- Jamoa darajasidagi aldovlar: Advokat niqobi, Soxtakor, Sehrgar Mirage, Arcade Soxta hujjat. Ular faqat **jamoa tekshiruvlariga** (Komissar, Jurnalist) ta’sir qiladi.
- Ruhoniy shu aldovlarning **barchasini** bekor qiladi.
- Konsilyeri har doim haqiqiy rolni ko‘radi, hech qaysi aldov unga ta’sir qilmaydi.

### Q7 🟡 Vaziyat 6 natijasi yozilmagan
**Tuzatish:** Tartib: Advokat (SHAHAR) → Soxtakor (MAFIA) → Ruhoniy (haqiqat). Ruhoniy bo‘lmasa yakuniy natija **MAFIA**. Jurnalist uchun aldov har bir o‘yinchiga alohida qo‘llanib, keyin solishtiriladi.

### Q8 🟡 Ovchi
- Nishon kunduzgi ovozda yoki yurak ezilishidan o‘lsa-chi? "U halok bo‘lgan tongda" faqat tunni nazarda tutadi.
- Nishon `PERSONAL_WIN_EXIT` yoki `LEFT` bo‘lsa, Ovchi hech qachon yuta olmaydi.

**Tuzatish:**
- Nishon har qanday sabab bilan o‘lsa va Ovchi shu hisoblash yakunida tirik bo‘lsa (tong yoki hukm yakuni), Ovchi g‘alaba qiladi.
- Nishon o‘lmasdan chiqib ketsa, Ovchiga yangi tasodifiy tirik nishon beriladi va shaxsiy xabar yuboriladi.
- Ovchi asosiy fraksiya g‘alabasini to‘xtatmaydi.

### Q9 🟡 Sehrgar: "uchinchi tun yakunidagi tong"
**Tuzatish:** `nightNumber ≥ 3` bo‘lgan birinchi tongda ikkala sehr ishlatilgan va Sehrgar tirik bo‘lsa, g‘alaba. Barrier hujum bo‘lmasa ham ishlatilgan hisoblanadi (bloklanmagan bo‘lsa).

### Q10 🟡 O‘g‘ri: "muvaffaqiyatli o‘g‘rilik"
**Tuzatish:** Muvaffaqiyatli = bloklanmagan va nishon tong paytida tirik. Jarima ovoz hisoblanayotgan paytda qo‘llanadi: `og‘irlik = max(0, asosiy og‘irlik − 1)`. Mer shu kuni ochilsa: 2 − 1 = 1. Egizak bonusida: 2 − 1 = 1.

### Q11 🟡 Shaxsiy va asosiy g‘alabalar tartibi
**Tuzatish:** Har bir tong va hukmdan keyin:
1. Shaxsiy g‘alabalar tekshiriladi → `PERSONAL_WIN_EXIT`.
2. Keyin tirik ro‘yxat bo‘yicha fraksiya g‘alabasi tekshiriladi. Shaxsiy chiqish Mafia pariteti hisobini o‘zgartiradi.
3. O‘yin tugaganda tirik qolgan Yolg‘iz bo‘ri sharti (tirik ≤ 4) yana bir marta tekshiriladi. Boshqa bajarilmagan mustaqil rollar mag‘lub hisoblanadi.

### Q12 🟡 Manyak 1 ga 1 qolganda
Manyak va Mafia 1:1 qolsa, ikkalasi bir-birini o‘ldirib durrang chiqishi yoki himoyalar tufayli 20 siklgacha cho‘zilishi mumkin.

**Tuzatish:** Tirik 2 kishi qolsa va ulardan biri Manyak bo‘lsa, Manyak darhol g‘alaba qiladi. G‘alabani to‘xtatuvchi rollar ro‘yxati aniq: faqat Manyak (`blocksMainWin = true`). Ovchi, O‘g‘ri, Masxaraboz, Sehrgar, Yolg‘iz bo‘ri to‘xtatmaydi.

### Q13 🟡 Sudya
**Tuzatish:** Sudya o‘zini ham qutqara oladi. `DAY_VERDICT` bosqichi faqat nomzod bo‘lsa va tirik, vetoni ishlatmagan Sudya bo‘lsa ochiladi. Aks holda 15 soniya kutilmaydi, darhol hukm.

### Q14 🟡 Mer qayerda o‘zini e’lon qiladi
**Tuzatish:** Shaxsiy chatdagi tugma orqali, `DAY_DISCUSSION` yoki `DAY_VOTING` davomida. Guruhga e’lon yuboriladi.

### Q15 🟡 Oshiqlar va Egizaklar chekka holatlari
**Tuzatish:**
- Oshiqlardan biri kunduzgi ovozda chiqarilsa ham, ikkinchisi yurak ezilishidan o‘ladi.
- `LEFT` (ixtiyoriy chiqish) yurak ezilishini ishga tushirmaydi (§32.2 bilan mos).
- Feniks qayta tirilsa, u o‘lmagan hisoblanadi, sherigi tirik qoladi.
- Amur bloklansa ham bog‘lanish majburiy: server tasodifiy tanlaydi.
- Egizaklar: "birinchi Egizak" emas, "Egizaklardan biri" halok bo‘lsa (tun yoki kunduz). `LEFT` bonus bermaydi.

### Q16 🟡 Feniks e’loni rolni fosh qiladi
"🔥 FENIKS QAYTA TIRILDI!" ism bilan chiqsa, rol fosh bo‘ladi.

**Tuzatish:** Standart: qayta tirilish fakti e’lon qilinadi, ism **yashiriladi** ("🔥 Tunda kimdir o‘limdan qaytdi!"). Ism bilan e’lon guruh sozlamasi.

### Q17 🟡 LEFT bo‘lgan o‘yinchining bog‘lanishlari
**Tuzatish:** Don chiqsa — hujum ijrochiligi keyingisiga o‘tadi. Ovchi nishoni chiqsa — yangi nishon (Q8). Qasoskor chiqsa — belgisi bekor. LEFT o‘yinchi tirik hisoblanmaydi (paritet va g‘alaba hisobida).

---

## 4. Telegram va texnik cheklovlar

| # | Muammo | Tuzatish |
|---|---|---|
| E1 | `callback_data` 64 bayt bilan cheklangan | Qisqa format: `v1:<gameShortId>:<phaseNo>:<act>:<seat>`. Qolgan tekshiruv serverda (§31.3) |
| E2 | `pre_checkout_query` ga Telegram 10 soniya ichida javob kutadi | Faqat tez tekshiruv (narx, mahsulot faolligi, buyurtma holati), og‘ir ish `successful_payment` dan keyin |
| E3 | Stars obunasi | Bot API'da obuna `createInvoiceLink` dagi `subscription_period` orqali qilinadi. U hozircha faqat `2592000` (30 kun) bo‘lishi mumkin va narx 10 000 Stars dan oshmasligi kerak ([Bot API](https://core.telegram.org/bots/api)). Guruhga bog‘langan CLUB tarifi bizning serverda guruhga biriktiriladi |
| E4 | Telegram xabar limitlari | Bitta chatga sekundiga ~1 xabar, guruhga daqiqasiga ~20 xabar, umumiy ~30 xabar/soniya. Barcha xabarlar navbat orqali, `429` da `retry_after` |
| E5 | Mafia ichki chati qanday ishlashi yozilmagan | Tunda Mafia a’zosi botga shaxsiy chatda yozgan matnni bot boshqa tirik Mafia a’zolariga yuboradi. Shaxsiy chat xabarlari Privacy Mode'dan qat’i nazar botga keladi |
| E6 | O‘lgan o‘yinchilarning guruhda gapirishi haqida qoida yo‘q (ko‘p Mafia botlarda bor) | Ixtiyoriy guruh sozlamasi, standartda o‘chiq. Yoqish uchun bot admin bo‘lishi (`can_delete_messages`) va guruh xabarlarini olishi kerak. Bu §5.5 dagi Privacy Mode maqsadiga zid, shuning uchun majburiy emas |
| E7 | Lobbyda shaxsiy chat ochmagan foydalanuvchi | Deep link: `t.me/<bot>?start=join_<gameShortId>` — `/start` bosilishi bilan avtomatik lobbyga qo‘shiladi |
| E8 | 8 ta haqiqiy odamsiz sinab bo‘lmaydi | Faqat development muhitida: `minPlayers` pastroq va simulyatsiya qilingan "bot-o‘yinchilar". Productionda o‘chirilgan |
| E9 | Ikki worker bir tunni ikki marta yakunlashi (§12.5) | `SELECT … FOR UPDATE` + `games.version` tekshiruvi; BullMQ `jobId = <gameId>:<phaseNumber>` takrorni oldini oladi |
| E10 | Kutubxona versiyalari | 1-bosqichda `npm view` orqali amaldagi barqaror versiyalar tekshiriladi (ayniqsa Prisma va NestJS major versiyalaridagi o‘zgarishlar) |

---

## 5. Hajm haqida

Spetsifikatsiyadagi hammasi — bir necha oylik ish. Asosiy xavf: pul, VIP, do‘kon va admin panelga o‘yin yadrosi ishonchli bo‘lmasdan oldin vaqt sarflash.

Shuning uchun ish rejasida (`docs/02-ISH-REJASI.md`):
- GameEngine Telegramdan oldin, testlar va simulyator bilan yoziladi.
- Birinchi o‘ynaladigan Classic versiya (M4) tayyor bo‘lganda yopiq beta qilinadi.
- Iqtisodiyot, Stars va admin shundan keyin qo‘shiladi.

---

## 6. Loyiha egasining qarorlari (M0, tasdiqlangan)

| Savol | Qaror | Amalga oshirilishi |
|---|---|---|
| Minimal o‘yinchi soni | **4 — qat’iy pastki chegara**, egasi o‘zi boshqaradi | `MIN_PLAYERS_FLOOR = 4` (engine). Global standart: superadmin `/admin_minplayers N` (4..30). Guruh admini `/settings` da 4..30 oralig‘ida o‘zgartiradi. Hech qaysi sozlama 4 dan pastga tushira olmaydi |
| O‘lganlar va tungi jimlik | **Ha** | Guruh sozlamalari: `silenceDead`, `silenceNight` (standart yoqilgan). Bot guruhda administrator bo‘lishi va xabarlarni o‘chirish huquqiga ega bo‘lishi kerak |
| Repozitoriy | Yangi repo | `mafia-platform` |
| Qolgan tuzatishlar (T1–T10, Q1–Q17, E1–E10) | Hammasi tasdiqlandi | Kodda shu qoidalar bo‘yicha |

### 6.1. 4–7 o‘yinchi uchun balans qatorlari

Minimal son 4 bo‘lgani uchun §11 jadvaliga qo‘shimcha qatorlar kiritildi:

| O‘yinchi | Mafia | Shahar | Mustaqil |
|---|---|---|---|
| 4–5 | 1 | 3–4 | 0 |
| 6 | 1 | 5 | 0 |
| 7 | 2 | 5 | 0 |

4 kishilik o‘yin: Don, Komissar, Doktor, Fuqaro.

### 6.2. Simulyatsiya natijasi (balans haqida ogohlantirish)

Tasodifiy botlar bilan 100 tadan o‘yin (`npm run sim`): Mafia g‘alabasi 71–97%. Bu raqam **tasodifiy** ovoz beruvchi botlar uchun: ular Komissar ma’lumotidan foydalanmaydi, shuning uchun Shahar kuchsiz ko‘rinadi. Haqiqiy balansni faqat odamlar bilan beta test ko‘rsatadi (§37.4). Balans jadvali `packages/game-engine/src/config.ts` da va beta natijasiga qarab o‘zgartiriladi.
