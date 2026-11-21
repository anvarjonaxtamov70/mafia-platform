/**
 * Test muhiti: Durable Object'larsiz, lekin bir xil mantiq — RoomCore / RegistryCore / Router
 * node:sqlite, xotiradagi storage va soxta Telegram API bilan.
 */
import { DatabaseSync } from 'node:sqlite';
import { seededRng } from '@mafia/game-engine';
import { RegistryCore, type Sql } from '../registry-core';
import { RoomCore, type RegistryPort, type RoomData, type RoomStore } from '../room-core';
import { Router, type RegistryApi, type RoomApi, type TgUpdate } from '../router';
import { TgError, type Telegram } from '../telegram';

export function sqliteSql(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(query: string, ...params: (string | number | null)[]): T[] {
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|INSERT[\s\S]*RETURNING|WITH)/i.test(query)) return stmt.all(...params) as T[];
      stmt.run(...params);
      return [];
    },
  };
}

export interface Call {
  method: string;
  params: Record<string, unknown>;
}

export class FakeTelegram implements Telegram {
  calls: Call[] = [];
  admins = new Set<number>();
  blocked = new Set<number>();
  failNext: TgError | null = null;
  private nextId = 1;

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const chat = Number(params['chat_id']);
    if ((method === 'sendMessage' || method === 'sendChatAction') && this.blocked.has(chat)) {
      throw new TgError(403, 'Forbidden: bot was blocked by the user');
    }
    let result: unknown = true;
    if (method === 'sendMessage') result = { message_id: this.nextId++ };
    if (method === 'getChatMember') result = { status: this.admins.has(Number(params['user_id'])) ? 'administrator' : 'member' };
    if (method === 'getMe') result = { username: 'test_mafia_bot' };
    return result as T;
  }

  sent(chatId?: number): Call[] {
    return this.calls.filter((c) => c.method === 'sendMessage' && (chatId === undefined || Number(c.params['chat_id']) === chatId));
  }

  texts(chatId?: number): string[] {
    return this.sent(chatId).map((c) => String(c.params['text']));
  }
}

export class MemStore implements RoomStore {
  data: RoomData | undefined;
  alarm: number | null = null;
  saves = 0;
  async load() {
    return this.data ? structuredClone(this.data) : undefined;
  }
  async save(d: RoomData) {
    this.saves++;
    this.data = structuredClone(d);
  }
  async setAlarm(at: number | null) {
    this.alarm = at;
  }
}

/** RPC ni simulyatsiya: har bir chaqiruv asinxron va natija nusxa (structured clone). */
export function rpc<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const v = (obj as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => structuredClone(await (v as (...a: unknown[]) => unknown).apply(obj, structuredClone(args)));
    },
  });
}

export class World {
  now = 1_800_000_000_000;
  tg = new FakeTelegram();
  registryCore: RegistryCore;
  registry: RegistryPort & RegistryApi;
  stores = new Map<number, MemStore>();
  rooms = new Map<number, RoomCore>();
  router: Router;
  rng = seededRng(5);
  devFake = false;
  admins = new Set<number>([1]);

  constructor(opts: { devFake?: boolean } = {}) {
    this.devFake = !!opts.devFake;
    this.registryCore = new RegistryCore(sqliteSql(), () => this.now);
    this.registryCore.migrate();
    this.registry = rpc(this.registryCore) as unknown as RegistryPort & RegistryApi;
    this.router = new Router({
      tg: this.tg,
      registry: this.registry,
      room: (chatId) => this.roomApi(chatId),
      admins: this.admins,
      devFake: this.devFake,
      botUsername: async () => 'test_mafia_bot',
      now: () => this.now,
    });
  }

  roomCore(chatId: number): RoomCore {
    let core = this.rooms.get(chatId);
    if (!core) {
      let store = this.stores.get(chatId);
      if (!store) {
        store = new MemStore();
        this.stores.set(chatId, store);
      }
      core = new RoomCore(chatId, {
        store,
        registry: this.registry,
        telegram: this.tg,
        clock: () => this.now,
        rng: this.rng,
        botUsername: () => 'test_mafia_bot',
        devFakePlayers: this.devFake,
      });
      this.rooms.set(chatId, core);
    }
    return core;
  }

  async loaded(chatId: number): Promise<RoomCore> {
    const core = this.roomCore(chatId);
    if (!core.data) await core.load();
    return core;
  }

  roomApi(chatId: number): RoomApi {
    return new Proxy({} as RoomApi, {
      get: (_t, prop) =>
        prop === 'then' || typeof prop !== 'string'
          ? undefined
          : async (...args: unknown[]) => {
        const core = await this.loaded(chatId);
              const fn = (core as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!;
              return structuredClone(await fn.apply(core, structuredClone(args)));
            },
    });
  }

  /** DO "restart": xotiradagi obyekt yo'qoladi, storage qoladi */
  restart(chatId: number): void {
    this.rooms.delete(chatId);
  }

  /** Muddati yetgan alarmlarni bajarish (Cloudflare alarm o'rniga) */
  async runAlarms(maxRounds = 50): Promise<number> {
    let fired = 0;
    for (let i = 0; i < maxRounds; i++) {
      const due = [...this.stores.entries()].filter(([, s]) => s.alarm !== null && s.alarm <= this.now);
      if (due.length === 0) break;
      for (const [chatId, store] of due) {
        store.alarm = null;
        const core = await this.loaded(chatId);
        await core.alarm();
        fired++;
      }
    }
    return fired;
  }

  /** Vaqtni oldinga surib, alarmlarni bajarish */
  async advance(ms: number): Promise<void> {
    this.now += ms;
    await this.runAlarms();
  }

  async send(update: Omit<TgUpdate, 'update_id'>): Promise<void> {
    await this.router.handle({ update_id: Math.floor(Math.random() * 1e9), ...update });
    await this.runAlarms();
  }
}

let msgId = 1;
export const user = (id: number) => ({ id, is_bot: false, first_name: `U${id}`, username: `u${id}` });
export const GROUP = -1009990001;

export function privateText(from: number, text: string): Omit<TgUpdate, 'update_id'> {
  return { message: { message_id: msgId++, chat: { id: from, type: 'private' }, from: user(from), text } };
}

export function groupText(from: number, text: string, chatId = GROUP): Omit<TgUpdate, 'update_id'> {
  return { message: { message_id: msgId++, chat: { id: chatId, type: 'supergroup', title: 'Mafia guruh' }, from: user(from), text } };
}

export function callback(from: number, data: string, chatId?: number): Omit<TgUpdate, 'update_id'> {
  const chat = chatId !== undefined ? { id: chatId, type: 'supergroup' as const, title: 'Mafia guruh' } : { id: from, type: 'private' as const };
  return { callback_query: { id: String(msgId++), from: user(from), data, message: { message_id: 77, chat } } };
}
