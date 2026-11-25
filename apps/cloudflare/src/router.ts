/**
 * Telegram update router (Cloudflare Worker). O'yin qoidalari yo'q: faqat buyruq va tugmalarni
 * tegishli Durable Object'ga yo'naltiradi va javobni ko'rsatadi (§2.2).
 */
import {
  applySettingsOp,
  backRow,
  buyConfirmView,
  catalogItem,
  dailyView,
  decode,
  encode,
  engineErrorText,
  formatDate,
  inviteView,
  itemName,
  lobbyErrorText,
  mainMenu,
  plainAlert,
  refCode,
  REFERRAL,
  roleStatsView,
  rolesText,
  learningView,
  SELECTABLE_MODES,
  settingsView,
  shopHomeView,
  splitLong,
  starsProduct,
  vipView,
  type CallbackData,
  type DailyInfo,
  type GroupSettingsData,
  type InventoryInfo,
  type Keyboard,
  type LobbyError,
  type ReferralInfo,
  type RoleStatRow,
  type StarsMode,
  type WalletInfo,
} from '@mafia/bot-core';
import { MAX_PLAYERS_CEILING, MIN_PLAYERS_FLOOR, type EngineErrorCode, type GameMode } from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import type { BuyResult, CheckOrderResult, ClaimDailyResult, PaymentInput, PaymentResult, PaymentRow } from './economy-core';
import type { TgUserInput, UserInfo } from './registry-core';
import type { RoomResult, SilenceSnapshot, ViewResult } from './room-core';
import { HTML, TgError, type Telegram } from './telegram';
import { sendVisual } from './visuals';
import type { HeroCore } from './hero-core';
import { heroView, heroTopView } from './hero-views';

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
  refunded_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
  successful_payment?: {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    telegram_payment_charge_id: string;
    provider_payment_charge_id?: string;
  };
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
  pre_checkout_query?: { id: string; from: TgUser; currency: string; total_amount: number; invoice_payload: string };
}

// ───────────────────────────── Portlar ─────────────────────────────

export interface RegistryApi {
  upsertUser(u: TgUserInput, dmOpened: boolean): Promise<UserInfo>;
  onStart(u: TgUserInput, payload: string): Promise<{ user: UserInfo; referred: boolean }>;
  // iqtisodiyot
  wallet(tgId: number): Promise<WalletInfo>;
  inventory(tgId: number): Promise<InventoryInfo>;
  buy(tgId: number, code: string, idem: string): Promise<BuyResult>;
  buyDiamondVip(tgId: number, idem: string): Promise<BuyResult>;
  toggleArm(tgId: number, code: string): Promise<boolean>;
  equip(tgId: number, kind: 'FRAME' | 'TITLE', code: string | null): Promise<boolean>;
  dailyInfo(tgId: number): Promise<DailyInfo>;
  claimDaily(tgId: number): Promise<ClaimDailyResult>;
  claimQuest(tgId: number, code: string): Promise<{ ok: true; reward: number; balance: number } | { ok: false }>;
  referralInfo(tgId: number): Promise<ReferralInfo>;
  roleStats(tgId: number): Promise<RoleStatRow[]>;
  // to'lovlar
  createOrder(tgId: number, code: string): Promise<{ ok: true; id: string; payload: string } | { ok: false }>;
  checkOrder(payload: string, tgId: number, amount: number, currency: string): Promise<CheckOrderResult>;
  completePayment(p: PaymentInput): Promise<PaymentResult>;
  paymentInfo(chargeId: string): Promise<PaymentRow | null>;
  beginRefund(chargeId: string): Promise<boolean>;
  markRefunded(chargeId: string, by: string): Promise<boolean>;
  recentPayments(limit?: number, tgId?: number): Promise<PaymentRow[]>;
  // murojaatlar
  createTicket(tgId: number, category: string, message: string): Promise<{ ok: true; id: number } | { ok: false }>;
  answerTicket(id: number, by: string, answer: string): Promise<{ tgId: number } | null>;
  activeOf(tgId: number): Promise<{ chatId: number; number: number } | null>;
  gameChat(number: number): Promise<number | null>;
  upsertGroup(chatId: number, title: string, opts?: { status?: string; botIsAdmin?: boolean }): Promise<void>;
  group(chatId: number): Promise<{ botIsAdmin: boolean; title: string } | null>;
  setBotAdmin(chatId: number, value: boolean): Promise<void>;
  getSettings(chatId: number): Promise<GroupSettingsData>;
  saveSettings(chatId: number, data: GroupSettingsData, by: string): Promise<GroupSettingsData>;
  profileText(tgId: number): Promise<string>;
  singleHero(tgId: number): Promise<ReturnType<HeroCore['single']>>;
  setOwnHeroLevel(tgId: number, level: number): Promise<boolean>;
  buyHero(tgId: number, idem: string): Promise<BuyResult>;
  heroTop(): Promise<ReturnType<HeroCore['top']>>;
  globalRating(tgId: number | null): Promise<string>;
  gameHistory(tgId: number): Promise<string>;
  periodRating(period: 'weekly' | 'monthly'): Promise<string>;
  groupLeaderboard(chatId: number): Promise<string>;
  pointsTop(chatId: number | null, days: 0 | 1 | 7 | 30, actor: number): Promise<string>;
  adminStats(): Promise<string>;
  setGlobalMinPlayers(value: number, by: string): Promise<number>;
  anonymize(tgId: number): Promise<'OK' | 'IN_GAME'>;
  migrateGroup(oldChatId: number, newChatId: number): Promise<void>;
}

