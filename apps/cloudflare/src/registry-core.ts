/**
 * Registry — global ma'lumotlar (bitta Durable Object, SQLite):
 * foydalanuvchilar, profillar, faol o'yinchilar (bir vaqtda bitta o'yin), o'yin raqamlari,
 * guruh sozlamalari, natijalar va reytinglar.
 *
 * SQL qatlami interfeys orqali: Workers'da ctx.storage.sql, testlarda node:sqlite.
 */
import {
  clampMinPlayers,
  DEFAULT_MIN_PLAYERS_KEY,
  displayName,
  levelForXp,
  normalizeSettings,
  simpleRating,
  totalXpForLevel,
  xpFor,
  type GroupSettingsData,
} from '@mafia/bot-core';
import { MIN_PLAYERS_FLOOR, type Faction, type MainOutcome, type PlayerOutcome, type RoleCode } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';

export interface Sql {
  exec<T = Record<string, unknown>>(query: string, ...params: (string | number | null)[]): T[];
}

export interface TgUserInput {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface UserRow {
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  dm_available: number;
  deleted_at: number | null;
}

export interface UserInfo {
  id: number;
  name: string;
  dmAvailable: boolean;
  banned: boolean;
}

export interface RecordPlayer {
  tgId: number;
  name: string;
  role: RoleCode;
  faction: Faction;
  outcome: PlayerOutcome;
  survived: boolean;
  left: boolean;
  active: boolean;
  fake: boolean;
}

export interface RecordGameInput {
  gameId: string;
  number: number;
  chatId: number;
  ranked: boolean;
  /** Bot-o'yinchilar qatnashgan mashq o'yini: statistika va reytingga yozilmaydi */
  practice?: boolean;
  outcome: MainOutcome;
  days: number;
  players: RecordPlayer[];
}

export interface RecordedPlayer {
  tgId: number;
  outcome: PlayerOutcome;
  xp: number;
  ratingChange: number;
}

export type ClaimResult = 'OK' | 'ALREADY' | 'BUSY';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT,
    username TEXT,
    language_code TEXT,
    dm_available INTEGER NOT NULL DEFAULT 0,
    dm_blocked_at INTEGER,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    telegram_id INTEGER PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_finished INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    games_lost INTEGER NOT NULL DEFAULT 0,
    games_drawn INTEGER NOT NULL DEFAULT 0,
    games_left INTEGER NOT NULL DEFAULT 0,
    personal_wins INTEGER NOT NULL DEFAULT 0,
    mafia_wins INTEGER NOT NULL DEFAULT 0,
    city_wins INTEGER NOT NULL DEFAULT 0,
    neutral_wins INTEGER NOT NULL DEFAULT 0,
    survived_games INTEGER NOT NULL DEFAULT 0,
    current_win_streak INTEGER NOT NULL DEFAULT 0,
    best_win_streak INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS profiles_rating ON profiles (rating DESC)`,
  `CREATE TABLE IF NOT EXISTS role_stats (
    telegram_id INTEGER NOT NULL, role TEXT NOT NULL, played INTEGER NOT NULL DEFAULT 0, won INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS group_stats (
    chat_id INTEGER NOT NULL, telegram_id INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, telegram_id)
  )`,
  `CREATE INDEX IF NOT EXISTS group_stats_wins ON group_stats (chat_id, wins DESC)`,
  `CREATE TABLE IF NOT EXISTS groups (
    chat_id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE',
    bot_is_admin INTEGER NOT NULL DEFAULT 0, settings TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)`,
  // Bir foydalanuvchi bir vaqtda faqat bitta faol o'yinda (PRIMARY KEY)
  `CREATE TABLE IF NOT EXISTS active_players (
    telegram_id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, game_number INTEGER NOT NULL, since INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS active_players_game ON active_players (game_number)`,
  `CREATE TABLE IF NOT EXISTS games (
    number INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'LOBBY',
    created_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT, players INTEGER, days INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS game_results (
    game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, role TEXT NOT NULL, faction TEXT NOT NULL,
    result TEXT NOT NULL, survived INTEGER NOT NULL, xp INTEGER NOT NULL, rating_change INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (game_number, telegram_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bans (telegram_id INTEGER PRIMARY KEY, reason TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
    before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL
  )`,
];

export class RegistryCore {
  constructor(
    private readonly sql: Sql,
    private readonly clock: () => number = Date.now,
  ) {}

  migrate(): void {
    for (const q of SCHEMA) this.sql.exec(q);
  }

  private one<T>(q: string, ...p: (string | number | null)[]): T | undefined {
    return this.sql.exec<T>(q, ...p)[0];
  }

  // ───────────────────────────── Foydalanuvchilar ─────────────────────────────

  upsertUser(u: TgUserInput, dmOpened = false): UserInfo {
    const now = this.clock();
    this.sql.exec(
      `INSERT INTO users (telegram_id, first_name, last_name, username, language_code, dm_available, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (telegram_id) DO UPDATE SET
         first_name = excluded.first_name, last_name = excluded.last_name, username = excluded.username,
         language_code = excluded.language_code, last_active_at = excluded.last_active_at,
         dm_available = CASE WHEN ? = 1 THEN 1 ELSE users.dm_available END,
         dm_blocked_at = CASE WHEN ? = 1 THEN NULL ELSE users.dm_blocked_at END,
         deleted_at = CASE WHEN ? = 1 THEN NULL ELSE users.deleted_at END`,
      u.id,
      u.first_name ?? '',
      u.last_name ?? null,
      u.username ?? null,
      u.language_code ?? null,
      dmOpened ? 1 : 0,
      now,
      now,
      dmOpened ? 1 : 0,
      dmOpened ? 1 : 0,
      dmOpened ? 1 : 0,
    );
    this.sql.exec(`INSERT OR IGNORE INTO profiles (telegram_id) VALUES (?)`, u.id);
    return this.userInfo(u.id)!;
  }

  userInfo(tgId: number): UserInfo | null {
    const r = this.one<UserRow>(`SELECT * FROM users WHERE telegram_id = ?`, tgId);
    if (!r) return null;
    return {
      id: r.telegram_id,
      name: displayName({ firstName: r.first_name, lastName: r.last_name, username: r.username }),
      dmAvailable: r.dm_available === 1,
      banned: this.isBanned(tgId),
    };
  }

  isBanned(tgId: number): boolean {
    const b = this.one<{ expires_at: number | null }>(`SELECT expires_at FROM bans WHERE telegram_id = ?`, tgId);
    return !!b && (b.expires_at === null || b.expires_at > this.clock());
  }

  markDmBlocked(tgIds: number[]): void {
    for (const id of tgIds) this.sql.exec(`UPDATE users SET dm_available = 0, dm_blocked_at = ? WHERE telegram_id = ?`, this.clock(), id);
  }

  /** /delete_me — anonimlashtirish (statistika anonim qoladi) */
  anonymize(tgId: number): 'OK' | 'IN_GAME' {
    if (this.activeOf(tgId)) return 'IN_GAME';
    this.sql.exec(`UPDATE users SET first_name = 'Deleted', last_name = NULL, username = NULL, language_code = NULL, deleted_at = ? WHERE telegram_id = ?`, this.clock(), tgId);
    this.audit(String(tgId), 'DELETE_ME', 'users', String(tgId));
    return 'OK';
  }

  // ───────────────────────────── O'yin raqamlari va faol o'yinchilar ─────────────────────────────

  allocateGame(chatId: number): number {
    const r = this.one<{ number: number }>(`INSERT INTO games (chat_id, created_at) VALUES (?, ?) RETURNING number`, chatId, this.clock());
    return r!.number;
  }

  gameChat(number: number): number | null {
    return this.one<{ chat_id: number }>(`SELECT chat_id FROM games WHERE number = ?`, number)?.chat_id ?? null;
  }

  claim(tgId: number, chatId: number, number: number): ClaimResult {
    const cur = this.one<{ game_number: number }>(`SELECT game_number FROM active_players WHERE telegram_id = ?`, tgId);
    if (cur) return cur.game_number === number ? 'ALREADY' : 'BUSY';
    this.sql.exec(`INSERT INTO active_players (telegram_id, chat_id, game_number, since) VALUES (?, ?, ?, ?)`, tgId, chatId, number, this.clock());
    return 'OK';
  }

  release(tgId: number, number: number): void {
    this.sql.exec(`DELETE FROM active_players WHERE telegram_id = ? AND game_number = ?`, tgId, number);
  }

  releaseGame(number: number, status: 'CANCELLED' | 'FINISHED' = 'CANCELLED'): void {
    this.sql.exec(`DELETE FROM active_players WHERE game_number = ?`, number);
    this.sql.exec(`UPDATE games SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE number = ? AND status <> 'FINISHED'`, status, this.clock(), number);
  }

  markRunning(number: number, players: number): void {
    this.sql.exec(`UPDATE games SET status = 'RUNNING', players = ? WHERE number = ?`, players, number);
  }

  activeOf(tgId: number): { chatId: number; number: number } | null {
    const r = this.one<{ chat_id: number; game_number: number }>(`SELECT chat_id, game_number FROM active_players WHERE telegram_id = ?`, tgId);
    return r ? { chatId: r.chat_id, number: r.game_number } : null;
  }

  // ───────────────────────────── Guruhlar va sozlamalar ─────────────────────────────

  upsertGroup(chatId: number, title: string, opts: { status?: string; botIsAdmin?: boolean } = {}): void {
    const now = this.clock();
    this.sql.exec(
      `INSERT INTO groups (chat_id, title, status, bot_is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE groups.title END,
         status = excluded.status, bot_is_admin = CASE WHEN ? = -1 THEN groups.bot_is_admin ELSE excluded.bot_is_admin END, updated_at = excluded.updated_at`,
      chatId,
      title,
      opts.status ?? 'ACTIVE',
      opts.botIsAdmin ? 1 : 0,
      now,
      now,
      opts.botIsAdmin === undefined ? -1 : 1,
    );
  }

  group(chatId: number): { botIsAdmin: boolean; title: string } | null {
    const r = this.one<{ bot_is_admin: number; title: string }>(`SELECT bot_is_admin, title FROM groups WHERE chat_id = ?`, chatId);
    return r ? { botIsAdmin: r.bot_is_admin === 1, title: r.title } : null;
  }

  setBotAdmin(chatId: number, value: boolean): void {
    this.sql.exec(`UPDATE groups SET bot_is_admin = ? WHERE chat_id = ?`, value ? 1 : 0, chatId);
  }

  migrateGroup(oldChatId: number, newChatId: number): void {
    const old = this.one<{ settings: string | null; title: string }>(`SELECT settings, title FROM groups WHERE chat_id = ?`, oldChatId);
    if (!old) return;
    this.upsertGroup(newChatId, old.title);
    if (old.settings) this.sql.exec(`UPDATE groups SET settings = ? WHERE chat_id = ?`, old.settings, newChatId);
    this.sql.exec(`UPDATE groups SET status = 'MIGRATED' WHERE chat_id = ?`, oldChatId);
  }

  globalMinPlayers(): number {
    const r = this.one<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, DEFAULT_MIN_PLAYERS_KEY);
    const v = r ? Number(r.value) : MIN_PLAYERS_FLOOR;
    return Number.isFinite(v) ? clampMinPlayers(v) : MIN_PLAYERS_FLOOR;
  }

  setGlobalMinPlayers(value: number, by: string): number {
    const v = clampMinPlayers(value);
    this.sql.exec(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      DEFAULT_MIN_PLAYERS_KEY,
      String(v),
      this.clock(),
      by,
    );
    this.audit(by, 'SET_DEFAULT_MIN_PLAYERS', 'app_settings', DEFAULT_MIN_PLAYERS_KEY, null, { value: v });
    return v;
  }

  getSettings(chatId: number): GroupSettingsData {
    const r = this.one<{ settings: string | null }>(`SELECT settings FROM groups WHERE chat_id = ?`, chatId);
    let raw: unknown;
    try {
      raw = r?.settings ? JSON.parse(r.settings) : {};
    } catch {
      raw = {};
    }
    return normalizeSettings(raw, this.globalMinPlayers());
  }

  saveSettings(chatId: number, data: GroupSettingsData, by: string): GroupSettingsData {
    const before = this.getSettings(chatId);
    const normalized = normalizeSettings(data);
    this.upsertGroup(chatId, '');
    this.sql.exec(`UPDATE groups SET settings = ?, updated_at = ? WHERE chat_id = ?`, JSON.stringify(normalized), this.clock(), chatId);
    this.audit(by, 'GROUP_SETTINGS', 'groups', String(chatId), before, normalized);
    return normalized;
  }

  // ───────────────────────────── Natijalar ─────────────────────────────

  /** O'yin natijalarini bir marta yozadi (idempotent: game_results PRIMARY KEY). */
  recordGame(input: RecordGameInput): RecordedPlayer[] {
    const now = this.clock();
    const out: RecordedPlayer[] = [];
    for (const p of input.practice ? [] : input.players) {
      if (p.fake) continue;
      const exists = this.one(`SELECT 1 AS x FROM game_results WHERE game_number = ? AND telegram_id = ?`, input.number, p.tgId);
      if (exists) continue;
      const result = { playerId: String(p.tgId), role: p.role, faction: p.faction, outcome: p.outcome, survived: p.survived, left: p.left, achievements: [] };
      const xp = xpFor(result, p.active);
      const ratingChange = simpleRating.change(result, input.ranked);
      this.sql.exec(
        `INSERT INTO game_results (game_number, telegram_id, role, faction, result, survived, xp, rating_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.number,
        p.tgId,
        p.role,
        p.faction,
        p.outcome,
        p.survived ? 1 : 0,
        xp,
        ratingChange,
        now,
      );
      this.sql.exec(`INSERT OR IGNORE INTO profiles (telegram_id) VALUES (?)`, p.tgId);
      const prof = this.one<{ xp: number; rating: number; current_win_streak: number; best_win_streak: number }>(
        `SELECT xp, rating, current_win_streak, best_win_streak FROM profiles WHERE telegram_id = ?`,
        p.tgId,
      )!;
      const won = p.outcome === 'WIN' || p.outcome === 'PERSONAL_WIN';
      const newXp = Math.max(0, prof.xp + xp);
      const streak = won ? prof.current_win_streak + 1 : p.outcome === 'DRAW' ? prof.current_win_streak : 0;
      const inc = (b: boolean) => (b ? 1 : 0);
      this.sql.exec(
        `UPDATE profiles SET xp = ?, level = ?, rating = ?, games_played = games_played + 1,
          games_finished = games_finished + ?, games_left = games_left + ?, games_won = games_won + ?, games_lost = games_lost + ?,
          games_drawn = games_drawn + ?, personal_wins = personal_wins + ?, mafia_wins = mafia_wins + ?, city_wins = city_wins + ?,
          neutral_wins = neutral_wins + ?, survived_games = survived_games + ?, current_win_streak = ?, best_win_streak = ?
         WHERE telegram_id = ?`,
        newXp,
        levelForXp(newXp),
        Math.max(0, prof.rating + ratingChange),
        inc(!p.left),
        inc(p.left),
        inc(won),
        inc(p.outcome === 'LOSS'),
        inc(p.outcome === 'DRAW'),
        inc(p.outcome === 'PERSONAL_WIN'),
        inc(won && p.faction === 'MAFIA'),
        inc(won && p.faction === 'CITY'),
        inc(won && p.faction === 'NEUTRAL'),
        inc(p.survived),
        streak,
        Math.max(prof.best_win_streak, streak),
        p.tgId,
      );
      this.sql.exec(
        `INSERT INTO role_stats (telegram_id, role, played, won) VALUES (?, ?, 1, ?)
         ON CONFLICT (telegram_id, role) DO UPDATE SET played = played + 1, won = won + excluded.won`,
        p.tgId,
        p.role,
        inc(won),
      );
      this.sql.exec(
        `INSERT INTO group_stats (chat_id, telegram_id, games, wins) VALUES (?, ?, 1, ?)
         ON CONFLICT (chat_id, telegram_id) DO UPDATE SET games = games + 1, wins = wins + excluded.wins`,
        input.chatId,
        p.tgId,
        inc(won),
      );
      out.push({ tgId: p.tgId, outcome: p.outcome, xp, ratingChange });
    }
    this.sql.exec(
      `UPDATE games SET status = 'FINISHED', finished_at = ?, outcome = ?, players = ?, days = ? WHERE number = ?`,
      now,
      input.outcome,
      input.players.length,
      input.days,
      input.number,
    );
    this.sql.exec(`DELETE FROM active_players WHERE game_number = ?`, input.number);
    return out;
  }

  // ───────────────────────────── Ko'rinishlar ─────────────────────────────

  profileText(tgId: number): string {
    const u = this.one<UserRow>(`SELECT * FROM users WHERE telegram_id = ?`, tgId);
    if (!u) return t('common.error');
    this.sql.exec(`INSERT OR IGNORE INTO profiles (telegram_id) VALUES (?)`, tgId);
    const p = this.one<Record<string, number>>(`SELECT * FROM profiles WHERE telegram_id = ?`, tgId)!;
    const total = p['games_won']! + p['games_lost']! + p['games_drawn']!;
    return t('profile.text', {
      name: escapeHtml(displayName({ firstName: u.first_name, lastName: u.last_name, username: u.username })),
      id: String(tgId),
      level: p['level']!,
      xp: p['xp']!,
      nextXp: totalXpForLevel(p['level']! + 1),
      rating: p['rating']!,
      played: p['games_played']!,
      won: p['games_won']!,
      lost: p['games_lost']!,
      drawn: p['games_drawn']!,
      winRate: total > 0 ? ((p['games_won']! / total) * 100).toFixed(2) : '0.00',
      mafiaWins: p['mafia_wins']!,
      cityWins: p['city_wins']!,
      neutralWins: p['neutral_wins']!,
      streak: p['current_win_streak']!,
      bestStreak: p['best_win_streak']!,
    });
  }

  globalRating(tgId: number | null): string {
    const top = this.sql.exec<{ telegram_id: number; rating: number; first_name: string; last_name: string | null; username: string | null }>(
      `SELECT p.telegram_id, p.rating, u.first_name, u.last_name, u.username FROM profiles p JOIN users u ON u.telegram_id = p.telegram_id
       WHERE p.games_played > 0 AND u.deleted_at IS NULL ORDER BY p.rating DESC, p.games_won DESC LIMIT 10`,
    );
    if (top.length === 0) return `${t('rating.title')}\n\n${t('rating.empty')}`;
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((r, i) =>
      t('rating.line', {
        place: medals[i] ? `${medals[i]} ${i + 1}` : i + 1,
        name: escapeHtml(displayName({ firstName: r.first_name, lastName: r.last_name, username: r.username })),
        rp: r.rating,
      }),
    );
    let you = '';
    if (tgId !== null) {
      const me = this.one<{ rating: number; games_played: number }>(`SELECT rating, games_played FROM profiles WHERE telegram_id = ?`, tgId);
      if (me && me.games_played > 0) {
        const better = this.one<{ c: number }>(`SELECT COUNT(*) AS c FROM profiles WHERE rating > ? AND games_played > 0`, me.rating)!.c;
        you = t('rating.you', { place: better + 1, rp: me.rating });
      }
    }
    return `${t('rating.title')}\n\n${lines.join('\n')}\n${you}`;
  }

  groupLeaderboard(chatId: number): string {
    const rows = this.sql.exec<{ games: number; wins: number; first_name: string; last_name: string | null; username: string | null }>(
      `SELECT g.games, g.wins, u.first_name, u.last_name, u.username FROM group_stats g JOIN users u ON u.telegram_id = g.telegram_id
       WHERE g.chat_id = ? ORDER BY g.wins DESC, g.games DESC LIMIT 10`,
      chatId,
    );
    if (rows.length === 0) return `${t('group_rating.title')}\n\n${t('rating.empty')}`;
    const lines = rows.map((r, i) =>
      t('group_rating.line', {
        place: i + 1,
        name: escapeHtml(displayName({ firstName: r.first_name, lastName: r.last_name, username: r.username })),
        wins: r.wins,
        games: r.games,
      }),
    );
    return `${t('group_rating.title')}\n\n${lines.join('\n')}`;
  }

  adminStats(): string {
    const dayStart = new Date(this.clock());
    dayStart.setUTCHours(0, 0, 0, 0);
    const c = (q: string, ...p: (string | number)[]) => this.one<{ c: number }>(q, ...p)!.c;
    return t('admin.stats', {
      users: c(`SELECT COUNT(*) AS c FROM users`),
      groups: c(`SELECT COUNT(*) AS c FROM groups WHERE status = 'ACTIVE'`),
      active: c(`SELECT COUNT(*) AS c FROM games WHERE status IN ('LOBBY', 'RUNNING')`),
      today: c(`SELECT COUNT(*) AS c FROM games WHERE status = 'FINISHED' AND finished_at >= ?`, dayStart.getTime()),
      outbox: 0,
    });
  }

  audit(actor: string | null, action: string, entity: string, entityId: string | null, before: unknown = null, after: unknown = null): void {
    this.sql.exec(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      actor,
      action,
      entity,
      entityId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      this.clock(),
    );
  }
}
