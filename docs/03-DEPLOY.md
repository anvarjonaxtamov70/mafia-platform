# Botni serverga joylash (24/7)

Bot doimiy ishlashi uchun server kerak. Kompyuteringiz yoki bu sandbox o‘chsa, bot ham to‘xtaydi.

Bot **polling** rejimida ishlaydi: domen va HTTPS shart emas. Faqat internetga chiqa oladigan server kerak.

## Variant A — VPS (tavsiya: to‘liq nazorat)

Talab: Ubuntu 22.04/24.04, kamida 1 vCPU, 1–2 GB RAM (Hetzner, DigitalOcean, Contabo va h.k.).

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Kod
git clone https://github.com/anvarjonaxtamov70/mafia-platform.git
cd mafia-platform

# 3. Sozlamalar
cp .env.example .env
nano .env
```

`.env` da production uchun:

```env
NODE_ENV=production
APP_ROLE=all
BOT_TOKEN=<BotFather tokeni>
SUPERADMIN_IDS=5105291033,7184608742
POSTGRES_PASSWORD=<kuchli parol>
DEV_FAKE_PLAYERS=false
```

`DATABASE_URL` va `REDIS_URL` ni yozish shart emas — `docker-compose.yml` ularni o‘zi beradi.

```bash
# 4. Ishga tushirish (migratsiyalar avtomatik qo'llanadi)
docker compose up -d --build

# 5. Tekshirish
curl http://127.0.0.1:3000/health
docker compose logs -f app
```

Yangilash:

```bash
git pull && docker compose up -d --build
```

Faol o‘yinlar yangilashdan keyin davom etadi: holat PostgreSQL da, taymerlar qayta tiklanadi.

### Zaxira nusxa (backup)

```bash
# Har kuni 03:00 da (crontab -e)
0 3 * * * cd /root/mafia-platform && docker compose exec -T postgres pg_dump -U mafia mafia | gzip > /root/backup-$(date +\%F).sql.gz
```

## Variant B — Railway (eng oson, oyiga taxminan $5 dan)

1. railway.com → New Project → Deploy from GitHub → `mafia-platform`.
2. Projectga **PostgreSQL** va **Redis** qo‘shing.
3. Bot servisining Variables bo‘limida: `BOT_TOKEN`, `SUPERADMIN_IDS`, `NODE_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`.
4. Railway `Dockerfile` ni o‘zi topadi va ishga tushiradi.

## Telegram tomonida

1. Botni guruhga qo‘shing va **administrator** qiling (xabarlarni o‘chirish huquqi bilan) — o‘lganlar va tungi jimlik shunda ishlaydi.
2. Guruhda `/settings` — rejim, minimal o‘yinchi soni, vaqtlar.
3. Guruhda `/game`.

## Xavfsizlik

- Token chatda yoki boshqa joyda oshkor bo‘lgan bo‘lsa: @BotFather → `/revoke` → yangi tokenni faqat server `.env` iga yozing.
- `.env` faylini hech qachon git ga qo‘shmang (`.gitignore` da bor).
- Bir token bilan faqat **bitta** server ishlashi kerak (aks holda Telegram `409 Conflict` beradi).
