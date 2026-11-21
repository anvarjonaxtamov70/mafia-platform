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
import { cryptoRng } from '@mafia/game-engine';
import { t } from '@mafia/localization';
import { RegistryCore, type Sql, type TgUserInput } from './registry-core';
import { RoomCore, type RoomData, type RoomDeps } from './room-core';
import { Router, RouterCaches, type RoomApi, type RegistryApi, type TgUpdate } from './router';
import { setupKey, TelegramClient, webhookSecret, type Telegram } from './telegram';

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  REGISTRY: DurableObjectNamespace<Registry>;
  BOT_TOKEN: string;
  ADMIN_IDS?: string;
  BOT_USERNAME?: string;
  DEV_FAKE_PLAYERS?: string;
  /** Faqat testlar: soxta Telegram API manzili */
  TELEGRAM_API?: string;
  /** Faqat testlar: /__test/* yo'llari */
  TEST_HOOKS?: string;
}

function telegram(env: Env): Telegram {
  return new TelegramClient(env.BOT_TOKEN, env.TELEGRAM_API || 'https://api.telegram.org');
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
    const sql: Sql = { exec: (q, ...p) => ctx.storage.sql.exec(q, ...p).toArray() as never };
    this.core = new RegistryCore(sql);
    void ctx.blockConcurrencyWhile(async () => this.core.migrate());
  }

  upsertUser(u: TgUserInput, dmOpened: boolean) {
    return this.core.upsertUser(u, dmOpened);
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
  globalRating(tgId: number | null) {
    return this.core.globalRating(tgId);
  }
  groupLeaderboard(chatId: number) {
    return this.core.groupLeaderboard(chatId);
  }
  adminStats() {
    return this.core.adminStats();
  }
  stats() {
    return this.core.stats();
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
  'join',
  'leave',
  'start',
  'cancel',
  'devFill',
  'nightAction',
  'skip',
  'mafiaVote',
  'dayVote',
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
    if (method === 'forceDeadline' && this.env.TEST_HOOKS !== 'true') throw new Error('forbidden');
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
    await this.core!.alarm();
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
      admins: new Set((env.ADMIN_IDS ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0)),
      devFake: env.DEV_FAKE_PLAYERS === 'true',
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
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    max_connections: 40,
  });
  await tg.call('setMyDescription', { description: t('bot.description') });
  await tg.call('setMyShortDescription', { short_description: t('bot.short_description') });
  await tg.call('setMyCommands', {
    scope: { type: 'all_private_chats' },
    commands: [
      { command: 'start', description: 'Bosh menyu' },
      { command: 'profile', description: 'Mening profilim' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'roles', description: 'Rollar' },
      { command: 'help', description: 'Yordam' },
      { command: 'privacy', description: 'Maxfiylik' },
    ],
  });
  await tg.call('setMyCommands', {
    scope: { type: 'all_group_chats' },
    commands: [
      { command: 'game', description: 'Yangi o‘yin yaratish' },
      { command: 'join', description: 'O‘yinga qo‘shilish' },
      { command: 'leave', description: 'O‘yindan chiqish' },
      { command: 'players', description: 'Ishtirokchilar' },
      { command: 'gstart', description: 'O‘yinni boshlash' },
      { command: 'status', description: 'O‘yin holati' },
      { command: 'rules', description: 'Qoidalar' },
      { command: 'mystats', description: 'Mening statistikam' },
      { command: 'leaderboard', description: 'Guruh reytingi' },
      { command: 'cancelgame', description: 'O‘yinni bekor qilish' },
      { command: 'settings', description: 'Guruh sozlamalari' },
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
    out['registry'] = { ok: true, ...(await registryStub(env).stats()) };
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response('bad request', { status: 400 });
      }
      try {
        await getRouter(env).handle(update);
      } catch (e) {
        // Telegram qayta-qayta yubormasligi uchun 200; xato Cloudflare loglarida ko'rinadi
        console.error('update failed', update.update_id, (e as Error).message);
      }
      return new Response('ok');
    }

    if (env.TEST_HOOKS === 'true' && request.method === 'POST' && url.pathname === '/__test/force') {
      const chatId = Number(url.searchParams.get('chat'));
      await (roomApi(env, chatId) as RoomApi & { forceDeadline(): Promise<void> }).forceDeadline();
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
