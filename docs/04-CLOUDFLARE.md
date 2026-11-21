# Bepul ishga tushirish: Cloudflare Workers (AvtoA1optum kabi)

Bot Cloudflare'ning bepul tarifida ishlaydi: server, karta va oylik to‘lov kerak emas. Bot 24/7 javob beradi, chunki Telegram har bir xabarni Cloudflare'ga o‘zi yuboradi (webhook).

| Qism | Nima qiladi |
|---|---|
| **Worker** | Telegram xabarlari va tugmalarini qabul qiladi |
| **GameRoom** (har bir guruhga alohida Durable Object) | Lobby, o‘yin holati, bosqich taymerlari (alarm), xabar navbati |
| **Registry** (bitta Durable Object, SQLite) | Foydalanuvchilar, profillar, reyting, guruh sozlamalari |

Kod: `apps/cloudflare/`. O‘yin qoidalari (`packages/game-engine`) va xabarlar (`packages/bot-core`) Node/VPS versiyasi bilan umumiy.

---

## Sozlash (bir marta, ~10 daqiqa)

### 1. Cloudflare API token

AvtoA1optum ishlayotgan Cloudflare hisobidan foydalanishingiz mumkin. Mafia alohida `mafia-bot` nomli Worker bo‘ladi va AvtoA1optum'ga tegmaydi.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → o‘ng yuqorida profil → **My Profile → API Tokens → Create Token**.
2. **Edit Cloudflare Workers** shablonini tanlang → **Use template**.
3. Account Resources: o‘z hisobingiz. Zone Resources: **All zones**.
4. **Continue to summary → Create Token**. Tokenni nusxalang.

### 2. GitHub sozlamalari

`mafia-platform` repozitoriyasi → **Settings → Secrets and variables → Actions**.

**Secrets** (New repository secret):

| Nomi | Qiymati |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1-qadamdagi token |
| `BOT_TOKEN` | @BotFather tokeni |

**Variables** (New repository variable):

| Nomi | Qiymati |
|---|---|
| `ADMIN_IDS` | `5105291033,7184608742` |
| `DEV_FAKE_PLAYERS` | `true` — guruhda `/devfill 5` bilan bot-o‘yinchilar qo‘shib, yolg‘iz sinash mumkin. Bu mashq o‘yinlari statistika va reytingga yozilmaydi. O‘chirish uchun `false` |

### 3. Ishga tushirish

**Actions → Deploy → Run workflow → Run workflow**. 3–5 daqiqa kuting.

Tugagach, **Summary** sahifasida bot havolasi va Worker manzili (`https://mafia-bot.<subdomen>.workers.dev`) chiqadi.

Shundan keyin `main` ga tushgan har bir o‘zgarish avtomatik deploy bo‘ladi.

---

## Tekshirish

1. Botga `/start` → bosh menyu.
2. Botni guruhga qo‘shing va **administrator** qiling (xabarlarni o‘chirish huquqi bilan).
3. Guruhda `/game` → o‘yinchilar **✅ Qo‘shilish** → **▶️ Boshlash**.
4. Yolg‘iz sinash: `/game` → `/devfill 5` → `/gstart`.

---

## Bepul tarif chegaralari

Cloudflare Workers Free ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)):

| Chegara | Bepul | Mafia uchun nimani anglatadi |
|---|---|---|
| Worker so‘rovlari | 100 000 / kun | Har bir Telegram xabar/tugma — 1 so‘rov |
| Durable Object so‘rovlari | 100 000 / kun | Har bir o‘yin harakati va taymer — ~1 so‘rov |
| SQLite yozuvlari | 100 000 qator / kun | Har bir o‘yin harakati — 1–2 qator |
| Subrequest | 50 / chaqiruv | Xabarlar 40 tadan partiyalab yuboriladi |

Taxminan: 10 kishilik bitta o‘yin ~300–500 so‘rov. Demak **kuniga 150–250 ta o‘yin** bepul. Reklama va mijoz yig‘ish bosqichi uchun yetarli.

Eslatma: bot guruhda administrator bo‘lsa, guruhdagi **har bir oddiy xabar** ham 1 so‘rov bo‘ladi (o‘lganlar va tungi jimlik uchun). Juda faol guruhlarda limit tezroq tugaydi. Limit tugasa, bot keyingi kun 00:00 UTC (Toshkent 05:00) da o‘zi tiklanadi.

Kunlik foydalanishni ko‘rish: Cloudflare → **Workers & Pages → mafia-bot → Metrics**.

---

## Keyin VPS ga o‘tish

Foydalanuvchilar ko‘paygach, `apps/server` (PostgreSQL + Redis) versiyasiga o‘tiladi: [docs/03-DEPLOY.md](03-DEPLOY.md).

Ikkala versiya bir xil o‘yin qoidalari va xabarlardan foydalanadi. Profillarni Cloudflare'dan PostgreSQL'ga ko‘chirish skripti o‘tish paytida yoziladi.

**Muhim:** bir token bilan faqat bitta versiya ishlashi kerak. VPS versiyasi polling rejimida ishga tushganda webhookni o‘chiradi, ya’ni Cloudflare boti to‘xtaydi.
