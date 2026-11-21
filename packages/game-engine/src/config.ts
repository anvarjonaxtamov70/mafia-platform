import type { GameConfig, GameMode } from './types';

/** Qat'iy pastki chegara: hech qanday sozlama 4 dan kam o'yinchiga ruxsat bermaydi. */
export const MIN_PLAYERS_FLOOR = 4;
export const MAX_PLAYERS_CEILING = 30;

export const BALANCE_VERSION = 'v1.1';

/**
 * Jamoa balansi jadvali (§11 + v1.1 T6). Qadamli: N uchun N dan kichik yoki teng eng yaqin qator.
 * 4–7 o'yinchilik qatorlar foydalanuvchi talabi bilan qo'shilgan (minimal 4).
 */
export const BALANCE_TABLE: readonly { players: number; mafia: number; neutral: number }[] = [
  { players: 4, mafia: 1, neutral: 0 },
  { players: 6, mafia: 1, neutral: 0 },
  { players: 7, mafia: 2, neutral: 0 },
  { players: 8, mafia: 2, neutral: 0 },
  { players: 10, mafia: 2, neutral: 0 },
  { players: 12, mafia: 3, neutral: 1 },
  { players: 15, mafia: 4, neutral: 1 },
  { players: 20, mafia: 5, neutral: 2 },
  { players: 25, mafia: 6, neutral: 3 },
  { players: 30, mafia: 8, neutral: 4 },
];

export function factionPlan(playerCount: number): { mafia: number; neutral: number; city: number } {
  let row = BALANCE_TABLE[0]!;
  for (const r of BALANCE_TABLE) if (r.players <= playerCount) row = r;
  return { mafia: row.mafia, neutral: row.neutral, city: playerCount - row.mafia - row.neutral };
}

export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: MIN_PLAYERS_FLOOR,
  maxPlayers: 20,
  nightDurationSec: 90,
  discussionDurationSec: 120,
  votingDurationSec: 60,
  verdictDurationSec: 15,
  revealRolesOnDeath: true,
  revealPhoenixIdentity: false,
  announceSavedAttacks: true,
  firstNightActions: true,
  allowArcadeItems: false,
  ranked: true,
  maxCycles: 20,
  endPhaseEarly: true,
  disabledRoles: [],
};

/** Rejimga xos standart sozlamalar (§4). */
export function modeDefaults(mode: GameMode): Partial<GameConfig> {
  switch (mode) {
    case 'CLASSIC':
      return { ranked: true, allowArcadeItems: false, revealRolesOnDeath: true };
    case 'ADVANCED':
      return { ranked: false, allowArcadeItems: false };
    case 'CHAOS':
      return { ranked: false, allowArcadeItems: false };
    case 'ARCADE':
      return { ranked: false, allowArcadeItems: true };
    case 'PRIVATE':
      return { ranked: false, allowArcadeItems: false };
    case 'TOURNAMENT':
      return { ranked: true, allowArcadeItems: false };
  }
}

/** Reyting faqat CLASSIC va TOURNAMENT da bo'lishi mumkin (v1.1 T2). */
export function rankedAllowed(mode: GameMode): boolean {
  return mode === 'CLASSIC' || mode === 'TOURNAMENT';
}

export function buildConfig(mode: GameMode, overrides: Partial<GameConfig> = {}): GameConfig {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...modeDefaults(mode), ...overrides };
  return normalizeConfig(mode, cfg);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Noto'g'ri qiymatlarni xavfsiz oraliqqa keltiradi. */
export function normalizeConfig(mode: GameMode, cfg: GameConfig): GameConfig {
  const minPlayers = clamp(cfg.minPlayers, MIN_PLAYERS_FLOOR, MAX_PLAYERS_CEILING);
  const maxPlayers = clamp(cfg.maxPlayers, minPlayers, MAX_PLAYERS_CEILING);
  return {
    ...cfg,
    minPlayers,
    maxPlayers,
    nightDurationSec: clamp(cfg.nightDurationSec, 20, 600),
    discussionDurationSec: clamp(cfg.discussionDurationSec, 15, 900),
    votingDurationSec: clamp(cfg.votingDurationSec, 15, 600),
    verdictDurationSec: clamp(cfg.verdictDurationSec, 5, 120),
    maxCycles: clamp(cfg.maxCycles, 3, 50),
    ranked: cfg.ranked && rankedAllowed(mode),
    allowArcadeItems: mode === 'ARCADE' ? cfg.allowArcadeItems : false,
    disabledRoles: [...new Set(cfg.disabledRoles)],
  };
}
