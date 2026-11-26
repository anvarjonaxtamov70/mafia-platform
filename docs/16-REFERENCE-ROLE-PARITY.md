# Reference role parity — DRAFT, DO NOT MERGE

Scope: 28 role buttons observed in user screenshots of 26 November 2026. The UI is a prototype for review, not a claim of complete gameplay parity. The active engine still has 30 old roles. Existing /characters remains the real engine catalogue until migration is complete. Standard Telegram emoji approximate the screenshots; custom emoji identifiers are not available. Text paraphrases the source. Long descriptions use private messages, short ones use callback alerts.

## Source-derived rules
1. Tinch axoli — Mafiyani toping va kunduzgi ovoz berishda uni o‘yindan chiqaring.
2. Don — Mafia sardorisiz. Tungi hujum nishonini siz belgilaysiz.
3. Mafia — Donga bo‘ysunasiz. Don halok bo‘lsa, uning o‘rnini egallashingiz mumkin.
4. Manyak — Boshqa barcha o‘yinchilarni o‘yindan chiqaring. Faol himoya hujumingizni to‘xtatadi.
5. Komissar — Shaharning asosiy himoyachisisiz va mafiyaga qarshi kurashasiz.
6. Doktor — Tunda bir o‘yinchini qutqarishingiz mumkin.
7. Serjant — Komissarning yordamchisisiz. Uning harakatlaridan xabardor bo‘lasiz. U halok bo‘lsa, o‘rnini egallaysiz.
8. Daydi — Bir o‘yinchining uyiga borib, qotillikka guvoh bo‘lishingiz mumkin.
9. Frozen — Maqsadingiz tirik qolish. Tashrif buyurgan o‘yinchingiz bir kun uxlaydi.
10. Advokat — Mafia tarafidasiz. Tunda tanlagan mafia a’zongiz Komissarga tinch aholi bo‘lib ko‘rinadi.
11. Suidsid — Kunduzgi osish orqali o‘yindan chiqarilsangiz, g‘alaba qozonasiz.
12. убийца — Mafia tarafidasiz. Har tun yashirin hujum qilasiz; Komissarni nishonga olsangiz, o‘zingiz halok bo‘lasiz.
13. Kamikaze — Tinchlarga yordam berasiz. Tunda halok bo‘lsangiz, hujumchi ham halok bo‘ladi. Kunduz osilsangiz, bir o‘yinchini tanlab olib ketishingiz mumkin.
14. Grench — Betarafsiz. Har tun 50–150 Dollar (o‘nlik qadamda) olasiz. Nishonning puli yetmasa, 50 joni kamayadi; joni tugasa, halok bo‘ladi. Maqsad — tirik qolish.
15. Minior — Erkinsiz. Tunda tanlangan uyga tuzoq qo‘yasiz; o‘sha uyga kelgan sizdan boshqa barcha o‘yinchilar halok bo‘ladi.
16. Shpion — Mafia tarafidasiz. Tunda bir o‘yinchining rolini bilib, mafiyalarga oshkor qilishingiz mumkin.
17. Zombi — Shahardagi hammani zombiga aylantirishga harakat qilasiz.
18. Kimyogar — Mafia tarafidasiz. Tunda mafia a’zosini tanlasangiz, himoya qilasiz; boshqa tarafdagi nishonga hujum qilasiz.
19. Tentak — Tunda tanlagan o‘yinchingiz tinch tarafda bo‘lsa, o‘sha kuni uni osib bo‘lmaydi. Aks holda unga hujum qilasiz.
20. Buqalamun — Tunda bir marta o‘yinchi tanlaysiz va uning tarafida o‘yinni davom ettirasiz.
21. Sotuvchi — Tunda bir o‘yinchini tanlab, ertasi kuni mahsulotlarni yarim narxda taklif qilasiz. Xarid qilsa, 10% olasiz.
22. Krampous — Har tun takrorlanmaydigan nishon tanlaysiz. O‘zingizni tanlasangiz, avvalgi nishonlar bilan halok bo‘lasiz. Doktor, Kimyogar yoki faol himoya nishonni qutqarishi mumkin. Kamida 3 nishon halok bo‘lsa yutasiz. Erta faollashtirsangiz ham o‘zingiz halok bo‘lasiz. Rolingiz o‘zgarmaydi.
23. Omadli — Tinch aholisiz. Hujum qilinganda tasodifan omon qolishingiz mumkin.
24. Klaus — Tunda tanlagan o‘yinchingizga 50–200 Dollar sovg‘a qilasiz.
25. Sehrgar — Kimdir hujum qilsa, uni kechirish yoki kechirmaslikni tanlaysiz. O‘yin oxirigacha tirik qolsangiz, yutasiz.
26. Mergan — Yakka rollar orasida kuchlisiz. Boshqa yakka rollar sizni o‘ldira olmaydi.
27. Janob — Kunduzgi ovozingiz ikkita ovozga teng. Ovoz berganda shaxsingiz oshkor bo‘lmaydi.
28. Qo'y — Suidsidni osishda qatnashgan o‘yinchining roli Qo‘yga aylanadi.

