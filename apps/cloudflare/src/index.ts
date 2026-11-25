/**
 * Cloudflare Worker: Telegram webhook + Durable Objects (bepul tarif).
 *
 *   POST /telegram/webhook  — Telegram update lari (secret_token bilan)
 *   POST /telegram/setup    — webhook, buyruqlar menyusi va tavsifni o'rnatish (X-Setup-Key)
 *   GET  /health
 *
 *   GameRoom (har bir guruhga bitta) — lobby, o'yin holati, taymerlar (alarm), xabarlar navbati
 *   Registry (bitta)               — foydalanuvchilar, profillar, reyting, sozlamalar
 */
import { DurableObject } from 'cloudflare:workers';
import { parseStarsMode } from '@mafia/bot-core';
import { cryptoRng } from '@mafia/game-engine';
import { t } from '@mafia/localization';
import type { PaymentInput } from './economy-core';
import { RegistryCore, type Sql, type TgUserInput } from './registry-core';
import { reentrantTx } from './sql';
import { RoomCore, type RoomData, type RoomDeps } from './room-core';
import { Router, RouterCaches, type RoomApi, type RegistryApi } from './router';
import { setupKey, TelegramClient, webhookSecret, type Telegram } from './telegram';
import { readTelegramUpdate } from './webhook-input';
import { reconcileRefunds } from './refund-reconcile';

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  REGISTRY: DurableObjectNamespace<Registry>;
  BOT_TOKEN: string;
  ADMIN_IDS?: string;
  BOT_USERNAME?: string;
  DEV_FAKE_PLAYERS?: string;
  VISUAL_MEDIA?: string;
  /** Telegram Stars: off | admins | all (standart: admins) */
  STARS_MODE?: string;
  /** Faqat testlar: soxta Telegram API manzili */
  TELEGRAM_API?: string;
  /** Faqat testlar: /__test/* yo'llari */
  TEST_HOOKS?: string;
}

function telegram(env: Env): Telegram {
  return new TelegramClient(env.BOT_TOKEN, env.TELEGRAM_API || 'https://api.telegram.org');
}

function ownerIds(env: Env): ReadonlySet<number> {
  return new Set((env.ADMIN_IDS ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isSafeInteger(x) && x > 0));
}

/** No raw update, token, names or payment data are included in automated alerts. */
async function reportFailure(env: Env, kind: 'webhook' | 'alarm' | 'registry'): Promise<void> {
  try {
    await registryStub(env).logError(kind, 'Operation failed; inspect protected diagnostics');
    if (!(await registryStub(env).claimSecurityAlert(kind))) return;
    await Promise.allSettled([...ownerIds(env)].map((id) => telegram(env).call('sendMessage', { chat_id: id, text: `⚠️ Hypernova: ${kind} xatosi. /admin_stats orqali holatni tekshiring. Har tur uchun xabar 15 daqiqada ko‘pi bilan bir marta.` })));
  } catch {
    // Alert failure must not prevent retry or the next game phase.
  }
}

function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName('global'));
}

let cachedUsername: string | null = null;
async function botUsername(env: Env): Promise<string> {
  if (env.BOT_USERNAME) return env.BOT_USERNAME;
  if (cachedUsername) return cachedUsername;
  try {
    const me = await telegram(env).call<{ username: string }>('getMe');
    cachedUsername = me.username;
  } catch {
    return '';
  }
  return cachedUsername;
}

// ───────────────────────────── Registry DO ─────────────────────────────

