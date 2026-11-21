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

### M7 — Iqtisodiyot — `PENDING`
Sxema tayyor (`wallet_transactions`, `products`, `inventory_items`, `daily_reward_claims`, `quests`). Menyu “keyingi bosqich” deb ochiq ko‘rsatadi.

### M8 — Telegram Stars va VIP — `PENDING`
Sxema tayyor (`orders`, `payments` unique `telegram_payment_charge_id`, `payment_refunds`, `subscriptions`).

### M9 — Ijtimoiy — `PENDING`
Sxema tayyor (`referrals`, `achievements`, `user_achievements`).

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
| Bot token (BotFather) | Hozir | Haqiqiy Telegram’da sinash. Faqat `.env` ga yoziladi |
| 1–2 test guruhi | Hozir | `/devfill` bilan yolg‘iz ham sinash mumkin, keyin 4+ odam |
| Server tanlovi va rozilik | M11 | Production |
| Stars sinovi uchun rozilik | M8 | Haqiqiy to‘lov |
