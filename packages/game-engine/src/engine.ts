/**
 * GameEngine — ommaviy API. Har bir funksiya sof: kirish holatini o'zgartirmaydi,
 * yangi holat va hodisalar (events) qaytaradi.
 */
import { buildConfig, BALANCE_VERSION, MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR } from './config';
import { distributeRoles, DistributionError, safeComposition, validateComposition } from './distribution';
import { grantTwinBonus, resolveNight } from './night/resolver';
import { getRole } from './roles';
import { cryptoRng, pick, shuffle } from './rng';
import type {
  ActionKind,
  ArcadeItems,
  DayVote,
  EngineErrorCode,
  EngineResult,
  GameConfig,
  GameEvent,
  GameMode,
  GameState,
  MainOutcome,
  Phase,
  PlayerState,
  Rng,
  RoleCode,
} from './types';
import { availableNightActions, validateNightAction } from './validation';
import { applyPersonalWins, buildResult, checkMainVictory, reassignHunterTargets } from './victory';

export interface CreateGameInput {
  id: string;
  mode: GameMode;
  players: { id: string; name: string }[];
  config?: Partial<GameConfig>;
  now: number;
  rng?: Rng;
  /** Faqat testlar uchun: aniq rollar (o'yinchilar tartibida, aralashtirilmaydi) */
  fixedRoles?: RoleCode[];
  /** Arcade buyumlari (faqat allowArcadeItems bo'lsa) */
  items?: Record<string, Partial<ArcadeItems>>;
}

function fail(state: GameState, error: EngineErrorCode): EngineResult {
  return { ok: false, error, state };
}

function ok(state: GameState, events: GameEvent[]): EngineResult {
  return { ok: true, state, events };
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

export function getPlayer(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.status === 'ALIVE');
}

function phaseDuration(cfg: GameConfig, phase: Phase): number | null {
  switch (phase) {
    case 'NIGHT':
      return cfg.nightDurationSec;
    case 'DAY_DISCUSSION':
      return cfg.discussionDurationSec;
    case 'DAY_VOTING':
      return cfg.votingDurationSec;
    case 'DAY_VERDICT':
      return cfg.verdictDurationSec;
    case 'ENDED':
      return null;
  }
}

function startPhase(s: GameState, phase: Phase, now: number, events: GameEvent[]): void {
  s.phase = phase;
  s.phaseSeq += 1;
  s.phaseStartedAt = now;
  const dur = phaseDuration(s.config, phase);
  s.phaseEndsAt = dur === null ? null : now + dur * 1000;
  events.push({
    type: 'PHASE_STARTED',
    phase,
    nightNumber: s.nightNumber,
    dayNumber: s.dayNumber,
    endsAt: s.phaseEndsAt,
    aliveCount: alivePlayers(s).length,
    audience: { kind: 'public' },
  });
}

// ───────────────────────────── O'yin yaratish ─────────────────────────────

