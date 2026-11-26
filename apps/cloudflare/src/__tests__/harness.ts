/**
 * Test muhiti: Durable Object'larsiz, lekin bir xil mantiq — RoomCore / RegistryCore / Router
 * node:sqlite, xotiradagi storage va soxta Telegram API bilan.
 */
import { DatabaseSync } from 'node:sqlite';
import { seededRng } from '@mafia/game-engine';
import { RegistryCore, type Sql } from '../registry-core';
import { RoomCore, type RegistryPort, type RoomData, type RoomStore, type V2SettlementPort } from '../room-core';
import { Router, type RegistryApi, type RoomApi, type TgUpdate } from '../router';
import { reentrantTx } from '../sql';
import { TgError, type Telegram } from '../telegram';
import type { StarsMode } from '@mafia/bot-core';

export function sqliteSql(): Sql {
  const db = new DatabaseSync(':memory:');
  // Durable Object SQLite ham tayyorlangan so'rovlarni keshlaydi
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  return {
    exec<T>(query: string, ...params: (string | number | null)[]): T[] {
      let stmt = cache.get(query);
      if (!stmt) {
        stmt = db.prepare(query);
        cache.set(query, stmt);
      }
      if (/\bRETURNING\b/i.test(query) || /^\s*(SELECT|WITH|PRAGMA)/i.test(query)) return stmt.all(...params) as T[];
      stmt.run(...params);
      return [];
    },
    // Durable Object transactionSync bilan bir xil: xato bo'lsa ROLLBACK
    tx: reentrantTx(<T>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }),
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
    if (method === 'sendMessage' || method === 'sendInvoice' || method === 'sendPhoto' || method === 'sendAnimation') result = { message_id: this.nextId++ };
    if (method === 'getChatMember') result = { status: this.admins.has(Number(params['user_id'])) ? 'administrator' : 'member' };
    if (method === 'getChatAdministrators') result = [...this.admins].map(id => ({ user: { id }, status: 'administrator' }));
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
export function rpc<T extends object>(target: T, fallback?: object): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'then') return undefined;
      let self: object = obj;
      let v = (obj as Record<string | symbol, unknown>)[prop];
      // Registry DO iqtisodiyot metodlarini core.eco ga yo'naltiradi (index.ts dagi kabi)
      if (v === undefined && fallback) {
        self = fallback;
        v = (fallback as Record<string | symbol, unknown>)[prop];
      }
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => structuredClone(await (v as (...a: unknown[]) => unknown).apply(self, structuredClone(args)));
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
  visuals = false;
  v2Settlement:V2SettlementPort|undefined;
  admins = new Set<number>([1]);

  starsMode: StarsMode;

  constructor(opts: { devFake?: boolean; starsMode?: StarsMode; ownerBenefits?: boolean; visuals?: boolean; v2Preview?: boolean; v2Ledger?:boolean; v2SettingsMode?:boolean } = {}) {
    this.devFake = !!opts.devFake;
    this.visuals = !!opts.visuals;
    this.starsMode = opts.starsMode ?? 'admins';
    this.registryCore = new RegistryCore(sqliteSql(), () => this.now, opts.ownerBenefits ? this.admins : undefined);
    this.registryCore.migrate();
    if(opts.v2Ledger)this.v2Settlement={
      snapshots:async ids=>Object.fromEntries(ids.flatMap(id=>{const h=this.registryCore.heroV2.view(id);return h?[[String(id),{defense:h.defense,charges:h.charges,damage:h.damage}]]:[];})),
      settleNight:async (game,round,debits)=>this.registryCore.roleV2Economy.settleGrenchBatch(game,round,debits),
      settleHero:async request=>this.registryCore.heroV2.settleShot(request),
      settleDawn:async (game,round,actions)=>this.registryCore.roleV2Economy.settleDawn(game,round,actions),
      buyOffer:async (game,attempt,buyer,offer,code)=>this.registryCore.roleV2Economy.settleOfferPurchase(game,attempt,buyer,offer,code),
      markRunning:async (game,chatId,ids,allowItems)=>this.registryCore.markV2Running(game,chatId,ids,allowItems),
      recordResult:async input=>this.registryCore.recordV2Game(input),
    };
    this.registry = rpc(this.registryCore, this.registryCore.eco) as unknown as RegistryPort & RegistryApi;
    this.router = new Router({
      tg: this.tg,
      registry: this.registry,
      room: (chatId) => this.roomApi(chatId),
      admins: this.admins,
      devFake: this.devFake,
      v2Preview: !!opts.v2Preview,
      v2SettingsMode: !!opts.v2SettingsMode,
      ...(opts.v2Ledger?{heroV2Shop:{top:async()=>this.registryCore.heroV2.top(),view:async id=>this.registryCore.heroV2.view(id),quote:async (id,op,arg)=>this.registryCore.heroV2.quote(id,op,arg),confirm:async (id,quoteId)=>this.registryCore.heroV2.confirm(id,quoteId),cancel:async (id,quoteId)=>this.registryCore.heroV2.cancel(id,quoteId)}}:{}),
      visuals: this.visuals,
      starsMode: this.starsMode,
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
        visuals: this.visuals,
        ...(this.v2Settlement?{v2Settlement:this.v2Settlement}:{}),
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

export function callback(from: number, data: string, chatId?: number, messageId=77): Omit<TgUpdate, 'update_id'> {
  const chat = chatId !== undefined ? { id: chatId, type: 'supergroup' as const, title: 'Mafia guruh' } : { id: from, type: 'private' as const };
  return { callback_query: { id: String(msgId++), from: user(from), data, message: { message_id: messageId, chat } } };
}

// ───────────────────────────── O'yin yordamchilari ─────────────────────────────

/** Har o'yinchi /start bosadi, birinchisi admin sifatida /game (ixtiyoriy rejim), qolganlar tugma bilan qo'shiladi */
export async function lobby(w: World, ids: number[], mode = ''): Promise<number> {
  for (const id of ids) await w.send(privateText(id, '/start'));
  w.tg.admins.add(ids[0]!);
  await w.send(groupText(ids[0]!, mode ? `/game ${mode}` : '/game'));
  const core = await w.loaded(GROUP);
  const number = core.data.game!.number;
  for (const id of ids.slice(1)) await w.send(callback(id, `l:j:${number}`, GROUP));
  return number;
}

export function roomState(w: World) {
  return w.rooms.get(GROUP)?.data.game?.state ?? null;
}

/** Shahar uchun ochiq o'yin: Mafia hujum qilmaydi, hamma Mafiaga ovoz beradi */
export async function playToEnd(w: World, number: number): Promise<void> {
  for (let step = 0; step < 200; step++) {
    const s = roomState(w);
    if (!s) return;
    const alive = s.players.filter((p) => p.status === 'ALIVE');
    if (s.phase === 'NIGHT') {
      for (const p of alive) {
        const id = Number(p.id);
        if (p.faction === 'MAFIA') await w.send(callback(id, `mv:${number}:${s.phaseSeq}:0`));
        await w.send(callback(id, `a:${number}:${s.phaseSeq}:SKIP`));
      }
    } else if (s.phase === 'DAY_VOTING') {
      const mafia = alive.find((p) => p.faction === 'MAFIA')!;
      for (const p of alive) if (p.id !== mafia.id) await w.send(callback(Number(p.id), `v:${number}:${s.phaseSeq}:${mafia.seat}`, GROUP));
    }
    const after = roomState(w);
    if (after && after.phaseSeq === s.phaseSeq) await w.advance((after.phaseEndsAt ?? w.now) - w.now + 1000);
  }
  throw new Error('game did not finish');
}
