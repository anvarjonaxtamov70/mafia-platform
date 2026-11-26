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


## Superseding user decisions (26 November, Q1–75)
The following supersede conflicting earlier reference descriptions. Qo'y removed: **27 roles**, 13 two-column rows and last single Janob. Draft only. Old game engine remains live; do not merge.

### Game lifecycle
- 4–30 players, 30 seconds each night/discussion/vote/verdict; first night attacks; end night early when all eligible actions resolve. Tied vote/verdict means no execution; yes > no passes even with abstentions. No self vote for Suidsid. Two missed eligible night actions remove player; day votes don't count; passive roles and forced sleep exempt (forced sleep exemption proposed). No group chat at night or after death; DM last words forwarded to group within 29 seconds. Mafia knows teammates and private relays. Leaving receives own loss. Retain admin start/stop, group isolation.
- Classic: no Zombi. Zombi: excludes ordinary Citizen, Suidsid, Sotuvchi, Klaus; conversions remove old abilities, converted can convert, no mutual identities; doctor and paid shield prevent conversion. Hypernova: night-active roles only, no Citizen. VS: even player count, equal red/blue teams, colours known, no Citizen, active roles only, one Don globally, role faction != colour victory, dead teammates win when other colour eliminated. No duplicate unique role decisions yet for 30-player active-only modes.
- Classic wins: 2 mafia vs 2 city continues; 3 vs 2 mafia wins; 1 vs 1 mafia wins; 1 mafia vs 1 Manyak and 2 city vs 1 Manyak Manyak wins. Multiple solo roles continue to one remaining; all die => draw. Surviving neutrals share victory. Exact generalization to complex mixed endings pending.
- Komissar one action exact check or shoot. Sergeant sees only; converted chameleon Sergeant succeeds first. Don priority; absent choice mafia majority; tie no death; all mafia attacks attributed to Don, including Kamikaze retaliation. Frozen Don disables team attack. Doctor self-heal once, others consecutive; all hits prevented; no paid shield consumption; dead via Minior cancels heal. Simultaneous ordinary attacks can mutually kill.
- Frozen city, blocks all actions one day; no self/repeat consecutive. Daydi sees killer identity and role. Omadli one guaranteed natural protection before paid shield. Advokat hides mafia as citizen and saves from hanging with group cause; paid document also hides; Shpion cannot bypass document. Kimyogar protects mafia all attacks, cannot self-protect. Tentak city: selected city protected from hanging; non-city attack can be protected. Minior one night trap, repeat allowed, all visitors die except owner and Minior; solo. Sehrgar all attackers one choice: forgive all survive; refuse attackers die, wizard lives; no response wizard dies. Kamikaze all attackers die on death, Don attribution, Commissar involvement both lose, other killer death grants personal win, alive at end loses, execution can choose one and wins, hero owner exempt. Krampous prior dead marked targets count. Chameleon initially neutral, selects city->Sergeant, mafia->Mafioso, solo->Manyak. Grench choice 50–150 Dollar or 17 HP, timeout defaults money, insufficient money ->17 HP, public HP, no doctor HP restoration; normal lethal attack 100 HP. Sotuvchi/Klaus neutral, ordinary mode available.

### Hero v2 (new pure rules module; not integrated)
- 90 diamonds for one permanent hero. Initial level 1, 0 points; proposed full starting defense and 10 charges. Only Don, Commissar, Mergan can fire, all others can use hero defense. All modes, dawn, once per game, one charge each accepted valid shot. Frozen cannot fire. Hero-specific defense is persistent and absorbs hero damage point-for-point before HP; never ordinary role attacks. Separate purchased hero protection remains separate. No Kamikaze retaliation on hero owner. Multiple shots stack; actual HP damage earns partial points, lethal credited shooter earns full kill points (not stacked); deterministic order and idempotent ledger required. No ordinary win/loss hero XP. Provisional rule: 100% max attack after level 10, no level cap other than exact safe storage. Formulas tested separately: threshold 1100(L-1) + 25 over(over+1), over=max(0,L-50); max defense floor(25L/3); attack rounded 45+55(L-1)/9 capped 100; kill XP 30+floor((L-1)/10)+floor(sqrt(over)); restore 100(L+1); reload +5; 500 XP 35 gems, 1000 XP 65 gems, rename 780 Dollar. Full refill only if not already full; no automatic refill at level up (proposed). Existing players migrate points without loss; avoid free currency or duplicate purchases. Owner privilege preserve, no unsafe number overflow.

