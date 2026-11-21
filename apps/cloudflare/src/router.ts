/**
 * Telegram update router (Cloudflare Worker). O'yin qoidalari yo'q: faqat buyruq va tugmalarni
 * tegishli Durable Object'ga yo'naltiradi va javobni ko'rsatadi (§2.2).
 */
import {
  applySettingsOp,
  backRow,
  decode,
  encode,
  engineErrorText,
  lobbyErrorText,
  mainMenu,
  plainAlert,
  rolesText,
  SELECTABLE_MODES,
  settingsView,
  SOON_SECTIONS,
  splitLong,
  type CallbackData,
  type GroupSettingsData,
  type Keyboard,
  type LobbyError,
} from '@mafia/bot-core';
import { MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, type EngineErrorCode, type GameMode } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import type { TgUserInput, UserInfo } from './registry-core';
import type { RoomResult, SilenceSnapshot, ViewResult } from './room-core';
import { HTML, TgError, type Telegram } from './telegram';

// ───────────────────────────── Telegram update tiplari (kerakli qismi) ─────────────────────────────

export interface TgUser extends TgUserInput {
  is_bot?: boolean;
}
export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  sender_chat?: TgChat;
  text?: string;
  migrate_to_chat_id?: number;
}
export interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: { message_id: number; chat: TgChat };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
  my_chat_member?: { chat: TgChat; from: TgUser; old_chat_member: { status: string }; new_chat_member: { status: string } };
}

// ───────────────────────────── Portlar ─────────────────────────────

export interface RegistryApi {
  upsertUser(u: TgUserInput, dmOpened: boolean): Promise<UserInfo>;
  activeOf(tgId: number): Promise<{ chatId: number; number: number } | null>;
  gameChat(number: number): Promise<number | null>;
  upsertGroup(chatId: number, title: string, opts?: { status?: string; botIsAdmin?: boolean }): Promise<void>;
  group(chatId: number): Promise<{ botIsAdmin: boolean; title: string } | null>;
  setBotAdmin(chatId: number, value: boolean): Promise<void>;
  getSettings(chatId: number): Promise<GroupSettingsData>;
  saveSettings(chatId: number, data: GroupSettingsData, by: string): Promise<GroupSettingsData>;
  profileText(tgId: number): Promise<string>;
  globalRating(tgId: number | null): Promise<string>;
  groupLeaderboard(chatId: number): Promise<string>;
  adminStats(): Promise<string>;
  setGlobalMinPlayers(value: number, by: string): Promise<number>;
  anonymize(tgId: number): Promise<'OK' | 'IN_GAME'>;
  migrateGroup(oldChatId: number, newChatId: number): Promise<void>;
}

export interface RoomApi {
  createLobby(input: { title: string; host: UserInfo; isAdmin: boolean; mode?: GameMode }): Promise<RoomResult<{ number: number; hostJoined: boolean }>>;
  join(user: UserInfo, number?: number): Promise<RoomResult<{ title: string }>>;
  leave(tgId: number): Promise<RoomResult>;
  start(trigger: { by: number; isAdmin: boolean }, number?: number): Promise<RoomResult>;
  cancel(trigger: { by: number; isAdmin: boolean }): Promise<RoomResult>;
  devFill(count: number): Promise<RoomResult<{ added: number }>>;
  nightAction(input: { tgId: number; number: number; seq: number; kind: import('@mafia/game-engine').ActionKind; seats: number[] }): Promise<RoomResult<ViewResult>>;
  skip(input: { tgId: number; number: number; seq: number }): Promise<RoomResult<ViewResult>>;
  mafiaVote(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<ViewResult>>;
  dayVote(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<{ targetName: string | null }>>;
  revealMayor(input: { tgId: number; number: number }): Promise<RoomResult<ViewResult>>;
  judgeVeto(input: { tgId: number; number: number; seq: number }): Promise<RoomResult<ViewResult>>;
  relayMafia(input: { tgId: number; text: string }): Promise<boolean>;
  silenceSnapshot(): Promise<SilenceSnapshot>;
  statusText(): Promise<string>;
  migrate(newChatId: number): Promise<void>;
}

export interface RouterDeps {
  tg: Telegram;
  registry: RegistryApi;
  room(chatId: number): RoomApi;
  admins: ReadonlySet<number>;
  devFake: boolean;
  botUsername(): Promise<string>;
  now(): number;
}

// ───────────────────────────── Isolate xotirasidagi keshlar ─────────────────────────────

class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((x) => now - x < this.windowMs);
    if (arr.length >= this.limit) return false;
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 20_000) this.hits.clear();
    return true;
  }
}

