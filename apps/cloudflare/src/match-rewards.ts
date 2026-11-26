import type { Faction, PlayerOutcome, RoleCode,V2Role,V2Faction } from '@mafia/game-engine';

export interface MatchRewardContext {
  playerCount: number;
  days: number;
  durationMs: number;
  activeRatio: number;
  ranked: boolean;
  practice: boolean;
}
export interface MatchRewardPlayer {
  role: RoleCode | V2Role;
  faction: Faction | V2Faction;
  teamWin?:boolean;
  outcome: PlayerOutcome;
  active: boolean;
  afk?: boolean;
  left: boolean;
  fake: boolean;
  missed?: number;
}
export interface MatchReward { points: number; dollars: number }
const clamp = (n: number, lo = 0, hi = 1) => Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
const won = (p: MatchRewardPlayer) => p.outcome === 'WIN' || p.outcome === 'PERSONAL_WIN';

/** Server-only deterministic calculation. No random bonuses or client-supplied money.
 * A neutral main victory (currently Serial Killer) is a solo win; neutral personal goals have a separate cap.
 * The current engine supports 4–30 players. At 30 the size factor is 1.
 */
export function matchReward(c: MatchRewardContext, p: MatchRewardPlayer): MatchReward {
  if (!c.ranked || c.practice || p.fake || !Number.isInteger(c.playerCount) || c.playerCount < 4 || c.playerCount > 30) return { points: 0, dollars: 0 };
  if (p.left || p.afk) return { points: -8, dollars: 0 };
  const size = clamp((c.playerCount - 4) / 26);
  // Wall time alone cannot raise the reward: both completed days and time must increase.
  const depth = Math.min(clamp((c.days - 1) / 7), clamp(c.durationMs / (30 * 60_000)));
  const participation = clamp(c.activeRatio);
  const quality = 0.15 + 0.35 * size + 0.30 * depth + 0.20 * participation;
  const missed = clamp(p.missed ?? (p.active ? 0 : 1), 0, 1000);
  const personal = p.active ? 1 : Math.max(0.35, 0.85 - 0.10 * Math.max(0, missed - 1));
  if (won(p)) {
    const cap = p.teamWin ? 120 : p.faction === 'SOLO'||p.faction==='NEUTRAL' ? (p.outcome === 'WIN' ? 150 : 70) : 120;
    return { points: Math.min(cap, Math.max(1, Math.round(cap * quality * personal))), dollars: Math.min(66, Math.round(66 * quality * personal)) };
  }
  if (p.outcome === 'DRAW') return { points: 0, dollars: Math.min(16, Math.round(16 * quality * personal)) };
  // Good performance reduces the loss penalty; money is earned for participation.
  return { points: -Math.min(8, Math.max(1, Math.round(8 - 5 * quality * personal))), dollars: Math.min(33, Math.round(33 * quality * personal)) };
}
