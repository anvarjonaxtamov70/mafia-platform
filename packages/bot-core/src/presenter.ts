/**
 * Presenter: GameEngine hodisalarini Telegram xabarlariga (outbox) aylantiradi.
 * Maxfiy ma'lumot faqat tegishli o'yinchiga yuboriladi; guruhga faqat ommaviy hodisalar.
 */
import {
  availableNightActions,
  getRole,
  mafiaCanVote,
  validTargets,
  type GameEvent,
  type GameState,
  type PlayerState,
  type RoleCode,
} from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import { encode } from './callback-data';
import type { ActionKind } from '@mafia/game-engine';
import { buttonLabel, rows, type Button, type Keyboard, type OutboxDraft } from './outbox-types';

export interface PresentUser {
  telegramId: bigint;
  isFake: boolean;
}

export interface PresentInput {
  game: { id: string; number: number; chatId: bigint };
  /** Mutatsiyadan keyingi games.version — dedupe kaliti uchun */
  version: number;
  state: GameState;
  events: GameEvent[];
  users: Map<string, PresentUser>;
  /** Mutatsiyadan oldingi bosqich raqami (ovoz xabari tugmalarini olib tashlash uchun) */
  prevPhaseSeq: number;
}

export function roleLabel(role: RoleCode): string {
  return `${getRole(role).emoji} ${t(`role.${role}.name`)}`;
}

function nameOf(state: GameState, id: string): string {
  return escapeHtml(state.players.find((p) => p.id === id)?.name ?? '?');
}

function plainName(p: PlayerState): string {
  return buttonLabel(p.name);
}

function secondsLeft(state: GameState): number {
  return state.phaseEndsAt ? Math.max(0, Math.round((state.phaseEndsAt - state.phaseStartedAt) / 1000)) : 0;
}

export function voteRefKey(gameId: string, phaseSeq: number): string {
  return `vote:${gameId}:${phaseSeq}`;
}

export function votingText(state: GameState): string {
  const alive = state.players.filter((p) => p.status === 'ALIVE');
  const voted = alive.filter((p) => state.day.votes[p.id] !== undefined).length;
  return t('game.voting', { seconds: secondsLeft(state), voted, total: alive.length });
}

export function votingKeyboard(state: GameState, gameNumber: number): Keyboard {
  const alive = state.players.filter((p) => p.status === 'ALIVE');
  const buttons: Button[] = alive.map((p) => ({
    text: `👤 ${plainName(p)}`,
    callback_data: encode({ t: 'vote', game: gameNumber, seq: state.phaseSeq, seat: p.seat }),
  }));
  const kb = rows(buttons, 2);
  kb.push([{ text: t('game.vote_none'), callback_data: encode({ t: 'vote', game: gameNumber, seq: state.phaseSeq, seat: 0 }) }]);
  return kb;
}

/** Tungi harakat klaviaturasi (shaxsiy chat). null — harakat yo'q. */
export function nightActionMessage(state: GameState, player: PlayerState, gameNumber: number): { text: string; keyboard: Keyboard } | null {
  const specs = availableNightActions(state, player);
  if (specs.length === 0) return null;
  const role = player.role;
  const emoji = getRole(role).emoji;
  const roleName = t(`role.${role}.name`);
  const seq = state.phaseSeq;
  const skip: Button = { text: t('dm.skip'), callback_data: encode({ t: 'skip', game: gameNumber, seq }) };
  if (specs.length > 1) {
    const buttons = specs.map((s) => ({
      text: t(`action.${s.kind}`),
      callback_data: encode({ t: 'action', game: gameNumber, seq, kind: s.kind, seats: [] }),
    }));
    return { text: t('dm.night_pick_action', { emoji, role: roleName }), keyboard: [...rows(buttons, 2), [skip]] };
  }
  const spec = specs[0]!;
  return { text: t('dm.night_prompt', { emoji, role: roleName, prompt: t(`role.${role}.prompt`) }), keyboard: targetKeyboard(state, player, gameNumber, spec.kind, []) };
}

export function targetKeyboard(state: GameState, player: PlayerState, gameNumber: number, kind: ActionKind, chosen: number[]): Keyboard {
  const spec = availableNightActions(state, player).find((s) => s.kind === kind);
  const seq = state.phaseSeq;
  const skip: Button = { text: t('dm.skip'), callback_data: encode({ t: 'skip', game: gameNumber, seq }) };
  if (!spec) return [[skip]];
  if (spec.targets.self === 'only') {
    return [[{ text: t('dm.use'), callback_data: encode({ t: 'action', game: gameNumber, seq, kind, seats: [player.seat] }) }], [skip]];
  }
  const targets = validTargets(state, player, spec).filter((p) => !chosen.includes(p.seat));
  const buttons = targets.map((p) => ({
    text: `👤 ${plainName(p)}`,
    callback_data: encode({ t: 'action', game: gameNumber, seq, kind, seats: [...chosen, p.seat] }),
  }));
  return [...rows(buttons, 2), [skip]];
}