### Para — requested new independent social feature (spec only)
- /para is group-only and requires a direct reply to the target's own message. No username alternative. Deliver request only to the exact recipient's Hypernova private chat; group gets only a sent/failure acknowledgement. Accept/reject only in recipient's private bot. No self, bots, blocked/deleted users, or already paired user. One mutual global pair at a time; atomic unique user constraints, request expiry proposed 10 min; repeat/spam throttling. /mypara displays own current partner in group or private bot; /qpara is private-bot-only and requires explicit Yes confirmation bound to requester/current pair generation; delete both sides atomically; no partner consent needed to leave. User deletion clears relationships and pending requests. No gameplay, XP, economy, VIP or permissions effects; no automatic pairing; no private IDs published.

### Remaining unresolved
- VS colours and role identity scopes, duplicate active roles and exact mixed victory/role allocation still not confirmed. Special interaction precedence, paid item and hero defense ordering, Grench/Sehrgar response windows and accounting, Klaus funding and Sotuvchi commission base need integration decisions. User has delegated algorithm design; proposed values must not be represented as Bloody internals.

### Latest confirmations (Q76–78)
- Nonlethal actual HP damage from a hero shot earns points. Proposed award = max(1, round(killPoints * actual HP lost / 200)); full lethal award = killPoints instead, no extra stacking. Zero HP damage (fully absorbed/blocked, invalid, or dead target) = 0. Pure helper and unit tests added. Persistent settlement/integration pending.
- Suidsid successfully executed: entire match ends immediately, Suidsid wins. Not merely a personal-win exit. Protected/no-death verdict does not trigger this. Mode interaction: VS team-only victory was separately specified; Suidsid is not a night-active role, so excluded from VS/Hypernova under the active-role rule, and explicitly excluded from Zombi.
- Mergan: ordinary Don/Komissar attacks, hero shot, and day execution can kill Mergan. Solo-role attacks cannot. Other cross-effects remain subject to the confirmed immunity/protection ordering.
- Para group command uses reply_to_message.from identity only, never quoted text, forwarded origin or free-form username. Reject anonymous sender/chat, self, bots, unregistered/unreachable DM, stale requests, replay and concurrent accepted pairs. Group: /para and /mypara only. All confirmation buttons and /qpara in DM. Do not publicly reveal rejection or private request details. If DM delivery fails, invalidate request and report failure; no false success. Store exact target binding, expiry and atomic unique membership in registry. No gameplay effects. This is still an implementation specification, not a live feature.


## Isolated v2 engine implementation checkpoint
Added separate v2 registry, allocation, snapshot, night resolver, voting, victory, and hero-damage functions plus deterministic unit scenarios. Not wired into production rooms. Proposed choices: active/no-citizen modes may repeat nonlethal support roles to fill 30 seats; no duplicate Don/Komissar; at most two starting solo attackers. Classic slots use previously discussed formula; empty special pool slots fall back to city. Zombie mode starts with one zombie. Frozen simultaneously resolves before other visits; trap deaths cancel visits and bypass ordinary healing; normal hits resolve together; doctor before natural luck before consumable; these precedence rules are proposed, not observed internal Bloody logic. Grench money, Klaus, Seller emit effects only; durable wallet debit/grant, interactive response phases, delivery, damage settlement and protection against replay still require integration. The pairwise test is a smoke test, not proof of all combinations. Existing v1 is untouched. Last words helper and new phase clocks are not yet Telegram handlers. VS and mixed solo victory generalization require further playtesting. Keep draft.


## Para implementation checkpoint
Cloudflare registry and router now implement reply-only group /para, DM-only acceptance/rejection and breakup confirmation, /mypara in both contexts, expiry, transactional unique membership, failed delivery cancellation, and deletion cleanup. Added router and storage tests; alternate Node runtime does not yet have Para. New v2 engine is still isolated from real game rooms. Do not merge until integration is complete.


## Hero persistent economy checkpoint
New isolated HeroV2Core preserves historical total points on first migration, stores one permanent hero name/points/defense/charges, validates purchases, uses atomic existing Dollar/diamond ledgers and unique receipts, and has a trusted one-shot-per-game settlement helper. 90-diamond initial purchase, 500/1000-point packs, restore/reload/rename are implemented at storage level. Active-game purchases blocked. Existing production /hero remains legacy until v2 room adapter can safely synchronize charge/HP/defense with durable game state. No public RPC exposes settlement. Do not merge. Tests cover price, replay, conflicts, partial points and persistent defense. The adapter must still reserve/settle with durable game outbox, protect against role/phase abuse and recover failed room writes.


