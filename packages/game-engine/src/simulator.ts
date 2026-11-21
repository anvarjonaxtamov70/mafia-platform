/**
 * Simulyator (§37.4): inson ishtirokisiz tasodifiy, lekin qonuniy harakatlar bilan o'yinlar.
 * Maqsad: tugamay qoladigan o'yinlar, taqsimot xatolari va g'alaba foizlarini aniqlash.
 */
import {
  advancePhase,
  alivePlayers,
  createGame,
  judgeAvailable,
  mafiaCanVote,
  revealMayor,
  judgeVeto,
  skipNightAction,
  submitDayVote,
  submitMafiaVote,
  submitNightAction,
} from './engine';
import { getRole } from './roles';
import { pick, seededRng, shuffle } from './rng';
import type { GameConfig, GameMode, GameState, MainOutcome, Rng, RoleCode } from './types';
import { availableNightActions, validTargets } from './validation';

export interface SimulationOptions {
  players: number;
  mode: GameMode;
  seed: number;
  config?: Partial<GameConfig>;
  maxSteps?: number;
}

export interface SimulationResult {
  finished: boolean;
  outcome: MainOutcome | null;
  days: number;
  steps: number;
  roles: RoleCode[];
  personalWins: RoleCode[];
  state: GameState;
}

function must<T extends { ok: boolean }>(r: T): T {
  return r;
}

function chance(rng: Rng, pct: number): boolean {
  return rng.int(100) < pct;
}

export function playNightRandomly(state: GameState, rng: Rng, now: number, only?: ReadonlySet<string>): GameState {
  let s = state;
  for (const p of alivePlayers(s)) {
    if (only && !only.has(p.id)) continue;
    const specs = availableNightActions(s, p);
    const spec = pick(specs, rng);
    if (spec && chance(rng, 85)) {
      const targets = shuffle(validTargets(s, p, spec), rng).slice(0, spec.targets.count).map((t) => t.id);
      if (targets.length === spec.targets.count) {
        const r = submitNightAction(s, { actorId: p.id, kind: spec.kind, targetIds: targets, now });
        if (r.ok) s = r.state;
        continue;
      }
    }
    const r = skipNightAction(s, p.id);
    if (r.ok) s = r.state;
  }
  if (mafiaCanVote(s)) {
    const targets = alivePlayers(s).filter((p) => p.faction !== 'MAFIA');
    for (const m of alivePlayers(s).filter((p) => p.faction === 'MAFIA' && (!only || only.has(p.id)))) {
      const t = chance(rng, 90) ? pick(targets, rng) : undefined;
      const r = submitMafiaVote(s, m.id, t?.id ?? null);
      if (r.ok) s = r.state;
    }
  }
  return s;
}

export function playVotingRandomly(state: GameState, rng: Rng, only?: ReadonlySet<string>): GameState {
  let s = state;
  for (const p of alivePlayers(s)) {
    if (only && !only.has(p.id)) continue;
    if (!only && chance(rng, 10)) continue;
    const others = alivePlayers(s).filter((x) => x.id !== p.id);
    const choice = chance(rng, 15) ? 'NONE' : (pick(others, rng)?.id ?? 'NONE');
    const r = submitDayVote(s, p.id, choice);
    if (r.ok) s = r.state;
  }
  return s;
}

export function simulateGame(opts: SimulationOptions): SimulationResult {
  const rng = seededRng(opts.seed);
  let now = 1_700_000_000_000;
  const created = createGame({
    id: `sim-${opts.seed}`,
    mode: opts.mode,
    players: Array.from({ length: opts.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    config: { maxPlayers: 30, ...opts.config },
    now,
    rng,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error}`);
  let s = created.state;
  const roles = s.players.map((p) => p.role);
  const maxSteps = opts.maxSteps ?? 500;
  let steps = 0;
  while (s.status === 'RUNNING' && steps < maxSteps) {
    steps++;
    now += 1000;
    if (s.phase === 'NIGHT') s = playNightRandomly(s, rng, now);
    if (s.phase === 'DAY_DISCUSSION') {
      const mayor = alivePlayers(s).find((p) => getRole(p.role).day.mayorReveal && !p.ability.flags['mayorRevealed']);
      if (mayor && chance(rng, 30)) {
        const r = revealMayor(s, mayor.id);
        if (r.ok) s = r.state;
      }
    }
    if (s.phase === 'DAY_VOTING') s = playVotingRandomly(s, rng);
    if (s.phase === 'DAY_VERDICT') {
      const judge = judgeAvailable(s);
      if (judge && chance(rng, 30)) {
        const r = must(judgeVeto(s, judge.id, now, rng));
        if (r.ok) {
          s = r.state;
          continue;
        }
      }
    }
    const r = advancePhase(s, now, rng);
    if (!r.ok) throw new Error(`advancePhase failed: ${r.error}`);
    s = r.state;
  }
  return {
    finished: s.status === 'FINISHED',
    outcome: s.result?.outcome ?? null,
    days: s.dayNumber,
    steps,
    roles,
    personalWins: s.players.filter((p) => p.status === 'PERSONAL_WIN_EXIT').map((p) => p.role),
    state: s,
  };
}

export interface SimulationStats {
  games: number;
  unfinished: number;
  outcomes: Record<MainOutcome, number>;
  avgDays: number;
  personalWins: Partial<Record<RoleCode, number>>;
}

export function runSimulations(count: number, opts: Omit<SimulationOptions, 'seed'> & { seedStart?: number }): SimulationStats {
  const stats: SimulationStats = {
    games: count,
    unfinished: 0,
    outcomes: { CITY: 0, MAFIA: 0, SERIAL_KILLER: 0, DRAW: 0 },
    avgDays: 0,
    personalWins: {},
  };
  let days = 0;
  for (let i = 0; i < count; i++) {
    const r = simulateGame({ ...opts, seed: (opts.seedStart ?? 1) + i });
    if (!r.finished || !r.outcome) {
      stats.unfinished++;
      continue;
    }
    stats.outcomes[r.outcome]++;
    days += r.days;
    for (const role of r.personalWins) stats.personalWins[role] = (stats.personalWins[role] ?? 0) + 1;
  }
  stats.avgDays = count - stats.unfinished > 0 ? days / (count - stats.unfinished) : 0;
  return stats;
}

/**
 * Development bot-o'yinchilari uchun: faqat berilgan o'yinchilar joriy bosqichda tasodifiy, qonuniy harakat qiladi.
 */
export function autoplayPlayers(state: GameState, ids: ReadonlySet<string>, rng: Rng, now: number): GameState {
  if (state.status !== 'RUNNING' || ids.size === 0) return state;
  if (state.phase === 'NIGHT') return playNightRandomly(state, rng, now, ids);
  if (state.phase === 'DAY_VOTING') return playVotingRandomly(state, rng, ids);
  return state;
}
