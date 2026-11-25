/**
 * RoomCore — bitta Telegram guruhining o'yin xonasi (Durable Object ichida ishlaydi).
 *
 *  - Durable Object bitta oqimli: bitta guruhdagi buyruqlar ketma-ket bajariladi (qulf shart emas).
 *  - Holat, xabarlar navbati (outbox) va kutilayotgan registry amallari bitta yozuvda saqlanadi.
 *  - Bosqich muddati va xabar yuborish DO alarm orqali: restart/ko'chishdan keyin ham davom etadi.
 *  - Bepul tarif: bitta chaqiruvda ≤ 50 subrequest — xabarlar partiyalab yuboriladi.
 */
import {
  REFERRAL,
  mafiaVoteMessage,
  nightActionMessage,
  present,
  renderLobby,
  settingsToConfig,
  targetKeyboard,
  type ConfigSnapshot,
  type GroupSettingsData,
  type Keyboard,
  type LobbyError,
  type OutboxDraft,
  type OutboxPayload,
  type PresentUser,
} from '@mafia/bot-core';
import {
  advancePhase,
  autoplayPlayers,
  availableNightActions,
  canEndPhaseEarly,
  createGame,
  getRole,
  heroAttack,
  judgeVeto,
  leaveGame,
  revealMayor,
  skipNightAction,
  submitDayVote,
  submitMafiaVote,
  submitNightAction,
  type ActionKind,
  type EngineErrorCode,
  type EngineResult,
  type GameEvent,
  type GameMode,
  type GameState,
  type Rng,
} from '@mafia/game-engine';
import { escapeHtml, t } from '@mafia/localization';
import type { ClaimResult, RecordGameInput, RecordResult, UserInfo } from './registry-core';
import { HTML, TgError, type Telegram } from './telegram';
import { sendVisual } from './visuals';

export type { ConfigSnapshot };

// ───────────────────────────── Ma'lumot tiplari ─────────────────────────────

export interface RoomPlayer {
  id: number;
  name: string;
  fake: boolean;
  /** VIP belgisi ('' | '👑' | '💎') — lobbyda ko'rsatiladi */
  badge?: string;
}

export interface RoomGame {
  id: string;
  number: number;
  status: 'LOBBY' | 'RUNNING';
  mode: GameMode;
  config: ConfigSnapshot;
  silenceDead: boolean;
  silenceNight: boolean;
  hostId: number;
  hostName: string;
  deadline: number | null;
  players: RoomPlayer[];
  state: GameState | null;
  version: number;
  createdAt: number;
  startedAt?: number;
  /** Arcade: o'yin boshida band qilingan buyumlar (tgId → bor/yo'q) */
  arcade?: Record<string, { shield: boolean; fakeDocument: boolean; voteShield?: boolean; heroShot?: boolean; heroShield?: boolean }>;
}

export interface OutItem {
  id: number;
  chatId: number;
  payload: OutboxPayload;
  storeRefAs?: string;
  coalesceKey?: string;
  attempts: number;
  notBefore: number;
}

export type PendingOp =
  | { id: number; type: 'record'; input: RecordGameInput }
  | { id: number; type: 'releaseGame'; number: number; status: 'CANCELLED' | 'FINISHED' }
  | { id: number; type: 'release'; tgId: number; number: number }
  | { id: number; type: 'dmBlocked'; tgIds: number[] }
  | { id: number; type: 'running'; number: number; players: number }
  | { id: number; type: 'settleItems'; number: number; used: Record<string, string[]> }
  | { id: number; type: 'releaseItems'; number: number };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface RoomData {
  v: 1;
  chatId: number;
  title: string;
  game: RoomGame | null;
  outbox: OutItem[];
  refs: Record<string, { chatId: number; messageId: number }>;
  ops: PendingOp[];
  opsRetryAt?: number;
  opsFailures?: number;
  nextId: number;
  alarmAt: number | null;
}

export interface RegistryPort {
  allocateGame(chatId: number): Promise<number>;
  claim(tgId: number, chatId: number, number: number): Promise<ClaimResult>;
  release(tgId: number, number: number): Promise<void>;
  releaseGame(number: number, status: 'CANCELLED' | 'FINISHED'): Promise<void>;
  markRunning(number: number, players: number): Promise<void>;
  recordGame(input: RecordGameInput): Promise<RecordResult>;
  reserveArcade(number: number, tgIds: number[]): Promise<Record<string, { shield: boolean; fakeDocument: boolean; voteShield?: boolean; heroShot?: boolean; heroShield?: boolean }>>;
  settleArcade(number: number, used: Record<string, string[]>): Promise<void>;
  releaseArcade(number: number): Promise<void>;
  markDmBlocked(tgIds: number[]): Promise<void>;
  getSettings(chatId: number): Promise<GroupSettingsData>;
}

export interface RoomStore {
  load(): Promise<RoomData | undefined>;
  save(data: RoomData): Promise<void>;
  setAlarm(at: number | null): Promise<void>;
}

export interface RoomDeps {
  store: RoomStore;
  registry: RegistryPort;
  telegram: Telegram;
  clock: () => number;
  rng: Rng;
  botUsername: () => string;
  devFakePlayers: boolean;
  visuals?: boolean;
  reportRegistryFailure?: () => void;
}

export type RoomResult<T = object> = ({ ok: true } & T) | { ok: false; error: LobbyError | EngineErrorCode | 'NOT_FOUND'; details?: Record<string, string | number> };

export interface ViewResult {
  text: string;
  keyboard?: Keyboard;
}