export interface RoomApi {
  createLobby(input: { title: string; host: UserInfo; isAdmin: boolean; mode?: GameMode; quick?: boolean }): Promise<RoomResult<{ number: number; hostJoined: boolean }>>;
  join(user: UserInfo, number?: number): Promise<RoomResult<{ title: string }>>;
  leave(tgId: number, number?: number): Promise<RoomResult>;
  start(trigger: { by: number; isAdmin: boolean }, number?: number): Promise<RoomResult>;
  cancel(trigger: { by: number; isAdmin: boolean }, text?: string, number?: number): Promise<RoomResult>;
  devFill(count: number): Promise<RoomResult<{ added: number }>>;
  nightAction(input: { tgId: number; number: number; seq: number; kind: import('@mafia/game-engine').ActionKind; seats: number[] }): Promise<RoomResult<ViewResult>>;
  skip(input: { tgId: number; number: number; seq: number }): Promise<RoomResult<ViewResult>>;
  mafiaVote(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<ViewResult>>;
  heroAttack(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<ViewResult>>;
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
  visuals?: boolean;
  /** Telegram Stars: off | admins (faqat bot egalari sinaydi) | all */
  starsMode: StarsMode;
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
  readonly media = new RateLimiter(1, 5000);
  readonly gameChats = new Map<number, number>();
  readonly silence = new Map<number, SilenceSnapshot>();
}

export class Router {
  private readonly clicks: RateLimiter;
  private readonly chats: RateLimiter;
  private readonly media: RateLimiter;
  private readonly gameChats: Map<number, number>;
  private readonly silence: Map<number, SilenceSnapshot>;

  constructor(
    private readonly d: RouterDeps,
    caches: RouterCaches = new RouterCaches(),
  ) {
    this.clicks = caches.clicks;
    this.chats = caches.chats;
    this.media = caches.media;
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

  /** Live Telegram permissions for privileged commands; no stale positive/negative cache. */
  private async isChatAdmin(chatId: number, userId: number): Promise<boolean> {
    if (this.isSuperadmin(userId)) return true;
    try {
      const m = await this.d.tg.call<{ status: string }>('getChatMember', { chat_id: chatId, user_id: userId });
      return m.status === 'creator' || m.status === 'administrator';
    } catch {
      // getChatMember for other users is not guaranteed if the bot lacks admin rights.
      // A successful administrator-list response is an independent authoritative fallback.
      try {
        const members = await this.d.tg.call<{ user: { id: number }; status: string }[]>('getChatAdministrators', { chat_id: chatId });
        return Array.isArray(members) && members.some(m => m.user?.id === userId && (m.status === 'creator' || m.status === 'administrator'));
      } catch {
        return false;
      }
    }
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
    if (update.pre_checkout_query) return this.onPreCheckout(update.pre_checkout_query);
    if (update.my_chat_member) return this.onMyChatMember(update.my_chat_member);
    const m = update.message;
    if (!m) return;
    if (m.successful_payment) return this.onPayment(m);
    if (m.refunded_payment) return this.onRefundedPayment(m);
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
    // Argumentlardagi qator ko'chishlari saqlanadi (murojaat matni uchun)
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!m) return null;
    const [cmd = '', at] = m[1]!.split('@');
    if (at && at.toLowerCase() !== (await this.d.botUsername()).toLowerCase()) return null;
    return { cmd: cmd.toLowerCase(), args: (m[2] ?? '').trim() };
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
        const { user, referred } = await this.d.registry.onStart(from, c.args);
        if (referred) await this.reply(chatId, t('invite.welcome_referred', { games: REFERRAL.gamesRequired }));
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
        return this.reply(chatId, t('menu.welcome', { name: escapeHtml(from.first_name || 'do‘st') }), mainMenu(true, !!this.d.visuals, true));
      }
      case 'help':
        return this.reply(chatId, t('help.text'));
      case 'support':
      case 'report':
      case 'paysupport':
        return this.ticket(from, c.cmd, c.args);
      case 'daily':
      case 'shop':
      case 'inventory':
      case 'vip':
      case 'invite': {
        const v = await this.section(from, c.cmd, true);
        return this.reply(chatId, v!.text, v!.keyboard);
      }
      case 'refund':
        return this.refund(from, c.args);
      case 'reply':
        return this.answerTicket(from, c.args);
      case 'admin_payments':
        return this.adminPayments(from);
      case 'privacy':
        return this.reply(chatId, t('privacy.text'));
      case 'rules':
        return this.reply(chatId, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }));
      case 'intro':
        return this.showVisual(from.id, 'intro');
      case 'characters':
      case 'guide': {
        const view = learningView(c.cmd, !!this.d.visuals)!;
        return this.reply(chatId, view.text, view.keyboard);
      }
      case 'roles':
        for (const part of splitLong(rolesText())) await this.reply(chatId, part);
        return;
      case 'admin_hero_level': {
        if (!this.isSuperadmin(from.id)) return this.reply(chatId,t('admin.no_access'));
        const level = /^\d{1,7}$/.test(c.args.trim()) ? Number(c.args.trim()) : 0;
        const ok=await this.d.registry.setOwnHeroLevel(from.id,level);
        return this.reply(chatId,ok?t('hero.level_saved',{level}):t('hero.owner_level_help'));
      }
      case 'hero':
      case 'heroes':
      case 'herotop': {
        await this.d.registry.upsertUser(from, true);
        const v = await this.heroSection(from.id, c.cmd);
        return this.reply(chatId, v.text, v.keyboard);
      }
      case 'history':
      case 'weekly':
      case 'monthly':
      case 'rating': {
        const v = await this.competitionView(from.id, c.cmd);
        return this.reply(chatId, v.text, v.keyboard);
      }
      case 'profile':
      case 'mystats': {
        const v = await this.section(from, 'profile', true);
        return this.reply(chatId, v!.text, v!.keyboard);
      }
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
    const chatId = m.chat.id;
    const anonymous = m.sender_chat?.id === chatId && (m.sender_chat.type === 'group' || m.sender_chat.type === 'supergroup');
    const from = m.from ?? (anonymous ? { id: chatId, first_name: m.chat.title ?? 'Guruh administratori', is_bot: true } : undefined);
    const c = await this.parseCommand(m.text);
    // Commands must not be a loophole for dead/night silence. Authorized commands still run.
    await this.silenceCheck(m, !!c);
    if (!c || !from || (m.sender_chat && !anonymous) || (from.is_bot && !anonymous)) return;
    // Anonymous group admins may manage this group only; never create fake user accounts or access owner commands.
    if (anonymous && !['game','quick','gstart','cancelgame','settings','top','top1','top7','top30','leaderboard'].includes(c.cmd)) return;
    const room = this.d.room(chatId);
    const isAdmin = async () => anonymous || await this.isChatAdmin(chatId, from.id);
    const replyTo = m.message_id;
    switch (c.cmd) {
      case 'quick':
      case 'game': {
        if (!(await isAdmin())) return this.reply(chatId, t('lobby.create_forbidden'), undefined, replyTo);
        await this.d.registry.upsertGroup(chatId, m.chat.title ?? '');
        const host = anonymous ? { id: chatId, name: m.chat.title ?? 'Guruh administratori', dmAvailable: false, banned: false, badge: '' } : await this.d.registry.upsertUser(from, false);
        const arg = c.args.toUpperCase() as GameMode;
        const r = await room.createLobby({ title: m.chat.title ?? '', host, isAdmin: true, ...(c.cmd === 'quick' ? { mode: 'PRIVATE' as const, quick: true } : SELECTABLE_MODES.includes(arg) ? { mode: arg } : {}) });
        if (!r.ok) return this.reply(chatId, this.errText(r), undefined, replyTo);
        this.gameChats.set(r.number, chatId);
        if (!r.hostJoined && !anonymous) return this.reply(chatId, t('lobby.need_dm'), undefined, replyTo);
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
      case 'top':
      case 'top1':
      case 'top7':
      case 'top30': {
        if (!(await isAdmin())) return this.reply(chatId, t('top.admin_only'), undefined, replyTo);
        const days = c.cmd === 'top1' ? 1 : c.cmd === 'top7' ? 7 : c.cmd === 'top30' ? 30 : 0;
        return this.reply(chatId, await this.d.registry.pointsTop(chatId, days, from.id), undefined, replyTo);
      }
      case 'fulltop':
      case 'fulltop7':
      case 'fulltop30': {
        if (m.sender_chat || !this.isSuperadmin(from.id)) return this.reply(chatId, t('admin.no_access'), undefined, replyTo);
        const days = c.cmd === 'fulltop7' ? 7 : c.cmd === 'fulltop30' ? 30 : 0;
        return this.reply(chatId, await this.d.registry.pointsTop(null, days, from.id), undefined, replyTo);
      }
      case 'mystats':
        await this.d.registry.upsertUser(from, false);
        return this.reply(chatId, await this.d.registry.profileText(from.id), undefined, replyTo);
      case 'gstart': {
        if (!(await isAdmin())) return this.reply(chatId, t('lobby.no_permission'), undefined, replyTo);
        const r = await room.start({ by: anonymous ? chatId : from.id, isAdmin: true });
        if (!r.ok && r.error !== 'DM_FAILED') return this.reply(chatId, this.errText(r), undefined, replyTo);
        return;
      }
      case 'cancelgame': {
        if (!(await isAdmin())) return this.reply(chatId, t('lobby.no_permission'), undefined, replyTo);
        const r = await room.cancel({ by: anonymous ? chatId : from.id, isAdmin: true });
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
        if (!this.d.devFake || !this.isSuperadmin(from.id)) return;
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
  private async silenceCheck(m: TgMessage, fresh = false): Promise<void> {
    const from = m.from;
    if (!from || from.is_bot) return;
    const now = this.d.now();
    let snap = fresh ? undefined : this.silence.get(m.chat.id);
    if (!snap || snap.until <= now) {
      snap = await this.d.room(m.chat.id).silenceSnapshot();
      if (fresh) this.silence.delete(m.chat.id);
      else {
        this.silence.set(m.chat.id, snap);
        if (this.silence.size > 5000) this.silence.clear();
      }
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
    // Private menus, economy and deletion must never be invoked from a group or another user's message.
    if (['menu', 'eco', 'delme', 'hero'].includes(data.t) && (cb.message?.chat.type !== 'private' || cb.message.chat.id !== from.id)) return this.answer(cb, t('cb.stale'));
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
      case 'eco':
        return this.eco(cb, data.op, data.arg);
      case 'delme': {
        if (data.op === 'n') {
          await this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name) }), mainMenu(true, !!this.d.visuals, true));
          return this.answer(cb);
        }
        const r = await this.d.registry.anonymize(from.id);
        if (r === 'IN_GAME') return this.answer(cb, t('delete.in_game'), true);
        await this.edit(cb, t('delete.done'));
        return this.answer(cb);
      }
      case 'lobby': {
        if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return this.answer(cb, t('cb.stale'));
        const room = this.d.room(chat.id);
        if (data.op === 'j') {
          const user = await this.d.registry.upsertUser(from, false);
          const r = await room.join(user, data.game);
          return this.answer(cb, r.ok ? t('lobby.joined') : this.errText(r), !r.ok && r.error === 'NEED_DM');
        }
        if (data.op === 'l') return this.answer(cb, t('cb.stale'));
        const isAdmin = await this.isChatAdmin(chat.id, from.id);
        if (!isAdmin) return this.answer(cb, t('lobby.no_permission'), true);
        const r = data.op === 's' ? await room.start({ by: from.id, isAdmin }, data.game) : await room.cancel({ by: from.id, isAdmin }, undefined, data.game);
        this.silence.delete(chat.id);
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
      case 'hero': {
        const room=await this.roomOfGame(data.game);
        if (!room) return this.answer(cb,t('cb.stale'));
        return this.viewResult(cb,await room.heroAttack({tgId:from.id,number:data.game,seq:data.seq,seat:data.seat}));
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
    if (section === 'intro' || section.startsWith('art_')) return this.showVisual(from.id, section);
    if (section.startsWith('pick_')) { const v=await this.heroSection(from.id,'hero'); return this.edit(cb,v.text,v.keyboard); }
    if (section === 'buy_dollars' || section === 'buy_diamonds') return this.edit(cb,t('currency.packs_pending'),[backRow()]);
    if (section === 'hero' || section === 'heroes' || section === 'herotop' || section.startsWith('hero_')) {
      const v = await this.heroSection(from.id, section);
      return this.edit(cb, v.text, v.keyboard);
    }
    const learning = learningView(section, !!this.d.visuals);
    if (learning) return this.edit(cb, learning.text, learning.keyboard);
    const username = await this.d.botUsername();
    switch (section) {
      case 'home':
        return this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name || 'do‘st') }), mainMenu(true, !!this.d.visuals, true));
      case 'play':
        return this.edit(cb, t('play.text'), [
          ...(username ? [[{ text: t('play.add_to_group'), url: `https://t.me/${username}?startgroup=true` }]] : []),
          [{ text: t('play.rules'), callback_data: encode({ t: 'menu', section: 'rules' }) }],
          backRow(),
        ]);
      case 'rating':
      case 'history':
      case 'weekly':
      case 'monthly': {
        const v = await this.competitionView(user.id, section);
        return this.edit(cb, v.text, v.keyboard);
      }
      case 'rules':
        return this.edit(cb, t('rules.text', { min: MIN_PLAYERS_FLOOR, max: MAX_PLAYERS_CEILING }), [
          [{ text: t('menu.characters'), callback_data: encode({ t: 'menu', section: 'characters' }) }],
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
      default: {
        const v = await this.section(from, section, cb.message?.chat.type === 'private');
        if (v) return this.edit(cb, v.text, v.keyboard);
        return this.edit(cb, t('menu.welcome', { name: escapeHtml(from.first_name) }), mainMenu(true, !!this.d.visuals, true));
      }
    }
  }

