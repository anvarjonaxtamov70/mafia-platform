# Hypernova v2 — Telegram-first roadmap

Mini App va web admin rejalashtirilmagan. Mavjud GameEngine, iqtisodiyot va storage saqlanadi.

## Ushbu PR
- /quick: PRIVATE, reytingsiz, 45/60/30/10 soniya; guruhning saqlangan sozlamalariga tegilmaydi.
- /characters: jamoalar va 30 rol bo‘yicha interaktiv katalog, /guide: onboarding.
- Cloudflare: eskirgan leave/cancel callbacklar joriy o‘yinga ta’sir qilmaydi.
- Cloudflare: payment webhook xatosida 503, charge_id dedup mavjud.
- FIFO outbox boshidagi xabar kutayotgan bo‘lsa, keyingi tayyor xabar sababli keraksiz alarm takrorlanmasin.
- DEV_FAKE_PLAYERS standart false (GitHub Variables override qilishi mumkin).
- Maxfiylik matni saqlanadigan ID va yozuvlarni aniq aytadi.
- Regression testlar qo‘shilgan; CI muvaffaqiyatli bo‘lmaguncha merge qilinmasin.

## Keyingi PRlar
1. Persistent update inbox, refund reconciliation, spam/AFK, global Telegram limiter, to‘liq deletion policy va parallel guruh load test.
2. Real beta balans, RP/Coins farming himoyasi, o‘yin tarixi, haftalik leaderboard va yutuqlar.
3. 30 personaj uchun tasdiqlangan media assetlar (Telegram file_id cache), tun/tong/g‘alaba animatsiyalari va text fallback.
4. Telegram admin panel, turnir/mavsum, klan/do‘stlar, VIP sovg‘alar. Real Stars testdan oldin STARS_MODE=all qilinmasin.

Har bosqichda lint, typecheck, unit, integration, Cloudflare E2E; production merge alohida qaror.

## Owner benefits policy
- Faqat serverdagi ADMIN_IDS ro‘yxatidagi superadminlar: doimiy VIP PRO va cheksiz xarid huquqi (1 milliard virtual Coins ko‘rinadi, xaridda kamaymaydi). Real ledgerga virtual pul kiritilmaydi. Oddiy guruh adminlari bunday imtiyoz olmaydi. Stars to‘lovlari va refund yozuvlari o‘zgarmaydi.
- Pichoq va XCoin katalogga kiritilmaydi. Olmos hozir alohida valyuta emas; keyinchalik joriy qilinsa owner imtiyozi alohida tatbiq etiladi. Real Stars hech qachon sun’iy ko‘paytirilmaydi.
- Ranked rejimdagi o‘yin qoidalari hamma uchun bir xil. Arcade buyumlari faqat mavjud reytingsiz Arcade rejimida ishlaydi.
- Amaldagi Cloudflare iqtisodiyoti uchun; VPS iqtisodiyoti hali alohida ish.