## Night response checkpoint
Added serializable deterministic preview/answer/finalize session for Wizard and Grench. One private answer per intended recipient, 30-second proposed timeout, missing Wizard answer kills Wizard, Grench defaults to money and requires a real ledger receipt; insufficient funds gives 17 HP damage. Preview is not a final public result. Still requires durable Room/Registry integration and conflict handling (e.g. overlapping Grench and Wizard effects). Fixed hero lint findings.


## Role economy / Telegram presentation checkpoint
Added transactional Grench transfers (real virtual balance only; no owner allowance mint), Klaus gift receipts and one discounted consumable offer per Seller per round. Seller prices ceil half price, commission floor 10% of actual paid amount in same currency; owner free purchase yields no commission. Proposed offer lifetime 60s, no VIP/hero/real-money sales. Operations check active same-game membership, are not exposed as untrusted RPC, and still require authoritative room role validation. Added native v2 presenter for private role and night/hero/vote/confirmation/revenge buttons, public phases, night response prompts and audience-specific effects. New callback format is bounded and distinct; production router/room is not yet wired. Tests added. No real deployment.


## Serializable room session checkpoint
Added standalone v2 room transitions with native Telegram outbox drafts, phase/deadline/game/actor checks, private response handling, deterministic timer progression, last words (one message, 29 seconds) and silence decisions. JSON snapshot reload is tested. This is an adapter building block, not live RoomCore integration: production dispatch remains on v1. Remaining critical work: use authoritative Registry receipts and durable room/outbox transaction ordering, integrate mode settings/lobby, group membership and last-word routing after match end, result statistics and hero shop/UI, and verify real Telegram E2E. No merge.


## Owner-only real Telegram preview checkpoint
Cloudflare RoomCore now optionally runs the v2 room session inside the existing lobby, durable storage, alarms and Telegram outbox. Off by default; enabled only by V2_PREVIEW=true, with owner-only explicit /game v2classic, v2zombie, v2hypernova, v2vs. Normal /game remains v1. Preview is clearly announced, no real wallet, hero or rating changes, Grench money path simulates insufficient funds; Klaus/Seller effects are not delivered as live purchases. Existing /stop, membership claim, DM probes and stale callback checks are preserved. Added integration tests for disabled gate, real router/lobby/callback/timer and cancellation. Production integration remains blocked on real economy/hero reconciliation and result migration, not solved by preview. Do not merge.


## Preview departure checkpoint
Explicit group /leave now forfeits the v2 participant, clears pending intents/votes and last-word eligibility, promotes a missing leader, and releases only the departing player's registry claim. This is preview-only; v1 behavior and balances remain unchanged. A locked Wizard/Grench night-response snapshot must resolve before departure is accepted; immediate exit during that window remains pending work. Added adapter and router regression tests. No production enablement or merge.


## Hero durable receipt checkpoint
Replaced draft shot settlement with an exact replayable receipt keyed by game and actor. Trusted request binds phase sequence, target, pre-hit HP, hero charge, damage, persistent defense and shield. Registry requires a running game with both active members before a new settlement; same request returns original receipt even after cleanup, changed request conflicts. Added pure room preparation/finalization bridge with revision guard, receipt/state consistency checks and reload/replay tests. Live routing remains disabled: RoomCore must still durably freeze mutation around pending settlement, initialize hero snapshots, and retry the registry operation before publishing. No real balances or production settings changed.


## Grench atomic night settlement checkpoint
Added one atomic ordered batch per game/round for Grench money decisions, with full replay receipts and rollback on conflicts/unavailable participants. Prepared room plan binds game, round, phase sequence, revision and exact debit amounts; finalization rejects missing/mismatched receipts and uses a fresh dawn clock after successful settlement. Tests use the real test SQLite ledger and deterministic room snapshots. Explicit HP requires no debit. No live routing or wallet mutation in production; overlapping Grench/Wizard preview interactions and durable RoomCore operation scheduling still require resolution.


## Durable RoomCore settlement checkpoint
Added persisted v2Night/v2Hero operations to the existing room retry queue. Room state is frozen while settlement is pending; the plan is saved before external calls, replay receipt is checked, and updated state/outbox/op removal are saved together. Preview uses simulated insufficient-funds receipts by default, still no real wallet changes. A dependency-injected ledger is available only to internal test harness (production Worker does not inject it), with hero snapshots at start and real test SQLite ledger. Tests simulate lost responses after committed debit/charge and restart. Admin /stop and /leave are temporarily rejected while a receipt is uncertain (retry after reconciliation); migration is deferred. This is not production enablement; need further work on permanent failure recovery, all role payouts and result migration.