  private async showVisual(id: number, section: string): Promise<void> {
    if (!this.d.visuals) return this.reply(id, t('visual.unavailable'));
    const key = section === 'intro' ? 'intro' : 'role_' + section.slice(4);
    const role = section === 'intro' ? null : learningView(key);
    if (section !== 'intro' && !role) return;
    if (!this.media.allow(String(id), this.d.now())) return this.reply(id, t('common.rate_limited'));
    const caption = section === 'intro' ? 'HYPERNOVA MAFIA' : t('role.' + key.slice(5).toUpperCase() + '.name');
    if (!(await sendVisual(this.d.tg, id, key, caption))) await this.reply(id, t('visual.unavailable'));
  }

  private async heroSection(id: number, section: string): Promise<{ text: string; keyboard: Keyboard }> {
    if (section === 'herotop') return heroTopView(await this.d.registry.heroTop());
    return heroView(await this.d.registry.singleHero(id));
  }

  private async competitionView(id: number, section: string): Promise<{ text: string; keyboard: Keyboard }> {
    const b = (key: string, section: string) => ({ text: t(key), callback_data: encode({ t: 'menu', section }) });
    const text = section === 'history' ? await this.d.registry.gameHistory(id) : t('top.group_info');
    return { text, keyboard: [[b('menu.rating', 'rating'), b('menu.history', 'history')], backRow()] };
  }

