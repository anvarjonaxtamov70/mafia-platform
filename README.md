# 🎭 Mafia Platform — Telegram Mafia bot

Telegram guruhlarida o‘ynaladigan Mafia o‘yini. O‘yin qoidalari Telegramdan mustaqil `GameEngine` da, shuning uchun keyinchalik Mini App va 3D mobil ilova shu backenddan foydalana oladi.

- **30 ta rol** (13 shahar, 8 mafia, 6 mustaqil, 3 maxsus), 4–30 o‘yinchi
- Rejimlar: Classic, Advanced, Chaos, Arcade, Private (Tournament — keyingi bosqich)
- Bir vaqtda ko‘plab guruhlarda mustaqil o‘yinlar, restartdan keyin davom etadi
- Asosiy til: o‘zbekcha (lotin)

Bot: [@Hypernovamafia_bot](https://t.me/Hypernovamafia_bot)

Hujjatlar:
- [docs/01-SPEC-TAHLIL-VA-TUZATISHLAR.md](docs/01-SPEC-TAHLIL-VA-TUZATISHLAR.md) — spetsifikatsiya tahlili va v1.1 qoidalari
- [docs/02-ISH-REJASI.md](docs/02-ISH-REJASI.md) — reja va har bir bosqich holati
- [docs/04-CLOUDFLARE.md](docs/04-CLOUDFLARE.md) — **hozirgi ishga tushirish: Cloudflare (bepul, 24/7)**
- [docs/03-DEPLOY.md](docs/03-DEPLOY.md) — keyinchalik VPS ga o‘tish (PostgreSQL + Redis)

## Ikki xil ishga tushirish

| | Cloudflare (hozir) | VPS (keyin) |
|---|---|---|
| Kod | `apps/cloudflare` | `apps/server` |
| Narx | Bepul | Oyiga ~$4–6 |
| Ma’lumotlar | Durable Objects (SQLite) | PostgreSQL + Redis |
| Telegram | Webhook | Polling yoki webhook |
| Deploy | GitHub Actions avtomatik | `docker compose up -d --build` |

O‘yin qoidalari (`packages/game-engine`) va barcha xabar/tugmalar (`packages/bot-core`) ikkalasida bir xil.

---

## Tez boshlash

### 1. Bot yaratish
1. Telegram’da [@BotFather](https://t.me/BotFather) → `/newbot` → token oling.
2. `/setjoingroups` → Enable.
3. Guruhda botni **administrator** qiling (xabarlarni o‘chirish huquqi bilan) — o‘lganlar va tungi jimlik shunda ishlaydi.

### 2. Muhit
```bash
cp .env.example .env
# .env ichida: BOT_TOKEN=...   SUPERADMIN_IDS=<sizning Telegram ID>
```
Token faqat `.env` da turadi, `.gitignore` uni repozitoriyga qo‘shmaydi.

### 3. Ishga tushirish (Docker bilan)
```bash
docker compose up -d postgres redis
npm install
npm run db:migrate
npm run dev
```
Yoki hammasini konteynerda: `docker compose up -d --build`.

### 4. Sinash
- Botga shaxsiy chatda `/start`.
- Guruhda `/game`, keyin o‘yinchilar **✅ Qo‘shilish** tugmasini bosadi, tashkilotchi **▶️ Boshlash**.
- Yolg‘iz sinash: `.env` da `DEV_FAKE_PLAYERS=true`, guruhda `/game` → `/devfill 5` → `/gstart`. Bot-o‘yinchilar tasodifiy, lekin qoidaga mos harakat qiladi. Productionda bu taqiqlangan.

---

## Buyruqlar

**Guruhda:** `/game [classic|advanced|chaos|arcade|private]`, `/join`, `/leave`, `/players`, `/gstart`, `/status`, `/cancelgame`, `/settings` (admin), `/leaderboard`, `/mystats`, `/rules`

**Shaxsiy chatda:** `/start`, `/profile`, `/rules`, `/roles`, `/help`, `/privacy`, `/delete_me`

**Bot egasi (SUPERADMIN_IDS):** `/admin_minplayers N` — barcha guruhlar uchun standart minimal o‘yinchi soni (4..30), `/admin_stats`

### Minimal o‘yinchi soni
- Qat’iy pastki chegara — **4**. Hech qanday sozlama uni pasaytira olmaydi (`MIN_PLAYERS_FLOOR`).
- Global standart — `/admin_minplayers`.
- Har bir guruh admini `/settings` → 👥 Min −/+ bilan o‘z guruhida o‘zgartiradi.

---

## Arxitektura

```text
Telegram ──► grammY adapter (apps/server/src/telegram)
                 │  faqat buyruq/tugmani qabul qiladi, ruxsatni tekshiradi
                 ▼
          Application services (apps/server/src/game)
          LobbyService · GameService · StatsService · Presenter
                 │  SELECT … FOR UPDATE + versiya, bitta tranzaksiya
                 ▼
          GameEngine (packages/game-engine) — sof, deterministik
          roles/ · night/resolver · victory · distribution · simulator
                 │
                 ▼
          PostgreSQL (holat snapshot, hodisalar, outbox, natijalar)
          Redis/BullMQ (bosqich taymerlari) + DB sweeper (zaxira)
                 │
                 ▼
          OutboxDispatcher ──► Telegram (per-chat tartib, rate limit, retry)
```

Asosiy qarorlar:
- **Engine sof funksiyalar**: `(state, action) → (newState, events)`. Tasodif tashqaridan beriladi — testlar va simulyatsiya takrorlanadi.
- **Transactional outbox**: xabarlar o‘yin holati bilan bitta tranzaksiyada yoziladi, keyin navbat orqali yuboriladi. Takroriy xabar `dedupe_key` bilan to‘siladi.
- **Bosqich raqami (`phaseSeq`)** har tugmada: eskirgan tugma rad etiladi, ikki parallel taymer bitta bosqichni ikki marta yakunlamaydi.
- **Restart**: taymer xotirada emas. Ishga tushganda faol o‘yinlar qayta rejalashtiriladi, sweeper muddati o‘tgan bosqichlarni yakunlaydi.
- `APP_ROLE=all|bot|worker` — bitta kod, production’da alohida jarayonlar.

### Yangi rol qo‘shish
`packages/game-engine/src/roles/` da `role({...})` bilan ta’rif yozing (fraksiya, `night` harakatlari: bosqich, nishon qoidalari, `resolve`), `ALL_ROLES` ga qo‘shing, `uz.json` ga `role.<CODE>.name/desc/prompt` kalitlarini qo‘shing. Resolver o‘zgarmaydi.

---

## Testlar

```bash
npm test                  # unit: engine (22 vaziyat, qoidalar, taqsimot, 1 000+ simulyatsiya), config, presenter
npm run test:integration  # PostgreSQL + Redis bilan: lobby, to‘liq o‘yin, parallellik, restart, outbox, Telegram E2E
npm run lint
npm run typecheck
npm run sim -- 1000       # balans statistikasi
```
`test:integration` PostgreSQL va Redis ishlab turgan bo‘lsa ulardan foydalanadi (`docker compose up -d postgres redis`). Docker yo‘q muhit uchun `scripts/with-services.sh` lokal binarilarni ishga tushira oladi.

Cloudflare versiyasi uchun qo‘shimcha:
```bash
npm run cf:typecheck
npm run cf:e2e            # haqiqiy Cloudflare runtime (workerd) + soxta Telegram: to‘liq o‘yin
```

---

## Holat

| Modul | Holat |
|---|---|
| GameEngine: 30 rol, NightResolver, ovoz, hukm, g‘alaba | ✅ VERIFIED (unit + simulyatsiya) |
| §15 ning 22 ta to‘qnashuv vaziyati | ✅ VERIFIED (har biri alohida test) |
| Rol taqsimoti 4–30, barcha rejimlar | ✅ VERIFIED (27 son × 6 rejim × 200 seed) |
| Prisma sxema (34 jadval) va migratsiya | ✅ VERIFIED (PostgreSQL 18) |
| Lobby, to‘liq o‘yin, natijalar, XP/RP | ✅ VERIFIED (integration) |
| Parallellik, restart tiklanishi, eskirgan tugmalar | ✅ VERIFIED (integration) |
| Outbox dispatcher (tartib, 429, 403, birlashtirish) | ✅ VERIFIED (soxta Telegram API bilan) |
| BullMQ taymerlari | ✅ VERIFIED (haqiqiy Redis) |
| Cloudflare versiyasi (Worker + GameRoom/Registry Durable Objects) | ✅ VERIFIED — unit testlar, workerd ichida to‘liq o‘yin (E2E), production'ga deploy va har deploydan keyin avtomatik tekshiruv (Registry, GameRoom, webhook) |
| Production | 🟢 https://mafia-bot.anvaraxtamov70.workers.dev — GitHub Actions orqali avtomatik deploy |
| Telegram ulanishi (getMe, buyruqlar menyusi, tavsif, polling) | ✅ VERIFIED — haqiqiy Telegram API bilan |
| Telegram adapter (menyu, lobby, tugmalar, sozlamalar, jimlik) | 🟡 TESTED — soxta Bot API bilan E2E; haqiqiy guruhda odamlar bilan hali o‘ynalmagan |
| Webhook rejimi | 🟡 IMPLEMENTED — HTTPS domen kerak, sinalmagan |
| Docker / docker-compose | 🟡 IMPLEMENTED — sandboxda Docker ishlamaydi, sinalmagan |
| Do‘kon, Coins, inventar, kunlik mukofot, vazifalar | ⏳ PENDING (sxema tayyor) |
| Telegram Stars, VIP, refund, `/paysupport` | ⏳ PENDING (sxema tayyor) |
| Referal, yutuqlar, turnir, haftalik reytinglar | ⏳ PENDING |
| To‘liq admin tizimi, support ticketlar, web-admin | ⏳ PENDING (asosiy superadmin buyruqlari bor) |
| Rus va ingliz tillari | ⏳ PENDING (arxitektura tayyor) |

### Ma’lum cheklovlar
- Simulyatsiyada Mafia 71–97% yutadi, chunki botlar tasodifiy ovoz beradi va Komissar ma’lumotidan foydalanmaydi. Haqiqiy balans faqat odamlar bilan beta testda aniqlanadi.
- Telegram rate limiter (`transformer-throttler`) har bir jarayonda alohida ishlaydi. Bir nechta `worker` nusxasi bo‘lsa, umumiy limitni Redis orqali birlashtirish kerak bo‘ladi (M11).
- `npm ls` `effect` paketini "invalid" deb ko‘rsatadi: Prisma CLI ichidagi zaif versiya `overrides` bilan xavfsiz versiyaga almashtirilgan (`npm audit`: 0 zaiflik).
