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
  formatDate,
  parseRefPayload,
  TIER_BADGE,
  levelForXp,
  normalizeSettings,
  simpleRating,
  xpFor,
  v2RoleLabel,
  type GroupSettingsData,
} from '@mafia/bot-core';
import { MIN_PLAYERS_FLOOR, type Faction, type MainOutcome, type PlayerOutcome, type RoleCode, V2_ROLES,V2_MODES,V2_DEFS,type V2Role,type V2Faction,type V2Mode } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import { EconomyCore } from './economy-core';
import { SecurityCore } from './security-core';
import { HeroCore, type HeroAward } from './hero-core';
import { matchReward } from './match-rewards';
import type { Sql } from './sql';

export type { Sql } from './sql';

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
  /** VIP belgisi: '' | '👑' | '💎' */
  badge: string;
}

export interface RecordPlayer {
  tgId: number;
  name: string;
  role: RoleCode | V2Role;
  faction: Faction | V2Faction;
  outcome: PlayerOutcome;
  survived: boolean;
  left: boolean;
  active: boolean;
  afk?: boolean;
  missed?: number;
  fake: boolean;
  /** VIP belgisi (g'olib e'loni uchun; registry saqlamaydi) */
  badge?: string;
}

export interface RecordGameInput {
  gameId: string;
  number: number;
  chatId: number;
  ranked: boolean;
  /** Bot-o'yinchilar qatnashgan mashq o'yini: statistika va reytingga yozilmaydi */
  practice?: boolean;
  outcome: MainOutcome | 'SOLO' | 'TEAM' | 'ZOMBIE' | 'NEUTRAL' | 'SUIDSID';
  engineVersion?: 2;
  mode?: V2Mode;
  usedItems?:Record<string,string[]>;
  days: number;
  /** Optional for previously persisted v6 result operations. */
  rewardVersion?: 1;
  durationMs?: number;
  completedAt?: number;
  players: RecordPlayer[];
}

export interface RecordedPlayer {
  tgId: number;
  outcome: PlayerOutcome;
  xp: number;
  coins: number;
  ratingChange: number;
  hero?: HeroAward;
  points?: number;
}

export interface RecordResult {
  players: RecordedPlayer[];
  /** Taklif qilgan do'stlarga mukofot (xabar yuborish uchun) */
  referrals: { referrerId: number; referredName: string; reward: number }[];
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
  `CREATE INDEX IF NOT EXISTS games_status_finished ON games(status,finished_at)`,
  `CREATE TABLE IF NOT EXISTS game_results (
    game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, role TEXT NOT NULL, faction TEXT NOT NULL,
    result TEXT NOT NULL, survived INTEGER NOT NULL, xp INTEGER NOT NULL, rating_change INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (game_number, telegram_id)
  )`,
  `CREATE INDEX IF NOT EXISTS game_results_player_recent ON game_results (telegram_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS game_results_period ON game_results (created_at, telegram_id)`,
  `CREATE TABLE IF NOT EXISTS match_points (game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, points INTEGER NOT NULL CHECK(points BETWEEN -8 AND 150), dollars INTEGER NOT NULL CHECK(dollars BETWEEN 0 AND 66), at INTEGER NOT NULL, PRIMARY KEY(game_number, telegram_id))`,
  `CREATE INDEX IF NOT EXISTS match_points_group_time ON match_points(chat_id, at, telegram_id)`,
  `CREATE INDEX IF NOT EXISTS match_points_time ON match_points(at, telegram_id)`,
  `CREATE INDEX IF NOT EXISTS match_points_user ON match_points(telegram_id)`,
  `CREATE TABLE IF NOT EXISTS v2_role_stats(telegram_id INTEGER NOT NULL,role TEXT NOT NULL,played INTEGER NOT NULL DEFAULT 0,won INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(telegram_id,role))`,
  `CREATE TABLE IF NOT EXISTS v2_match_modes(game_number INTEGER PRIMARY KEY,mode TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS v2_loadouts(game_number INTEGER PRIMARY KEY,enabled INTEGER NOT NULL,items TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS v2_match_rosters(game_number INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, roster TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS v2_match_receipts(game_number INTEGER PRIMARY KEY, request TEXT NOT NULL, receipt TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS game_participation (game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, afk INTEGER NOT NULL, left_game INTEGER NOT NULL, PRIMARY KEY(game_number, telegram_id))`,
  `CREATE TABLE IF NOT EXISTS bans (telegram_id INTEGER PRIMARY KEY, reason TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, place TEXT NOT NULL, message TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
    before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL
  )`,
];