export class Registry extends DurableObject<Env> {
  private readonly core: RegistryCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql: Sql = {
      exec: (q, ...p) => ctx.storage.sql.exec(q, ...p).toArray() as never,
      // transactionSync: xato bo'lsa hamma o'zgarishlar bekor qilinadi
      tx: reentrantTx((fn) => ctx.storage.transactionSync(fn)),
    };
    this.core = new RegistryCore(sql, Date.now, ownerIds(env));
    void ctx.blockConcurrencyWhile(async () => this.core.migrate());
  }

  upsertUser(u: TgUserInput, dmOpened: boolean) {
    return this.core.upsertUser(u, dmOpened);
  }
  onStart(u: TgUserInput, payload: string) {
    return this.core.onStart(u, payload);
  }
  // ── iqtisodiyot ──
  wallet(tgId: number) {
    return this.core.eco.wallet(tgId);
  }
  inventory(tgId: number) {
    return this.core.eco.inventory(tgId);
  }
  buy(tgId: number, code: string, idem: string) {
    return this.core.eco.buy(tgId, code, idem);
  }
  buyDiamondVip(tgId: number, idem: string) { return this.core.eco.buyDiamondVip(tgId, idem); }
  toggleArm(tgId: number, code: string) {
    return this.core.eco.toggleArm(tgId, code);
  }
  equip(tgId: number, kind: 'FRAME' | 'TITLE', code: string | null) {
    return this.core.eco.equip(tgId, kind, code);
  }
  dailyInfo(tgId: number) {
    return this.core.eco.dailyInfo(tgId);
  }
  claimDaily(tgId: number) {
    return this.core.eco.claimDaily(tgId);
  }
  claimQuest(tgId: number, code: string) {
    return this.core.eco.claimQuest(tgId, code);
  }
  referralInfo(tgId: number) {
    return this.core.eco.referralInfo(tgId);
  }
  roleStats(tgId: number) {
    return this.core.eco.roleStats(tgId);
  }
  reserveArcade(number: number, tgIds: number[]) {
    return this.core.eco.reserveArcade(number, tgIds);
  }
  settleArcade(number: number, used: Record<string, string[]>) {
    this.core.eco.settleArcade(number, used);
  }
  releaseArcade(number: number) {
    this.core.eco.releaseArcade(number);
  }
  // ── to'lovlar ──
  createOrder(tgId: number, code: string) {
    return this.core.eco.createOrder(tgId, code);
  }
  checkOrder(payload: string, tgId: number, amount: number, currency: string) {
    return this.core.eco.checkOrder(payload, tgId, amount, currency);
  }
  completePayment(p: PaymentInput) {
    return this.core.eco.completePayment(p);
  }
  paymentInfo(chargeId: string) {
    return this.core.eco.paymentInfo(chargeId);
  }
  pendingRefunds() {
    return this.core.eco.pendingRefunds();
  }
  beginRefund(chargeId: string) {
    return this.core.eco.beginRefund(chargeId);
  }
  markRefunded(chargeId: string, by: string) {
    return this.core.eco.markRefunded(chargeId, by);
  }
  recentPayments(limit?: number, tgId?: number) {
    return this.core.eco.recentPayments(limit, tgId);
  }
  // ── murojaatlar ──
  createTicket(tgId: number, category: string, message: string) {
    return this.core.eco.createTicket(tgId, category, message);
  }
  answerTicket(id: number, by: string, answer: string) {
    return this.core.eco.answerTicket(id, by, answer);
  }
  activeOf(tgId: number) {
    return this.core.activeOf(tgId);
  }
  gameChat(number: number) {
    return this.core.gameChat(number);
  }
  allocateGame(chatId: number) {
    return this.core.allocateGame(chatId);
  }
  claim(tgId: number, chatId: number, number: number) {
    return this.core.claim(tgId, chatId, number);
  }
  release(tgId: number, number: number) {
    this.core.release(tgId, number);
  }
  releaseGame(number: number, status: 'CANCELLED' | 'FINISHED') {
    this.core.releaseGame(number, status);
  }
  markRunning(number: number, players: number) {
    this.core.markRunning(number, players);
  }
  recordGame(input: Parameters<RegistryCore['recordGame']>[0]) {
    return this.core.recordGame(input);
  }
  markDmBlocked(tgIds: number[]) {
    this.core.markDmBlocked(tgIds);
  }
  upsertGroup(chatId: number, title: string, opts?: { status?: string; botIsAdmin?: boolean }) {
    this.core.upsertGroup(chatId, title, opts);
  }
  group(chatId: number) {
    return this.core.group(chatId);
  }
  setBotAdmin(chatId: number, value: boolean) {
    this.core.setBotAdmin(chatId, value);
  }
  getSettings(chatId: number) {
    return this.core.getSettings(chatId);
  }
  saveSettings(chatId: number, data: Parameters<RegistryCore['saveSettings']>[1], by: string) {
    return this.core.saveSettings(chatId, data, by);
  }
  profileText(tgId: number) {
    return this.core.profileText(tgId);
  }
  singleHero(tgId: number) { return this.core.singleHero(tgId); }
  setOwnHeroLevel(tgId: number, level: number) { return this.core.setOwnHeroLevel(tgId, level); }
  buyHero(tgId: number, idem: string) { return this.core.eco.buyHero(tgId, idem); }
  heroAccount(tgId: number) { return this.core.heroAccount(tgId); }
  selectHero(tgId: number, code: string) { return this.core.selectHero(tgId, code); }
  heroTop() { return this.core.heroTop(); }
  globalRating(tgId: number | null) {
    return this.core.globalRating(tgId);
  }
  gameHistory(tgId: number) {
    return this.core.gameHistory(tgId);
  }
  periodRating(period: 'weekly' | 'monthly') {
    return this.core.periodRating(period);
  }
  groupLeaderboard(chatId: number) {
    return this.core.groupLeaderboard(chatId);
  }
  pointsTop(chatId: number | null, days: 0 | 1 | 7 | 30, actor: number) { return this.core.pointsTop(chatId, days, actor); }
  adminStats() {
    return this.core.adminStats();
  }
  stats() {
    return this.core.stats();
  }
  logError(place: string, message: string) {
    this.core.logError(place, message);
  }
  recentErrors() {
    return this.core.recentErrors();
  }
  beginUpdate(updateId: number, userId: number) {
    return this.core.security.begin(updateId, userId);
  }
  finishUpdate(updateId: number, ok: boolean) {
    this.core.security.finish(updateId, ok);
  }
  claimSecurityAlert(kind: 'webhook' | 'alarm' | 'registry') {
    return this.core.security.claimAlert(kind);
  }
  securityStats() {
    return { ...this.core.security.stats(), ...this.core.security.abuseStats(), pendingRefunds: this.core.eco.pendingRefunds().length };
  }
  async recoveryCheckpoint(): Promise<void> {
    const now = Date.now();
    const last = await this.ctx.storage.get<{ at: number; bookmark: string }>('security:pitr');
    if (last && now - last.at < 24 * 60 * 60 * 1000) return;
    const bookmark = await this.ctx.storage.getCurrentBookmark();
    await this.ctx.storage.put('security:pitr', { at: now, bookmark });
  }
  async recoveryStatus(): Promise<{ lastCheckpointAt: number | null }> {
    const last = await this.ctx.storage.get<{ at: number; bookmark: string }>('security:pitr');
    return { lastCheckpointAt: last?.at ?? null };
  }
  setGlobalMinPlayers(value: number, by: string) {
    return this.core.setGlobalMinPlayers(value, by);
  }
  anonymize(tgId: number) {
    return this.core.anonymize(tgId);
  }
  migrateGroup(oldChatId: number, newChatId: number) {
    this.core.migrateGroup(oldChatId, newChatId);
  }
}

