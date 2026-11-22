# MAFIA BOT — ISH REJASI VA HOLAT

Asos: `MAFIA TELEGRAM BOT — MASTER TECHNICAL SPECIFICATION v1.0` + `docs/01-SPEC-TAHLIL-VA-TUZATISHLAR.md` (v1.1).

Holatlar: `PENDING` → `IMPLEMENTED` → `TESTED` → `VERIFIED` (yoki `BLOCKED`).
`VERIFIED` — avtomatik testlar haqiqiy PostgreSQL/Redis bilan ishga tushirilib o‘tgan. Haqiqiy Telegram tarmog‘ida sinalmagan narsa `VERIFIED` deb yozilmaydi.

---

## Arxitektura (amaldagi)

```text
mafia-platform/
├── apps/
│   └── server/          NestJS (HTTP: /health, /telegram/webhook) + grammY bot + BullMQ worker
│                        APP_ROLE=all|bot|worker — bitta kod, alohida jarayonlar sifatida ham ishlaydi
├── packages/
│   ├── game-engine/     sof TS: 30 rol, NightResolver, ovoz, g‘alaba, taqsimot, simulyator
│   ├── database/        Prisma 7 sxema (34 jadval), migratsiyalar
│   ├── localization/    uz.json (asosiy), ru/en (keyingi bosqich, uz ga qaytadi)
│   └── config/          zod bilan .env validatsiyasi
├── scripts/with-services.sh   Docker bo‘lmagan muhitda testlar uchun PostgreSQL/Redis
├── docker-compose.yml, Dockerfile, .env.example
└── docs/
```

Rejadan farqlar (sabablari bilan):
- **pnpm o‘rniga npm workspaces** — sandboxda pnpm o‘rnatib bo‘lmadi; npm workspaces bir xil vazifani bajaradi.
- **`apps/bot` + `apps/worker` o‘rniga bitta `apps/server` + `APP_ROLE`** — servislar takrorlanmaydi. Production’da `APP_ROLE=bot` va `APP_ROLE=worker` alohida konteynerlar sifatida ishga tushiriladi.
- **Xabarlar navbati: BullMQ emas, PostgreSQL outbox** — xabar o‘yin holati bilan bitta tranzaksiyada yoziladi, shuning uchun holat saqlanib xabar yo‘qolishi yoki aksincha bo‘lmaydi. BullMQ taymerlar uchun ishlatiladi.

---

## Bosqichlar holati

### M0 — Tayyorgarlik — `VERIFIED`
- Tuzatishlar tasdiqlandi, qarorlar: minimal 4 (qat’iy, egasi boshqaradi), o‘lganlar/tungi jimlik — ha, yangi repo.

### M1 — Foundation — `VERIFIED` (Docker — `IMPLEMENTED`, sinalmagan)
- Monorepo, TypeScript 6 (strict), ESLint 10, Vitest 5.
- `.env` validatsiyasi (token yo‘q/noto‘g‘ri bo‘lsa aniq xato, qiymat logga chiqmaydi).
- Prisma 7 + `@prisma/adapter-pg`, birinchi migratsiya.
- `/start`, bosh menyu (inline), har bo‘limda orqaga tugmasi.
- pino structured log (token, rollar redaksiya qilinadi), `/health`.
- Docker Compose va Dockerfile yozilgan, lekin sandboxda Docker ishlamaydi — **sinalmagan**.

### M2 — GameEngine yadrosi — `VERIFIED`
- Holat mashinasi, `RoleAbilityHandler` (har rol `NightActionSpec.resolve`), 12 bosqichli `NightResolver`.
- Mafia jamoaviy hujumi, ovoz berish, hukm, `VictoryEngine`, `RoleDistributionService` (kriptografik RNG).
- Simulyator: `npm run sim`, testda 1 000 aralash o‘yin + 6×200 o‘yin — hammasi tugaydi.

### M3 — Lobby — `VERIFIED` (haqiqiy Telegram’da — `PENDING`)
- `/game`, `/join`, `/leave`, `/players`, `/gstart`, `/cancelgame`, `/status`, `/rules`, tugmalar.
- Bitta xabar tahrirlanadi, takroriy bosish ikki marta qo‘shmaydi (parallel test).
- Shaxsiy chat tekshiruvi (`sendChatAction`), `join_<raqam>` deep link.
- Lobby taymeri, avtostart, admin huquqi (`getChatMember`, 60 s kesh), superguruh migratsiyasi.

### M4 — To‘liq Classic o‘yin + ishonchlilik — `VERIFIED` (haqiqiy Telegram’da — `PENDING`)
- Rollar DM, Mafia jamoadoshlari, tunda Mafia ichki chati (relay).
- Tun/kunduz/ovoz/hukm/tong xabarlari, rolni oshkor qilish sozlamasi.
- Callback xavfsizligi: `phaseSeq` bilan eskirgan tugma, aktyor `ctx.from` dan, ruxsat serverda.
- BullMQ taymerlari + DB sweeper, restartdan keyin tiklash (test), `FOR UPDATE` + versiya (5 parallel taymer testi).
- Outbox: per-chat tartib, EDIT birlashtirish, 429/retry_after, 403 → foydalanuvchi bloklangan.
- Natijalar, XP, daraja, reyting (RP), rol statistikasi.
- O‘lganlar va tungi xabarlarni o‘chirish (guruh sozlamasi).
- `/devfill N` — development bot-o‘yinchilari (1 kishi bilan ham sinash mumkin).

