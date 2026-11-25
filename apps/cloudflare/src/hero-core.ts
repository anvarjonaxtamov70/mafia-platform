/** Cosmetic collectible progression. No game-engine modifiers, purchases or real Stars. */
import type { Sql } from './sql';
import type { RoleCode } from '@mafia/game-engine';

export type Rarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
export interface HeroDefinition { code: string; name: string; rarity: Rarity; unlockXp: number; art: RoleCode }
export const HEROES: readonly HeroDefinition[] = [
  { code: 'citizen', name: 'Tungi fuqaro', rarity: 'COMMON', unlockXp: 0, art: 'CITIZEN' },
  { code: 'doctor', name: 'Hayot qo‘riqchisi', rarity: 'COMMON', unlockXp: 100, art: 'DOCTOR' },
  { code: 'detective', name: 'Soya detektivi', rarity: 'RARE', unlockXp: 300, art: 'DETECTIVE' },
  { code: 'bodyguard', name: 'Temir qalqon', rarity: 'RARE', unlockXp: 700, art: 'BODYGUARD' },
  { code: 'sheriff', name: 'Adolat sherifi', rarity: 'EPIC', unlockXp: 1500, art: 'SHERIFF' },
  { code: 'spy', name: 'Tungi josus', rarity: 'EPIC', unlockXp: 3000, art: 'SPY' },
  { code: 'don', name: 'The Godfather', rarity: 'LEGENDARY', unlockXp: 5000, art: 'DON' },
  { code: 'judge', name: 'So‘nggi hukm', rarity: 'LEGENDARY', unlockXp: 7500, art: 'JUDGE' },
  { code: 'wizard', name: 'Qorong‘u sehrgar', rarity: 'MYTHIC', unlockXp: 10000, art: 'WIZARD' },
  { code: 'phoenix', name: 'O‘lmas Feniks', rarity: 'MYTHIC', unlockXp: 15000, art: 'PHOENIX' },
];
export const HERO_DAILY_CAP = 300;
export const HERO_MAX_LEVEL = 100;
export const HERO_MAX_XP = 5 * 99 * 99;
export const STARTER = HEROES[0]!.code;

export function heroLevel(xp: number): number {
  return Math.min(HERO_MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / 5)) + 1);
}
export function heroThreshold(level: number): number {
  return 5 * (Math.min(HERO_MAX_LEVEL, Math.max(1, level)) - 1) ** 2;
}
export function heroDefinition(code: string): HeroDefinition | undefined { return HEROES.find((h) => h.code === code); }
function uzDay(now: number): string { return new Date(now + 5 * 60 * 60 * 1000).toISOString().slice(0, 10); }

export interface HeroCard extends HeroDefinition { unlocked: boolean; xp: number; level: number }
export interface HeroAccount { selected: string; totalXp: number; todayXp: number; owner: boolean; heroes: HeroCard[] }
export interface HeroAward { code: string; xp: number; level: number; leveled: boolean }
export type HeroSelect = 'OK' | 'LOCKED' | 'IN_GAME' | 'UNKNOWN' | 'UNAVAILABLE';

