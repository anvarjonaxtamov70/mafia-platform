# V2 Telegram acceptance (staging, no production changes)

## Preconditions
- Exact branch CI green, including staging dry-run and workerd tests.
- Separate bot created in BotFather; separate Cloudflare Worker named hypernova-v2-staging, separate secrets and DO storage. Do not reuse production bot token, webhook, or worker.
- Use a private test group, add the staging bot as administrator with message-delete rights, and register at least four test participants in its DM. Set only the intended staging owners in ADMIN_IDS. Leave Stars off, V2_LOCAL_LEDGER false, TEST_HOOKS false, no TELEGRAM_API override.
- This preview validates Telegram interaction only. It intentionally does not settle real virtual currency, hero or ranking balances. Do not infer economy readiness from it.

## Acceptance scenarios
| ID | Action | Expected result |
| --- | --- | --- |
| T01 | Owner /game v2classic; other members join; non-admin /startgame then admin /startgame | Non-admin denied, correct roster and private roles, no public roles |
| T02 | Don submits night target, Commissar checks, Doctor heals when available | Correct private messages, timers and role effects |
| T03 | Vote, verdict, execution, last word within 29 seconds | Correct target, one public last word, stale button rejected |
| T04 | /game v2zombie | No Citizen, conversion removes old ability, zombie identities not disclosed by target buttons |
| T05 | /game v2hypernova | Only active initial roles, night buttons private, no hidden-role leaks |
| T06 | /game v2vs with an even number; repeat with odd number | Equal red/blue teams; invalid size rejected; mafia messages remain colour-scoped |
| T07 | Two independent test groups and old game buttons | No cross-group action or reward; current active membership required |
| T08 | /leave, admin /stop, normal user /stop | Only authorized stop, correct departure, next lobby available |
| T09 | Reply to a user's message with /para; accept in bot DM; /mypara | Request and acceptance private, one pair; /qpara confirmation private |
| T10 | Existing /hero, /profile and /top; normal /game | Legacy path remains available; preview produces no wallet or ranking changes |

For each scenario record commit, group, game number, result, short description and screenshots with tokens/private data removed. Mark PASS only after actual observation. An issue involving balance or private role leakage blocks pilot. No real Stars purchases in staging. Do not run production deploy from the draft branch.

## After interaction acceptance
Complete a separately approved isolated economy trial, including persistent hero shots, Seller, Klaus, Grench, shields, reward retries, migration and recovery. Then follow the cutover checklist. Human staging acceptance is not automated and has not yet been performed.

## Fail-closed staging identity
Staging requires `STAGING_BOT_ID`, `PRODUCTION_BOT_ID` (public numeric bot IDs, not owner IDs), `STAGING_ORIGIN` (the exact `https://hypernova-v2-staging.<account-subdomain>.workers.dev`), explicit ADMIN_IDS and a matching separate BOT_TOKEN. Defaults are deliberately blank and block Telegram actions. Runtime refuses mismatched token prefix/identity, origin, unsafe flags or an existing webhook belonging to another origin before `setWebhook`. Leave production config unchanged. The guard is defense-in-depth, not proof that operator-supplied production ID is correct.