// ───────────────────────────── GameRoom DO ─────────────────────────────

const ROOM_METHODS = [
  'createLobby',
  'cleanupCommand',
  'join',
  'leave',
  'leaveLobbyForTransfer',
  'start',
  'cancel',
  'devFill',
  'nightAction',
  'skip',
  'mafiaVote',
  'dayVote',
  'heroAttack',
  'revealMayor',
  'judgeVeto',
  'relayMafia',
  'silenceSnapshot',
  'statusText',
  'migrate',
  'forceDeadline',
] as const;
type RoomMethod = (typeof ROOM_METHODS)[number];

export class GameRoom extends DurableObject<Env> {
  private core: RoomCore | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get<RoomData>('room');
      if (data) await this.ensure(data.chatId);
    });
  }

  private deps(): RoomDeps {
    const storage = this.ctx.storage;
    const env = this.env;
    return {
      store: {
        load: () => storage.get<RoomData>('room'),
        save: (d) => storage.put('room', d),
        setAlarm: async (at) => {
          if (at === null) await storage.deleteAlarm();
          else await storage.setAlarm(at);
        },
      },
      registry: lazyRegistry(env),
      telegram: telegram(env),
      clock: Date.now,
      rng: cryptoRng,
      botUsername: () => cachedUsername ?? env.BOT_USERNAME ?? '',
      devFakePlayers: env.DEV_FAKE_PLAYERS === 'true',
      visuals: env.VISUAL_MEDIA !== 'false',
      reportRegistryFailure: () => this.ctx.waitUntil(reportFailure(env, 'registry')),
    };
  }

  private async ensure(chatId: number): Promise<RoomCore> {
    if (!this.core) {
      const core = new RoomCore(chatId, this.deps());
      await core.load();
      this.core = core;
    }
    return this.core;
  }

  /** Worker yagona kirish nuqtasi: chatId + ruxsat etilgan metod nomi. */
  async invoke(chatId: number, method: RoomMethod, args: unknown[]): Promise<unknown> {
    if (!ROOM_METHODS.includes(method)) throw new Error('unknown method');
    if (method === 'forceDeadline' && (this.env.TEST_HOOKS !== 'true' || !this.env.TELEGRAM_API)) throw new Error('forbidden');
    if (!cachedUsername) await botUsername(this.env);
    const core = await this.ensure(chatId);
    const fn = core[method] as (...a: unknown[]) => Promise<unknown> | unknown;
    return fn.apply(core, args);
  }

  async alarm(): Promise<void> {
    if (!this.core) {
      const data = await this.ctx.storage.get<RoomData>('room');
      if (!data) return;
      await this.ensure(data.chatId);
    }
    if (!cachedUsername) await botUsername(this.env);
    try {
      await this.core!.alarm();
    } catch (e) {
      // Cloudflare alarmni o'zi qayta ishga tushiradi; xato jurnalga yoziladi
      this.ctx.waitUntil(reportFailure(this.env, 'alarm'));
      throw e;
    }
  }
}