export class HeroCore {
  constructor(private readonly sql: Sql, private readonly clock: () => number, private readonly owner: (id: number) => boolean) {}
  migrate(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_accounts (telegram_id INTEGER PRIMARY KEY, selected TEXT NOT NULL DEFAULT 'citizen', total_xp INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '', day_xp INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hero_accounts_top ON hero_accounts(total_xp DESC, telegram_id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_progress (telegram_id INTEGER NOT NULL, code TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(telegram_id, code))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_game_selection (game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, code TEXT NOT NULL, PRIMARY KEY(game_number, telegram_id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_owner_levels (telegram_id INTEGER PRIMARY KEY, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 1000000))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_awards (game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, code TEXT NOT NULL, xp INTEGER NOT NULL, PRIMARY KEY(game_number, telegram_id))`);
  }
  single(id: number, owned: boolean) {
    const totalXp = this.account(id)?.total_xp ?? 0;
    const owner = this.owner(id);
    const level = Math.floor(Math.sqrt(Math.max(0,totalXp)/5))+1;
    const override = owner ? this.sql.exec<{level:number}>(`SELECT level FROM hero_owner_levels WHERE telegram_id = ?`,id)[0]?.level : undefined;
    return { owned, owner, totalXp, level: override ?? level, earnedLevel: level };
  }
  setOwnLevel(id: number, level: number): boolean {
    if (!this.owner(id) || !Number.isSafeInteger(level) || level < 1 || level > 1000000 || !this.eligibleUser(id)) return false;
    this.sql.exec(`INSERT INTO hero_owner_levels (telegram_id,level) VALUES (?,?) ON CONFLICT (telegram_id) DO UPDATE SET level=excluded.level`,id,level);
    return true;
  }
  private account(id: number) {
    return this.sql.exec<{ selected: string; total_xp: number; day: string; day_xp: number }>(`SELECT selected, total_xp, day, day_xp FROM hero_accounts WHERE telegram_id = ?`, id)[0];
  }
  private available(id: number, code: string, total: number): boolean {
    const def = heroDefinition(code);
    return !!def && (this.owner(id) || total >= def.unlockXp);
  }
  private eligibleUser(id: number): boolean {
    return this.sql.exec(`SELECT 1 FROM users u WHERE u.telegram_id = ? AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.telegram_id = u.telegram_id AND (b.expires_at IS NULL OR b.expires_at > ?))`, id, this.clock()).length > 0;
  }
  view(id: number): HeroAccount {
    const a = this.account(id);
    const totalXp = a?.total_xp ?? 0;
    const owner = this.owner(id);
    const selected = a && this.available(id, a.selected, totalXp) ? a.selected : STARTER;
    const xp = new Map(this.sql.exec<{ code: string; xp: number }>(`SELECT code, xp FROM hero_progress WHERE telegram_id = ?`, id).map((x) => [x.code, x.xp]));
    return { selected, totalXp, todayXp: a?.day === uzDay(this.clock()) ? a.day_xp : 0, owner, heroes: HEROES.map((h) => {
      const value = xp.get(h.code) ?? 0;
      return { ...h, unlocked: owner || totalXp >= h.unlockXp, xp: value, level: heroLevel(value) };
    }) };
  }
  select(id: number, code: string): HeroSelect {
    return this.sql.tx(() => {
      if (!heroDefinition(code)) return 'UNKNOWN';
      if (!this.eligibleUser(id)) return 'UNAVAILABLE';
      if (this.sql.exec(`SELECT 1 FROM active_players WHERE telegram_id = ?`, id).length) return 'IN_GAME';
      const a = this.account(id);
      if (!this.available(id, code, a?.total_xp ?? 0)) return 'LOCKED';
      this.sql.exec(`INSERT INTO hero_accounts (telegram_id, selected) VALUES (?, ?) ON CONFLICT (telegram_id) DO UPDATE SET selected = excluded.selected`, id, code);
      return 'OK';
    });
  }
  /** Freeze selection when entering a lobby; old games without snapshot use starter. */
  snapshot(id: number, game: number): void {
    const a = this.account(id);
    const code = a && this.available(id, a.selected, a.total_xp) ? a.selected : STARTER;
    this.sql.exec(`INSERT OR REPLACE INTO hero_game_selection (game_number, telegram_id, code) VALUES (?, ?, ?)`, game, id, code);
  }
  release(id: number, game: number): void {
    this.sql.exec(`DELETE FROM hero_game_selection WHERE game_number = ? AND telegram_id = ?`, game, id);
  }
  releaseGame(game: number): void {
    this.sql.exec(`DELETE FROM hero_game_selection WHERE game_number = ?`, game);
  }
  /** Called inside the authoritative recordGame transaction. A replay cannot add XP again. */
  award(id: number, game: number, won: boolean): HeroAward | undefined {
    return this.sql.tx(() => {
      if (!this.eligibleUser(id)) return undefined;
      if (this.sql.exec(`SELECT 1 FROM hero_awards WHERE game_number = ? AND telegram_id = ?`, game, id).length) return undefined;
      const a = this.account(id);
      const total = a?.total_xp ?? 0;
      const snapshot = this.sql.exec<{ code: string }>(`SELECT code FROM hero_game_selection WHERE game_number = ? AND telegram_id = ?`, game, id)[0]?.code ?? STARTER;
      const code = this.available(id, snapshot, total) ? snapshot : STARTER;
      const oldXp = this.sql.exec<{ xp: number }>(`SELECT xp FROM hero_progress WHERE telegram_id = ? AND code = ?`, id, code)[0]?.xp ?? 0;
      const day = uzDay(this.clock());
      const today = a?.day === day ? a.day_xp : 0;
      const xp = Math.max(0, Math.min(won ? 50 : 25, HERO_DAILY_CAP - today));
      if (xp === 0) return undefined;
      this.sql.exec(`INSERT INTO hero_awards (game_number, telegram_id, code, xp) VALUES (?, ?, ?, ?)`, game, id, code, xp);
      this.sql.exec(`INSERT INTO hero_progress (telegram_id, code, xp) VALUES (?, ?, ?) ON CONFLICT (telegram_id, code) DO UPDATE SET xp = hero_progress.xp + excluded.xp`, id, code, xp);
      this.sql.exec(`INSERT INTO hero_accounts (telegram_id, total_xp, day, day_xp) VALUES (?, ?, ?, ?) ON CONFLICT (telegram_id) DO UPDATE SET total_xp = hero_accounts.total_xp + excluded.total_xp, day = excluded.day, day_xp = excluded.day_xp`, id, xp, day, today + xp);
      const level = heroLevel(oldXp + xp);
      return { code, xp, level, leveled: level > heroLevel(oldXp) };
    });
  }
  top(): { first_name: string; last_name: string | null; username: string | null; total_xp: number }[] {
    return this.sql.exec(`SELECT u.first_name, u.last_name, u.username, h.total_xp FROM hero_accounts h JOIN users u ON u.telegram_id = h.telegram_id
      WHERE h.total_xp > 0 AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.telegram_id = h.telegram_id AND (b.expires_at IS NULL OR b.expires_at > ?))
      ORDER BY h.total_xp DESC, h.telegram_id ASC LIMIT 10`, this.clock());
  }
}