export interface SilenceSnapshot {
  running: boolean;
  phase: string | null;
  players: number[];
  alive: number[];
  silenceDead: boolean;
  silenceNight: boolean;
  until: number;
}

/** Bitta chaqiruvda Telegramga ko'pi bilan shuncha so'rov (bepul tarif: 50 subrequest) */
const SEND_BUDGET = 40;
const FAKE_ID_BASE = 9_000_000_000_000;

function lobbyRef(gameId: string): string {
  return `lobby:${gameId}`;
}

// ───────────────────────────── RoomCore ─────────────────────────────

export class RoomCore {
  data!: RoomData;
  /** Joriy chaqiruvdagi tashqi (Telegram) so'rovlar soni — 50 subrequest limitidan oshmaslik uchun */
  private externalCalls = 0;
  private starting = false;

  constructor(
    private readonly chatId: number,
    private readonly deps: RoomDeps,
  ) {}

  async load(): Promise<void> {
    this.data = (await this.deps.store.load()) ?? {
      v: 1,
      chatId: this.chatId,
      title: '',
      game: null,
      outbox: [],
      refs: {},
      ops: [],
      nextId: 1,
      alarmAt: null,
    };
  }

  private get now(): number {
    return this.deps.clock();
  }

  private async commit(): Promise<void> {
    await this.deps.store.save(this.data);
    await this.reschedule();
  }

  /** Keyingi alarm: navbatdagi xabar / registry amali / bosqich muddati — eng yaqini. */
  private async reschedule(): Promise<void> {
    const g = this.data.game;
    const candidates: number[] = [];
    if (this.data.ops.length > 0) candidates.push(Math.max(this.now, this.data.opsRetryAt ?? 0));
    if (this.data.outbox.length > 0) candidates.push(Math.max(this.now, this.data.outbox[0]!.notBefore));
    if (g?.status === 'LOBBY' && g.deadline) candidates.push(g.deadline);
    if (g?.status === 'RUNNING' && g.state?.phaseEndsAt) candidates.push(g.state.phaseEndsAt);
    const next = candidates.length ? Math.min(...candidates) : null;
    if (next !== this.data.alarmAt) {
      this.data.alarmAt = next;
      await this.deps.store.setAlarm(next);
      await this.deps.store.save(this.data);
    }
  }

  private enqueue(drafts: OutboxDraft[]): void {
    for (const d of drafts) {
      this.data.outbox.push({
        id: this.data.nextId++,
        chatId: Number(d.chatId),
        payload: d.payload,
        ...(d.storeRefAs ? { storeRefAs: d.storeRefAs } : {}),
        ...(d.coalesceKey ? { coalesceKey: d.coalesceKey } : {}),
        attempts: 0,
        notBefore: 0,
      });
    }
  }

  private send(chatId: number, text: string, keyboard?: Keyboard, extra: Partial<OutboxDraft> = {}): void {
    this.enqueue([{ chatId: BigInt(chatId), payload: { kind: 'SEND', text, ...(keyboard ? { keyboard } : {}) }, dedupeKey: '', ...extra }]);
  }

  private addOp(op: DistributiveOmit<PendingOp, 'id'>): void {
    this.data.ops.push({ ...(op as PendingOp), id: this.data.nextId++ });
  }

  private users(g: RoomGame): Map<string, PresentUser> {
    return new Map(g.players.map((p) => [String(p.id), { telegramId: BigInt(p.id), isFake: p.fake }]));
  }

  private lobbyView(g: RoomGame): ViewResult {
    return renderLobby(
      { number: g.number, mode: g.mode, config: g.config, hostName: g.hostName, deadline: g.deadline },
      g.players.map((p) => (p.badge ? `${p.name} ${p.badge}` : p.name)),
      { now: this.now, botUsername: this.deps.botUsername() },
    );
  }

  private lobbyEdit(g: RoomGame): void {
    const v = this.lobbyView(g);
    this.enqueue([
      {
        chatId: BigInt(this.chatId),
        payload: { kind: 'EDIT', refKey: lobbyRef(g.id), text: v.text, ...(v.keyboard ? { keyboard: v.keyboard } : {}) },
        dedupeKey: '',
        coalesceKey: `lobby:${g.id}`,
      },
    ]);
  }

  // ───────────────────────────── Lobby ─────────────────────────────

  async createLobby(input: { title: string; host: UserInfo; isAdmin: boolean; mode?: GameMode; quick?: boolean }): Promise<RoomResult<{ number: number; hostJoined: boolean }>> {
    if (this.data.game) return { ok: false, error: 'GROUP_ACTIVE_GAME' };
    if (input.host.banned) return { ok: false, error: 'BANNED' };
    if (!input.isAdmin) return { ok: false, error: 'CREATE_FORBIDDEN' };
    const settings = await this.deps.registry.getSettings(this.chatId);
    const number = await this.deps.registry.allocateGame(this.chatId);
    // await davomida boshqa /game kelgan bo'lishi mumkin
    if (this.data.game) {
      await this.deps.registry.releaseGame(number, 'CANCELLED');
      return { ok: false, error: 'GROUP_ACTIVE_GAME' };
    }
    const mode = input.mode ?? settings.mode;
    const config: ConfigSnapshot = { ...settingsToConfig(settings, mode, input.quick), lobby: { lobbySec: settings.lobbySec, autostart: settings.autostart, ...(input.quick ? { quick: true } : {}) } };
    const g: RoomGame = {
      id: `${this.chatId}-${number}`,
      number,
      status: 'LOBBY',
      mode,
      config,
      silenceDead: settings.silenceDead,
      silenceNight: settings.silenceNight,
      hostId: input.host.id,
      hostName: input.host.name,
      deadline: this.now + settings.lobbySec * 1000,
      players: [],
      state: null,
      version: 0,
      createdAt: this.now,
    };
    this.data.game = g;
    if (input.title) this.data.title = input.title;
    let hostJoined = false;
    if (input.host.dmAvailable) {
      const c = await this.deps.registry.claim(input.host.id, this.chatId, number);
      if (this.data.game !== g) {
        if (c === 'OK') await this.deps.registry.release(input.host.id, number);
        return { ok: false, error: 'NOT_FOUND' };
      }
      if (c !== 'BUSY' && !g.players.some((p) => p.id === input.host.id) && g.players.length < g.config.maxPlayers) {
        g.players.push({ id: input.host.id, name: input.host.name, fake: false, badge: input.host.badge });
        hostJoined = true;
      } else if (g.players.some((p) => p.id === input.host.id)) {
        hostJoined = true;
      } else if (c === 'OK') {
        await this.deps.registry.release(input.host.id, number);
      }
    }
    const v = this.lobbyView(g);
    this.send(this.chatId, v.text, v.keyboard, { storeRefAs: lobbyRef(g.id) });
    await this.commit();
    return { ok: true, number, hostJoined };
  }

