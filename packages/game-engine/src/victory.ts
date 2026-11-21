/**
 * VictoryEngine (§14 + v1.1 Q8, Q9, Q11, Q12).
 */
import { getRole } from './roles';
import { pick } from './rng';
import type { GameEvent, GameResult, GameState, MainOutcome, PlayerResult, Rng } from './types';

export type CheckMoment = 'DAWN' | 'VERDICT' | 'END';

/** Shaxsiy g'alabalarni tekshiradi va PERSONAL_WIN_EXIT ga o'tkazadi. */
export function applyPersonalWins(state: GameState, moment: CheckMoment, rng: Rng): GameEvent[] {
  const alive = state.players.filter((p) => p.status === 'ALIVE');
  const aliveCount = alive.length;
  const winners: string[] = [];
  for (const p of alive) {
    switch (p.role) {
      case 'THIEF':
        if (moment === 'DAWN' && (p.ability.counters['thiefSuccess'] ?? 0) >= 3) winners.push(p.id);
        break;
      case 'WIZARD':
        if (
          moment === 'DAWN' &&
          state.nightNumber >= 3 &&
          p.ability.flags['mirageUsed'] &&
          p.ability.flags['barrierUsed']
        )
          winners.push(p.id);
        break;
      case 'LONE_WOLF':
        if ((moment === 'DAWN' || moment === 'END') && aliveCount <= 4) winners.push(p.id);
        break;
      case 'HUNTER': {
        const targetId = state.links.hunterTargets[p.id];
        const target = state.players.find((x) => x.id === targetId);
        if (moment !== 'END' && target?.status === 'DEAD') winners.push(p.id);
        break;
      }
      default:
        break;
    }
  }
  const events: GameEvent[] = [];
  for (const id of winners) {
    const p = state.players.find((x) => x.id === id)!;
    p.status = 'PERSONAL_WIN_EXIT';
    events.push({ type: 'PERSONAL_WIN', playerId: id, role: p.role, audience: { kind: 'public' } });
  }
  events.push(...reassignHunterTargets(state, rng));
  return events;
}

/** Ovchi nishoni o'lmasdan o'yindan chiqsa, yangi nishon beriladi (Q8). */
export function reassignHunterTargets(state: GameState, rng: Rng): GameEvent[] {
  const events: GameEvent[] = [];
  for (const hunter of state.players.filter((p) => p.role === 'HUNTER' && p.status === 'ALIVE')) {
    const targetId = state.links.hunterTargets[hunter.id];
    const target = state.players.find((p) => p.id === targetId);
    if (target && (target.status === 'ALIVE' || target.status === 'DEAD')) continue;
    const pool = state.players.filter((p) => p.status === 'ALIVE' && p.id !== hunter.id);
    const next = pick(pool, rng);
    if (!next) continue;
    state.links.hunterTargets[hunter.id] = next.id;
    events.push({
      type: 'HUNTER_TARGET',
      targetId: next.id,
      reassigned: true,
      audience: { kind: 'private', playerId: hunter.id },
    });
  }
  return events;
}

/** Asosiy fraksiya g'alabasi. null — o'yin davom etadi. */
export function checkMainVictory(state: GameState): MainOutcome | null {
  const alive = state.players.filter((p) => p.status === 'ALIVE');
  if (alive.length === 0) return 'DRAW';
  const hostile = alive.filter((p) => getRole(p.role).blocksMainWin);
  if (hostile.length > 0) {
    // Q12: 2 yoki undan kam tirik qolsa Manyak g'alaba qiladi
    if (alive.length <= 2) return 'SERIAL_KILLER';
    return null;
  }
  const mafia = alive.filter((p) => p.faction === 'MAFIA').length;
  const city = alive.filter((p) => p.faction === 'CITY').length;
  const others = alive.length - mafia;
  if (mafia === 0) return city > 0 ? 'CITY' : 'DRAW';
  if (mafia >= others) return 'MAFIA';
  return null;
}

/** O'yin yakuni: har bir o'yinchi natijasi. */
export function buildResult(
  state: GameState,
  outcome: MainOutcome,
  reason: GameResult['reason'],
  now: number,
): GameResult {
  const lovers = state.links.lovers;
  const players: PlayerResult[] = state.players.map((p) => {
    const achievements: string[] = [];
    if (lovers && lovers.includes(p.id)) {
      const bothAlive = lovers.every((id) => state.players.find((x) => x.id === id)?.status === 'ALIVE');
      if (bothAlive) achievements.push('TRUE_LOVE');
    }
    let result: PlayerResult['outcome'];
    if (p.status === 'LEFT') result = 'LOSS';
    else if (p.status === 'PERSONAL_WIN_EXIT') result = 'PERSONAL_WIN';
    else if (outcome === 'DRAW') result = 'DRAW';
    else if (outcome === 'SERIAL_KILLER') result = p.role === 'SERIAL_KILLER' ? 'WIN' : 'LOSS';
    else if (p.faction === outcome) result = 'WIN';
    else result = 'LOSS';
    return {
      playerId: p.id,
      role: p.role,
      faction: p.faction,
      outcome: result,
      survived: p.status === 'ALIVE' || p.status === 'PERSONAL_WIN_EXIT',
      left: p.status === 'LEFT',
      achievements,
    };
  });
  return { outcome, reason, finishedAt: now, players };
}
