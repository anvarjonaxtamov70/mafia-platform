import { MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR } from '@mafia/game-engine';
import { DEFAULT_MIN_PLAYERS_KEY, normalizeSettings, type GroupSettingsData } from '@mafia/bot-core';
import type { Db, Tx } from '@mafia/database';

export {
  DEFAULT_MIN_PLAYERS_KEY,
  defaultGroupSettings,
  normalizeSettings,
  settingsToConfig,
  type GroupSettingsData,
} from '@mafia/bot-core';

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