  async join(user: UserInfo, number?: number): Promise<RoomResult<{ title: string }>> {
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (g.status !== 'LOBBY' || this.starting) return { ok: false, error: 'NOT_LOBBY' };
    if (!user.dmAvailable) return { ok: false, error: 'NEED_DM' };
    if (user.banned) return { ok: false, error: 'BANNED' };
    if (g.players.some((p) => p.id === user.id)) return { ok: false, error: 'ALREADY_JOINED' };
    if (g.players.length >= g.config.maxPlayers) return { ok: false, error: 'FULL' };
    const c = await this.deps.registry.claim(user.id, this.chatId, g.number);
    if (c === 'BUSY') return { ok: false, error: 'IN_OTHER_GAME' };
    // await dan keyin qayta tekshirish
    if (this.data.game !== g || g.status !== 'LOBBY' || this.starting) {
      // ALREADY may belong to another concurrent join; only release our own fresh claim.
      if (c === 'OK') await this.deps.registry.release(user.id, g.number);
      return { ok: false, error: 'NOT_LOBBY' };
    }
    if (g.players.some((p) => p.id === user.id)) return { ok: false, error: 'ALREADY_JOINED' };
    if (g.players.length >= g.config.maxPlayers) {
      if (c === 'OK') await this.deps.registry.release(user.id, g.number);
      return { ok: false, error: 'FULL' };
    }
    g.players.push({ id: user.id, name: user.name, fake: false, badge: user.badge });
    g.version++;
    this.lobbyEdit(g);
    await this.commit();
    return { ok: true, title: this.data.title };
  }

  async leave(tgId: number, number?: number): Promise<RoomResult> {
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (!g.players.some((p) => p.id === tgId)) return { ok: false, error: 'NOT_JOINED' };
    if (g.status === 'LOBBY') {
      if (this.starting) return { ok: false, error: 'NOT_LOBBY' };
      g.players = g.players.filter((p) => p.id !== tgId);
      g.version++;
      this.addOp({ type: 'release', tgId, number: g.number });
      this.lobbyEdit(g);
      await this.commit();
      return { ok: true };
    }
    const r = await this.mutate(tgId, (s, now, rng) => leaveGame(s, String(tgId), now, rng));
    if (r.ok) {
      this.addOp({ type: 'release', tgId, number: g.number });
      await this.commit();
    }
    return r.ok ? { ok: true } : r;
  }

  async devFill(count: number): Promise<RoomResult<{ added: number }>> {
    const g = this.data.game;
    if (!this.deps.devFakePlayers) return { ok: false, error: 'NO_PERMISSION' };
    if (!g || g.status !== 'LOBBY' || this.starting) return { ok: false, error: 'NOT_FOUND' };
    const toAdd = Math.max(0, Math.min(count, g.config.maxPlayers - g.players.length));
    for (let i = 0; i < toAdd; i++) {
      const n = g.players.length + 1;
      g.players.push({ id: FAKE_ID_BASE + g.number * 100 + n, name: `🤖 Bot ${n}`, fake: true });
    }
    g.version++;
    this.lobbyEdit(g);
    await this.commit();
    return { ok: true, added: toAdd };
  }

  /** Rollarni yuborishdan oldin shaxsiy chat ochiqligini tekshirish (§3.5). */
  private async probeDms(ids: number[]): Promise<number[]> {
    const failing: number[] = [];
    for (let i = 0; i < ids.length; i += 6) {
      const batch = ids.slice(i, i + 6);
      const res = await Promise.all(
        batch.map(async (id) => {
          this.externalCalls++;
          try {
            await this.deps.telegram.call('sendChatAction', { chat_id: id, action: 'typing' });
            return null;
          } catch (e) {
            return e instanceof TgError && (e.code === 403 || e.code === 400) ? id : null;
          }
        }),
      );
      for (const r of res) if (r !== null) failing.push(r);
    }
    return failing;
  }

  async start(trigger: { by: number; isAdmin: boolean } | 'auto', number?: number): Promise<RoomResult> {
    if (this.starting) return { ok: false, error: 'NOT_LOBBY' };
    this.starting = true;
    try {
      return await this.startOnce(trigger, number);
    } finally {
      this.starting = false;
    }
  }

