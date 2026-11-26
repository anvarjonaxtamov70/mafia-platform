# Hypernova V2 — video-based interaction parity (2026-11-26)

## Evidence and limitations
User-provided IMG_5299.MOV, 195.705 seconds, 352×624, 30 fps, 18.12 MB. Reviewed frames throughout the recording, with closer examination around interaction transitions. Recording shows a reference Telegram group's approximately 30-player match, night actions, dawn, discussion, day nomination, public verdict and following night. It does not establish two complete match endings, internal allocation algorithms, hidden backend state, all role mechanics, or an exact server latency SLA. The footage is low-resolution video of a phone, not direct Telegram logs. User's explicit corrections override previous proposed behavior.

## Observed timeline
| Approx. time | Observed reference behavior |
| --- | --- |
| 00:00–00:10 | Numbered roster extends to 30, linked player names, pinned game/join message, countdown text and “Botga o‘tish” button. |
| 00:10–00:17 | Animated night transition, short night narration, living-player list, 30-second night text and group→bot navigation. Individual public role-action activity notices begin. |
| 00:18–00:23 | Private role/description for Mergan, numbered target buttons. After a target is pressed, question remains with “Sizning tanlovingiz: …”; target keyboard disappears; “Guruhga o‘tish” remains. |
| 00:25–00:50 | Group action feed: e.g. Doctor begins night duty, Commissar investigates, Daydi visits, Frozen visits, Don chooses victim, Mergan selects target. These notices use role labels, not living players' secret role identities or selected victim names. |
| 00:50–01:09 | Grench transaction notice and separate death notices including dead player's role/name and killer role (e.g. Don, Manyak, Mergan, Kimyogar). Sunrise animation with short day narration. |
| 00:55–01:10 | Remaining-player roster, aggregate role composition by factions (6 city, 8 mafia, 8 solo, 3 neutral; 25 total), not a mapping of living players to roles. |
| 01:14–01:38 | Public last words attributed to eliminated players, with their roles. Discussion remains in group. |
| 01:41–02:02 | Group announces 30-second voting, “Botga o‘tish”; public messages attribute each submitted nomination to voter and target. |
| 02:03–02:07 | Private numbered voting targets, skip option; after selection the message shows chosen target and only return-to-group button. |
| 02:12–02:22 | One group verdict message asking whether the nominated player should be hanged; two thumbs-up/down inline buttons display live counts (visible yes count increases 0→2→4→6); no private verdict menu observed. |
| 02:42–03:15 | New night roster and bot navigation, fresh private numbered target keyboard including skip; public role-action notices resume. End-of-match rewards or a second full match ending are not visible. |

## Confirmed user requirements
1. Exactly one Doctor in each mode. Hypernova/VS initially active-only. Do not duplicate Doctor to fill small/large games. User reported a live 4-player bad distribution: 2 Doctors, Don, Sergeant (in code, fixed 4-seat active distribution currently has 1 Don, 1 Commissar, 2 Doctors; reported Sergeant may reflect label/display or assignment and needs verification, not dismissal).
2. Nomination votes in DM; execution verdict in group, one shared live tally message. No private Y/N verdict.
3. After each accepted private action (night attack/check/heal/skip, nomination, hero, revenge, prompt, shop choice when applicable), edit the exact original message: retain question, append confirmation and target/action, remove selection buttons. Keep return-to-group URL button. Do not delete action history. Reject duplicate/stale/foreign choices and do not emit a second public announcement or spend resources again. Invalid or failed actions must not falsely show success.
4. Group public action feed: role-specific night activity (no live actor identity/secret target disclosure); public nomination voter→target; death victim name + role + cause/killer role; last words with victim role/name. Sensitive check/witness results and private role assignment stay private.
5. Night/day transitions include original Hypernova animations, concise narrative, roster, countdown and group→bot navigation; preserve player numbering within one match. Show aggregate remaining role counts without mapping living identity to role.
6. Group chat must allow discussion at correct phases, dead-player last words via DM, reject ineligible votes. Public verdict count must update the same message, not create one per click. Closing phase disables old keyboards; navigation can remain.
7. Smoothness: no unnecessary duplicate prompts/messages, short callback acknowledgement, ordered public events, retry-safe durable outbox; Telegram API failures/429 must not advance false UI state.

## Code audit at head 31cb044
- packages/game-engine/src/v2/catalog.ts: repeatPool for non-Classic contains DOCTOR and minimum-eligible DAYDI/FROZEN; at 4 players Hypernova/VS yields DON+COMMISSAR+DOCTOR+DOCTOR. Classic at 4 lacks Doctor. Need role allocation policy with one Doctor, enough eligible active seats and tests for every size 4–30 (VS even). Proposed, not verified reference: 4-player active DON/COMMISSAR/DOCTOR/DAYDI, Classic DON/COMMISSAR/DOCTOR/CITIZEN; small active modes relax support-role minimum (DAYDI), bigger modes use appropriate active support rather than duplicate Doctor. Confirm balance; no claim this is the reference algorithm.
- packages/bot-core/src/v2-presenter.ts: private verdict Y/N exists; public phase view currently only phase title, living list, HP; DEATH only prints name “o‘yindan chiqdi”; no public activity or nomination feed, no actor-aware confirmation, skip nomination missing. Add structured view/notice functions, source role/cause metadata, aggregate living roster; never infer private info from public message.
- apps/cloudflare/src/v2-room-session.ts: publishes group/DM phase snapshots; v2RoomButton updates intents/votes/verdicts but doesn't generate confirmation or per-action notices. Session should persist one accepted choice per applicable phase/action and exact target, private message reference and group verdict reference/tally. Use accepted state for confirmation, not untrusted callback alone.
- apps/cloudflare/src/router.ts: V2 callbacks currently require private origin for all, return generic “Qabul qilindi”; change only Y/N to exact authenticated active group's verdict message, preserve DM restriction for all other operations. Validate active membership, game, seq, sender eligibility, chat and message identity. Keep actual economic receipt for hero/Seller before final confirmation.
- apps/cloudflare/src/room-core.ts: existing durable outbox supports SEND/EDIT by ref, retry and coalescing. Reuse rather than invent untracked sends. Preserve public phase order, no duplicate notices, immutable choice receipt through restart. Keep old games/legacy routing unaffected during staging.
- packages/game-engine/src/v2/engine.ts: v2Submit/v2Vote/v2Verdict currently replace previous choice, despite UI requiring final accepted private action. Enforce private one-choice semantics in adapter with tests. Public verdict policy (one vote per person; whether changing vote is permitted) is not conclusively evidenced by video. Proposed one vote, reject repeat; tally counts actual eligible votes and weighted Janob behavior only if agreed.
- Visual assets should be original Hypernova, not copied reference branding/media. Source video does not establish exact per-role animation designs.

## Implementation order (do not merge before acceptance)
A. Correct role distribution and role-name mapping; matrix test across sizes; fix active-play fixtures without weakening assertions.
B. Durable private selection confirmation and cleanup; per-choice public role activity feed (privacy-safe); group/DM navigation.
C. Group verdict with live aggregate tally, public nomination feed and skip, stale/foreign/dead/duplicate protection; exact message scope.
D. Death cause/victim role, last words, remaining role roster, original phase animation and timer UX.
E. Test all four modes via synthetic Telegram and workerd using emitted buttons; 4/8/30 players, lost response/restart, concurrent clicks, 429 and outbox ordering, live staging smoke with a small real group when available.

Video acceptance is independent of previous green unit tests. This document is a source-grounded audit; no implementation changes or new production deployment in this commit. User's reported live defects remain open.
