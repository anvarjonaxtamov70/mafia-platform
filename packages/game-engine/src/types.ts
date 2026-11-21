/**
 * GameEngine domen tiplari.
 * Engine sof (pure): Telegram, baza yoki tarmoqqa bog'liq emas.
 * Barcha holat JSON'ga seriyalashtiriladigan bo'lishi shart (bazada snapshot sifatida saqlanadi).
 */

export type Faction = 'CITY' | 'MAFIA' | 'NEUTRAL';

/** Interfeysdagi toifa. SPECIAL rollar g'alaba nuqtayi nazaridan CITY. */
export type RoleCategory = 'CITY' | 'MAFIA' | 'NEUTRAL' | 'SPECIAL';

export const ROLE_CODES = [
  // Shahar — 13
  'CITIZEN',
  'COMMISSAR',
  'DOCTOR',
  'SHERIFF',
  'BODYGUARD',
  'DETECTIVE',
  'JOURNALIST',
  'JUDGE',
  'MAYOR',
  'WATCHER',
  'PRIEST',
  'AVENGER',
  'ENGINEER',
  // Mafia — 8
  'MAFIOSO',
  'DON',
  'CONSIGLIERE',
  'LAWYER',
  'SPY',
  'FORGER',
  'BLOCKER',
  'MAFIA_GUARD',
  // Mustaqil — 6
  'SERIAL_KILLER',
  'THIEF',
  'JESTER',
  'HUNTER',
  'WIZARD',
  'LONE_WOLF',
  // Maxsus shahar — 3
  'CUPID',
  'TWIN',
  'PHOENIX',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export type GameMode = 'CLASSIC' | 'ADVANCED' | 'CHAOS' | 'ARCADE' | 'PRIVATE' | 'TOURNAMENT';

export const GAME_MODES: readonly GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS', 'ARCADE', 'PRIVATE', 'TOURNAMENT'];

/**
 * Engine ichidagi bosqichlar. LOBBY / READY_CHECK / ROLE_ASSIGNMENT ilova qatlamida
 * (lobby) boshqariladi, DAWN esa tun hisoblanadigan bir lahzali qadam (alohida kutish yo'q).
 */
export type Phase = 'NIGHT' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'DAY_VERDICT' | 'ENDED';

export type PlayerStatus = 'ALIVE' | 'DEAD' | 'LEFT' | 'PERSONAL_WIN_EXIT';

export type AttackKind = 'MAFIA' | 'SERIAL_KILLER' | 'HUNTER' | 'AVENGER';

export type DeathCause = AttackKind | 'HEARTBREAK' | 'VOTE';

export type ActionKind =
  | 'COMMISSAR_CHECK'
  | 'DOCTOR_HEAL'
  | 'SHERIFF_ARREST'
  | 'BODYGUARD_GUARD'
  | 'DETECTIVE_TRACK'
  | 'JOURNALIST_COMPARE'
  | 'WATCHER_WATCH'
  | 'PRIEST_CLEANSE'
  | 'AVENGER_MARK'
  | 'ENGINEER_INSTALL'
  | 'CONSIGLIERE_CHECK'
  | 'LAWYER_MASK'
  | 'SPY_TRACK'
  | 'FORGER_FRAME'
  | 'BLOCKER_BLOCK'
  | 'MAFIA_GUARD_PROTECT'
  | 'SERIAL_KILLER_KILL'
  | 'THIEF_STEAL'
  | 'HUNTER_SHOT'
  | 'WIZARD_MIRAGE'
  | 'WIZARD_BARRIER'
  | 'LONE_WOLF_SHIELD'
  | 'CUPID_LINK';

/** Tun hisoblash bosqichlari (§12.2). Tartib muhim. */
export type NightStage = 'BLOCK' | 'PROTECT' | 'DECEIVE' | 'CLEANSE' | 'PREP' | 'INFO' | 'ATTACK';

export const NIGHT_STAGE_ORDER: readonly NightStage[] = [
  'BLOCK',
  'PROTECT',
  'DECEIVE',
  'CLEANSE',
  'PREP',
  'INFO',
  'ATTACK',
];

export interface AbilityState {
  /** Qolgan zaryadlar: masalan { selfHeal: 1, install: 1 } */
  charges: Record<string, number>;
  /** Oxirgi muvaffaqiyatli harakat nishonlari ("ketma-ket ikki kecha" qoidasi uchun) */
  lastTargets: string[];
  /** lastTargets qaysi kechaga tegishli */
  lastNight: number;
  /** Bir martalik bayroqlar: mayorRevealed, vetoUsed, phoenixUsed, mirageUsed, barrierUsed */
  flags: Record<string, boolean>;
  /** Hisoblagichlar: thiefSuccess */
  counters: Record<string, number>;
}

export interface ArcadeItems {
  /** Arcade qalqoni: birinchi mos tungi hujumni qaytaradi */
  shield: boolean;
  /** Soxta hujjat: birinchi jamoa tekshiruvida SHAHAR ko'rsatadi */
  fakeDocument: boolean;
}

export interface PlayerDeath {
  cause: DeathCause;
  at: 'NIGHT' | 'DAY';
  number: number;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  role: RoleCode;
  faction: Faction;
  status: PlayerStatus;
  death: PlayerDeath | null;
  ability: AbilityState;
  items: ArcadeItems;
  missedActions: number;
  missedVotes: number;
}

export interface NightActionRecord {
  actorId: string;
  kind: ActionKind;
  targetIds: string[];
  submittedAt: number;
  /** Barqaror tartib uchun ketma-ketlik raqami */
  seq: number;
}

export type MafiaVote = string | 'SKIP';
export type DayVote = string | 'NONE';

export interface NightState {
  actions: Record<string, NightActionRecord>;
  /** Harakatni o'tkazib yuborganlar (erta tugatish uchun) */
  skipped: string[];
  mafiaVotes: Record<string, MafiaVote>;
}

export interface DayState {
  votes: Record<string, DayVote>;
  candidateId: string | null;
}

export interface GameLinks {
  lovers: [string, string] | null;
  twins: [string, string] | null;
  /** hunterId -> targetId */
  hunterTargets: Record<string, string>;
}

export type MainOutcome = 'CITY' | 'MAFIA' | 'SERIAL_KILLER' | 'DRAW';

export type PlayerOutcome = 'WIN' | 'LOSS' | 'DRAW' | 'PERSONAL_WIN';

export interface PlayerResult {
  playerId: string;
  role: RoleCode;
  faction: Faction;
  outcome: PlayerOutcome;
  survived: boolean;
  left: boolean;
  achievements: string[];
}

export interface GameResult {
  outcome: MainOutcome;
  reason: 'FACTION_WIN' | 'MAX_CYCLES' | 'ALL_DEAD' | 'NO_MAIN_FACTION';
  finishedAt: number;
  players: PlayerResult[];
}

export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  nightDurationSec: number;
  discussionDurationSec: number;
  votingDurationSec: number;
  verdictDurationSec: number;
  revealRolesOnDeath: boolean;
  revealPhoenixIdentity: boolean;
  announceSavedAttacks: boolean;
  /** Birinchi tunda asosiy tungi harakatlar ishlaydimi (Classic: ha) */
  firstNightActions: boolean;
  allowArcadeItems: boolean;
  ranked: boolean;
  /** Maksimal kunduz-tun sikli; oshsa durrang */
  maxCycles: number;
  /** Hamma harakat qilsa bosqich erta tugaydi */
  endPhaseEarly: boolean;
  disabledRoles: RoleCode[];
}

