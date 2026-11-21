import type {
  AbilityState,
  ActionKind,
  AttackKind,
  EngineErrorCode,
  EventBody,
  Faction,
  GameMode,
  GameState,
  NightActionRecord,
  NightStage,
  PlayerState,
  RoleCategory,
  RoleCode,
} from '../types';

export interface TargetRules {
  count: 1 | 2;
  /** forbid — o'zini tanlay olmaydi, allow — mumkin, only — faqat o'zi */
  self: 'forbid' | 'allow' | 'only';
  /** Oldingi kechadagi nishonni yana tanlab bo'lmaydi */
  noConsecutive?: boolean;
  /** Faqat shu jamoa a'zolari (Advokat, Mafia Qo'riqchisi) */
  onlyFaction?: Faction;
  /** Shu jamoa a'zolarini tanlab bo'lmaydi (Konsilyeri jamoadoshini tekshirmaydi) */
  excludeFaction?: Faction;
}

/** Tun hisoblanayotgan paytda harakat. */
export interface ResolvedAction {
  record: NightActionRecord;
  actor: PlayerState;
  spec: NightActionSpec;
  status: 'PENDING' | 'BLOCKED' | 'RESOLVED';
}

export type ProtectionType =
  | 'ENGINEER'
  | 'ARCADE_SHIELD'
  | 'BARRIER'
  | 'DOCTOR'
  | 'MAFIA_GUARD'
  | 'BODYGUARD'
  | 'PHOENIX';

/** Himoya ustuvorligi (v1.1, Q5). Kichik raqam — birinchi ishlaydi. */
export const PROTECTION_PRIORITY: Record<ProtectionType, number> = {
  ENGINEER: 1,
  ARCADE_SHIELD: 2,
  BARRIER: 3,
  DOCTOR: 4,
  MAFIA_GUARD: 5,
  BODYGUARD: 6,
  PHOENIX: 7,
};

/** Aldov qatlamlari tartibi (Q7): avval niqoblar (SHAHAR), keyin Soxtakor (MAFIA). */
export type DeceptionSource = 'LAWYER' | 'MIRAGE' | 'FAKE_DOCUMENT' | 'FORGER';

export const DECEPTION_LAYER: Record<DeceptionSource, number> = {
  LAWYER: 1,
  MIRAGE: 1,
  FAKE_DOCUMENT: 1,
  FORGER: 2,
};

/** Rol handlerlari tun hisoblash dvigateli bilan shu interfeys orqali ishlaydi. */
export interface NightApi {
  readonly state: GameState;
  readonly nightNumber: number;
  player(id: string): PlayerState;
  addProtection(type: ProtectionType, ownerId: string, targetId: string): void;
  addDeception(source: DeceptionSource, targetId: string, apparent: Faction): void;
  cleanse(targetId: string): void;
  /** Jamoa tekshiruvi natijasi (aldovlar va Ruhoniy hisobga olinadi). */
  apparentFaction(targetId: string): Faction;
  /** actor shu kecha kimlarga tashrif buyurgan */
  visitsBy(actorId: string): string[];
  /** target oldiga kimlar kelgan */
  visitorsOf(targetId: string): string[];
  /** Bloklangan bloklovchilar natija olmaydi, lekin bloki ishlaydi */
  isBlocked(actorId: string): boolean;
  /** Nishon shu kecha biror faol harakat qilmoqchi bo'lganmi (Sherif) */
  intendedAction(playerId: string): boolean;
  block(targetId: string): void;
  addAttack(kind: AttackKind, attackerId: string, targetId: string): void;
  linkLovers(a: string, b: string, random: boolean): void;
  markAvenger(avengerId: string, targetId: string): void;
  addSteal(thiefId: string, targetId: string): void;
  trackEngineer(engineerId: string, targetId: string): void;
  consumeCharge(actorId: string, key: string): void;
  setFlag(actorId: string, key: string): void;
  /** Faqat oluvchi tun oxirida tirik bo'lsa yuboriladi (§12.3, vaziyat 13). */
  deferPrivate(recipientId: string, body: EventBody): void;
  /** Manba tirik bo'lsa, tirik Mafia a'zolariga yuboriladi. */
  deferMafia(sourceId: string, body: EventBody): void;
}

export interface AvailabilityContext {
  state: GameState;
  player: PlayerState;
  nightNumber: number;
}

export interface NightActionSpec {
  kind: ActionKind;
  stage: NightStage;
  /** Bir bosqich ichidagi tartib (kichik — oldin) */
  order: number;
  targets: TargetRules;
  /** Boshqa o'yinchiga qaratilgan bo'lsa tashrif hisoblanadi (Q3) */
  visits: boolean;
  available(ctx: AvailabilityContext): boolean;
  extraValidate?(actor: PlayerState, targetIds: string[], state: GameState): EngineErrorCode | null;
  resolve(api: NightApi, action: ResolvedAction): void;
}

export interface DayAbilities {
  mayorReveal?: boolean;
  judgeVeto?: boolean;
}

export interface RoleDefinition {
  code: RoleCode;
  faction: Faction;
  category: RoleCategory;
  emoji: string;
  /** Standartda o'yinda bittadan ko'p bo'lmaydi */
  unique: boolean;
  /** Egizaklar — 2 slot */
  slots: 1 | 2;
  /** Taqsimotda chiqishi uchun minimal o'yinchi soni */
  minPlayers: number;
  modes: GameMode[];
  /** Taqsimot og'irligi */
  weight: number;
  /** Tirik bo'lsa Shahar va Mafia g'alabasini to'xtatadi (faqat Manyak) */
  blocksMainWin: boolean;
  /** Hujum qiluvchi mustaqil rol (balans cheklovi uchun) */
  isNeutralKiller: boolean;
  initialAbility(): Partial<AbilityState>;
  night: NightActionSpec[];
  day: DayAbilities;
}

export const ALL_MODES: GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS', 'ARCADE', 'PRIVATE', 'TOURNAMENT'];
export const CLASSIC_LIKE: GameMode[] = ALL_MODES;
export const ADVANCED_ONLY: GameMode[] = ['ADVANCED', 'CHAOS', 'PRIVATE'];

/** Zaryad mavjudligini tekshiruvchi yordamchi */
export function hasCharge(player: PlayerState, key: string): boolean {
  return (player.ability.charges[key] ?? 0) > 0;
}

export function always(): boolean {
  return true;
}

export function role(def: Omit<RoleDefinition, 'initialAbility' | 'night' | 'day'> & Partial<Pick<RoleDefinition, 'initialAbility' | 'night' | 'day'>>): RoleDefinition {
  return {
    initialAbility: () => ({}),
    night: [],
    day: {},
    ...def,
  };
}