function roomApi(env: Env, chatId: number): RoomApi {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(String(chatId)));
  return new Proxy({} as RoomApi, {
    // 'then' bo'lmasligi shart: aks holda async funksiyadan qaytganda Proxy "thenable" deb qabul qilinadi
    get: (_t, prop) => (prop === 'then' || typeof prop !== 'string' ? undefined : (...args: unknown[]) => stub.invoke(chatId, prop as RoomMethod, args)),
  });
}

// ───────────────────────────── Worker ─────────────────────────────

/**
 * Keshlar (admin, rate limit, o'yin→chat) isolate davomida saqlanadi.
 * Durable Object stub lari esa har so'rovda yangidan yaratiladi: Workers I/O obyektlarini
 * boshqa so'rov kontekstida ishlatishga ruxsat bermaydi.
 */
const caches = new RouterCaches();
function getRouter(env: Env): Router {
  return new Router(
    {
      tg: telegram(env),
      registry: registryStub(env) as unknown as RegistryApi,
      room: (chatId) => roomApi(env, chatId),
      admins: ownerIds(env),
      devFake: env.DEV_FAKE_PLAYERS === 'true',
      visuals: env.VISUAL_MEDIA !== 'false',
      starsMode: parseStarsMode(env.STARS_MODE),
      botUsername: () => botUsername(env),
      now: Date.now,
    },
    caches,
  );
}