Recovery hardening: explicitly save the exact queued plan immediately before every external ledger call, including when an older operation was already in flight. On reload or alarm, a previously persisted deferred migration is completed once the settlement queue clears. The ordinary preview still cannot access the real ledger.


## Klaus/Seller dawn receipt checkpoint
The injected test ledger now resolves all ready nights, including nights with no Grench debit, through the durable queue. It deterministically derives Klaus and Seller effects from the final night resolution, settles them in one atomic replayable dawn batch, and publishes only after receipt verification. Klaus gifts reach both participants privately; Seller offers are created only if both are alive at dawn (proposed policy), expire after 60 seconds and are privately notified. Purchase buttons/routing are still pending; the current test notification is explicit about that. Klaus gifts are awarded for a valid night action even if the recipient dies in that night (proposed simultaneous rule). Grench and dawn are separate replayable transactions; permanent failure recovery is still required. Production Worker does not inject the ledger. Added lost-response/restart and rollback tests.


## Seller private purchase checkpoint
Added private callback buttons for four eligible consumables, with the buyer, game, active same-round dawn/discussion phase, living seller/buyer and expiry rechecked in RoomCore. Purchases use the same durable queue and an exact attempt receipt, including insufficient-funds outcomes. One successful purchase removes the offer; 10% commission is floored in the actual currency, half-price rounded up to a whole unit. Items enter inventory for subsequent games, not the current reserved loadout (proposed). Test harness covers private ownership, replay and commission; no production ledger injection or deployment.


## Hero v2 private shop checkpoint
Internal test-only `/herov2` and `/herov2name <name>` UI shows level, total/next points, attack, defense, charges and kill points; permanent purchase, XP packs and conditional refill buttons, plus rename quote. A durable 120-second account-bound quote with exact price and argument is confirmed once; newer quote supersedes older pending quotes; declined or expired confirmation cannot later debit a top-up. Active game purchases remain blocked, existing owners pay zero in confirmation. Production Router does not inject the shop, and legacy /hero stays unchanged. Proposed choices: 120-second quote, one active quote per user, command for rename. Tests cover foreign account, stale price/expiry, replay, and group callback rejection. Existing account migration still needs production cutover planning.

Quote cancellation now durably revokes the exact account-bound pending quote, rather than merely hiding the confirmation screen. Profile progress bar is measured between the current and next level thresholds.


## V2 match result checkpoint
Trusted isolated ledger now binds a roster at start, records final outcome exactly once with replayable result receipt, updates existing match_points, profiles, role/group stats, history and Dollar rewards via existing v7 scoring. V2 final role/faction retained; VS winners use team cap, solo main wins use 150 cap, personal wins 70 for solo/neutral; zombie team cap 120; AFK/leavers -8/no Dollar for ranked matches. V2 does not award ordinary legacy hero XP. Cumulative missed eligible night actions tracked separately from consecutive AFK counter. Result freezes after last words until receipt is saved, supports lost-response replay, no production injection. Provisional: final role used for stats after conversion/promotion; VS color determines wins, surviving neutral/personal wins mapped to PERSONAL_WIN; existing XP/rating progression preserved. Full production migration, anti-farming validation and real Telegram verification pending.

V2 role statistics now use a separate table and carry an engine-version label in the existing statistics view, avoiding collisions between old and new role codes. History includes the actual mode. Existing legacy role rows remain intact; new ranked match caps are tested separately for solo, VS team, personal, AFK, unranked and practice. Legacy record endpoint rejects v2-rostered game numbers.


## V2 consumable loadout checkpoint
Internal ledger start now atomically reserves enabled armed consumables and binds exact loadout to the existing roster, returning identical receipt on retry. Room applies shield/document/vote shield/hero shield once before accepting night actions. First-night clock restarts after start receipt. Normal finish settles used items atomically with match result; cancellation and migration consume used and return unused via durable operations (proposed anti-refund-abuse policy). Disallowed items and normal no-money preview are untouched. Seller purchases are inventory for subsequent matches. Tests cover lost start receipt, cancellation, no-item configuration and used/unused balances. Production ledger remains disabled.

Added five explicit interaction scenarios for ordinary shield vs simultaneous lethal attacks and persistent defense, paid document vs spy/commissar/lawyer, zombie conversion vs doctor/shield, hero shield before persistent defense, and hanging protection before vote shield. These are focused assertions on confirmed/proposed precedence, not exhaustive proof of every role combination.