### M5 — 30 rol — `VERIFIED` (engine darajasida)
- 30 rolning hammasi implementatsiya qilingan va §15 ning 22 vaziyati + qo‘shimcha chekka holatlar testlangan.
- Classic rejimida faqat 9 ta Classic roli, qolganlari ADVANCED/CHAOS/PRIVATE da.
- Balans haqiqiy o‘yinchilar bilan sinalmagan (§37.4) — beta kerak.

### M6 — Profil, statistika, reyting — `IMPLEMENTED` · `TESTED` (qisman)
- Profil, global reyting, guruh reytingi, `/mystats`.
- `PENDING`: haftalik/oylik/mavsumiy reytinglar (jadval tayyor: `leaderboard_seasons`, `rating_entries`).

### M7 — Iqtisodiyot — `VERIFIED` (Cloudflare)
- Coins ledger: har o‘zgarish `wallet_tx` da noyob kalit bilan, balans manfiy bo‘lmaydi, xarid + buyum bitta tranzaksiyada.
- O‘yin uchun: tugatish +10, g‘alaba +15 🪙 (mashq o‘yinida yo‘q).
- Kunlik mukofot: 50 → 75 → 100 → 125 → 150 → 200 → 300 🪙, Toshkent kuni bo‘yicha.
- Kunlik vazifalar: 2 ta o‘yin (60), 1 g‘alaba (80), oxirigacha tirik qolish (50).
- Do‘kon: ramkalar, unvonlar, Arcade buyumlari. Inventar: tanlash, Arcade’da ishlatishni yoqish.
- Arcade: o‘yin boshida band qilinadi, guruhga soni e’lon qilinadi, ishlatilgani sarflanadi, qolgani qaytadi, bekor qilinsa hammasi qaytadi.
- `PENDING`: Node/VPS versiyasiga ko‘chirish, admin orqali narxlarni o‘zgartirish.

### M8 — Telegram Stars va VIP — `VERIFIED` (Cloudflare)
- VIP (99 ⭐) va VIP PRO (249 ⭐), 30 kunlik bir martalik xarid; qayta xarid muddatni uzaytiradi.
- Buyurtma → `sendInvoice` (XTR) → `pre_checkout_query` tekshiruvi → `successful_payment` da berish; `telegram_payment_charge_id` bir marta.
- `/refund` (admin) → `refundStarPayment`, VIP davri bekor; `/admin_payments`; `/paysupport` murojaati.
- `STARS_MODE`: `off` / `admins` (hozir — faqat bot egalari, 1 ⭐ test to‘lov bilan) / `all`.
- `PENDING`: CLUB (guruh tarifi), Telegram avto-obunasi (`subscription_period`).

### M9 — Ijtimoiy — qisman `VERIFIED`
- Referal: `ref_` havola, do‘st 2 ta o‘yin yakunlasa 100 🪙, o‘zini/takroriy taklif rad etiladi.
- `PENDING`: yutuqlar, turnir, haftalik/oylik reytinglar.

### M10 — Admin, moderatsiya, support — `IMPLEMENTED` (qisman)
- Bor: `/admin_minplayers`, `/admin_stats` (superadmin), audit log (sozlamalar o‘zgarishi), `/privacy`, `/delete_me` (anonimlashtirish).
- `PENDING`: rollar darajalari (MODERATOR, SUPPORT…), ticketlar, foydalanuvchini cheklash buyruqlari, web-admin.

### M11 — Samaradorlik va xavfsizlik — `PENDING` (qisman bajarilgan)
- Bor: 50 parallel o‘yin testi, rate limit (tugma va chat), graceful shutdown, webhook secret token.
- `PENDING`: yuklama testi (yuzlab haqiqiy guruh), backup, monitoring, production deploy.

### M12 — Ommaviy beta — `PENDING`

---

## Sizdan kerak bo‘ladigan narsalar
| Nima | Qachon | Nima uchun |
|---|---|---|
| Bot token (BotFather) | ✅ Berildi | @Hypernovamafia_bot, Telegram API bilan ulanish tekshirildi |
| Superadminlar | ✅ Berildi | 5105291033, 7184608742 |
| Server tanlovi va rozilik | Hozir | Bot 24/7 ishlashi uchun (`docs/03-DEPLOY.md`) |
| 1–2 test guruhi | Server ishga tushgach | `/devfill` bilan yolg‘iz ham sinash mumkin, keyin 4+ odam |
| Stars sinovi uchun rozilik | M8 | Haqiqiy to‘lov |