export interface GameState {
  schemaVersion: 1;
  id: string;
  mode: GameMode;
  config: GameConfig;
  balanceVersion: string;
  status: 'RUNNING' | 'FINISHED';
  phase: Phase;
  /** Har bir bosqich o'zgarishida oshadi. Taymer va tugmalar shu raqam bilan tekshiriladi. */
  phaseSeq: number;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  nightNumber: number;
  dayNumber: number;
  players: PlayerState[];
  links: GameLinks;
  night: NightState;
  day: DayState;
  /** playerId -> qaysi kunduz ovozida jarima (-1) qo'llanadi */
  votePenaltyDay: Record<string, number>;
  /** playerId -> qaysi kunduz ovozida Egizak bonusi (2 ovoz) qo'llanadi */
  twinBonusDay: Record<string, number>;
  actionSeq: number;
  result: GameResult | null;
}

// ─────────────────────────────── Events ───────────────────────────────

export type Audience =
  | { kind: 'public' }
  | { kind: 'private'; playerId: string }
  | { kind: 'mafia' };

export interface DeathInfo {
  playerId: string;
  role: RoleCode | null;
}

export type EventBody =
  | { type: 'GAME_STARTED'; playerCount: number; mode: GameMode }
  | { type: 'ROLE_ASSIGNED'; role: RoleCode; faction: Faction }
  | { type: 'MAFIA_TEAM'; members: { playerId: string; role: RoleCode }[] }
  | { type: 'TWIN_PARTNER'; partnerId: string }
  | { type: 'HUNTER_TARGET'; targetId: string; reassigned: boolean }
  | { type: 'LOVERS_LINKED'; partnerId: string }
  | { type: 'CUPID_RESULT'; loverIds: [string, string]; random: boolean }
  | {
      type: 'PHASE_STARTED';
      phase: Phase;
      nightNumber: number;
      dayNumber: number;
      endsAt: number | null;
      aliveCount: number;
    }
  | { type: 'ACTION_ACCEPTED'; kind: ActionKind | 'SKIP'; targetIds: string[] }
  | { type: 'MAFIA_VOTE_CAST'; voterId: string; targetId: string | null }
  | { type: 'ACTION_FAILED'; kind: ActionKind; reason: 'BLOCKED' }
  | { type: 'CHECK_RESULT'; targetId: string; faction: Faction }
  | { type: 'ROLE_RESULT'; targetId: string; role: RoleCode }
  | { type: 'TRACK_RESULT'; source: 'DETECTIVE' | 'SPY'; targetId: string; visitedIds: string[] }
  | { type: 'WATCH_RESULT'; targetId: string; visitorIds: string[] }
  | { type: 'COMPARE_RESULT'; aId: string; bId: string; same: boolean }
  | { type: 'SHERIFF_RESULT'; targetId: string; acted: boolean }
  | { type: 'ENGINEER_RESULT'; targetId: string; triggered: boolean }
  | { type: 'VOTE_WEAKENED'; dayNumber: number }
  | { type: 'THIEF_RESULT'; targetId: string; success: boolean; total: number }
  | { type: 'TWIN_BONUS'; dayNumber: number }
  | {
      type: 'DAWN';
      nightNumber: number;
      deaths: DeathInfo[];
      savedCount: number;
      revivedIds: string[];
      revivedCount: number;
      aliveCount: number;
    }
  | { type: 'MAYOR_REVEALED'; playerId: string }
  | { type: 'DAY_VOTE_CAST'; votedCount: number; totalVoters: number }
  | {
      type: 'VOTE_RESULT';
      dayNumber: number;
      tally: { targetId: string; weight: number }[];
      noneWeight: number;
      candidateId: string | null;
    }
  | { type: 'VERDICT_STARTED'; candidateId: string }
  | { type: 'JUDGE_VETO'; candidateId: string }
  | { type: 'PLAYER_EXECUTED'; playerId: string; role: RoleCode | null }
  | { type: 'DAY_DEATHS'; deaths: DeathInfo[] }
  | { type: 'PERSONAL_WIN'; playerId: string; role: RoleCode }
  | { type: 'PLAYER_LEFT'; playerId: string; role: RoleCode | null }
  | { type: 'GAME_ENDED'; result: GameResult };

export type EventType = EventBody['type'];

export type GameEvent = EventBody & { audience: Audience };

export type EngineErrorCode =
  | 'GAME_FINISHED'
  | 'WRONG_PHASE'
  | 'STALE_PHASE'
  | 'NOT_A_PLAYER'
  | 'PLAYER_NOT_ALIVE'
  | 'NO_SUCH_ACTION'
  | 'INVALID_TARGET'
  | 'NO_CHARGES'
  | 'NOT_MAFIA'
  | 'ALREADY_USED'
  | 'CANNOT_VOTE_SELF'
  | 'NOT_ENOUGH_PLAYERS'
  | 'TOO_MANY_PLAYERS'
  | 'DUPLICATE_PLAYER'
  | 'DISTRIBUTION_FAILED';

export type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineErrorCode; state: GameState };

export interface Rng {
  /** [0, maxExclusive) oralig'ida butun son */
  int(maxExclusive: number): number;
}