/** Isolate davomida saqlanadigan keshlar (Router har so'rovda yangidan yaratiladi). */
export class RouterCaches {
  readonly clicks = new RateLimiter(6, 3000);
  readonly chats = new RateLimiter(3, 3000);
  readonly adminCache = new Map<string, { value: boolean; expires: number }>();
  readonly gameChats = new Map<number, number>();
  readonly silence = new Map<number, SilenceSnapshot>();
}

export class Router {
  private readonly clicks: RateLimiter;
  private readonly chats: RateLimiter;
  private readonly adminCache: Map<string, { value: boolean; expires: number }>;
  private readonly gameChats: Map<number, number>;
  private readonly silence: Map<number, SilenceSnapshot>;

  constructor(
    private readonly d: RouterDeps,
    caches: RouterCaches = new RouterCaches(),
  ) {
    this.clicks = caches.clicks;
    this.chats = caches.chats;
    this.adminCache = caches.adminCache;
    this.gameChats = caches.gameChats;
    this.silence = caches.silence;
  }

  // ───── yordamchilar ─────

  private async reply(chatId: number, text: string, keyboard?: Keyboard, replyTo?: number): Promise<void> {
    await this.d.tg
      .call('sendMessage', {
        chat_id: chatId,
        text,
        ...HTML,
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      })
      .catch(() => undefined);
  }

