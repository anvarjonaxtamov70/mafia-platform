/**
 * XP, daraja va reyting qoidalari (§16.2, §16.3 + v1.1 T4, §24.1).
 */
import type { PlayerOutcome, PlayerResult } from '@mafia/game-engine';

/** L-darajaga yetish uchun jami XP: 100 × (L − 1)² */
export function totalXpForLevel(level: number): number {
  return 100 * (level - 1) * (level - 1);
}

export function levelForXp(xp: number): number {
  const safe = Math.max(0, xp);
  return Math.floor(Math.sqrt(safe / 100)) + 1;
}

export const XP_RULES = {
  completed: 20,
  win: 30,
  personalWin: 30,
  active: 5,
} as const;

export const RATING_RULES: Record<PlayerOutcome, number> = {
  WIN: 20,
  PERSONAL_WIN: 20,
  LOSS: -10,
  DRAW: 0,
};

export const RATING_START = 1000;

/** RatingService strategiyasi — keyinchalik rol/fraksiya ehtimollarini hisobga oluvchi model bilan almashtiriladi. */
export interface RatingStrategy {
  change(result: Pick<PlayerResult,'outcome'|'left'>, ranked: boolean): number;
}

export const simpleRating: RatingStrategy = {
  change(result, ranked) {
    if (!ranked) return 0;
    if (result.left) return RATING_RULES.LOSS;
    return RATING_RULES[result.outcome];
  },
};

export function xpFor(result: Pick<PlayerResult,'outcome'|'left'>, active: boolean): number {
  if (result.left) return 0;
  let xp = XP_RULES.completed;
  if (result.outcome === 'WIN') xp += XP_RULES.win;
  if (result.outcome === 'PERSONAL_WIN') xp += XP_RULES.personalWin;
  if (active) xp += XP_RULES.active;
  return xp;
}