## Known differences in existing engine
- SPY_TRACK currently tracks visits, not actual role disclosure.
- MAYOR requires a reveal for double vote; Janob's vote is double and anonymous.
- WIZARD currently uses mirage/barrier with a different win predicate.
- JESTER personal win is not sufficient for Qo'y transformation.
- Existing distribution uses factionPlan, weighted pools and 30 roles; exact reference player-count thresholds are not evidenced.
- Existing victory assumes CITY/MAFIA/SERIAL_KILLER/DRAW; zombie conversion and other solo wins require a versioned result model.
- Existing economy settlement is separate from the pure engine. Grench, Klaus and Sotuvchi need idempotent server-side ledger operations with distinct caps for game rewards vs role actions.

## Blocking unknowns (do not invent parity)
1. Assignment counts by player count; whether Qo'y is transformation-only (description implies this), which seasonal roles are enabled and how settings affect them.
2. Exact night action order and simultaneous kills, blocks and heals. Commissar can investigate/attack? Doctor self-heal/repeat? Don succession ordering and mafia voting vs Don priority?
3. Frozen blocks which actions (night/day chat/votes/hero)? Daydi sees attacker identity or only role? Omadli probability and repeat limits.
4. Mergan action and win condition; Minior win condition and which visits count; Zombi conversion limits, faction victory and immunity.
5. Suidsid: which stage of vote converts voters, whether death by vote shield prevents transformation, Qo'y faction/abilities/win. Kamikaze multiple attackers, verdict timing and protection. Tentak protection applies only to selected player as source says.
6. Krampous marked dead targets, multiple protection and premature death. Sehrgar outcome after forgive/refuse, timeout, multiple attackers.
7. Grench health baseline, debit rounding, shield interactions and superadmin unlimited balance; Sotuvchi 10% base, eligible items and currency; Klaus funding, gift bounds and cancellation.
8. Exact group message templates, timings, role announcements, voting details and victory thresholds.

## Required test plan before ready-for-review
- Versioned migration: old games finish under old engine; new games only use confirmed 28-role rules, no unknown role assigned; retain historic stats and inventory.
- For every enabled player count and mode, verify exact composition constraints, no duplicate unique roles, disabled roles respected and no immediate victory. Qo'y assignment restriction pending confirmation.
- Pairwise actor/target matrix across 28 roles (784 ordered pairs), supplemented by multi-role scenarios (block + protect + attack, conversion + succession, multiple simultaneous attacks, vote changes and timeouts). Pairwise alone is not exhaustive.
- Verify role-specific wins, faction wins, ties, dead vs alive rewards, no repeated payouts, no negative balances, retries and transaction failures.
- Ensure old/replayed callbacks, other group/other user actions, dead/blocked actors and phase mismatch cannot mutate state. Keep existing one-game-per-user, /startgame and /stop permission controls.
- Fake Telegram integration for all private/public messages, hidden role and vote privacy; real multi-user playtesting. Existing CI required. No production deployment until verified.
