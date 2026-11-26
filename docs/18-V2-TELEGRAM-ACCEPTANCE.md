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

## Windows / local launch helper
The helper `apps/cloudflare/scripts/staging-launch.mjs` runs **read-only** Telegram identity/webhook checks without arguments. It only deploys with explicit `--apply` and `STAGING_CONFIRM=hypernova-v2-staging`. Use the PR branch, not main, and require green CI first. Install Node 22 and run `npm ci` from the repo root. Authenticate Wrangler to the intended Cloudflare account separately (`npx wrangler login`). In PowerShell, set these environment variables in the same terminal (substitute actual values):
```powershell
$env:STAGING_BOT_ID = "NEW_BOT_NUMERIC_ID"
$env:PRODUCTION_BOT_ID = "LIVE_BOT_NUMERIC_ID"
$env:STAGING_ORIGIN = "https://hypernova-v2-staging.YOUR_SUBDOMAIN.workers.dev"
$env:STAGING_ADMIN_IDS = "YOUR_TELEGRAM_USER_ID"
$secret = Read-Host "Staging bot token (not production)" -AsSecureString
$env:STAGING_BOT_TOKEN = [System.Net.NetworkCredential]::new("", $secret).Password
node apps/cloudflare/scripts/staging-launch.mjs
```
Check the displayed bot username and worker before approving. Only after verification, run:
```powershell
$env:STAGING_CONFIRM = "hypernova-v2-staging"
node apps/cloudflare/scripts/staging-launch.mjs --apply
Remove-Item Env:STAGING_BOT_TOKEN, Env:STAGING_CONFIRM -ErrorAction SilentlyContinue
```
The script never deploys by default, never takes a token as an argument, checks existing webhook, deploys only using staging config, verifies reported origin before secret upload, and validates the setup response. If a deploy partially succeeds, inspect the staging Worker and retry only with the same staging identity. No automatic cleanup of any Worker or webhook. The helper has not been executed against a real Telegram or Cloudflare account.

## GitHub-only option (no VS Code)
Use the existing **Tekshiruv** workflow, which already exists on main and supports manual dispatch. On the V2 branch only, a separate `deploy_staging` job runs after full CI on manual dispatch, never on PR/push. It uses the GitHub Environment `hypernova-v2-staging`. Create that environment in Settings → Environments, restrict deployment to branch `hypernova-role-parity-v16`, and add approval protection if supported. Add environment secrets `STAGING_BOT_TOKEN`, `STAGING_CLOUDFLARE_API_TOKEN`, `STAGING_CLOUDFLARE_ACCOUNT_ID`; use appropriately scoped Cloudflare credentials, no production bot token. Add environment variables `STAGING_BOT_ID`, `PRODUCTION_BOT_ID`, `STAGING_ORIGIN`, `STAGING_ADMIN_IDS`, and `STAGING_CONFIRM`=`hypernova-v2-staging` only when ready. Bot username is explicitly checked against the supplied `HypernovaV2Test_Bot`. In Actions → Tekshiruv → Run workflow, select `hypernova-role-parity-v16`. Verify CI and staging job result. No job dispatch or deployment has been performed. Remove the confirmation variable after the trial if no further deployments are wanted. The environment must be configured correctly by an authorized owner; there is no automatic fallback to production credentials.

## First staging launch retry
Manual run 45797311078 passed full CI and Telegram preflight, but the apply step stopped with a generic runtime/connectivity error; exact failing substep was not visible. The launcher now logs deploy, secret upload, readiness and webhook setup separately, with sanitized numeric codes/HTTP status, bounded retries for propagation, and safe handling of non-JSON responses. A 403 safety rejection is never retried. Retry using a NEW manual Tekshiruv run on the V2 branch, not rerun of the old commit. Existing staging secrets/variables need not be re-entered. No production worker changes.

## Telegram command menu aliases
The four V2 commands are now `/game_v2classic`, `/game_v2zombie`, `/game_v2hypernova`, `/game_v2vs`, advertised by setup only when V2_PREVIEW is true. The previous space-argument syntax still works; `/game` remains V1. All aliases use the existing owner-only gate. The local workerd E2E uses the new aliases in all four modes and verifies their registration in the group command menu. Deploy the updated staging branch to refresh Telegram commands; no merge.

## No-audience automated acceptance
Added three deterministic active-mode scenarios via real Router, RoomCore and SQLite Registry harness using emitted callback buttons and normal randomly assigned roles: Zombie conversion with healing, Hypernova protected target and Commissar shot, VS opposing-team kill and vote. Each checks no AFK, final history, released membership and stable balance after extra alarms. This is synthetic Telegram traffic, not human acceptance; CI pending. Existing local workerd smoke covers all four modes.

Active-mode CI initially passed 294/296 tests; Zombie and Hypernova fixtures tried to read an already-settled room after normal immediate cleanup. Revised fixtures observe the successful real Registry settlement instead, asserting exact game/mode/outcome, expected winner IDs, every participant active and not AFK, released memberships and no repeat settlement. No runtime behavior changed. New CI pending.

## Opt-in isolated virtual economy trial
After CI is green, an authorized owner may add environment variable `STAGING_V2_LEDGER=true` and run the staging workflow. Only the separate staging worker with valid bot identity, safe flags and dedicated storage can use V2 ledger RPCs. This activates simulated/virtual Dollars, Diamonds, hero purchases and match accounting on staging; Stars stay off and production is not changed. `/herov2` is advertised when the ledger is enabled. The launcher checks the existing staging health, prevents ordinary downgrade of an already-enabled ledger and verifies the requested ledger state after deployment. Do not remove the variable while there are active or uncertain matches. No live economic trial has been performed; local workerd and synthetic player tests are not human acceptance. Legacy V1 routes remain available for comparison; use V2 commands for V2 trials, not legacy hero purchases. Production cutover remains blocked.