export function createGame(input: CreateGameInput): EngineResult | { ok: false; error: EngineErrorCode } {
  const rng = input.rng ?? cryptoRng;
  const config = buildConfig(input.mode, input.config);
  const n = input.players.length;
  if (n < Math.max(MIN_PLAYERS_FLOOR, config.minPlayers)) return { ok: false, error: 'NOT_ENOUGH_PLAYERS' };
  if (n > Math.min(MAX_PLAYERS_CEILING, config.maxPlayers)) return { ok: false, error: 'TOO_MANY_PLAYERS' };
  if (new Set(input.players.map((p) => p.id)).size !== n) return { ok: false, error: 'DUPLICATE_PLAYER' };

  let roles: RoleCode[];
  if (input.fixedRoles) {
    try {
      validateComposition(input.fixedRoles, n);
    } catch {
      return { ok: false, error: 'DISTRIBUTION_FAILED' };
    }
    roles = [...input.fixedRoles];
  } else {
    try {
      roles = shuffle(distributeRoles({ playerCount: n, mode: input.mode, config, rng }), rng);
    } catch (e) {
      if (!(e instanceof DistributionError)) throw e;
      roles = shuffle(safeComposition(n), rng);
    }
  }

  const players: PlayerState[] = input.players.map((p, i) => {
    const role = roles[i]!;
    const def = getRole(role);
    const init = def.initialAbility();
    const items = input.items?.[p.id];
    return {
      id: p.id,
      name: p.name,
      seat: i + 1,
      role,
      faction: def.faction,
      status: 'ALIVE',
      death: null,
      ability: {
        charges: { ...(init.charges ?? {}) },
        lastTargets: [],
        lastNight: 0,
        flags: { ...(init.flags ?? {}) },
        counters: { ...(init.counters ?? {}) },
      },
      items: {
        shield: config.allowArcadeItems && !!items?.shield,
        fakeDocument: config.allowArcadeItems && !!items?.fakeDocument,
      },
      missedActions: 0,
      missedVotes: 0,
    };
  });

  const state: GameState = {
    schemaVersion: 1,
    id: input.id,
    mode: input.mode,
    config,
    balanceVersion: BALANCE_VERSION,
    status: 'RUNNING',
    phase: 'NIGHT',
    phaseSeq: 0,
    phaseStartedAt: input.now,
    phaseEndsAt: null,
    nightNumber: 1,
    dayNumber: 0,
    players,
    links: { lovers: null, twins: null, hunterTargets: {} },
    night: { actions: {}, skipped: [], mafiaVotes: {} },
    day: { votes: {}, candidateId: null },
    votePenaltyDay: {},
    twinBonusDay: {},
    actionSeq: 0,
    result: null,
  };

  const events: GameEvent[] = [{ type: 'GAME_STARTED', playerCount: n, mode: input.mode, audience: { kind: 'public' } }];
  for (const p of players) {
    events.push({ type: 'ROLE_ASSIGNED', role: p.role, faction: p.faction, audience: { kind: 'private', playerId: p.id } });
  }
  const mafia = players.filter((p) => p.faction === 'MAFIA');
  for (const m of mafia) {
    events.push({
      type: 'MAFIA_TEAM',
      members: mafia.map((x) => ({ playerId: x.id, role: x.role })),
      audience: { kind: 'private', playerId: m.id },
    });
  }
  const twins = players.filter((p) => p.role === 'TWIN');
  if (twins.length === 2) {
    state.links.twins = [twins[0]!.id, twins[1]!.id];
    events.push({ type: 'TWIN_PARTNER', partnerId: twins[1]!.id, audience: { kind: 'private', playerId: twins[0]!.id } });
    events.push({ type: 'TWIN_PARTNER', partnerId: twins[0]!.id, audience: { kind: 'private', playerId: twins[1]!.id } });
  }
  for (const h of players.filter((p) => p.role === 'HUNTER')) {
    const target = pick(players.filter((p) => p.id !== h.id), rng)!;
    state.links.hunterTargets[h.id] = target.id;
    events.push({ type: 'HUNTER_TARGET', targetId: target.id, reassigned: false, audience: { kind: 'private', playerId: h.id } });
  }
  startPhase(state, 'NIGHT', input.now, events);
  return ok(state, events);
}

// ───────────────────────────── Tungi harakatlar ─────────────────────────────

export interface NightActionInput {
  actorId: string;
  kind: ActionKind;
  targetIds: string[];
  now: number;
  /** Tugma qaysi bosqich uchun yaratilgan (eskirgan tugmalarni rad etish) */
  phaseSeq?: number;
}

function checkStale(state: GameState, phaseSeq: number | undefined): EngineErrorCode | null {
  if (state.status !== 'RUNNING') return 'GAME_FINISHED';
  if (phaseSeq !== undefined && phaseSeq !== state.phaseSeq) return 'STALE_PHASE';
  return null;
}