  private async startOnce(trigger: { by: number; isAdmin: boolean } | 'auto', number?: number): Promise<RoomResult> {
    if (trigger !== 'auto') this.externalCalls = 0;
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (g.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
    if (trigger !== 'auto' && !trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
    if (g.players.length < g.config.minPlayers) return { ok: false, error: 'NOT_ENOUGH', details: { min: g.config.minPlayers, count: g.players.length } };

    const failing = await this.probeDms(g.players.filter((p) => !p.fake).map((p) => p.id));
    if (this.data.game !== g || g.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
    if (failing.length > 0) {
      const removed = g.players.filter((p) => failing.includes(p.id));
      g.players = g.players.filter((p) => !failing.includes(p.id));
      g.version++;
      for (const p of removed) this.addOp({ type: 'release', tgId: p.id, number: g.number });
      this.addOp({ type: 'dmBlocked', tgIds: failing });
      this.send(this.chatId, t('lobby.dm_failed', { names: removed.map((p) => escapeHtml(p.name)).join(', ') }));
      this.lobbyEdit(g);
      await this.commit();
      return { ok: false, error: 'DM_FAILED', details: { names: removed.map((p) => p.name).join(', ') } };
    }

    // Arcade: yoqilgan buyumlar band qilinadi (har turdan bittadan, §18.1)
    let items: Record<string, { shield: boolean; fakeDocument: boolean; voteShield?: boolean; heroShot?: boolean; heroShield?: boolean }> = {};
    if (g.config.allowArcadeItems) {
      this.externalCalls++;
      items = await this.deps.registry.reserveArcade(
        g.number,
        g.players.filter((p) => !p.fake).map((p) => p.id),
      );
      if (this.data.game !== g || g.status !== 'LOBBY') {
        this.addOp({ type: 'releaseItems', number: g.number });
        await this.commit();
        return { ok: false, error: 'NOT_LOBBY' };
      }
    }

    const now = this.now;
    const { lobby: _lobby, ...config } = g.config;
    void _lobby;
    const created = createGame({
      id: g.id,
      mode: g.mode,
      players: g.players.map((p) => ({ id: String(p.id), name: p.name })),
      config,
      now,
      rng: this.deps.rng,
      items,
    });
    if (!created.ok) {
      if (Object.keys(items).length > 0) {
        this.addOp({ type: 'releaseItems', number: g.number });
        await this.commit();
      }
      return { ok: false, error: 'NOT_ENOUGH', details: { min: g.config.minPlayers, count: g.players.length } };
    }
    if (Object.keys(items).length > 0) {
      g.arcade = items;
      const all = Object.values(items);
      // Buyumlar barcha o'yinchilarga o'yin boshlanishidan oldin ko'rsatiladi (§4.4); kimda ekanligi aytilmaydi
      this.send(this.chatId, t('game.arcade_items', { shields: all.filter((x) => x.shield).length, docs: all.filter((x) => x.fakeDocument).length, votes: all.filter((x) => x.voteShield).length }));
    }
    const fakes = new Set(g.players.filter((p) => p.fake).map((p) => String(p.id)));
    const pp = this.postProcess(created.state, created.events, fakes, -1, now);
    g.status = 'RUNNING';
    g.startedAt = now;
    g.deadline = null;
    this.applyState(g, null, pp.state, pp.events);
    this.enqueue([{ chatId: BigInt(this.chatId), payload: { kind: 'CLEAR_KEYBOARD', refKey: lobbyRef(g.id) }, dedupeKey: '' }]);
    this.addOp({ type: 'running', number: g.number, players: g.players.length });
    await this.commit();
    return { ok: true };
  }

  async cancel(trigger: { by: number; isAdmin: boolean } | 'timeout', text?: string, number?: number): Promise<RoomResult> {
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (trigger !== 'timeout' && !trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
    if (g.status === 'RUNNING' && (trigger === 'timeout' || !trigger.isAdmin)) return { ok: false, error: 'NO_PERMISSION' };
    if (g.status === 'LOBBY') this.enqueue([{ chatId: BigInt(this.chatId), payload: { kind: 'CLEAR_KEYBOARD', refKey: lobbyRef(g.id) }, dedupeKey: '' }]);
    this.send(this.chatId, text ?? (g.status === 'RUNNING' ? t('game.cancelled_admin') : t('lobby.cancelled')));
    this.addOp({ type: 'releaseGame', number: g.number, status: 'CANCELLED' });
    this.data.game = null;
    await this.commit();
    return { ok: true };
  }

  private async lobbyTimeout(): Promise<void> {
    const g = this.data.game;
    if (!g || g.status !== 'LOBBY' || !g.deadline || g.deadline > this.now + 500) return;
    if (this.starting) {
      g.deadline = this.now + 1000;
      await this.commit();
      return;
    }
    if (g.players.length >= g.config.minPlayers) {
      if (!g.config.lobby.autostart) {
        g.deadline = null;
        await this.commit();
        return;
      }
      let r = await this.start('auto');
      if (!r.ok && r.error === 'DM_FAILED') r = await this.start('auto');
      if (r.ok || this.data.game !== g || g.status !== 'LOBBY') return;
    }
    await this.cancel('timeout', t('lobby.timeout_cancelled', { min: g.config.minPlayers }));
  }

  /** Superguruhga ko'chish: eski chatdagi o'yin bekor qilinadi (yangi chatda qayta boshlanadi). */
  async migrate(newChatId: number): Promise<void> {
    const g = this.data.game;
    if (g) {
      this.addOp({ type: 'releaseGame', number: g.number, status: 'CANCELLED' });
      this.data.game = null;
    }
    this.data.outbox = [];
    this.send(newChatId, `${t('group.migrated')}\n${g ? t('lobby.cancelled') : ''}`);
    await this.commit();
  }

  // ───────────────────────────── O'yin ─────────────────────────────

  private postProcess(state: GameState, events: GameEvent[], fakes: ReadonlySet<string>, playedSeq: number, now: number): { state: GameState; events: GameEvent[] } {
    let s = state;
    const out = [...events];
    let played = playedSeq;
    for (let i = 0; i < 30 && s.status === 'RUNNING'; i++) {
      if (fakes.size > 0 && s.phaseSeq !== played) {
        s = autoplayPlayers(s, fakes, this.deps.rng, now);
        played = s.phaseSeq;
      }
      if (!canEndPhaseEarly(s)) break;
      const r = advancePhase(s, now, this.deps.rng);
      if (!r.ok) break;
      s = r.state;
      out.push(...r.events);
    }
    return { state: s, events: out };
  }

  /** Yangi holatni qo'llash: xabarlar navbatga, o'yin tugasa natijalar registryga. */
  private applyState(g: RoomGame, before: GameState | null, state: GameState, events: GameEvent[]): void {
    g.state = state;
    g.version++;
    const drafts = present({
      game: { id: g.id, number: g.number, chatId: BigInt(this.chatId) },
      version: g.version,
      state,
      events,
      users: this.users(g),
      prevPhaseSeq: before?.phaseSeq ?? 0,
      visuals: !!this.deps.visuals,
    });
    this.enqueue(drafts);
    // Cosmetic group banners follow critical text. Never put role-specific art in a group.
    if (this.deps.visuals) {
      const ended = events.some((e) => e.type === 'GAME_ENDED');
      const started = events.some((e) => e.type === 'GAME_STARTED');
      const visual = ended && state.result ? 'game_' + state.result.outcome.toLowerCase() : started ? 'game_start' : null;
      if (visual) this.enqueue([{ chatId: BigInt(this.chatId), payload: { kind: 'SEND', text: '', visual }, dedupeKey: '' }]);
    }
    if (state.status === 'FINISHED' && state.result) {
      const byId = new Map(g.players.map((p) => [String(p.id), p]));
      if (g.arcade && Object.keys(g.arcade).length > 0) {
        // Ishlatilgan buyum sarflanadi, ishlatilmagani inventarga qaytadi
        const used: Record<string, string[]> = {};
        for (const [id, had] of Object.entries(g.arcade)) {
          const fin = state.players.find((p) => p.id === id)?.items;
          const list: string[] = [];
          if (had.shield && fin && !fin.shield) list.push('SHIELD');
          if (had.fakeDocument && fin && !fin.fakeDocument) list.push('FAKE_DOC');
          if (had.voteShield && fin && !fin.voteShield) list.push('VOTE_SHIELD');
          if (had.heroShield && fin && !fin.heroShield) list.push('HERO_SHIELD');
          if (list.length) used[id] = list;
        }
        this.addOp({ type: 'settleItems', number: g.number, used });
      }
      this.addOp({
        type: 'record',
        input: {
          gameId: g.id,
          number: g.number,
          chatId: this.chatId,
          ranked: state.config.ranked && !g.players.some((p) => p.fake),
          practice: g.players.some((p) => p.fake),
          outcome: state.result.outcome,
          days: state.dayNumber,
          rewardVersion: 1,
          completedAt: state.result.finishedAt,
          durationMs: Math.max(0, state.result.finishedAt - (g.startedAt ?? state.result.finishedAt)),
          players: state.result.players.map((r) => {
            const sp = state.players.find((x) => x.id === r.playerId)!;
            const rp = byId.get(r.playerId)!;
            return {
              tgId: rp.id,
              name: rp.name,
              role: r.role,
              faction: r.faction,
              outcome: r.outcome,
              survived: r.survived,
              left: r.left,
              active: sp.missedVotes === 0 && sp.missedActions === 0,
              afk: sp.afkPenalized === true,
              missed: sp.missedVotes + sp.missedActions,
              fake: rp.fake,
              ...(rp.badge ? { badge: rp.badge } : {}),
            };
          }),
        },
      });
      // Eski tugmalar ishlamasligi uchun xona bo'shatiladi (natijalar registryga yoziladi)
      delete this.data.refs[lobbyRef(g.id)];
      for (const k of Object.keys(this.data.refs)) if (k.includes(g.id)) delete this.data.refs[k];
      this.data.game = null;
    }
  }

  private async mutate(tgId: number | null, fn: (s: GameState, now: number, rng: Rng) => EngineResult): Promise<RoomResult<{ state: GameState }>> {
    const g = this.data.game;
    if (!g || g.status !== 'RUNNING' || !g.state) return { ok: false, error: 'GAME_FINISHED' };
    if (tgId !== null && !g.players.some((p) => p.id === tgId)) return { ok: false, error: 'NOT_A_PLAYER' };
    const before = g.state;
    const now = this.now;
    const r = fn(before, now, this.deps.rng);
    if (!r.ok) return { ok: false, error: r.error };
    const fakes = new Set(g.players.filter((p) => p.fake).map((p) => String(p.id)));
    const pp = this.postProcess(r.state, r.events, fakes, before.phaseSeq, now);
    this.applyState(g, before, pp.state, pp.events);
    await this.commit();
    return { ok: true, state: pp.state };
  }

  private seatToId(s: GameState, seat: number): string | null {
    return s.players.find((p) => p.seat === seat)?.id ?? null;
  }

  private checkGame(number: number): RoomGame | null {
    const g = this.data.game;
    // A delayed alarm must not let old buttons mutate an already-expired phase.
    return g && g.number === number && g.status === 'RUNNING' && g.state && (g.state.phaseEndsAt === null || g.state.phaseEndsAt > this.now) ? g : null;
  }

  /** Tungi harakat tugmasi: nishon yetarli bo'lmasa keyingi tanlov klaviaturasi qaytariladi. */
  async nightAction(input: { tgId: number; number: number; seq: number; kind: ActionKind; seats: number[] }): Promise<RoomResult<ViewResult>> {
    const g = this.checkGame(input.number);
    const s = g?.state;
    if (!g || !s || s.phaseSeq !== input.seq) return { ok: false, error: 'STALE_PHASE' };
    const me = s.players.find((p) => p.id === String(input.tgId));
    if (!me) return { ok: false, error: 'NOT_A_PLAYER' };
    const spec = availableNightActions(s, me).find((x) => x.kind === input.kind);
    if (!spec) return { ok: false, error: 'WRONG_PHASE' };
    const emoji = getRole(me.role).emoji;
    const role = t(`role.${me.role}.name`);
    if (input.seats.length < spec.targets.count) {
      const first = input.seats[0] ? s.players.find((p) => p.seat === input.seats[0]) : undefined;
      const text = first
        ? t('dm.night_second', { emoji, role, first: escapeHtml(first.name) })
        : t('dm.night_prompt', { emoji, role, prompt: t(`role.${me.role}.prompt`) || t(`action.${input.kind}`) });
      return { ok: true, text, keyboard: targetKeyboard(s, me, input.number, input.kind, input.seats) };
    }
    const targetIds = input.seats.map((x) => this.seatToId(s, x));
    if (targetIds.some((x) => x === null)) return { ok: false, error: 'INVALID_TARGET' };
    const r = await this.mutate(input.tgId, (st, now) => submitNightAction(st, { actorId: me.id, kind: input.kind, targetIds: targetIds as string[], now, phaseSeq: input.seq }));
    if (!r.ok) return r;
    const names = input.seats.map((x) => s.players.find((p) => p.seat === x)?.name ?? '?');
    const accepted = spec.targets.self === 'only' ? t('dm.accepted_self') : t('dm.accepted', { target: escapeHtml(names.join(', ')) });
    return { ok: true, ...this.afterNightView(r.state, input.tgId, input.number, input.seq, accepted) };
  }

  private afterNightView(state: GameState, tgId: number, number: number, seq: number, acceptedText: string): ViewResult {
    const me = state.players.find((p) => p.id === String(tgId));
    const head = me ? `${getRole(me.role).emoji} <b>${t(`role.${me.role}.name`)}</b>\n\n` : '';
    const still = me && state.status === 'RUNNING' && state.phase === 'NIGHT' && state.phaseSeq === seq;
    const view = still ? nightActionMessage(state, me, number) : null;
    return { text: head + acceptedText, ...(view ? { keyboard: view.keyboard } : {}) };
  }

  async skip(input: { tgId: number; number: number; seq: number }): Promise<RoomResult<ViewResult>> {
    if (!this.checkGame(input.number)) return { ok: false, error: 'STALE_PHASE' };
    const r = await this.mutate(input.tgId, (s) => skipNightAction(s, String(input.tgId), input.seq));
    if (!r.ok) return r;
    return { ok: true, ...this.afterNightView(r.state, input.tgId, input.number, input.seq, t('dm.skipped')) };
  }

  async mafiaVote(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<ViewResult>> {
    const g = this.checkGame(input.number);
    if (!g || !g.state) return { ok: false, error: 'STALE_PHASE' };
    const target = input.seat === 0 ? null : this.seatToId(g.state, input.seat);
    if (input.seat !== 0 && !target) return { ok: false, error: 'INVALID_TARGET' };
    const r = await this.mutate(input.tgId, (s) => submitMafiaVote(s, String(input.tgId), target, input.seq));
    if (!r.ok) return r;
    const st = r.state;
    const voterName = st.players.find((p) => p.id === String(input.tgId))?.name ?? '';
    const tName = target ? st.players.find((p) => p.id === target)?.name ?? '' : '';
    const still = st.status === 'RUNNING' && st.phase === 'NIGHT' && st.phaseSeq === input.seq;
    const mv = mafiaVoteMessage(st, input.number);
    const text = `${mv.text}\n\n${target ? t('dm.mafia_voted', { target: escapeHtml(tName) }) : t('dm.mafia_vote_skip', { voter: escapeHtml(voterName) })}`;
    return { ok: true, text, ...(still ? { keyboard: mv.keyboard } : {}) };
  }

  async heroAttack(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<ViewResult>> {
    const g = this.checkGame(input.number);
    if (!g?.state || g.state.phaseSeq !== input.seq) return {ok:false,error:'STALE_PHASE'};
    const target = this.seatToId(g.state,input.seat);
    if (!target) return {ok:false,error:'INVALID_TARGET'};
    const result = await this.mutate(input.tgId,(s,now,rng)=>heroAttack(s,String(input.tgId),target,now,rng,input.seq));
    return result.ok ? {ok:true,text:t('hero.attack_done')} : result;
  }

  async dayVote(input: { tgId: number; number: number; seq: number; seat: number }): Promise<RoomResult<{ targetName: string | null }>> {
    const g = this.checkGame(input.number);
    if (!g || !g.state) return { ok: false, error: 'STALE_PHASE' };
    const choice = input.seat === 0 ? 'NONE' : this.seatToId(g.state, input.seat);
    if (!choice) return { ok: false, error: 'INVALID_TARGET' };
    const name = choice === 'NONE' ? null : (g.state.players.find((p) => p.id === choice)?.name ?? null);
    const r = await this.mutate(input.tgId, (s) => submitDayVote(s, String(input.tgId), choice, input.seq));
    return r.ok ? { ok: true, targetName: name } : r;
  }

  async revealMayor(input: { tgId: number; number: number }): Promise<RoomResult<ViewResult>> {
    if (!this.checkGame(input.number)) return { ok: false, error: 'STALE_PHASE' };
    const r = await this.mutate(input.tgId, (s) => revealMayor(s, String(input.tgId)));
    if (!r.ok) return r;
    const name = r.state.players.find((p) => p.id === String(input.tgId))?.name ?? '';
    return { ok: true, text: t('game.mayor', { name: escapeHtml(name) }) };
  }

  async judgeVeto(input: { tgId: number; number: number; seq: number }): Promise<RoomResult<ViewResult>> {
    const g = this.checkGame(input.number);
    if (!g || !g.state || g.state.phaseSeq !== input.seq) return { ok: false, error: 'STALE_PHASE' };
    const r = await this.mutate(input.tgId, (s, now, rng) => judgeVeto(s, String(input.tgId), now, rng));
    return r.ok ? { ok: true, text: t('dm.judge_done') } : r;
  }

  /** Tunda Mafia a'zosining xabari tirik jamoadoshlariga (§8). */
  async relayMafia(input: { tgId: number; text: string }): Promise<boolean> {
    const g = this.data.game;
    const s = g?.state;
    if (!g || !s || g.status !== 'RUNNING' || s.phase !== 'NIGHT') return false;
    const me = s.players.find((p) => p.id === String(input.tgId));
    if (!me || me.status !== 'ALIVE' || me.faction !== 'MAFIA') return false;
    const fakes = new Set(g.players.filter((p) => p.fake).map((p) => String(p.id)));
    const body = t('dm.mafia_chat', { name: escapeHtml(me.name), text: escapeHtml(input.text.slice(0, 1000)) });
    for (const m of s.players.filter((p) => p.faction === 'MAFIA' && p.status === 'ALIVE' && p.id !== me.id && !fakes.has(p.id))) {
      this.send(Number(m.id), body);
    }
    await this.commit();
    return true;
  }

  silenceSnapshot(): SilenceSnapshot {
    const g = this.data.game;
    const s = g?.state;
    if (!g || !s || g.status !== 'RUNNING') {
      return { running: false, phase: null, players: [], alive: [], silenceDead: false, silenceNight: false, until: this.now + 30_000 };
    }
    return {
      running: true,
      phase: s.phase,
      players: g.players.map((p) => p.id),
      alive: s.players.filter((p) => p.status === 'ALIVE').map((p) => Number(p.id)),
      silenceDead: g.silenceDead,
      silenceNight: g.silenceNight,
      until: Math.min(this.now + 10_000, s.phaseEndsAt ?? this.now + 10_000),
    };
  }

  statusText(): string {
    const g = this.data.game;
    if (!g) return t('game.no_active');
    if (g.status === 'LOBBY') {
      return t('lobby.players_title', {
        count: g.players.length,
        list: g.players.map((p, i) => `${i + 1}. ${escapeHtml(p.name)}`).join('\n') || t('lobby.empty_list'),
      });
    }
    const s = g.state!;
    const alive = s.players.filter((p) => p.status === 'ALIVE');
    return t('game.status', {
      mode: t(`mode.${s.mode}`),
      phase: t(`phase.${s.phase}`),
      night: s.nightNumber,
      day: s.dayNumber,
      left: s.phaseEndsAt ? Math.max(0, Math.round((s.phaseEndsAt - this.now) / 1000)) : 0,
      aliveCount: alive.length,
      alive: alive.map((p) => `${p.seat}. ${escapeHtml(p.name)}`).join('\n'),
    });
  }

  // ───────────────────────────── Alarm ─────────────────────────────

  async alarm(): Promise<void> {
    this.externalCalls = 0;
    this.data.alarmAt = null;
    await this.processOps();
    const g = this.data.game;
    if (g?.status === 'LOBBY') await this.lobbyTimeout();
    const g2 = this.data.game;
    if (g2?.status === 'RUNNING' && g2.state?.phaseEndsAt && g2.state.phaseEndsAt <= this.now + 500) {
      const seq = g2.state.phaseSeq;
      await this.mutate(null, (s, now, rng) => advancePhase(s, now, rng, seq));
    }
    await this.processOps();
    await this.flush(Math.max(0, SEND_BUDGET - this.externalCalls));
    await this.commit();
  }

  /** Registry amallari (at-least-once, idempotent). */
  private async processOps(): Promise<void> {
    if ((this.data.opsRetryAt ?? 0) > this.now) return;
    while (this.data.ops.length > 0 && this.externalCalls < 8) {
      const op = this.data.ops[0]!;
      this.externalCalls++;
      try {
        switch (op.type) {
          case 'record': {
            const recorded = await this.deps.registry.recordGame(op.input);
            if (op.input.practice) {
              for (const p of op.input.players) if (!p.fake) this.send(p.tgId, t('dm.practice_over'));
            } else {
              const proWinners = op.input.players.filter((p) => p.badge === '💎' && (p.outcome === 'WIN' || p.outcome === 'PERSONAL_WIN'));
              if (proWinners.length > 0) this.send(this.chatId, t('game.vip_pro_winner', { names: proWinners.map((p) => escapeHtml(p.name)).join(', ') }));
            }
            for (const r of recorded.players) {
              const rating = r.ratingChange !== 0 ? ` · 🏅 ${r.ratingChange > 0 ? '+' : ''}${r.ratingChange} RP` : '';
              const hero = r.hero ? '\n' + t('hero.reward', { xp: r.hero.xp, level: r.hero.level }) + (r.hero.leveled ? ' 🎉' : '') : '';
              const reward = r.points === undefined ? t('dm.game_over_coins', { outcome: t(`dm.outcome.${r.outcome}`), xp: r.xp, coins: r.coins, rating }) : t('reward.v7', { outcome: t(`dm.outcome.${r.outcome}`), dollars: r.coins, points: (r.points > 0 ? '+' : '') + r.points });
              this.send(r.tgId, reward + hero);
            }
            for (const ref of recorded.referrals) {
              this.send(ref.referrerId, t('invite.reward_dm', { name: escapeHtml(ref.referredName), games: REFERRAL.gamesRequired, reward: ref.reward }));
            }
            break;
          }
          case 'releaseGame':
            await this.deps.registry.releaseGame(op.number, op.status);
            break;
          case 'release':
            await this.deps.registry.release(op.tgId, op.number);
            break;
          case 'dmBlocked':
            await this.deps.registry.markDmBlocked(op.tgIds);
            break;
          case 'running':
            await this.deps.registry.markRunning(op.number, op.players);
            break;
          case 'settleItems':
            await this.deps.registry.settleArcade(op.number, op.used);
            break;
          case 'releaseItems':
            await this.deps.registry.releaseArcade(op.number);
            break;
        }
      } catch {
        const failures = Math.min(6, (this.data.opsFailures ?? 0) + 1);
        this.data.opsFailures = failures;
        this.data.opsRetryAt = this.now + Math.min(60_000, 1000 * 2 ** failures);
        await this.deps.store.save(this.data);
        this.deps.reportRegistryFailure?.();
        return;
      }
      this.data.ops = this.data.ops.filter((x) => x.id !== op.id);
      delete this.data.opsRetryAt;
      delete this.data.opsFailures;
      await this.deps.store.save(this.data);
    }
  }

  /** Navbatdagi xabarlarni yuborish: FIFO, EDIT birlashtiriladi, 429 / 403 hisobga olinadi. */
  async flush(budget = SEND_BUDGET): Promise<number> {
    let sent = 0;
    while (this.data.outbox.length > 0 && sent < budget) {
      const item = this.data.outbox[0]!;
      if (item.notBefore > this.now) break;
      if (item.coalesceKey && this.data.outbox.some((o) => o.id > item.id && o.coalesceKey === item.coalesceKey)) {
        this.drop(item.id);
        continue;
      }
      try {
        sent++;
        await this.deliver(item);
        this.drop(item.id);
      } catch (e) {
        const err = e instanceof TgError ? e : new TgError(0, String(e));
        const desc = err.description.toLowerCase();
        if (err.code === 429) {
          item.notBefore = this.now + (err.retryAfter ?? 3) * 1000;
          break;
        }
        if (err.code === 403) {
          this.data.outbox = this.data.outbox.filter((o) => o.chatId !== item.chatId);
          if (item.chatId > 0) this.addOp({ type: 'dmBlocked', tgIds: [item.chatId] });
          continue;
        }
        if (err.code === 400) {
          // "message is not modified", "message to edit not found", noto'g'ri so'rov — qayta urinish foydasiz
          void desc;
          this.drop(item.id);
          continue;
        }
        item.attempts++;
        if (item.attempts > 5) this.drop(item.id);
        else item.notBefore = this.now + Math.min(60_000, 1000 * 2 ** item.attempts);
        break;
      }
    }
    await this.deps.store.save(this.data);
    return sent;
  }

  private drop(id: number): void {
    this.data.outbox = this.data.outbox.filter((o) => o.id !== id);
  }

  private async deliver(item: OutItem): Promise<void> {
    const p = item.payload;
    if (p.kind === 'SEND') {
      if (p.visual) {
        if (this.deps.visuals) await sendVisual(this.deps.telegram, item.chatId, p.visual);
        return;
      }
      const res = await this.deps.telegram.call<{ message_id: number }>('sendMessage', {
        chat_id: item.chatId,
        text: p.text.length > 4096 ? `${p.text.slice(0, 4095)}…` : p.text,
        ...HTML,
        ...(p.keyboard ? { reply_markup: { inline_keyboard: p.keyboard } } : {}),
      });
      if (item.storeRefAs) this.data.refs[item.storeRefAs] = { chatId: item.chatId, messageId: res.message_id };
      return;
    }
    const ref = this.data.refs[p.refKey];
    if (!ref) return; // asl xabar yuborilmagan — tahrirlash shart emas
    if (p.kind === 'EDIT') {
      await this.deps.telegram.call('editMessageText', {
        chat_id: ref.chatId,
        message_id: ref.messageId,
        text: p.text,
        ...HTML,
        ...(p.keyboard ? { reply_markup: { inline_keyboard: p.keyboard } } : {}),
      });
    } else if (p.kind === 'CLEAR_KEYBOARD') {
      await this.deps.telegram.call('editMessageReplyMarkup', { chat_id: ref.chatId, message_id: ref.messageId, reply_markup: { inline_keyboard: [] } });
    } else {
      await this.deps.telegram.call('deleteMessage', { chat_id: ref.chatId, message_id: ref.messageId });
    }
  }

  /** Faqat testlar uchun: joriy muddatni hozirga surish. */
  async forceDeadline(): Promise<void> {
    const g = this.data.game;
    if (g?.status === 'LOBBY' && g.deadline) g.deadline = this.now;
    if (g?.status === 'RUNNING' && g.state?.phaseEndsAt) g.state.phaseEndsAt = this.now;
    await this.alarm();
  }
}