## Night interaction audit checkpoint
Fixed lint blockers in consumable tests. Night actions now resolve in stable seat order rather than callback arrival order. Minior traps exempt other Minior and Mergan; Lawyer can only select mafia; zombies cannot select already converted zombies. Grench HP losses are deferred until ordinary attack/Wizard resolution, avoiding a changed Wizard prompt plan or duplicate death; if ordinary attacks already kill the target, no additional HP loss is applied (proposed overlap policy). Grench lethal damage participates in the death/retaliation chain. Four new regression scenarios cover these decisions. VS coordination, spy sharing and information boundaries still require audit. No production deployment.

VS audit: coordinated mafia votes, effective visit and private mafia identities/chat/Spy reports are colour-scoped. Proposed explicit rule: if a colour has no Don, its Mafioso voters may independently attack the enemy colour by unique majority and the first matching voter is the attributed attacker; frozen Don disables only his own colour's coordinated attack. Ordinary modes retain Don priority. Spy shares the same masked result with allied mafia; Commissar checks reach only same-colour Sergeants in VS. These are proposed VS interaction policies, not claimed Bloody internals. Other role abilities retain faction-based logic for now; broader friendly-fire and promotion choices remain to review.


## Special-role and victory audit checkpoint
Added regressions for simultaneous Kamikaze attackers (Commissar and Kamikaze both lose; ordinary retaliation remains, hero shot does not retaliate), Krampous prior dead marks, protected marks, and no credit for AFK/leave; Frozen blocks Wizard response as well as active actions (proposed defensive-response precedence), does not accrue missed-night penalty while frozen, and expires next round. Chameleon conversion is deferred until after night resolution, only surviving unchanged Chameleon changes role (proposed simultaneous rule). VS succession stays in the former leader's colour; a winning verdict does not inflate the completed round count. Remaining: Grench response while frozen, broader VS ability/friendly-fire decisions, zombie prior leader conversion succession, and full end-to-end production audit. No live changes.

Hidden-faction audit supersedes the earlier Zombie target rejection: a zombie may select an already-zombie target, but the conversion has no effect. Chameleon may select any other living target; neutral/Zombie targets do not change its role. Both validation and the generated Telegram keyboard must be independent of hidden faction for these actors, preventing free identity probes. Proposed no-op policy preserves the requirement that zombies do not automatically learn each other's identities.


## Callback boundary audit
V2 private callbacks now route only through the requester's current Registry active membership and exact game number, rather than historical game-to-chat cache. Room-level game, actor, phase, seat and private chat checks still apply. Seller purchase also rejects an expired phase even before a delayed alarm advances it. Start verifies the exact roster/version after asynchronous hero snapshots. Regression tests use two actual independent rooms and forged cross-room/expired/group buttons. No deployment.

Deferred admin stop: if a v2 settlement is uncertain, persist the stop request, acknowledge it once and reject new callbacks. After exact receipt reconciliation, cancel and settle consumed/unused items; if the game naturally ended, preserve the completed result. Deferred migration has precedence. Reload/alarm resumes the saved stop. A permanently unavailable/conflicting ledger still requires operator investigation; do not discard committed economic operations automatically. New regression tests cover lost committed hero response, admin stop and restart.

Anti-farming review signal: admin stats count recipients of Klaus gifts in at least five cancelled matches totaling at least 500 Dollar within one hour, including different groups. Uses committed ledger receipts and cancelled game timestamps, not client reports; repeated receipt replay does not inflate the signal. Threshold is provisional, review only, no automatic ban, clawback or altered game rewards. Added regression for cross-group repeated cancellation and expiry.


## Actual workerd RPC integration (local only)
Added explicit internal Registry DO RPC methods for v2 snapshots, start reservation, hero/Grench/dawn/Seller settlements, results and shop quotes. GameRoom uses fresh Registry stubs per call. The switch requires V2_LOCAL_LEDGER=true, V2_PREVIEW=true, TEST_HOOKS=true and a loopback HTTP fake Telegram URL with explicit port. Production config is unchanged; even V2_PREVIEW=true alone cannot enable the real ledger. Existing v1 commands and hero account semantics stay unchanged. The existing local E2E script now includes a second V2 match through webhook, Room DO and Registry DO, checks role DMs, local hero price and persisted result. This is runtime integration, not production migration or real Telegram playtesting. Do not enable TEST_HOOKS in production; live coexistence/hero migration and permanent failure recovery remain blockers.

Local E2E also checks actual Registry DO hero quote creation, another user's rejected confirmation, insufficient diamonds and no hero granted on decline. Uses no payment provider or real Telegram token.