export function mafiaVoteMessage(state: GameState, gameNumber: number): { text: string; keyboard: Keyboard } {
  const targets = state.players.filter((p) => p.status === 'ALIVE' && p.faction !== 'MAFIA');
  const seq = state.phaseSeq;
  const buttons = targets.map((p) => ({
    text: `🎯 ${plainName(p)}`,
    callback_data: encode({ t: 'mafia', game: gameNumber, seq, seat: p.seat }),
  }));
  return {
    text: t('dm.mafia_vote'),
    keyboard: [...rows(buttons, 2), [{ text: t('dm.mafia_skip'), callback_data: encode({ t: 'mafia', game: gameNumber, seq, seat: 0 }) }]],
  };
}

export function present(input: PresentInput): OutboxDraft[] {
  const { game, state, events, users, version } = input;
  const out: OutboxDraft[] = [];
  let n = 0;
  const key = (suffix: string) => `g:${game.id}:v${version}:${n++}:${suffix}`;
  const group = (text: string, extra: Partial<OutboxDraft> = {}) =>
    out.push({ chatId: game.chatId, payload: { kind: 'SEND', text }, dedupeKey: key('group'), gameId: game.id, ...extra });
  const dm = (playerId: string, text: string, keyboard?: Keyboard, extra: Partial<OutboxDraft> = {}) => {
    const u = users.get(playerId);
    if (!u || u.isFake) return;
    out.push({
      chatId: u.telegramId,
      payload: { kind: 'SEND', text, ...(keyboard ? { keyboard } : {}) },
      dedupeKey: key(`dm:${playerId}`),
      gameId: game.id,
      ...extra,
    });
  };
  const aliveMafia = () => state.players.filter((p) => p.faction === 'MAFIA' && p.status === 'ALIVE');
  const toAudience = (e: GameEvent, text: string) => {
    if (e.audience.kind === 'private') dm(e.audience.playerId, text);
    else if (e.audience.kind === 'mafia') for (const m of aliveMafia()) dm(m.id, text);
    else group(text);
  };
  const deathLine = (id: string, role: RoleCode | null, k: 'dawn_death' | 'executed' | 'day_death') =>
    role ? t(`game.${k}_role`, { name: nameOf(state, id), role: roleLabel(role) }) : t(`game.${k}`, { name: nameOf(state, id) });

  const lastPhaseIdx = events.map((e) => e.type).lastIndexOf('PHASE_STARTED');

  events.forEach((e, idx) => {
    switch (e.type) {
      case 'GAME_STARTED':
        group(t('game.started', { count: e.playerCount, mode: t(`mode.${e.mode}`) }));
        break;
      case 'ROLE_ASSIGNED': {
        const pid = e.audience.kind === 'private' ? e.audience.playerId : '';
        dm(pid, t('dm.role', { emoji: getRole(e.role).emoji, role: t(`role.${e.role}.name`), faction: t(`faction.${e.faction}`), desc: t(`role.${e.role}.desc`) }));
        break;
      }
      case 'MAFIA_TEAM': {
        const list = e.members.map((m) => `• ${nameOf(state, m.playerId)} — ${roleLabel(m.role)}`).join('\n');
        toAudience(e, t('dm.mafia_team', { list }));
        break;
      }
      case 'TWIN_PARTNER':
        toAudience(e, t('dm.twin_partner', { name: nameOf(state, e.partnerId) }));
        break;
      case 'HUNTER_TARGET':
        toAudience(e, t(e.reassigned ? 'dm.hunter_target_new' : 'dm.hunter_target', { name: nameOf(state, e.targetId) }));
        break;
      case 'LOVERS_LINKED':
        toAudience(e, t('dm.lovers', { name: nameOf(state, e.partnerId) }));
        break;
      case 'CUPID_RESULT':
        toAudience(e, t(e.random ? 'dm.cupid_random' : 'dm.cupid_result', { a: nameOf(state, e.loverIds[0]), b: nameOf(state, e.loverIds[1]) }));
        break;
      case 'PHASE_STARTED': {
        const seconds = e.endsAt ? Math.round((e.endsAt - state.phaseStartedAt) / 1000) : 0;
        const isCurrent = idx === lastPhaseIdx && state.status === 'RUNNING' && state.phase === e.phase;
        if (e.phase === 'NIGHT') {
          group(t('game.night', { night: e.nightNumber, seconds }));
          if (isCurrent) {
            for (const p of state.players.filter((x) => x.status === 'ALIVE')) {
              const msg = nightActionMessage(state, p, game.number);
              if (msg) dm(p.id, msg.text, msg.keyboard);
            }
            if (mafiaCanVote(state)) {
              const mv = mafiaVoteMessage(state, game.number);
              for (const m of aliveMafia()) dm(m.id, mv.text, mv.keyboard);
            }
          }
        } else if (e.phase === 'DAY_DISCUSSION') {
          group(t('game.day', { day: e.dayNumber, seconds }));
          if (isCurrent) {
            for (const p of state.players.filter((x) => x.status === 'ALIVE' && getRole(x.role).day.mayorReveal && !x.ability.flags['mayorRevealed'])) {
              dm(p.id, t('dm.mayor_prompt'), [[{ text: t('dm.mayor_button'), callback_data: encode({ t: 'mayor', game: game.number }) }]]);
            }
          }
        } else if (e.phase === 'DAY_VOTING' && isCurrent) {
          out.push({
            chatId: game.chatId,
            payload: { kind: 'SEND', text: votingText(state), keyboard: votingKeyboard(state, game.number) },
            dedupeKey: key('vote'),
            storeRefAs: voteRefKey(game.id, state.phaseSeq),
            gameId: game.id,
          });
        } else if (e.phase === 'DAY_VERDICT' && isCurrent && state.day.candidateId) {
          group(t('game.verdict', { name: nameOf(state, state.day.candidateId), seconds }));
          const judge = state.players.find((p) => p.status === 'ALIVE' && getRole(p.role).day.judgeVeto && !p.ability.flags['vetoUsed']);
          if (judge) {
            dm(judge.id, t('dm.judge_prompt', { name: nameOf(state, state.day.candidateId) }), [
              [{ text: t('dm.judge_button'), callback_data: encode({ t: 'veto', game: game.number, seq: state.phaseSeq }) }],
            ]);
          }
        }
        break;
      }
      case 'DAY_VOTE_CAST':
        if (state.phase === 'DAY_VOTING') {
          out.push({
            chatId: game.chatId,
            payload: { kind: 'EDIT', refKey: voteRefKey(game.id, state.phaseSeq), text: votingText(state), keyboard: votingKeyboard(state, game.number) },
            dedupeKey: key('vote-edit'),
            coalesceKey: `vote-edit:${game.id}:${state.phaseSeq}`,
            gameId: game.id,
          });
        }
        break;
      case 'MAFIA_VOTE_CAST':
        for (const m of aliveMafia()) {
          if (m.id === e.voterId) continue;
          dm(m.id, e.targetId ? t('dm.mafia_vote_cast', { voter: nameOf(state, e.voterId), target: nameOf(state, e.targetId) }) : t('dm.mafia_vote_skip', { voter: nameOf(state, e.voterId) }));
        }
        break;
      case 'ACTION_ACCEPTED':
        // Tasdiq callback javobida (xabar tahrirlanadi) ko'rsatiladi
        break;
      case 'ACTION_FAILED':
        toAudience(e, t('dm.action_blocked'));
        break;
      case 'CHECK_RESULT':
        toAudience(e, t('dm.check_result', { name: nameOf(state, e.targetId), faction: t(`faction.${e.faction}`) }));
        break;
      case 'ROLE_RESULT':
        toAudience(e, t('dm.role_result', { name: nameOf(state, e.targetId), role: roleLabel(e.role) }));
        break;
      case 'TRACK_RESULT':
        toAudience(
          e,
          e.visitedIds.length === 0
            ? t('dm.track_none', { name: nameOf(state, e.targetId) })
            : t(e.source === 'SPY' ? 'dm.track_spy' : 'dm.track_detective', {
                name: nameOf(state, e.targetId),
                targets: e.visitedIds.map((id) => nameOf(state, id)).join(', '),
              }),
        );
        break;
      case 'WATCH_RESULT':
        toAudience(
          e,
          e.visitorIds.length === 0
            ? t('dm.watch_none', { name: nameOf(state, e.targetId) })
            : t('dm.watch_result', { name: nameOf(state, e.targetId), list: e.visitorIds.map((id) => `- ${nameOf(state, id)}`).join('\n') }),
        );
        break;
      case 'COMPARE_RESULT':
        toAudience(e, t(e.same ? 'dm.compare_same' : 'dm.compare_diff', { a: nameOf(state, e.aId), b: nameOf(state, e.bId) }));
        break;
      case 'SHERIFF_RESULT':
        toAudience(e, t(e.acted ? 'dm.sheriff_acted' : 'dm.sheriff_idle', { name: nameOf(state, e.targetId) }));
        break;
      case 'ENGINEER_RESULT':
        toAudience(e, t(e.triggered ? 'dm.engineer_triggered' : 'dm.engineer_idle'));
        break;
      case 'VOTE_WEAKENED':
        toAudience(e, t('dm.vote_weakened'));
        break;
      case 'THIEF_RESULT':
        toAudience(e, t(e.success ? 'dm.thief_success' : 'dm.thief_fail', { total: e.total }));
        break;
      case 'TWIN_BONUS':
        toAudience(e, t('dm.twin_bonus'));
        break;
      case 'DAWN': {
        const lines: string[] = [];
        for (const d of e.deaths) lines.push(deathLine(d.playerId, d.role, 'dawn_death'));
        if (e.savedCount > 0) lines.push(t('game.dawn_saved', { count: e.savedCount }));
        if (e.revivedIds.length > 0) for (const id of e.revivedIds) lines.push(t('game.dawn_revived_named', { name: nameOf(state, id) }));
        else if (e.revivedCount > 0) lines.push(t('game.dawn_revived'));
        if (lines.length === 0) lines.push(t('game.dawn_quiet'));
        group(t('game.dawn', { body: lines.join('\n'), alive: e.aliveCount }));
        for (const d of e.deaths) dm(d.playerId, t('dm.dead_info'));
        break;
      }
      case 'MAYOR_REVEALED':
        group(t('game.mayor', { name: nameOf(state, e.playerId) }));
        break;
      case 'VOTE_RESULT': {
        const lines = e.tally.map((x) => t('game.vote_line', { name: nameOf(state, x.targetId), weight: x.weight }));
        const verdict = e.candidateId
          ? t('game.vote_candidate', { name: nameOf(state, e.candidateId) })
          : e.tally.length === 0 && e.noneWeight === 0
            ? t('game.vote_no_votes')
            : t('game.vote_nobody');
        group(t('game.vote_result', { lines: lines.length ? `${lines.join('\n')}\n` : '', none: e.noneWeight, verdict }));
        out.push({
          chatId: game.chatId,
          payload: { kind: 'CLEAR_KEYBOARD', refKey: voteRefKey(game.id, input.prevPhaseSeq) },
          dedupeKey: key('vote-clear'),
          gameId: game.id,
        });
        break;
      }
      case 'VERDICT_STARTED':
        break;
      case 'JUDGE_VETO':
        group(t('game.judge_veto'));
        break;
      case 'PLAYER_EXECUTED':
        group(deathLine(e.playerId, e.role, 'executed'));
        dm(e.playerId, t('dm.dead_info'));
        break;
      case 'DAY_DEATHS':
        for (const d of e.deaths) {
          group(deathLine(d.playerId, d.role, 'day_death'));
          dm(d.playerId, t('dm.dead_info'));
        }
        break;
      case 'PERSONAL_WIN':
        group(t('game.personal_win', { name: nameOf(state, e.playerId), role: roleLabel(e.role) }));
        break;
      case 'AFK_NOTICE':
        dm(e.playerId, t(e.penalized ? 'afk.penalty' : 'afk.warning'));
        break;
      case 'PLAYER_LEFT':
        group(e.role ? t('game.left_role', { name: nameOf(state, e.playerId), role: roleLabel(e.role) }) : t('game.left', { name: nameOf(state, e.playerId) }));
        break;
      case 'GAME_ENDED': {
        const r = e.result;
        const winner = r.reason === 'MAX_CYCLES' ? t('game.winner.MAX_CYCLES') : t(`game.winner.${r.outcome}`);
        const icon = { WIN: '🏆', LOSS: '💀', DRAW: '🤝', PERSONAL_WIN: '🏅' } as const;
        const lines = r.players
          .map((p) => {
            const note = p.left ? t('game.end_note.LEFT') : p.outcome === 'PERSONAL_WIN' ? t('game.end_note.PERSONAL_WIN') : '';
            return t('game.end_line', { icon: icon[p.outcome], name: nameOf(state, p.playerId), role: roleLabel(p.role), note });
          })
          .join('\n');
        group(t('game.ended', { winner, lines, days: state.dayNumber }));
        break;
      }
    }
  });
  return out;
}