export function submitNightAction(state: GameState, input: NightActionInput): EngineResult {
  const stale = checkStale(state, input.phaseSeq);
  if (stale) return fail(state, stale);
  const actor = getPlayer(state, input.actorId);
  if (!actor) return fail(state, 'NOT_A_PLAYER');
  const err = validateNightAction(state, actor, input.kind, input.targetIds);
  if (err) return fail(state, err);
  const s = clone(state);
  s.actionSeq += 1;
  s.night.actions[actor.id] = {
    actorId: actor.id,
    kind: input.kind,
    targetIds: [...input.targetIds],
    submittedAt: input.now,
    seq: s.actionSeq,
  };
  s.night.skipped = s.night.skipped.filter((id) => id !== actor.id);
  return ok(s, [
    { type: 'ACTION_ACCEPTED', kind: input.kind, targetIds: [...input.targetIds], audience: { kind: 'private', playerId: actor.id } },
  ]);
}

export function skipNightAction(state: GameState, actorId: string, phaseSeq?: number): EngineResult {
  const stale = checkStale(state, phaseSeq);
  if (stale) return fail(state, stale);
  if (state.phase !== 'NIGHT') return fail(state, 'WRONG_PHASE');
  const actor = getPlayer(state, actorId);
  if (!actor) return fail(state, 'NOT_A_PLAYER');
  if (actor.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  const s = clone(state);
  delete s.night.actions[actorId];
  if (!s.night.skipped.includes(actorId)) s.night.skipped.push(actorId);
  return ok(s, [{ type: 'ACTION_ACCEPTED', kind: 'SKIP', targetIds: [], audience: { kind: 'private', playerId: actorId } }]);
}

export function mafiaCanVote(state: GameState): boolean {
  return state.phase === 'NIGHT' && (state.nightNumber > 1 || state.config.firstNightActions);
}

/** Mafia jamoaviy hujum ovozi. targetId = null — o'tkazib yuborish. */
export function submitMafiaVote(state: GameState, actorId: string, targetId: string | null, phaseSeq?: number): EngineResult {
  const stale = checkStale(state, phaseSeq);
  if (stale) return fail(state, stale);
  if (!mafiaCanVote(state)) return fail(state, 'WRONG_PHASE');
  const actor = getPlayer(state, actorId);
  if (!actor) return fail(state, 'NOT_A_PLAYER');
  if (actor.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  if (actor.faction !== 'MAFIA') return fail(state, 'NOT_MAFIA');
  if (targetId !== null) {
    const t = getPlayer(state, targetId);
    if (!t || t.status !== 'ALIVE' || t.faction === 'MAFIA') return fail(state, 'INVALID_TARGET');
  }
  const s = clone(state);
  s.night.mafiaVotes[actorId] = targetId ?? 'SKIP';
  return ok(s, [{ type: 'MAFIA_VOTE_CAST', voterId: actorId, targetId, audience: { kind: 'mafia' } }]);
}

// ───────────────────────────── Kunduz ─────────────────────────────

/** Ovoz og'irligi (§5.6, Q10). */
export function voteWeight(state: GameState, p: PlayerState): number {
  let w = 1;
  if (p.role === 'MAYOR' && p.ability.flags['mayorRevealed']) w = 2;
  if (state.twinBonusDay[p.id] === state.dayNumber) w = Math.max(w, 2);
  if (state.votePenaltyDay[p.id] === state.dayNumber) w = Math.max(0, w - 1);
  return w;
}

export interface VoteTally {
  tally: { targetId: string; weight: number }[];
  noneWeight: number;
  candidateId: string | null;
}

export function tallyVotes(state: GameState): VoteTally {
  const weights = new Map<string, number>();
  let noneWeight = 0;
  for (const voter of alivePlayers(state)) {
    const v = state.day.votes[voter.id];
    if (v === undefined) continue;
    const w = voteWeight(state, voter);
    if (v === 'NONE') {
      noneWeight += w;
      continue;
    }
    const t = getPlayer(state, v);
    if (!t || t.status !== 'ALIVE') continue;
    weights.set(v, (weights.get(v) ?? 0) + w);
  }
  const tally = [...weights.entries()]
    .map(([targetId, weight]) => ({ targetId, weight }))
    .sort((a, b) => b.weight - a.weight || getPlayer(state, a.targetId)!.seat - getPlayer(state, b.targetId)!.seat);
  const top = tally[0];
  const second = tally[1];
  let candidateId: string | null = null;
  if (top && top.weight >= 2 && (!second || top.weight > second.weight) && top.weight > noneWeight) {
    candidateId = top.targetId;
  }
  return { tally, noneWeight, candidateId };
}

export function submitDayVote(state: GameState, voterId: string, choice: DayVote, phaseSeq?: number): EngineResult {
  const stale = checkStale(state, phaseSeq);
  if (stale) return fail(state, stale);
  if (state.phase !== 'DAY_VOTING') return fail(state, 'WRONG_PHASE');
  const voter = getPlayer(state, voterId);
  if (!voter) return fail(state, 'NOT_A_PLAYER');
  if (voter.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  if (choice !== 'NONE') {
    if (choice === voterId) return fail(state, 'CANNOT_VOTE_SELF');
    const t = getPlayer(state, choice);
    if (!t || t.status !== 'ALIVE') return fail(state, 'INVALID_TARGET');
  }
  const s = clone(state);
  s.day.votes[voterId] = choice;
  const alive = alivePlayers(s);
  return ok(s, [
    {
      type: 'DAY_VOTE_CAST',
      votedCount: alive.filter((p) => s.day.votes[p.id] !== undefined).length,
      totalVoters: alive.length,
      audience: { kind: 'public' },
    },
  ]);
}

export function revealMayor(state: GameState, actorId: string): EngineResult {
  if (state.status !== 'RUNNING') return fail(state, 'GAME_FINISHED');
  if (state.phase !== 'DAY_DISCUSSION' && state.phase !== 'DAY_VOTING') return fail(state, 'WRONG_PHASE');
  const p = getPlayer(state, actorId);
  if (!p) return fail(state, 'NOT_A_PLAYER');
  if (p.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  if (!getRole(p.role).day.mayorReveal) return fail(state, 'NO_SUCH_ACTION');
  if (p.ability.flags['mayorRevealed']) return fail(state, 'ALREADY_USED');
  const s = clone(state);
  getPlayer(s, actorId)!.ability.flags['mayorRevealed'] = true;
  return ok(s, [{ type: 'MAYOR_REVEALED', playerId: actorId, audience: { kind: 'public' } }]);
}

export function judgeAvailable(state: GameState): PlayerState | null {
  return (
    alivePlayers(state).find((p) => getRole(p.role).day.judgeVeto && !p.ability.flags['vetoUsed']) ?? null
  );
}

export function judgeVeto(state: GameState, actorId: string, now: number, rng: Rng = cryptoRng): EngineResult {
  if (state.status !== 'RUNNING') return fail(state, 'GAME_FINISHED');
  if (state.phase !== 'DAY_VERDICT') return fail(state, 'WRONG_PHASE');
  const p = getPlayer(state, actorId);
  if (!p) return fail(state, 'NOT_A_PLAYER');
  if (p.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  if (!getRole(p.role).day.judgeVeto) return fail(state, 'NO_SUCH_ACTION');
  if (p.ability.flags['vetoUsed']) return fail(state, 'ALREADY_USED');
  const s = clone(state);
  getPlayer(s, actorId)!.ability.flags['vetoUsed'] = true;
  const events: GameEvent[] = [];
  const candidateId = s.day.candidateId;
  s.day.candidateId = null;
  if (candidateId) events.push({ type: 'JUDGE_VETO', candidateId, audience: { kind: 'public' } });
  afterDay(s, now, rng, events);
  return ok(s, events);
}

function executeCandidate(s: GameState, candidateId: string, events: GameEvent[]): void {
  const c = getPlayer(s, candidateId);
  if (!c || c.status !== 'ALIVE') return;
  if (c.role === 'JESTER') {
    c.status = 'PERSONAL_WIN_EXIT';
    events.push({ type: 'PERSONAL_WIN', playerId: c.id, role: c.role, audience: { kind: 'public' } });
    return;
  }
  c.status = 'DEAD';
  c.death = { cause: 'VOTE', at: 'DAY', number: s.dayNumber };
  events.push({
    type: 'PLAYER_EXECUTED',
    playerId: c.id,
    role: s.config.revealRolesOnDeath ? c.role : null,
    audience: { kind: 'public' },
  });
  const deaths = [c.id];
  // Kunduzgi yurak ezilishi (Q15)
  const lovers = s.links.lovers;
  if (lovers && lovers.includes(c.id)) {
    const partner = getPlayer(s, lovers[0] === c.id ? lovers[1] : lovers[0])!;
    if (partner.status === 'ALIVE') {
      partner.status = 'DEAD';
      partner.death = { cause: 'HEARTBREAK', at: 'DAY', number: s.dayNumber };
      deaths.push(partner.id);
      events.push({
        type: 'DAY_DEATHS',
        deaths: [{ playerId: partner.id, role: s.config.revealRolesOnDeath ? partner.role : null }],
        audience: { kind: 'public' },
      });
    }
  }
  grantTwinBonus(s, deaths, s.dayNumber + 1, (to, body) => events.push({ ...body, audience: { kind: 'private', playerId: to } }));
}

function finish(s: GameState, outcome: MainOutcome, reason: 'FACTION_WIN' | 'MAX_CYCLES' | 'ALL_DEAD' | 'NO_MAIN_FACTION', now: number, rng: Rng, events: GameEvent[]): void {
  events.push(...applyPersonalWins(s, 'END', rng));
  s.result = buildResult(s, outcome, reason, now);
  s.status = 'FINISHED';
  s.phase = 'ENDED';
  s.phaseSeq += 1;
  s.phaseEndsAt = null;
  s.phaseStartedAt = now;
  events.push({ type: 'GAME_ENDED', result: s.result, audience: { kind: 'public' } });
}

function outcomeReason(s: GameState, outcome: MainOutcome): 'FACTION_WIN' | 'ALL_DEAD' | 'NO_MAIN_FACTION' {
  if (outcome !== 'DRAW') return 'FACTION_WIN';
  return alivePlayers(s).length === 0 ? 'ALL_DEAD' : 'NO_MAIN_FACTION';
}

/** Kunduz yakuni: shaxsiy g'alabalar, asosiy g'alaba, sikl limiti, keyingi tun. */
function afterDay(s: GameState, now: number, rng: Rng, events: GameEvent[]): void {
  events.push(...applyPersonalWins(s, 'VERDICT', rng));
  const outcome = checkMainVictory(s);
  if (outcome) return finish(s, outcome, outcomeReason(s, outcome), now, rng, events);
  if (s.dayNumber >= s.config.maxCycles) return finish(s, 'DRAW', 'MAX_CYCLES', now, rng, events);
  s.day = { votes: {}, candidateId: null };
  s.nightNumber += 1;
  startPhase(s, 'NIGHT', now, events);
}

// ───────────────────────────── Bosqich almashinuvi ─────────────────────────────

export function advancePhase(state: GameState, now: number, rng: Rng = cryptoRng, expectedPhaseSeq?: number): EngineResult {
  const stale = checkStale(state, expectedPhaseSeq);
  if (stale) return fail(state, stale);
  const s = clone(state);
  const events: GameEvent[] = [];
  switch (s.phase) {
    case 'NIGHT': {
      const res = resolveNight(s, rng);
      events.push(...res.events);
      events.push(...applyPersonalWins(s, 'DAWN', rng));
      const outcome = checkMainVictory(s);
      if (outcome) {
        finish(s, outcome, outcomeReason(s, outcome), now, rng, events);
        break;
      }
      s.dayNumber = s.nightNumber;
      s.day = { votes: {}, candidateId: null };
      startPhase(s, 'DAY_DISCUSSION', now, events);
      break;
    }
    case 'DAY_DISCUSSION':
      s.day = { votes: {}, candidateId: null };
      startPhase(s, 'DAY_VOTING', now, events);
      break;
    case 'DAY_VOTING': {
      for (const p of alivePlayers(s)) if (s.day.votes[p.id] === undefined) p.missedVotes++;
      const t = tallyVotes(s);
      events.push({ type: 'VOTE_RESULT', dayNumber: s.dayNumber, ...t, audience: { kind: 'public' } });
      if (t.candidateId) {
        s.day.candidateId = t.candidateId;
        if (judgeAvailable(s)) {
          events.push({ type: 'VERDICT_STARTED', candidateId: t.candidateId, audience: { kind: 'public' } });
          startPhase(s, 'DAY_VERDICT', now, events);
          break;
        }
        executeCandidate(s, t.candidateId, events);
      }
      afterDay(s, now, rng, events);
      break;
    }
    case 'DAY_VERDICT': {
      if (s.day.candidateId) executeCandidate(s, s.day.candidateId, events);
      afterDay(s, now, rng, events);
      break;
    }
    case 'ENDED':
      return fail(state, 'GAME_FINISHED');
  }
  return ok(s, events);
}

/** Hamma harakat qilgan bo'lsa bosqichni erta tugatish mumkin. */
export function canEndPhaseEarly(state: GameState): boolean {
  if (state.status !== 'RUNNING' || !state.config.endPhaseEarly) return false;
  const alive = alivePlayers(state);
  if (state.phase === 'NIGHT') {
    for (const p of alive) {
      const hasActions = availableNightActions(state, p).length > 0;
      if (hasActions && !state.night.actions[p.id] && !state.night.skipped.includes(p.id)) return false;
      if (p.faction === 'MAFIA' && mafiaCanVote(state) && state.night.mafiaVotes[p.id] === undefined) return false;
    }
    return true;
  }
  if (state.phase === 'DAY_VOTING') return alive.every((p) => state.day.votes[p.id] !== undefined);
  return false;
}

// ───────────────────────────── Chiqib ketish ─────────────────────────────

/** O'yin davomida ixtiyoriy chiqish (§32.2). O'lim hisoblanmaydi. */
export function leaveGame(state: GameState, playerId: string, now: number, rng: Rng = cryptoRng): EngineResult {
  if (state.status !== 'RUNNING') return fail(state, 'GAME_FINISHED');
  const p0 = getPlayer(state, playerId);
  if (!p0) return fail(state, 'NOT_A_PLAYER');
  if (p0.status !== 'ALIVE') return fail(state, 'PLAYER_NOT_ALIVE');
  const s = clone(state);
  const p = getPlayer(s, playerId)!;
  p.status = 'LEFT';
  delete s.night.actions[playerId];
  delete s.night.mafiaVotes[playerId];
  delete s.day.votes[playerId];
  s.night.skipped = s.night.skipped.filter((id) => id !== playerId);
  const events: GameEvent[] = [
    { type: 'PLAYER_LEFT', playerId, role: s.config.revealRolesOnDeath ? p.role : null, audience: { kind: 'public' } },
  ];
  if (s.day.candidateId === playerId) s.day.candidateId = null;
  events.push(...reassignHunterTargets(s, rng));
  const outcome = checkMainVictory(s);
  if (outcome) finish(s, outcome, outcomeReason(s, outcome), now, rng, events);
  return ok(s, events);
}
