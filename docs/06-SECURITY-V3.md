# Security v3 — operation and recovery

Scope: current Cloudflare production runtime. No destructive migration, no changes to owner VIP/Coins or game rules.

## Added
- Durable per-actor command/callback admission: 60 per 10 seconds, shared across Worker isolates; existing stricter in-memory click and chat limits remain. Successful/refunded payments and pre-checkout bypass admission. Ordinary group moderation remains outside the persistent guard.
- Same update ID is suppressed; concurrent processing returns 503. An interrupted non-idempotent update is recorded as uncertain rather than blindly replayed. Metadata only (ID, state, timestamp; separate rate row with actor ID), incremental cleanup after 48h. Not an exactly-once durable inbox. Abrupt failure can lose a nonfinancial command; /admin_stats exposes uncertain count.
- Refund reservation is atomic. Unknown Telegram outcome stays REFUND_PENDING; authenticated refunded_payment service event reconciles by payer, charge and amount. No automatic retry of an uncertain refund. If event is missing, compare Telegram transaction records and arrange a reviewed reconciliation; never issue a second refund blindly.
- Registry operation retry with exponential backoff, persistent state and 8-operation budget per alarm. Game phases and outgoing messages can continue while the registry operation waits.
- Owner alerts on webhook, alarm and registry errors, 15-minute cooldown per type; no raw payload or secret in alert. Alerts require an open DM and reachable Telegram API.
- Commands are subject to night/dead message deletion; /devfill requires superadmin plus existing test setting.
- New 100-room virtual harness test, 1000-actor admission test, recovery and refund regressions, real-runtime E2E replay check. npm production dependency audit initially report-only to avoid blocking deploy on unknown advisory baseline.

## Before merge
All lint, typecheck, unit, integration and workerd E2E tests must pass; review dependency audit output. Verify two owners still receive VIP PRO and allowance; no real Stars test charges without approval. Test one real group from start to finish.

## Operator runbook / remaining work
1. GitHub: enable 2FA, branch protection for main, required CI, secret scanning if available. Restrict deploy credentials; pin actions to audited commit SHAs separately.
2. Cloudflare: use account 2FA, minimum-scope deployment token, rate limiting/WAF if supported by plan and endpoint. No live DDoS mitigation configuration was changed by this PR. Registry remains a shared bottleneck.
3. Verify production backups/PITR entitlement and retention in Cloudflare dashboard. Document restore procedure, export/store encrypted backups with least privilege, and rehearse restore in staging (never restore over live data untested). No backup job was installed here.
4. Test 100/1000 parallel real-runtime groups and soak traffic in a non-production environment, measure p95/p99 latency, CPU, queue depth, quota and message errors. Virtual 100-room test is not a capacity claim.
5. Full durable inbound queue with atomic business operations and bounded retries, provider refund reconciliation if a service event never arrives, cross-room outbound Telegram rate limiting, abuse telemetry/collusion detection, privacy deletion policy and independent penetration test remain separate work. Do not advertise absolute security.

## Follow-up hardening
- CI baseline showed zero known production npm vulnerabilities, so high/critical production advisories now block CI; weekly read-only audit on main; checkout credentials not persisted.
- Every 15 minutes Cloudflare cron checks Telegram webhook backlog and reconciles up to 100 pending refunds against up to 300 recent provider transactions. Matching requires outgoing user recipient, original charge ID and full amount. No refund is issued by this task. Older unmatched transactions require manual review.
- Review-only anti-farming signal: six same-roster games within an hour in one group, with at least half inactive/left in the sixth or later game. No automatic punishment or rewards changes; not proof of cheating. Limited retention; aggregates in /admin_stats.
- Native SQLite Durable Object PITR supports the past 30 days (https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api). Daily Registry recovery bookmark kept internally and timestamp visible via authenticated diag. Not an offsite copy, no automatic restore endpoint, local PITR unsupported. Verify production cron and recovery timestamp after deploy; independent encrypted offsite backup and staging restore still require infrastructure setup.
- No WAF/account/2FA settings changed by code. No external backup fees or accounts created.
