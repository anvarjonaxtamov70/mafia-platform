# Hypernova V2 — cutover checklist (draft; do not execute on production yet)

Current situation: PR #16 is draft. The only money-enabled V2 runtime is local workerd using a fake loopback Telegram API. V1 remains live. No live database was read or modified during development.

## Before any production pilot
- Require green CI on the exact head: lint, typecheck, unit, PostgreSQL/Redis integration, workerd E2E.
- Resolve permanent receipt failures and operator recovery; demonstrate lost-response recovery for every mutation.
- Choose an isolated staging bot token and separate Registry/Room bindings. Never reuse production TEST_HOOKS, Telegram API override or production credentials for staging.
- Verify backup / recovery checkpoint for production Registry and document the restoration decision. Restoring a database snapshot can erase transactions committed after the checkpoint; do not use it as an automatic rollback.
- Count existing permanent heroes, legacy XP rows and any V2 rows without verified import markers. Reconcile ambiguous rows without adding guessed XP.
- Verify current games can finish in the engine version recorded on their rooms. Never change engine version mid-match.

## Legacy data policy (proposed)
| Data | Treatment |
| --- | --- |
| User IDs, profiles, balances, inventory, VIP, referrals, Para | Retain existing records; no destructive copy |
| Permanent hero ownership | Reuse PERSONAL_HERO; do not charge again |
| Legacy hero points | Copy exact total_xp; import only positive new delta once during V1 coexistence |
| V2 hero points and paid resources | Preserve; never overwrite with legacy total |
| V2 hero level | Recalculate under V2 formula; old level remains readable in V1 |
| Old hero cosmetics and historical awards | Preserve for audit; no second paid hero granted from cosmetic XP |
| Role stats | Versioned separately; preserve historical V1 role stats |
| Existing draft account without watermark | Flag for manual reconciliation, do not infer overlap |

## Final cutover design gates
1. Complete a staging end-to-end match in all four modes including item and hero effects, using ordinary and owner accounts.
2. Review V1/V2 hero coexistence: freeze legacy hero XP awards and import final positive delta at a controlled boundary, then route all hero purchase/profile paths to V2. Existing V1 sessions must drain or be handled explicitly; do not force cancellation merely to migrate.
3. Restrict any initial real pilot to explicit approved groups, no fake players, with a stop-new-matches switch separate from receipt reconciliation. Turning off new admissions must not disable RPCs required to finish already-started games.
4. Confirm profile/history/TOP, balances and item reservations against durable receipts; test group isolation and stale callbacks.
5. Only after review authorize deployment and gradual expansion. No production switch or credentials in this PR stage.

## Rollback
Stop new V2 admissions first. Keep in-flight V2 receipt processing available; do not reapply V1 accounting to a V2 game or clear uncertain operations. Preserve both versions of tables, wallet ledger and migration markers. Resolve pending transactions before considering code rollback. If V2 points need reverse migration, use an explicit reviewed reconciliation; never sum the two XP totals blindly.

## Held V2 settlement recovery
After six automatic failures, the precise queued operation is durably held, with no further automatic ledger retries. The group receives a generic pause notice; bot owners receive game number only. In bot DM, `/admin_v2_recovery GAME` shows metadata, and `/admin_v2_retry GAME OP` schedules one exact retry after the underlying issue is repaired. Failure returns immediately to hold. Inspect logs and the authoritative Registry receipt; never delete or rewrite the queue, invent a receipt, or release a game with uncertain settlement. An accepted deferred stop is applied only after reconciliation. This mechanism does not repair contradictory/corrupt ledger data by itself. If a permanent conflict remains, retain the hold and investigate a reviewed code/data correction.

The workerd E2E script includes all four modes (Classic, Zombie, Hypernova, VS), fresh participant profiles, private role delivery, equal VS teams and terminal result persistence via accelerated timeout/AFK path. This is smoke coverage, not full active-role manual playtesting. Staging still needs human-played scenarios, role effects and payments review.

## Isolated real-Telegram preview preparation
`apps/cloudflare/wrangler.staging.toml` defines a distinct Worker `hypernova-v2-staging` with its own SQLite Durable Object classes, owner-only V2 preview enabled, Stars purchases disabled, no fake players or test hooks and no V2 ledger. It is intentionally not a real-economy staging mode yet. CI performs a bundle-only dry run. The production workflow now skips the deploy job unless the ref is `main`. No workflow deploys staging automatically.

Before manual staging deployment, create a separate bot using BotFather, verify its identity differs from the live bot, set an explicit staging owner ID and use only a staging Worker secret. Never paste a token into chat, commit it, or reuse the production secret. Confirm the separate Worker name and DO bindings before running a deploy; register the webhook only for the staging bot. See `docs/18-V2-TELEGRAM-ACCEPTANCE.md` for the acceptance scenarios. Real-economy staging and the production cutover remain blocked until separate authorization and isolation are verified.

Staging worker now fails closed until distinct expected staging/production bot IDs, exact staging origin, explicit owner IDs and safe preview flags are supplied. Even authenticated `/telegram/setup` refuses a different existing webhook or bot identity before changing Telegram configuration. New pure guard tests; no real credentials or deployment.