  // ───────────────────────────── Iqtisodiyot ─────────────────────────────

  private starsAllowed(tgId: number): boolean {
    if (this.d.starsMode === 'all') return true;
    if (this.d.starsMode === 'admins') return this.isSuperadmin(tgId);
    return false;
  }

  /** Bo'lim ko'rinishi (buyruq va menyu tugmasi uchun umumiy). null — bunday bo'lim yo'q. */
  private async section(from: TgUser, section: string, dmOpened: boolean): Promise<{ text: string; keyboard: Keyboard } | null> {
    const id = from.id;
    switch (section) {
      case 'inventory':
      case 'profile': {
        await this.d.registry.upsertUser(from, dmOpened);
        const inv=await this.d.registry.inventory(id);
        const menu=(text:string,section:string)=>({text,callback_data:encode({t:'menu',section})});
        const arm=(code:string,label:string)=>({text:label+' · '+(inv.items.find(i=>i.code===code)?.armed?'ON':'OFF'),callback_data:encode({t:'eco',op:'arm',arg:code})});
        return {text:await this.d.registry.profileText(id),keyboard:[[arm('SHIELD','🛡'),arm('FAKE_DOC','📁')],[arm('VOTE_SHIELD','⚖️'),arm('HERO_SHIELD','Geroy himoyasi')],[menu('Do‘kon','shop')],[menu('Xarid qilish 💎','buy_diamonds'),menu('Xarid qilish 💵','buy_dollars')],[menu('Mening geroyim','hero')],backRow()]};
      }
      case 'shop': {
        const w = await this.d.registry.wallet(id);
        return shopHomeView(w.coins, w.diamonds ?? 0);
      }
      case 'vip':
        return vipView(await this.d.registry.wallet(id), { starsAllowed: this.starsAllowed(id), isAdmin: this.isSuperadmin(id) });
      case 'daily':
        return dailyView(await this.d.registry.dailyInfo(id));
      case 'invite': {
        await this.d.registry.upsertUser(from, dmOpened);
        const link = `https://t.me/${await this.d.botUsername()}?start=ref_${refCode(id)}`;
        return inviteView(await this.d.registry.referralInfo(id), link);
      }
      default:
        return null;
    }
  }