import {ParaCore} from './para-core';
import {HeroV2Core} from './hero-v2-core';
import {RoleV2Economy} from './role-v2-economy';

export class RegistryCore {
  readonly para: ParaCore;
  readonly heroV2: HeroV2Core;
  readonly roleV2Economy: RoleV2Economy;
  readonly eco: EconomyCore;
  readonly security: SecurityCore;
  readonly heroes: HeroCore;

  constructor(
    private readonly sql: Sql,
    private readonly clock: () => number = Date.now,
    owners: ReadonlySet<number> = new Set<number>(),
  ) {
    this.eco = new EconomyCore(sql, clock, undefined, owners);
    this.security = new SecurityCore(sql, clock);
    this.heroes = new HeroCore(sql, clock, (id) => this.eco.isOwner(id));
    this.para = new ParaCore(sql,clock);
    this.heroV2 = new HeroV2Core(sql,this.eco,clock);
    this.roleV2Economy = new RoleV2Economy(sql,this.eco,clock);
  }

  migrate(): void {
    for (const q of SCHEMA) this.sql.exec(q);
    this.eco.migrate();
    this.security.migrate();
    this.heroes.migrate();
    this.para.migrate();
    this.heroV2.migrate();
    this.roleV2Economy.migrate();
  }

  paraRequest(sender:number,target:number){return this.para.request(sender,target);}
  paraFailed(sender:number,id:number){return this.para.failed(sender,id);}
  paraAnswer(target:number,id:number,accept:boolean){return this.para.answer(target,id,accept);}
  paraPair(user:number){return this.para.pair(user);}
  paraLeave(user:number,pair:number){return this.para.leave(user,pair);}

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
      badge: TIER_BADGE[this.eco.tierInfo(tgId).tier],
    };
  }

  /** /start: foydalanuvchi + (ixtiyoriy) referal havolasi. */
  onStart(u: TgUserInput, payload: string): { user: UserInfo; referred: boolean } {
    return this.sql.tx(() => {
      const user = this.upsertUser(u, true);
      const ref = parseRefPayload(payload);
      const referred = ref !== null && this.eco.applyReferral(u.id, ref);
      return { user, referred };
    });
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
    this.para.remove(tgId);
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
    return this.sql.tx(() => {
      const cur = this.one<{ game_number: number }>(`SELECT game_number FROM active_players WHERE telegram_id = ?`, tgId);
      if (cur) return cur.game_number === number ? 'ALREADY' : 'BUSY';
      this.sql.exec(`INSERT INTO active_players (telegram_id, chat_id, game_number, since) VALUES (?, ?, ?, ?)`, tgId, chatId, number, this.clock());
      this.heroes.snapshot(tgId, number);
      return 'OK';
    });
  }

  release(tgId: number, number: number): void {
    this.sql.tx(() => {
      this.sql.exec(`DELETE FROM active_players WHERE telegram_id = ? AND game_number = ?`, tgId, number);
      this.heroes.release(tgId, number);
    });
  }

  releaseGame(number: number, status: 'CANCELLED' | 'FINISHED' = 'CANCELLED'): void {
    this.sql.tx(() => {
      this.eco.releaseArcade(number);
      this.sql.exec(`DELETE FROM active_players WHERE game_number = ?`, number);
      this.heroes.releaseGame(number);
      this.sql.exec(`UPDATE games SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE number = ? AND status <> 'FINISHED'`, status, this.clock(), number);
    });
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
    this.sql.exec(`UPDATE match_points SET chat_id = ? WHERE chat_id = ?`, newChatId, oldChatId);
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

  /** Internal ledger only: bind v2 participants before any leave or result. */
  markV2Running(number:number,chatId:number,ids:readonly number[],allowItems=false):ReturnType<EconomyCore['reserveArcade']>{
    const sorted=[...ids].sort((a,b)=>a-b),roster=JSON.stringify(sorted);
    if(ids.length<4||ids.length>30||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('invalid v2 roster');
    return this.sql.tx(()=>{
      const prior=this.one<{chat_id:number;roster:string}>(`SELECT chat_id,roster FROM v2_match_rosters WHERE game_number=?`,number);
      if(prior){
        const load=this.one<{enabled:number;items:string}>(`SELECT enabled,items FROM v2_loadouts WHERE game_number=?`,number);
        if(prior.chat_id!==chatId||prior.roster!==roster||!load||load.enabled!==Number(allowItems))throw Error('v2 roster conflict');
        return JSON.parse(load.items) as ReturnType<EconomyCore['reserveArcade']>;
      }
      const game=this.one<{status:string;chat_id:number}>(`SELECT status,chat_id FROM games WHERE number=?`,number);
      const active=this.sql.exec<{telegram_id:number}>(`SELECT telegram_id FROM active_players WHERE game_number=? AND chat_id=? ORDER BY telegram_id`,number,chatId).map(x=>x.telegram_id);
      if(!game||game.chat_id!==chatId||game.status!=='LOBBY'||JSON.stringify(active)!==roster)throw Error('v2 roster unavailable');
      const items=allowItems?this.eco.reserveArcade(number,sorted):{};
      this.markRunning(number,ids.length);
      this.sql.exec(`INSERT INTO v2_match_rosters(game_number,chat_id,roster) VALUES(?,?,?)`,number,chatId,roster);
      this.sql.exec(`INSERT INTO v2_loadouts(game_number,enabled,items) VALUES(?,?,?)`,number,Number(allowItems),JSON.stringify(items));
      return items;
    });
  }

  recordV2Game(input:RecordGameInput):RecordResult{
    if(input.engineVersion!==2||!input.mode||!V2_MODES.includes(input.mode)||input.rewardVersion!==1||
      input.practice||input.players.some(p=>p.fake)||!Number.isSafeInteger(input.days)||input.days<1||
      !Number.isSafeInteger(input.completedAt)||!Number.isSafeInteger(input.durationMs)||input.durationMs!<0||
      !['CITY','MAFIA','SOLO','TEAM','ZOMBIE','NEUTRAL','SUIDSID','DRAW'].includes(input.outcome)||
      input.players.some(p=>!V2_ROLES.includes(p.role as V2Role)||V2_DEFS[p.role as V2Role].faction!==p.faction||
      !['WIN','PERSONAL_WIN','LOSS','DRAW'].includes(p.outcome)||(p.left||p.afk)&&(p.outcome!=='LOSS'||p.survived)))throw Error('invalid v2 result');
    const request=JSON.stringify(input);
    return this.sql.tx(()=>{
      const prior=this.one<{request:string;receipt:string}>(`SELECT request,receipt FROM v2_match_receipts WHERE game_number=?`,input.number);
      if(prior){if(prior.request!==request)throw Error('v2 result conflict');return JSON.parse(prior.receipt) as RecordResult;}
      const roster=this.one<{chat_id:number;roster:string}>(`SELECT chat_id,roster FROM v2_match_rosters WHERE game_number=?`,input.number);
      const ids=input.players.map(p=>p.tgId).sort((a,b)=>a-b);
      const game=this.one<{status:string;chat_id:number}>(`SELECT status,chat_id FROM games WHERE number=?`,input.number);
      if(!roster||roster.chat_id!==input.chatId||roster.roster!==JSON.stringify(ids)||!game||game.status!=='RUNNING'||game.chat_id!==input.chatId||
        this.one(`SELECT 1 FROM game_results WHERE game_number=?`,input.number))throw Error('v2 result unavailable');
      const used=input.usedItems??{};
      const reserved=this.sql.exec<{telegram_id:number;item:string}>(`SELECT telegram_id,item FROM item_reservations WHERE game_number=?`,input.number);
      if(Object.entries(used).some(([id,codes])=>!Array.isArray(codes)||new Set(codes).size!==codes.length||
        codes.some(code=>!reserved.some(x=>String(x.telegram_id)===id&&x.item===code))))throw Error('invalid v2 item receipt');
      this.eco.settleArcade(input.number,used);
      const receipt=this.recordGameTx(input);
      this.sql.exec(`INSERT INTO v2_match_modes(game_number,mode) VALUES(?,?)`,input.number,input.mode!);
      this.sql.exec(`INSERT INTO v2_match_receipts(game_number,request,receipt) VALUES(?,?,?)`,input.number,request,JSON.stringify(receipt));
      return receipt;
    });
  }

  /** O'yin natijalarini bir marta yozadi (idempotent: game_results PRIMARY KEY). */
  recordGame(input: RecordGameInput): RecordResult {
    if(input.engineVersion===2||this.one(`SELECT 1 FROM v2_match_rosters WHERE game_number=?`,input.number))throw Error('use trusted v2 result path');
    return this.sql.tx(() => this.recordGameTx(input));
  }

  private recordGameTx(input: RecordGameInput): RecordResult {
    const now = this.clock();
    const scoreVersion = input.rewardVersion === 1;
    const unique = new Set(input.players.map((p) => p.tgId)).size === input.players.length;
    const scoreContext = { playerCount: input.players.length, days: input.days, durationMs: input.durationMs ?? 0, activeRatio: input.players.filter((p) => p.active && !p.left && !p.afk && !p.fake).length / Math.max(1, input.players.length), ranked: input.ranked, practice: Boolean(input.practice || !unique || input.players.some((p) => p.fake)) };
    const at = Number.isSafeInteger(input.completedAt) && input.completedAt! > 0 ? Math.min(now, input.completedAt!) : now;
    const heroEligible = input.engineVersion!==2 && input.ranked && !input.practice && input.players.length >= 4 && new Set(input.players.map((p) => p.tgId)).size === input.players.length && !input.players.some((p) => p.fake);
    const out: RecordedPlayer[] = [];
    const referrals: RecordResult['referrals'] = [];
    if (!input.practice && !input.players.some((p) => p.fake)) this.security.observeGame(input.number, input.chatId, input.players);
    for (const p of input.practice ? [] : input.players) {
      if (p.fake) continue;
      const exists = this.one(`SELECT 1 AS x FROM game_results WHERE game_number = ? AND telegram_id = ?`, input.number, p.tgId);
      if (exists) continue;
      const result = { playerId: String(p.tgId), role: p.role, faction: p.faction, outcome: p.outcome, survived: p.survived, left: p.left, achievements: [] };
      const penalized = p.afk === true;
      const progression = penalized ? { ...result, outcome: 'LOSS' as const, left: true } : result;
      const xp = xpFor(progression, p.active);
      const ratingChange = simpleRating.change(progression, input.ranked);
      const scored = scoreVersion ? matchReward(scoreContext, {...p,...(input.mode==='VS'?{teamWin:true}:{})}) : undefined;
      if (scored && scoreContext.ranked && !scoreContext.practice && scoreContext.playerCount >= 4 && scoreContext.playerCount <= 30) {
        this.sql.exec(`INSERT INTO match_points (game_number, telegram_id, chat_id, points, dollars, at) VALUES (?, ?, ?, ?, ?, ?)`, input.number, p.tgId, input.chatId, scored.points, scored.dollars, at);
      }
      this.sql.exec(`INSERT OR IGNORE INTO game_participation (game_number, telegram_id, afk, left_game) VALUES (?, ?, ?, ?)`, input.number, p.tgId, penalized ? 1 : 0, p.left ? 1 : 0);
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
      const won = !penalized && (p.outcome === 'WIN' || p.outcome === 'PERSONAL_WIN');
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
        inc(penalized || p.outcome === 'LOSS'),
        inc(!penalized && p.outcome === 'DRAW'),
        inc(!penalized && p.outcome === 'PERSONAL_WIN'),
        inc(won && p.faction === 'MAFIA'),
        inc(won && p.faction === 'CITY'),
        inc(won && ['NEUTRAL','SOLO','ZOMBIE'].includes(p.faction)),
        inc(p.survived),
        streak,
        Math.max(prof.best_win_streak, streak),
        p.tgId,
      );
      const roleTable=input.engineVersion===2?'v2_role_stats':'role_stats';
      this.sql.exec(
        `INSERT INTO ${roleTable} (telegram_id, role, played, won) VALUES (?, ?, 1, ?)
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
      const reward = penalized || p.left ? { coins: 0, referral: null } : this.eco.gameReward({ number: input.number, tgId: p.tgId, outcome: p.outcome, survived: p.survived, left: p.left, ...(scored ? { dollarOverride: scored.dollars } : {}) });
      if (reward.referral) referrals.push({ referrerId: reward.referral.referrerId, referredName: p.name, reward: reward.referral.reward });
      const hero = heroEligible && p.active && !penalized && !p.left ? this.heroes.award(p.tgId, input.number, won) : undefined;
      out.push({ tgId: p.tgId, outcome: p.outcome, xp, coins: reward.coins, ratingChange, ...(scored ? { points: scored.points } : {}), ...(hero ? { hero } : {}) });
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
    this.heroes.releaseGame(input.number);
    return { players: out, referrals };
  }

  // ───────────────────────────── Ko'rinishlar ─────────────────────────────

  singleHero(tgId: number) { return this.heroes.single(tgId, this.eco.hasHero(tgId)); }
  setOwnHeroLevel(tgId: number, level: number) { return this.heroes.setOwnLevel(tgId, level); }
  heroAccount(tgId: number) { return this.heroes.view(tgId); }
  selectHero(tgId: number, code: string) { return this.heroes.select(tgId, code); }
  heroTop() { return this.heroes.top(); }

  profileText(tgId: number): string {
    const u = this.one<UserRow>(`SELECT * FROM users WHERE telegram_id = ?`, tgId);
    if (!u) return t('common.error');
    this.sql.exec(`INSERT OR IGNORE INTO profiles (telegram_id) VALUES (?)`, tgId);
    const p = this.one<Record<string, number>>(`SELECT * FROM profiles WHERE telegram_id = ?`, tgId)!;
    const w = this.eco.wallet(tgId);
    const inv = this.eco.inventory(tgId);
    const until = w.tier === 'VIP_PRO' ? w.proUntil : w.vipUntil;
    const tier = w.permanentOwner ? t('owner.tier') : w.tier === 'FREE' ? '' : t(`profile.tier_line.${w.tier}`, { date: until ? formatDate(until) : '' });
    const name = escapeHtml(displayName({ firstName: u.first_name, lastName: u.last_name, username: u.username }));
    return t('profile.v7', {
      name, tier: tier ? '\n' + tier : '', dollars: w.permanentOwner ? '1000000000 (∞)' : w.coins,
      diamonds: w.permanentOwner ? '∞' : (w.diamonds ?? 0), points: this.points(tgId),
      shield: inv.items.find((i) => i.code === 'SHIELD')?.qty ?? 0,
      document: inv.items.find((i) => i.code === 'FAKE_DOC')?.qty ?? 0,
      voteShield: inv.items.find((i) => i.code === 'VOTE_SHIELD')?.qty ?? 0,
      heroShield: inv.items.find((i) => i.code === 'HERO_SHIELD')?.qty ?? 0,
      hero: this.eco.hasHero(tgId) ? t('hero.yes') : t('hero.no'),
      wins: p['games_won']!, played: p['games_played']!,
    });
  }

  /** Last ten completed games of the requester only; never expose other players' hidden roles. */
  gameHistory(tgId: number): string {
    const rows = this.sql.exec<{ game_number: number; role: string; result: string; xp: number; rating_change: number; created_at: number; afk: number | null; left_game: number | null; points: number | null; dollars: number | null; v2: number | null; mode: V2Mode | null }>(
      `SELECT r.game_number, r.role, r.result, r.xp, r.rating_change, r.created_at, p.afk, p.left_game, m.points, m.dollars, CASE WHEN v.game_number IS NULL THEN NULL ELSE 2 END AS v2, vm.mode
       FROM game_results r LEFT JOIN game_participation p ON p.game_number = r.game_number AND p.telegram_id = r.telegram_id
       LEFT JOIN match_points m ON m.game_number = r.game_number AND m.telegram_id = r.telegram_id
       LEFT JOIN v2_match_receipts v ON v.game_number = r.game_number
       LEFT JOIN v2_match_modes vm ON vm.game_number = r.game_number
       WHERE r.telegram_id = ? ORDER BY r.created_at DESC, r.game_number DESC LIMIT 10`, tgId);
    if (!rows.length) return t('history.title') + '\n\n' + t('history.empty');
    return t('history.title') + '\n\n' + rows.map((x) => t(x.points === null ? 'history.legacy_v7' : 'history.line_v7', {
      number: x.game_number, role: x.v2===2&&V2_ROLES.includes(x.role as V2Role)?v2RoleLabel(x.role as V2Role):t('role.' + x.role + '.name'), outcome: t('dm.outcome.' + x.result),
      date: formatDate(x.created_at), dollars: x.dollars ?? 0, points: (x.points !== null && x.points > 0 ? '+' : '') + (x.points ?? 0),
      note: (x.mode?' · '+x.mode:'')+(x.afk ? ' · AFK' : x.left_game ? ' · ' + t('history.left') : ''),
    })).join('\n\n');
  }

  /** Calendar week (Monday) and month, Uzbekistan time UTC+5. Counts wins, not lifetime RP. */
  periodRating(period: 'weekly' | 'monthly'): string {
    const now = this.clock();
    const offset = 5 * 60 * 60 * 1000;
    const local = new Date(now + offset);
    local.setUTCHours(0, 0, 0, 0);
    if (period === 'monthly') local.setUTCDate(1);
    else local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
    const start = local.getTime() - offset;
    const title = t('period.' + period);
    const rows = this.sql.exec<{ wins: number; games: number; first_name: string; last_name: string | null; username: string | null }>(
      `SELECT SUM(CASE WHEN r.result IN ('WIN','PERSONAL_WIN') AND r.xp > 0 THEN 1 ELSE 0 END) AS wins,
       COUNT(*) AS games, u.first_name, u.last_name, u.username FROM game_results r JOIN users u ON u.telegram_id = r.telegram_id
       WHERE r.created_at >= ? AND r.created_at <= ? AND u.deleted_at IS NULL AND r.xp > 0
       GROUP BY r.telegram_id HAVING wins > 0 ORDER BY wins DESC, games ASC, r.telegram_id ASC LIMIT 10`, start, now);
    if (!rows.length) return title + '\n\n' + t('rating.empty');
    return title + '\n\n' + t('period.info') + '\n\n' + rows.map((x, i) => t('group_rating.line', {
      place: i + 1, name: escapeHtml(displayName({ firstName: x.first_name, lastName: x.last_name, username: x.username })), wins: x.wins, games: x.games,
    })).join('\n');
  }

  points(tgId: number): number {
    return this.one<{ points: number }>(`SELECT COALESCE(SUM(points), 0) AS points FROM match_points WHERE telegram_id = ?`, tgId)!.points;
  }

  pointsTop(chatId: number | null, days: 0 | 1 | 7 | 30, actor: number): string {
    if (chatId === null && !this.eco.isOwner(actor)) return t('admin.no_access');
    if (![0,1,7,30].includes(days)) return t('common.error');
    const now = this.clock();
    const from = days === 0 ? 0 : now - days * 86_400_000;
    const params: number[] = chatId === null ? [from, now, now] : [chatId, from, now, now];
    const rows = this.sql.exec<{ points: number; first_name: string; last_name: string | null; username: string | null }>(
      `SELECT SUM(m.points) AS points, u.first_name, u.last_name, u.username
       FROM match_points m JOIN users u ON u.telegram_id = m.telegram_id
       WHERE ${chatId === null ? '' : 'm.chat_id = ? AND '}m.at >= ? AND m.at <= ? AND u.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.telegram_id = m.telegram_id AND (b.expires_at IS NULL OR b.expires_at > ?))
       GROUP BY m.telegram_id ORDER BY points DESC, m.telegram_id ASC LIMIT 20`, ...params);
    const title = (chatId === null ? 'Umumiy' : 'Guruh') + ' TOP 20 · ' + (days === 0 ? 'Barcha vaqt' : days === 1 ? '24 soat' : days + ' kun');
    return '<b>' + title + '</b>\n\n' + (rows.length ? rows.map((x, i) => (i + 1) + '. ' + escapeHtml(displayName({ firstName: x.first_name, lastName: x.last_name, username: x.username })) + ' — <b>' + x.points + '</b> ball').join('\n') : t('rating.empty'));
  }

  globalRating(tgId: number | null): string {
    const top = this.sql.exec<{ telegram_id: number; rating: number; first_name: string; last_name: string | null; username: string | null }>(
      `SELECT p.telegram_id, p.rating, u.first_name, u.last_name, u.username FROM profiles p JOIN users u ON u.telegram_id = p.telegram_id
       WHERE p.games_played > 0 AND u.deleted_at IS NULL ORDER BY p.rating DESC, p.games_won DESC, p.telegram_id ASC LIMIT 10`,
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
       WHERE g.chat_id = ? AND u.deleted_at IS NULL ORDER BY g.wins DESC, g.games DESC, g.telegram_id ASC LIMIT 10`,
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

  stats(): { users: number; groups: number; active: number; today: number; finished: number } {
    const dayStart = new Date(this.clock());
    dayStart.setUTCHours(0, 0, 0, 0);
    const c = (q: string, ...p: (string | number)[]) => this.one<{ c: number }>(q, ...p)!.c;
    return {
      users: c(`SELECT COUNT(*) AS c FROM users`),
      groups: c(`SELECT COUNT(*) AS c FROM groups WHERE status = 'ACTIVE'`),
      active: c(`SELECT COUNT(*) AS c FROM games WHERE status IN ('LOBBY', 'RUNNING')`),
      today: c(`SELECT COUNT(*) AS c FROM games WHERE status = 'FINISHED' AND finished_at >= ?`, dayStart.getTime()),
      finished: c(`SELECT COUNT(*) AS c FROM games WHERE status = 'FINISHED'`),
    };
  }

  adminStats(): string {
    const s = this.stats();
    const e = this.recentErrors();
    const base = t('admin.stats', { users: s.users, groups: s.groups, active: s.active, today: s.today, outbox: 0 });
    const security = { ...this.security.stats(), ...this.security.abuseStats() };
    return `${base}\n${t('admin.errors', { count: e.count24h })}${e.last.length ? `\n${e.last.map((x) => `• ${escapeHtml(x.place)}: ${escapeHtml(x.message.slice(0, 120))}`).join('\n')}` : ''}\n\n${t('security.stats', security)}\nV2 — tekshiruv talab qiladigan bekor qilingan o‘yin sovg‘alari: ${this.roleV2Economy.suspiciousCancelledRecipients()}`;
  }

  /** Ichki xatolar jurnali (oxirgi 200 ta saqlanadi) — /admin_stats va /telegram/diag da ko'rinadi */
  logError(place: string, message: string): void {
    this.sql.exec(`INSERT INTO error_logs (at, place, message) VALUES (?, ?, ?)`, this.clock(), place.slice(0, 60), message.slice(0, 500));
    this.sql.exec(`DELETE FROM error_logs WHERE id <= (SELECT MAX(id) - 200 FROM error_logs)`);
  }

  recentErrors(): { count24h: number; last: { at: number; place: string; message: string }[] } {
    const since = this.clock() - 24 * 3600 * 1000;
    const count24h = this.one<{ c: number }>(`SELECT COUNT(*) AS c FROM error_logs WHERE at >= ?`, since)!.c;
    const last = this.sql.exec<{ at: number; place: string; message: string }>(`SELECT at, place, message FROM error_logs ORDER BY id DESC LIMIT 3`);
    return { count24h, last };
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