  private async edit(cb: TgCallback, text: string, keyboard?: Keyboard): Promise<void> {
    if (!cb.message) return;
    await this.d.tg
      .call('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text,
        ...HTML,
        reply_markup: { inline_keyboard: keyboard ?? [] },
      })
      .catch(() => undefined);
  }

  private async answer(cb: TgCallback, text?: string, alert = false): Promise<void> {
    await this.d.tg
      .call('answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text: plainAlert(text), show_alert: alert } : {}) })
      .catch(() => undefined);
  }

  private isSuperadmin(id: number): boolean {
    return this.d.admins.has(id);
  }

  /** getChatMember, 60 s kesh (eski ruxsat cheksiz saqlanmaydi, §25) */
  private async isChatAdmin(chatId: number, userId: number): Promise<boolean> {
    if (this.isSuperadmin(userId)) return true;
    const key = `${chatId}:${userId}`;
    const hit = this.adminCache.get(key);
    const now = this.d.now();
    if (hit && hit.expires > now) return hit.value;
    let value: boolean;
    try {
      const m = await this.d.tg.call<{ status: string }>('getChatMember', { chat_id: chatId, user_id: userId });
      value = m.status === 'creator' || m.status === 'administrator';
    } catch {
      value = false;
    }
    this.adminCache.set(key, { value, expires: now + 60_000 });
    if (this.adminCache.size > 10_000) this.adminCache.clear();
    return value;
  }

  private async roomOfGame(number: number): Promise<RoomApi | null> {
    let chat = this.gameChats.get(number);
    if (chat === undefined) {
      const c = await this.d.registry.gameChat(number);
      if (c === null) return null;
      chat = c;
      this.gameChats.set(number, c);
      if (this.gameChats.size > 5000) this.gameChats.clear();
    }
    return this.d.room(chat);
  }

  private errText(r: { error: string; details?: Record<string, string | number> }): string {
    const lobbyErrors: string[] = ['GROUP_ACTIVE_GAME', 'NOT_LOBBY', 'FULL', 'NEED_DM', 'IN_OTHER_GAME', 'ALREADY_JOINED', 'NOT_JOINED', 'NO_PERMISSION', 'NOT_ENOUGH', 'BANNED', 'CREATE_FORBIDDEN', 'DM_FAILED'];
    if (lobbyErrors.includes(r.error)) return lobbyErrorText(r.error as LobbyError, r.details);
    if (r.error === 'NOT_FOUND') return t('lobby.not_found');
    return engineErrorText(r.error as EngineErrorCode);
  }

  // ───── kirish nuqtasi ─────

  async handle(update: TgUpdate): Promise<void> {
    if (update.callback_query) return this.onCallback(update.callback_query);
    if (update.my_chat_member) return this.onMyChatMember(update.my_chat_member);
    const m = update.message;
    if (!m) return;
    if (m.migrate_to_chat_id) {
      await this.d.registry.migrateGroup(m.chat.id, m.migrate_to_chat_id);
      await this.d.room(m.chat.id).migrate(m.migrate_to_chat_id);
      return;
    }
    if (m.chat.type === 'private') return this.onPrivate(m);
    if (m.chat.type === 'group' || m.chat.type === 'supergroup') return this.onGroup(m);
  }

  private async parseCommand(text: string | undefined): Promise<{ cmd: string; args: string } | null> {
    if (!text || !text.startsWith('/')) return null;
    const [head = '', ...rest] = text.split(/\s+/);
    const [cmd = '', at] = head.slice(1).split('@');
    if (at && at.toLowerCase() !== (await this.d.botUsername()).toLowerCase()) return null;
    return { cmd: cmd.toLowerCase(), args: rest.join(' ').trim() };
  }

  private async onMyChatMember(u: NonNullable<TgUpdate['my_chat_member']>): Promise<void> {
    const chat = u.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const status = u.new_chat_member.status;
    if (status === 'left' || status === 'kicked') {
      await this.d.registry.upsertGroup(chat.id, chat.title ?? '', { status: 'LEFT' });
      return;
    }
    await this.d.registry.upsertGroup(chat.id, chat.title ?? '', { botIsAdmin: status === 'administrator' });
    const old = u.old_chat_member.status;
    if (old === 'left' || old === 'kicked') await this.reply(chat.id, t('group.welcome'));
  }

  // ───── shaxsiy chat ─────

  private async onPrivate(m: TgMessage): Promise<void> {
    const from = m.from;
    if (!from || from.is_bot) return;
    const c = await this.parseCommand(m.text);
    if (!c) {
      if (m.text && this.chats.allow(`chat:${from.id}`, this.d.now())) {
        const active = await this.d.registry.activeOf(from.id);
        if (active) await this.d.room(active.chatId).relayMafia({ tgId: from.id, text: m.text });
      }
      return;
    }
    const chatId = m.chat.id;
    switch (c.cmd) {
      case 'start': {
        const user = await this.d.registry.upsertUser(from, true);
        const join = /^join_(\d+)$/.exec(c.args);
        if (join) {
          const number = Number(join[1]);
          const room = await this.roomOfGame(number);
          if (room) {
            const r = await room.join(user, number);
            if (r.ok) return this.reply(chatId, t('lobby.joined_dm', { group: escapeHtml(r.title) }));
            if (r.error !== 'ALREADY_JOINED') await this.reply(chatId, this.errText(r));
          }
        }
        return this.reply(chatId, t('menu.welcome', { name: escapeHtml(from.first_name || 'do‘st') }), mainMenu());
      }
      case 'help':
        return this.reply(chatId, t('help.text'));
      case 'support':
      case 'report':
      case 'paysupport':
        return this.reply(chatId, t('support.text'));
      case 'privacy':
        return this.reply(chatId, t('privacy.text'));
      case 'rules':
        return this.reply(chatId, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }));
      case 'roles':
        for (const part of splitLong(rolesText())) await this.reply(chatId, part);
        return;
      case 'profile':
      case 'mystats':
        await this.d.registry.upsertUser(from, true);
        return this.reply(chatId, await this.d.registry.profileText(from.id));
      case 'delete_me':
        return this.reply(chatId, t('delete.confirm'), [
          [
            { text: t('common.yes'), callback_data: encode({ t: 'delme', op: 'y' }) },
            { text: t('common.no'), callback_data: encode({ t: 'delme', op: 'n' }) },
          ],
        ]);
      case 'admin_minplayers': {
        if (!this.isSuperadmin(from.id)) return this.reply(chatId, t('admin.no_access'));
        const n = Number(c.args);
        if (!Number.isInteger(n) || n < MIN_PLAYERS_FLOOR || n > MAX_PLAYERS_CEILING) return this.reply(chatId, t('admin.min_usage'));
        const v = await this.d.registry.setGlobalMinPlayers(n, String(from.id));
        return this.reply(chatId, t('admin.min_set', { min: v }));
      }
      case 'admin_stats':
        if (!this.isSuperadmin(from.id)) return this.reply(chatId, t('admin.no_access'));
        return this.reply(chatId, await this.d.registry.adminStats());
      default:
        return;
    }
  }

  // ───── guruh ─────

  private async onGroup(m: TgMessage): Promise<void> {
    const from = m.from;
    const chatId = m.chat.id;
    const c = await this.parseCommand(m.text);
    if (!c) return this.silenceCheck(m);
    if (!from || from.is_bot) return;
    const room = this.d.room(chatId);
    const isAdmin = async () => (m.sender_chat && m.sender_chat.id === chatId) || (await this.isChatAdmin(chatId, from.id));
    const replyTo = m.message_id;
    switch (c.cmd) {
      case 'game': {
        await this.d.registry.upsertGroup(chatId, m.chat.title ?? '');
        const host = await this.d.registry.upsertUser(from, false);
        const arg = c.args.toUpperCase() as GameMode;
        const r = await room.createLobby({ title: m.chat.title ?? '', host, isAdmin: await isAdmin(), ...(SELECTABLE_MODES.includes(arg) ? { mode: arg } : {}) });
        if (!r.ok) return this.reply(chatId, this.errText(r), undefined, replyTo);
        this.gameChats.set(r.number, chatId);
        if (!r.hostJoined) return this.reply(chatId, t('lobby.need_dm'), undefined, replyTo);
        return;
      }
      case 'join': {
        const user = await this.d.registry.upsertUser(from, false);
        const r = await room.join(user);
        if (!r.ok) return this.reply(chatId, this.errText(r), undefined, replyTo);
        return;
      }
      case 'leave': {
        const r = await room.leave(from.id);
        return this.reply(chatId, r.ok ? t('lobby.left') : this.errText(r), undefined, replyTo);
      }
      case 'players':
      case 'status':
        return this.reply(chatId, await room.statusText(), undefined, replyTo);
      case 'rules':
        return this.reply(chatId, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }), undefined, replyTo);
      case 'help':
        return this.reply(chatId, t('help.text'), undefined, replyTo);
      case 'leaderboard':
        return this.reply(chatId, await this.d.registry.groupLeaderboard(chatId), undefined, replyTo);
      case 'mystats':
        await this.d.registry.upsertUser(from, false);
        return this.reply(chatId, await this.d.registry.profileText(from.id), undefined, replyTo);
      case 'gstart': {
        const r = await room.start({ by: from.id, isAdmin: await isAdmin() });
        if (!r.ok && r.error !== 'DM_FAILED') return this.reply(chatId, this.errText(r), undefined, replyTo);
        return;
      }
      case 'cancelgame': {
        const r = await room.cancel({ by: from.id, isAdmin: await isAdmin() });
        if (!r.ok) return this.reply(chatId, this.errText(r), undefined, replyTo);
        return;
      }
      case 'settings': {
        if (!(await isAdmin())) return this.reply(chatId, t('gsettings.only_admin'), undefined, replyTo);
        await this.d.registry.upsertGroup(chatId, m.chat.title ?? '');
        const s = await this.d.registry.getSettings(chatId);
        const g = await this.d.registry.group(chatId);
        const view = settingsView(s, chatId);
        const note = (s.silenceDead || s.silenceNight) && !g?.botIsAdmin ? `\n\n${t('gsettings.no_delete_rights')}` : '';
        return this.reply(chatId, view.text + note, view.keyboard, replyTo);
      }
      case 'devfill': {
        if (!this.d.devFake || !(await isAdmin())) return;
        const n = Math.max(1, Math.min(29, Number(c.args) || 5));
        const r = await room.devFill(n);
        return this.reply(chatId, r.ok ? t('lobby.dev_filled', { count: r.added }) : this.errText(r), undefined, replyTo);
      }
      case 'admin_minplayers':
      case 'admin_stats':
        return;
      default:
        return;
    }
  }

  /** O'lganlar va tungi jimlik: bot admin bo'lsa xabar o'chiriladi. */
  private async silenceCheck(m: TgMessage): Promise<void> {
    const from = m.from;
    if (!from || from.is_bot) return;
    const now = this.d.now();
    let snap = this.silence.get(m.chat.id);
    if (!snap || snap.until < now) {
      snap = await this.d.room(m.chat.id).silenceSnapshot();
      this.silence.set(m.chat.id, snap);
      if (this.silence.size > 5000) this.silence.clear();
    }
    if (!snap.running || !snap.players.includes(from.id)) return;
    const alive = snap.alive.includes(from.id);
    const del = (!alive && snap.silenceDead) || (alive && snap.phase === 'NIGHT' && snap.silenceNight);
    if (!del) return;
    try {
      await this.d.tg.call('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    } catch (e) {
      if (e instanceof TgError && (e.code === 400 || e.code === 403)) await this.d.registry.setBotAdmin(m.chat.id, false).catch(() => undefined);
    }
  }

  // ───── tugmalar ─────

  private async onCallback(cb: TgCallback): Promise<void> {
    const from = cb.from;
    const data = cb.data ? decode(cb.data) : null;
    if (!data || from.is_bot) return this.answer(cb, t('cb.stale'));
    if (!this.clicks.allow(`cb:${from.id}`, this.d.now())) return this.answer(cb, t('common.rate_limited'));
    try {
      await this.callback(cb, data);
    } catch (e) {
      await this.answer(cb, t('common.error'));
      throw e;
    }
  }

  private async viewResult(cb: TgCallback, r: RoomResult<ViewResult>): Promise<void> {
    if (!r.ok) return this.answer(cb, this.errText(r));
    await this.edit(cb, r.text, r.keyboard);
    return this.answer(cb);
  }

  private async callback(cb: TgCallback, data: CallbackData): Promise<void> {
    const from = cb.from;
    const chat = cb.message?.chat;
    switch (data.t) {
      case 'menu':
        await this.menu(cb, data.section);
        return this.answer(cb);
      case 'delme': {
        if (data.op === 'n') {
          await this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name) }), mainMenu());
          return this.answer(cb);
        }
        const r = await this.d.registry.anonymize(from.id);
        if (r === 'IN_GAME') return this.answer(cb, t('delete.in_game'), true);
        await this.edit(cb, t('delete.done'));
        return this.answer(cb);
      }
      case 'lobby': {
        if (!chat) return this.answer(cb, t('cb.stale'));
        const room = this.d.room(chat.id);
        if (data.op === 'j') {
          const user = await this.d.registry.upsertUser(from, false);
          const r = await room.join(user, data.game);
          return this.answer(cb, r.ok ? t('lobby.joined') : this.errText(r), !r.ok && r.error === 'NEED_DM');
        }
        if (data.op === 'l') {
          const r = await room.leave(from.id);
          return this.answer(cb, r.ok ? t('lobby.left') : this.errText(r));
        }
        const isAdmin = await this.isChatAdmin(chat.id, from.id);
        const r = data.op === 's' ? await room.start({ by: from.id, isAdmin }, data.game) : await room.cancel({ by: from.id, isAdmin });
        return this.answer(cb, r.ok ? undefined : this.errText(r), !r.ok);
      }
      case 'gs': {
        if (!chat || chat.id !== data.chat || !(await this.isChatAdmin(chat.id, from.id))) return this.answer(cb, t('gsettings.only_admin'), true);
        if (data.op === 'close') {
          await this.d.tg.call('deleteMessage', { chat_id: chat.id, message_id: cb.message!.message_id }).catch(() => undefined);
          return this.answer(cb);
        }
        const cur = await this.d.registry.getSettings(chat.id);
        const saved = await this.d.registry.saveSettings(chat.id, applySettingsOp(cur, data.op), String(from.id));
        const view = settingsView(saved, chat.id);
        await this.edit(cb, view.text, view.keyboard);
        return this.answer(cb, t('gsettings.saved'));
      }
      case 'vote': {
        const room = chat ? this.d.room(chat.id) : await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        const r = await room.dayVote({ tgId: from.id, number: data.game, seq: data.seq, seat: data.seat });
        if (!r.ok) return this.answer(cb, this.errText(r));
        return this.answer(cb, r.targetName ? t('cb.voted', { target: r.targetName }) : t('cb.voted_none'));
      }
      case 'mafia': {
        const room = await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        return this.viewResult(cb, await room.mafiaVote({ tgId: from.id, number: data.game, seq: data.seq, seat: data.seat }));
      }
      case 'mayor': {
        const room = await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        return this.viewResult(cb, await room.revealMayor({ tgId: from.id, number: data.game }));
      }
      case 'veto': {
        const room = await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        return this.viewResult(cb, await room.judgeVeto({ tgId: from.id, number: data.game, seq: data.seq }));
      }
      case 'skip': {
        const room = await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        return this.viewResult(cb, await room.skip({ tgId: from.id, number: data.game, seq: data.seq }));
      }
      case 'action': {
        const room = await this.roomOfGame(data.game);
        if (!room) return this.answer(cb, t('cb.stale'));
        return this.viewResult(cb, await room.nightAction({ tgId: from.id, number: data.game, seq: data.seq, kind: data.kind, seats: data.seats }));
      }
    }
  }

  private async menu(cb: TgCallback, section: string): Promise<void> {
    const from = cb.from;
    const user = await this.d.registry.upsertUser(from, cb.message?.chat.type === 'private');
    const username = await this.d.botUsername();
    switch (section) {
      case 'home':
        return this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name || 'do‘st') }), mainMenu());
      case 'play':
        return this.edit(cb, t('play.text'), [
          ...(username ? [[{ text: t('play.add_to_group'), url: `https://t.me/${username}?startgroup=true` }]] : []),
          [{ text: t('play.rules'), callback_data: encode({ t: 'menu', section: 'rules' }) }],
          backRow(),
        ]);
      case 'profile':
        return this.edit(cb, await this.d.registry.profileText(user.id), [backRow()]);
      case 'rating':
        return this.edit(cb, await this.d.registry.globalRating(user.id), [backRow()]);
      case 'rules':
        return this.edit(cb, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }), [
          [{ text: '🎭 /roles', callback_data: encode({ t: 'menu', section: 'roles' }) }],
          backRow(),
        ]);
      case 'roles': {
        const parts = splitLong(rolesText());
        await this.edit(cb, parts[0]!, parts.length === 1 ? [backRow()] : undefined);
        for (let i = 1; i < parts.length; i++) await this.reply(cb.message!.chat.id, parts[i]!, i === parts.length - 1 ? [backRow()] : undefined);
        return;
      }
      case 'settings':
        return this.edit(cb, t('settings.text'), [backRow()]);
      case 'help':
        return this.edit(cb, t('help.text'), [backRow()]);
      default:
        if ((SOON_SECTIONS as readonly string[]).includes(section)) return this.edit(cb, t('common.soon', { section: t(`menu.${section}`) }), [backRow()]);
        return this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name) }), mainMenu());
    }
  }
}