  private async eco(cb: TgCallback, op: string, arg: string): Promise<void> {
    const id = cb.from.id;
    const reg = this.d.registry;
    switch (op) {
      case 'shop': {
        const w = await reg.wallet(id);
        const v = shopHomeView(w.coins, w.diamonds ?? 0);
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb);
      }
      case 'cat': {
        const w=await reg.wallet(id); const v=shopHomeView(w.coins,w.diamonds??0);
        await this.edit(cb,v.text,v.keyboard); return this.answer(cb);
      }
      case 'buy': {
        const item = catalogItem(arg);
        if (!item || item.kind !== 'ARCADE' || item.price === null) return this.answer(cb, t('shop.unknown'));
        const w = await reg.wallet(id);
        const v = buyConfirmView(item, w.coins, w.diamonds ?? 0);
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb);
      }
      case 'buyok': {
        const item = catalogItem(arg);
        // callback_query id har bosishda noyob: Telegram qayta yuborsa ham ikki marta yechilmaydi
        const r = await reg.buy(id, arg, `buy:${cb.id}`);
        if (!r.ok) {
          const msg =
            r.error === 'INSUFFICIENT'
              ? t(item?.currency === 'DIAMOND' ? 'shop.diamond_insufficient' : 'shop.insufficient', { price: r.price ?? 0, coins: r.balance })
              : r.error === 'OWNED'
                ? t('shop.already_owned')
                : r.error === 'TIER_ONLY'
                  ? t('shop.tier_only', { tier: t(`tier.${item?.tier ?? 'VIP'}`) })
                  : t('shop.unknown');
          return this.answer(cb, msg, true);
        }
        const w=await reg.wallet(id); const v=shopHomeView(w.coins,w.diamonds??0);
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb, t(item!.currency === 'DIAMOND' ? 'shop.diamond_bought' : 'shop.bought', { name: itemName(arg), coins: r.balance }), true);
      }
      case 'arm': {
        const ok=await reg.toggleArm(id,arg);
        const v=await this.section(cb.from,'profile',true);
        await this.edit(cb,v!.text,v!.keyboard);
        return this.answer(cb,ok?t('inv.saved'):t('inv.not_owned'));
      }
      case 'herobuy': {
        if(arg) return this.answer(cb,t('cb.stale'));
        await this.edit(cb,t('hero.confirm'),[[{text:t('common.yes'),callback_data:encode({t:'eco',op:'herook',arg:''})},{text:t('common.no'),callback_data:encode({t:'menu',section:'hero'})}]]);
        return this.answer(cb);
      }
      case 'herook': {
        if(arg) return this.answer(cb,t('cb.stale'));
        const result=await reg.buyHero(id,'hero:'+cb.id);
        const v=await this.heroSection(id,'hero'); await this.edit(cb,v.text,v.keyboard);
        return this.answer(cb,result.ok?t('hero.purchased'):t('shop.diamond_insufficient',{price:100,coins:result.balance}),true);
      }
      case 'daily': {
        const r = await reg.claimDaily(id);
        const v = dailyView(await reg.dailyInfo(id));
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb, r.ok ? t('daily.got', { amount: r.amount, streak: r.streak, coins: r.balance }) : t('daily.already'), r.ok);
      }
      case 'qc': {
        const r = await reg.claimQuest(id, arg);
        const v = dailyView(await reg.dailyInfo(id));
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb, r.ok ? t('quest.claimed', { reward: r.reward, coins: r.balance }) : t('quest.not_done'), r.ok);
      }
      case 'stats': {
        const [w, stats] = await Promise.all([reg.wallet(id), reg.roleStats(id)]);
        const v = roleStatsView(stats, w);
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb);
      }
      case 'vipdia': {
        if (arg) return this.answer(cb, t('cb.stale'));
        const w = await reg.wallet(id);
        await this.edit(cb, t('vip.diamond_confirm', { balance: w.diamonds ?? 0 }), [[{ text: t('common.yes'), callback_data: encode({ t: 'eco', op: 'vipdiok', arg: '' }) }, { text: t('common.no'), callback_data: encode({ t: 'menu', section: 'vip' }) }]]);
        return this.answer(cb);
      }
      case 'vipdiok': {
        if (arg) return this.answer(cb, t('cb.stale'));
        const result = await reg.buyDiamondVip(id, `vip:${cb.id}`);
        const v = vipView(await reg.wallet(id), { starsAllowed: this.starsAllowed(id), isAdmin: this.isSuperadmin(id) });
        await this.edit(cb, v.text, v.keyboard);
        return this.answer(cb, result.ok ? t('vip.diamond_success') : result.error === 'INSUFFICIENT' ? t('shop.diamond_insufficient', { price: 30, coins: result.balance }) : t('common.error'), true);
      }
      case 'star':
        return this.sendInvoice(cb, arg);
      default:
        return this.answer(cb, t('cb.stale'));
    }
  }

  // ───────────────────────────── Telegram Stars ─────────────────────────────

  private async sendInvoice(cb: TgCallback, code: string): Promise<void> {
    const id = cb.from.id;
    const product = starsProduct(code);
    if (!product) return this.answer(cb, t('cb.stale'));
    if (!this.starsAllowed(id)) return this.answer(cb, t('pay.disabled'), true);
    if (product.adminOnly && !this.isSuperadmin(id)) return this.answer(cb, t('pay.admin_only'), true);
    if (!product.adminOnly && (await this.d.registry.wallet(id)).permanentOwner) return this.answer(cb, t('owner.already_vip'), true);
    const order = await this.d.registry.createOrder(id, code);
    if (!order.ok) return this.answer(cb, t('common.error'));
    const title = t(`invoice.${code}.title`);
    await this.d.tg.call('sendInvoice', {
      chat_id: id,
      title,
      description: t(`invoice.${code}.desc`),
      payload: order.payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: title, amount: product.stars }],
    });
    return this.answer(cb, t('pay.sent'));
  }

  /** pre_checkout_query: Telegram 10 soniya ichida javob kutadi — faqat tez tekshiruv. */
  private async onPreCheckout(q: NonNullable<TgUpdate['pre_checkout_query']>): Promise<void> {
    const deny = (message: string) =>
      this.d.tg.call('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: false, error_message: plainAlert(message) }).catch(() => undefined);
    if (!this.starsAllowed(q.from.id)) return void (await deny(t('pay.disabled')));
    const r = await this.d.registry.checkOrder(q.invoice_payload, q.from.id, q.total_amount, q.currency);
    if (!r.ok) return void (await deny(t('pay.precheck_failed')));
    if (r.product.adminOnly && !this.isSuperadmin(q.from.id)) return void (await deny(t('pay.admin_only')));
    if (!r.product.adminOnly && (await this.d.registry.wallet(q.from.id)).permanentOwner) return void (await deny(t('owner.already_vip')));
    await this.d.tg.call('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: true });
  }

  /** successful_payment: mahsulot faqat shu yerda beriladi (tugma bosilishiga ishonilmaydi). */
  private async onPayment(m: TgMessage): Promise<void> {
    const sp = m.successful_payment!;
    const from = m.from;
    if (!from) return;
    const r = await this.d.registry.completePayment({
      tgId: from.id,
      payload: sp.invoice_payload,
      amount: sp.total_amount,
      currency: sp.currency,
      chargeId: sp.telegram_payment_charge_id,
    });
    if (r.status === 'DUPLICATE') return;
    if (r.status === 'UNMATCHED') {
      await this.reply(from.id, t('pay.unmatched'));
      for (const admin of this.d.admins) {
        await this.reply(
          admin,
          t('pay.admin_unmatched', { user: from.id, stars: sp.total_amount, payload: escapeHtml(sp.invoice_payload.slice(0, 64)), charge: escapeHtml(sp.telegram_payment_charge_id) }),
        );
      }
      return;
    }
    if (r.product === 'TEST_1') {
      return this.reply(from.id, t('pay.test_success', { stars: sp.total_amount, charge: escapeHtml(sp.telegram_payment_charge_id) }));
    }
    await this.reply(
      from.id,
      t('pay.success', {
        product: `<b>${t(`invoice.${r.product}.title`)}</b>`,
        until: r.until ? t('pay.success_until', { date: formatDate(r.until) }) : '',
      }),
    );
  }

  private async refund(from: TgUser, args: string): Promise<void> {
    if (!this.isSuperadmin(from.id)) return this.reply(from.id, t('admin.no_access'));
    const chargeId = args.trim();
    if (!chargeId) return this.reply(from.id, t('admin.refund_usage'));
    const p = await this.d.registry.paymentInfo(chargeId);
    if (!p || p.status === 'REFUNDED') return this.reply(from.id, t('admin.refund_not_found'));
    if (!(await this.d.registry.beginRefund(chargeId))) return this.reply(from.id, t('security.refund_pending'));
    try {
      const accepted = await this.d.tg.call<boolean>('refundStarPayment', { user_id: p.tgId, telegram_payment_charge_id: chargeId });
      if (accepted !== true) throw new Error('refund not confirmed');
      await this.d.registry.markRefunded(chargeId, String(from.id));
    } catch {
      // Unknown remote outcome: never blindly issue another refund. Reconcile via authenticated refund event.
      return this.reply(from.id, t('security.refund_pending'));
    }
    const product = p.product ? t(`invoice.${p.product}.title`) : '—';
    await this.reply(p.tgId, t('pay.refunded_user', { stars: p.amount, product }));
    return this.reply(from.id, t('admin.refund_done', { stars: p.amount, user: p.tgId }));
  }

  private async onRefundedPayment(m: TgMessage): Promise<void> {
    const event = m.refunded_payment!;
    if (m.chat.type !== 'private' || event.currency !== 'XTR') return;
    const p = await this.d.registry.paymentInfo(event.telegram_payment_charge_id);
    if (!p || p.tgId !== m.chat.id || p.amount !== event.total_amount || p.status === 'REFUNDED') return;
    await this.d.registry.markRefunded(p.chargeId, 'telegram');
  }

  private async adminPayments(from: TgUser): Promise<void> {
    if (!this.isSuperadmin(from.id)) return this.reply(from.id, t('admin.no_access'));
    const list = await this.d.registry.recentPayments(10);
    if (list.length === 0) return this.reply(from.id, t('admin.payments_empty'));
    const lines = list.map((p) => this.paymentLine(p));
    return this.reply(from.id, `${t('admin.payments_title')}\n\n${lines.join('\n\n')}`);
  }

  private paymentLine(p: PaymentRow): string {
    return t('admin.payment_line', {
      date: formatDate(p.createdAt),
      user: p.tgId,
      product: p.product ?? '—',
      stars: p.amount,
      status: p.status,
      charge: escapeHtml(p.chargeId),
    });
  }

  // ───────────────────────────── Murojaatlar ─────────────────────────────

  private async ticket(from: TgUser, cmd: string, text: string): Promise<void> {
    if (!text) return this.reply(from.id, t('support.usage'));
    const category = cmd === 'paysupport' ? 'PAYMENT' : cmd === 'report' ? 'REPORT' : 'SUPPORT';
    const user = await this.d.registry.upsertUser(from, true);
    const r = await this.d.registry.createTicket(from.id, category, text);
    if (!r.ok) return this.reply(from.id, t('support.limit'));
    let payments = '';
    if (category === 'PAYMENT') {
      const list = await this.d.registry.recentPayments(5, from.id);
      if (list.length > 0) payments = t('support.admin_payments', { list: list.map((p) => this.paymentLine(p)).join('\n') });
    }
    const msg = t('support.admin_new', { id: r.id, category, user: escapeHtml(user.name), tgId: from.id, text: escapeHtml(text.slice(0, 2000)), payments });
    for (const admin of this.d.admins) await this.reply(admin, msg);
    return this.reply(from.id, t('support.created', { id: r.id }));
  }

  private async answerTicket(from: TgUser, args: string): Promise<void> {
    if (!this.isSuperadmin(from.id)) return this.reply(from.id, t('admin.no_access'));
    const m = /^(\d+)\s+([\s\S]+)$/.exec(args);
    if (!m) return this.reply(from.id, t('admin.reply_usage'));
    const id = Number(m[1]);
    const r = await this.d.registry.answerTicket(id, String(from.id), m[2]!);
    if (!r) return this.reply(from.id, t('admin.reply_not_found'));
    await this.reply(r.tgId, t('support.answer', { id, text: escapeHtml(m[2]!) }));
    return this.reply(from.id, t('admin.reply_done', { id }));
  }
}
