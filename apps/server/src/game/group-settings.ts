import { buildConfig, GAME_MODES, MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, type GameConfig, type GameMode } from '@mafia/game-engine';
import type { Db, Tx } from '@mafia/database';

export interface GroupSettingsData {
  mode: GameMode;
  minPlayers: number;
  maxPlayers: number;
  nightSec: number;
  discussionSec: number;
  votingSec: number;
  verdictSec: number;
  lobbySec: number;
  revealRoles: boolean;
  autostart: boolean;
  adminOnlyCreate: boolean;
  silenceDead: boolean;
  silenceNight: boolean;
}

export const DEFAULT_MIN_PLAYERS_KEY = 'defaultMinPlayers';

export function defaultGroupSettings(minPlayers = MIN_PLAYERS_FLOOR): GroupSettingsData {
  return {
    mode: 'CLASSIC',
    minPlayers,
    maxPlayers: 20,
    nightSec: 90,
    discussionSec: 120,
    votingSec: 60,
    verdictSec: 15,
    lobbySec: 180,
    revealRoles: true,
    autostart: true,
    adminOnlyCreate: false,
    silenceDead: true,
    silenceNight: true,
  };
}

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : d;
  return Math.min(hi, Math.max(lo, v));
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** Bazadagi JSON ni xavfsiz qiymatlarga keltiradi (qo'lda tahrirlangan noto'g'ri qiymatlar ham). */
export function normalizeSettings(raw: unknown, globalMin = MIN_PLAYERS_FLOOR): GroupSettingsData {
  const d = defaultGroupSettings(globalMin);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = GAME_MODES.includes(r['mode'] as GameMode) ? (r['mode'] as GameMode) : d.mode;
  const minPlayers = clamp(r['minPlayers'], MIN_PLAYERS_FLOOR, MAX_PLAYERS_CEILING, d.minPlayers);
  return {
    mode,
    minPlayers,
    maxPlayers: clamp(r['maxPlayers'], minPlayers, MAX_PLAYERS_CEILING, Math.max(minPlayers, d.maxPlayers)),
    nightSec: clamp(r['nightSec'], 20, 600, d.nightSec),
    discussionSec: clamp(r['discussionSec'], 15, 900, d.discussionSec),
    votingSec: clamp(r['votingSec'], 15, 600, d.votingSec),
    verdictSec: clamp(r['verdictSec'], 5, 120, d.verdictSec),
    lobbySec: clamp(r['lobbySec'], 30, 1800, d.lobbySec),
    revealRoles: bool(r['revealRoles'], d.revealRoles),
    autostart: bool(r['autostart'], d.autostart),
    adminOnlyCreate: bool(r['adminOnlyCreate'], d.adminOnlyCreate),
    silenceDead: bool(r['silenceDead'], d.silenceDead),
    silenceNight: bool(r['silenceNight'], d.silenceNight),
  };
}

export function settingsToConfig(s: GroupSettingsData, mode: GameMode = s.mode): GameConfig {
  return buildConfig(mode, {
    minPlayers: s.minPlayers,
    maxPlayers: s.maxPlayers,
    nightDurationSec: s.nightSec,
    discussionDurationSec: s.discussionSec,
    votingDurationSec: s.votingSec,
    verdictDurationSec: s.verdictSec,
    revealRolesOnDeath: s.revealRoles,
  });
}

export async function getGlobalMinPlayers(db: Db | Tx): Promise<number> {
  const row = await db.appSetting.findUnique({ where: { key: DEFAULT_MIN_PLAYERS_KEY } });
  const v = row?.value;
  return typeof v === 'number' ? Math.max(MIN_PLAYERS_FLOOR, Math.min(MAX_PLAYERS_CEILING, v)) : MIN_PLAYERS_FLOOR;
}

export async function setGlobalMinPlayers(db: Db, value: number, by: string): Promise<number> {
  const v = Math.max(MIN_PLAYERS_FLOOR, Math.min(MAX_PLAYERS_CEILING, Math.round(value)));
  await db.$transaction([
    db.appSetting.upsert({
      where: { key: DEFAULT_MIN_PLAYERS_KEY },
      create: { key: DEFAULT_MIN_PLAYERS_KEY, value: v, updatedBy: by },
      update: { value: v, updatedBy: by },
    }),
    db.auditLog.create({
      data: { actorId: by, actorType: 'ADMIN', action: 'SET_DEFAULT_MIN_PLAYERS', entityType: 'app_settings', entityId: DEFAULT_MIN_PLAYERS_KEY, afterJson: { value: v } },
    }),
  ]);
  return v;
}

/** Guruh sozlamalari: o'zi saqlagan qiymatlar + global standart minimal soni. */
export async function loadGroupSettings(db: Db | Tx, groupId: string): Promise<GroupSettingsData> {
  const [row, globalMin] = await Promise.all([
    db.groupSettings.findUnique({ where: { groupId } }),
    getGlobalMinPlayers(db),
  ]);
  return normalizeSettings(row?.data ?? {}, globalMin);
}

export async function saveGroupSettings(db: Db, groupId: string, data: GroupSettingsData, by: string): Promise<GroupSettingsData> {
  const normalized = normalizeSettings(data);
  await db.groupSettings.upsert({
    where: { groupId },
    create: { groupId, data: normalized as object, updatedBy: by },
    update: { data: normalized as object, updatedBy: by },
  });
  return normalized;
}