/** Registry stubini har chaqiruvda yangidan oladi (DO ichida ham xavfsiz). */
function lazyRegistry(env: Env) {
  return new Proxy({} as ReturnType<typeof registryStub>, {
    get: (_t, prop) => {
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      return (...args: unknown[]) => (registryStub(env) as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!(...args);
    },
  });
}

async function setup(env: Env, origin: string): Promise<Response> {
  const tg = telegram(env);
  const me = await tg.call<{ username: string }>('getMe');
  const url = `${origin}/telegram/webhook`;
  await tg.call('setWebhook', {
    url,
    secret_token: await webhookSecret(env.BOT_TOKEN),
    // pre_checkout_query — Telegram Stars to'lovini tasdiqlash uchun
    allowed_updates: ['message', 'callback_query', 'my_chat_member', 'pre_checkout_query'],
    max_connections: 40,
  });
  await tg.call('setMyDescription', { description: t('bot.description') });
  await tg.call('setMyShortDescription', { short_description: t('bot.short_description') });
  await tg.call('setMyCommands', {
    scope: { type: 'all_private_chats' },
    commands: [
      { command: 'start', description: 'Bosh menyu' },
      { command: 'profile', description: 'Mening profilim' },
      { command: 'hero', description: 'Mening shaxsiy geroyim' },
      { command: 'herotop', description: 'Geroylar TOP 10' },
      { command: 'history', description: 'Oxirgi 10 o‘yin' },
      { command: 'rating', description: 'Umumiy reyting' },
      { command: 'weekly', description: 'Haftalik TOP 10' },
      { command: 'monthly', description: 'Oylik TOP 10' },
      { command: 'daily', description: 'Kunlik mukofot va vazifalar' },
      { command: 'shop', description: 'Do‘kon' },
      { command: 'vip', description: 'VIP obuna' },
      { command: 'invite', description: 'Do‘stlarni taklif qilish' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'roles', description: 'Rollar' },
      { command: 'characters', description: 'Personajlar katalogi' },
      { command: 'intro', description: 'Hypernova animatsiyasi' },
      { command: 'guide', description: 'Boshlovchilar qo‘llanmasi' },
      { command: 'help', description: 'Yordam' },
      { command: 'support', description: 'Yordam so‘rash' },
      { command: 'paysupport', description: 'To‘lov bo‘yicha yordam' },
      { command: 'privacy', description: 'Maxfiylik' },
    ],
  });
  await tg.call('setMyCommands', {
    scope: { type: 'all_group_chats' },
    commands: [
      { command: 'game', description: 'Yangi o‘yin yaratish' },
      { command: 'quick', description: 'Tezkor, reytingsiz o‘yin' },
      { command: 'join', description: 'O‘yinga qo‘shilish' },
      { command: 'leave', description: 'O‘yindan chiqish' },
      { command: 'players', description: 'Ishtirokchilar' },
      { command: 'startgame', description: 'O‘yinni boshlash (admin)' },
      { command: 'status', description: 'O‘yin holati' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'mystats', description: 'Mening statistikam' },
      { command: 'top', description: 'Guruh TOP 20 — barcha vaqt' },
      { command: 'top1', description: 'Guruh TOP 20 — 24 soat' },
      { command: 'top7', description: 'Guruh TOP 20 — 7 kun' },
      { command: 'top30', description: 'Guruh TOP 20 — 30 kun' },
      { command: 'stop', description: 'O‘yinni to‘xtatish (admin)' },
      { command: 'settings', description: 'Guruh sozlamalari (admin)' },
    ],
  });
  const info = await tg.call<{ url: string; pending_update_count: number }>('getWebhookInfo');
  return Response.json({ ok: true, username: me.username, webhook: info.url, pending: info.pending_update_count });
}

/** Production tekshiruvi: Registry (SQLite), GameRoom (Durable Object), Telegram webhook. */
async function diag(env: Env): Promise<Response> {
  const out: Record<string, unknown> = {};
  let ok = true;
  try {
    const reg = registryStub(env);
    out['registry'] = { ok: true, ...(await reg.stats()) };
    out['security'] = await reg.securityStats();
    out['recovery'] = await reg.recoveryStatus();
    out['errors'] = await reg.recentErrors();
  } catch (e) {
    ok = false;
    out['registry'] = { ok: false, error: (e as Error).message };
  }
  try {
    const snap = await roomApi(env, 0).silenceSnapshot();
    out['room'] = { ok: true, running: snap.running };
  } catch (e) {
    ok = false;
    out['room'] = { ok: false, error: (e as Error).message };
  }
  try {
    const info = await telegram(env).call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>('getWebhookInfo');
    const webhookOk = info.url.endsWith('/telegram/webhook');
    ok &&= webhookOk;
    out['webhook'] = { ok: webhookOk, url: info.url, pending: info.pending_update_count, lastError: info.last_error_message ?? null, lastErrorDate: info.last_error_date ?? null };
  } catch (e) {
    ok = false;
    out['webhook'] = { ok: false, error: (e as Error).message };
  }
  out['ok'] = ok;
  return Response.json(out, { status: ok ? 200 : 500 });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.BOT_TOKEN) return;
    const reg = registryStub(env);
    try {
      const info = await telegram(env).call<{ url: string; pending_update_count: number; last_error_date?: number }>('getWebhookInfo');
      if (!info.url.endsWith('/telegram/webhook') || info.pending_update_count >= 100 || (info.pending_update_count > 0 && (info.last_error_date ?? 0) * 1000 > Date.now() - 15 * 60_000)) {
        await reportFailure(env, 'webhook');
      }
    } catch {
      await reportFailure(env, 'webhook');
    }
    try {
      await reconcileRefunds(telegram(env), await reg.pendingRefunds(), (charge) => reg.markRefunded(charge, 'telegram-reconcile'));
    } catch {
      await reportFailure(env, 'registry');
    }
    // PITR is a native Cloudflare capability, not a separate backup. It is unavailable in local dev.
    if (!env.TELEGRAM_API) {
      try { await reg.recoveryCheckpoint(); } catch { await reportFailure(env, 'registry'); }
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return Response.json({ status: 'ok', bot: env.BOT_TOKEN ? 'configured' : 'missing-token' });
    }
    if (!env.BOT_TOKEN) return new Response('BOT_TOKEN missing', { status: 503 });

    if (request.method === 'POST' && url.pathname === '/telegram/setup') {
      if (request.headers.get('x-setup-key') !== (await setupKey(env.BOT_TOKEN))) return new Response('forbidden', { status: 403 });
      try {
        return await setup(env, url.origin);
      } catch (e) {
        return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/telegram/diag') {
      if (request.headers.get('x-setup-key') !== (await setupKey(env.BOT_TOKEN))) return new Response('forbidden', { status: 403 });
      return diag(env);
    }

    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      if (request.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(env.BOT_TOKEN))) {
        return new Response('forbidden', { status: 403 });
      }
      const parsed = await readTelegramUpdate(request);
      if (!parsed.ok) return new Response('bad request', { status: parsed.status });
      const update = parsed.update;
      // Payments retain their charge-level idempotency and must never be dropped by spam limits.
      const payment = Boolean(update.message?.successful_payment || update.message?.refunded_payment);
      const actor = update.callback_query?.from ?? (update.message?.text?.startsWith('/') ? update.message.from : undefined);
      const msg = update.message;
      const anonymousGroupId = msg && msg.text?.startsWith('/') && (msg.chat.type === 'group' || msg.chat.type === 'supergroup') && msg.sender_chat?.id === msg.chat.id && (msg.sender_chat.type === 'group' || msg.sender_chat.type === 'supergroup') ? msg.chat.id : null;
      // Negative chat IDs form a separate rate-limit namespace for anonymous administrators.
      const actorId = anonymousGroupId ?? (actor && !actor.is_bot ? actor.id : null);
      const guarded = !payment && !update.pre_checkout_query && actorId !== null;
      if (guarded && actorId !== null) {
        try {
          const admission = await registryStub(env).beginUpdate(update.update_id, actorId);
          if (admission === 'BUSY') return new Response('retry', { status: 503 });
          if (admission === 'RATE_LIMITED') {
            // Do not amplify a flood with a Telegram API request per rejected click.
            return new Response('ok');
          }
          if (admission !== 'ALLOW') return new Response('ok');
        } catch {
          ctx.waitUntil(reportFailure(env, 'registry'));
          return new Response('retry', { status: 503 });
        }
      }
      try {
        await getRouter(env).handle(update);
        if (guarded) await registryStub(env).finishUpdate(update.update_id, true);
      } catch {
        ctx.waitUntil(reportFailure(env, 'webhook'));
        if (guarded) await registryStub(env).finishUpdate(update.update_id, false).catch(() => undefined);
        if (payment) return new Response('retry payment', { status: 503 });
      }
      return new Response('ok');
    }

    if (env.TEST_HOOKS === 'true' && env.TELEGRAM_API && request.method === 'POST' && url.pathname === '/__test/force') {
      if (request.headers.get('x-setup-key') !== (await setupKey(env.BOT_TOKEN))) return new Response('forbidden', { status: 403 });
      const chatId = Number(url.searchParams.get('chat'));
      if (!Number.isSafeInteger(chatId) || chatId === 0) return new Response('bad request', { status: 400 });
      await (roomApi(env, chatId) as RoomApi & { forceDeadline(): Promise<void> }).forceDeadline();
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
