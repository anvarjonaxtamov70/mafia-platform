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
import {V2_DEFS,v2CanEndNight,v2NightSessionReady,v2SameMafia,type V2Mode} from '@mafia/game-engine';
import {decodeV2Button,v2PublicPhaseView} from '@mafia/bot-core';
import {prepareV2HeroShot,finalizeV2HeroShot,type PendingV2HeroShot} from './v2-hero-settlement';
import {prepareV2NightSettlement,finalizeV2NightSettlement,type PendingV2NightSettlement} from './v2-night-settlement';
import type {HeroV2ShotRequest,HeroV2ShotReceipt} from './hero-v2-core';
import type {GrenchBatchReceipt,GrenchDebit,DawnRoleAction,DawnRoleReceipt,Receipt} from './role-v2-economy';
import {decodeSellerButton,sellerKeyboard,type V2SellerOffer} from './v2-seller';
import {buildV2Result} from './v2-match-result';
import {applyV2Loadout,usedV2Items} from './v2-items';
import {createV2RoomSession,v2RoomButton,v2RoomTick,v2RoomLastWord,v2RoomLeave,v2RoomDeadline,type V2RoomSession,type V2RoomTransition} from './v2-room-session';

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
  /** Only explicit owner-controlled preview games use v2. */
  v2Mode?: V2Mode;
  v2Session?: V2RoomSession;
  /** Persist the ledger choice: a missing dependency on reload must never downgrade to simulation. */
  v2Ledger?: true;
  v2DeferredMigration?: number;
  v2DeferredStop?:true;
  v2Offers?: V2SellerOffer[];
  v2FinishedAt?:number;
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
  /** Only delete commands after this message was successfully delivered. */
  commandMessageIds?: number[];
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
  | { id: number; type: 'releaseItems'; number: number }
  | { id: number; type: 'v2Night'; number: number; pending: PendingV2NightSettlement }
  | { id: number; type: 'v2Hero'; number: number; pending: PendingV2HeroShot }
  | { id: number; type: 'v2Buy'; number: number; buyer:number; offer:number; code:string }
  | { id:number;type:'v2Running';number:number;chatId:number;ids:number[];allowItems?:boolean }
  | { id:number;type:'v2Record';number:number;input:RecordGameInput };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

type LobbyTask = { id: number; kind: 'pin' | 'clear' | 'unpin' | 'deleteCommand'; chatId: number; messageId: number; number: number; attempts: number; at: number };

/** No player identity, callback payload or financial request in the diagnostic. */
export type V2RecoveryHold={game:number;op:number;kind:PendingOp['type'];since:number;failures:number};
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
  v2RecoveryHold?:V2RecoveryHold;
  nextId: number;
  alarmAt: number | null;
  lobbyTasks?: LobbyTask[];
  lobbyPostedAt?: number;
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

/** Internal dependency only. Workerd injects this port exclusively in local fake-Telegram E2E. No production economy cutover. */
export interface V2SettlementPort {
  snapshots(ids:number[]):Promise<Record<string,{defense:number;charges:number;damage:number}>>;
  settleNight(game:number,round:number,debits:readonly GrenchDebit[]):Promise<GrenchBatchReceipt>;
  settleHero(request:HeroV2ShotRequest):Promise<HeroV2ShotReceipt>;
  settleDawn(game:number,round:number,actions:readonly DawnRoleAction[]):Promise<DawnRoleReceipt>;
  buyOffer(game:number,attempt:number,buyer:number,offer:number,code:string):Promise<Receipt>;
  markRunning(game:number,chatId:number,ids:readonly number[],allowItems:boolean):Promise<NonNullable<RoomGame['arcade']>>;
  recordResult(input:RecordGameInput):Promise<RecordResult>;
}
export interface RoomDeps {
  v2Settlement?: V2SettlementPort;
  store: RoomStore;
  registry: RegistryPort;
  telegram: Telegram;
  clock: () => number;
  rng: Rng;
  botUsername: () => string;
  devFakePlayers: boolean;
  visuals?: boolean;
  reportRegistryFailure?: () => void;
  reportV2Hold?: (hold:V2RecoveryHold)=>void;
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
  private processingOps = false;

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
    if(this.clearLegacyLobbyTimer())await this.commit();
    await this.resumeV2Deferred();
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
    if (this.data.ops.length > 0&&!this.data.v2RecoveryHold) candidates.push(Math.max(this.now, this.data.opsRetryAt ?? 0));
    if (this.data.outbox.length > 0) candidates.push(Math.max(this.now, this.data.outbox[0]!.notBefore));

    for (const task of this.data.lobbyTasks ?? []) candidates.push(task.at);
    if (g?.status === 'RUNNING' && g.state?.phaseEndsAt) candidates.push(g.state.phaseEndsAt);
    if(g?.status==='RUNNING'&&g.v2Session&&!this.v2Pending(g.number)){
      const deadline=g.v2DeferredMigration!==undefined||g.v2DeferredStop?this.now:this.v2Due(g.v2Session);
      if(deadline!==null)candidates.push(deadline);
    }
    const next = candidates.length ? Math.min(...candidates) : null;
    if (next !== this.data.alarmAt) {
      this.data.alarmAt = next;
      await this.deps.store.setAlarm(next);
      await this.deps.store.save(this.data);
    }
  }

  private enqueue(drafts: OutboxDraft[]): void {
    for (const d of drafts) {
      let payload=d.payload;
      const username=this.deps.botUsername();
      if(this.data.game?.status==='RUNNING' && Number(d.chatId)===this.chatId && username && (payload.kind==='SEND'||payload.kind==='EDIT')) {
        payload={...payload,keyboard:[...(payload.keyboard??[]),[{text:t('lobby.open_bot'),url:`https://t.me/${username}`}]]};
      }
      this.data.outbox.push({
        id: this.data.nextId++,
        chatId: Number(d.chatId),
        payload,
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

  private attachCommand(item: OutItem | undefined, messageId?: number): void {
    if (!item || item.chatId !== this.chatId || this.chatId >= 0 || !Number.isSafeInteger(messageId) || !messageId || messageId < 1) return;
    const ids=item.commandMessageIds??=[];
    if (!ids.includes(messageId) && ids.length < 200) ids.push(messageId);
  }

  /** Internal RPC for immediate replies that Telegram already accepted. */
  async cleanupCommand(messageId:number):Promise<void> {
    if(this.chatId>=0||!Number.isSafeInteger(messageId)||messageId<1)return;
    this.lobbyTask('deleteCommand',{chatId:this.chatId,messageId},0);
    await this.commit();
  }

  private lobbyEdit(g: RoomGame, commandMessageId?: number): void {
    const v = this.lobbyView(g);
    this.enqueue([
      {
        chatId: BigInt(this.chatId),
        payload: { kind: 'EDIT', refKey: lobbyRef(g.id), text: v.text, ...(v.keyboard ? { keyboard: v.keyboard } : {}) },
        dedupeKey: '',
        coalesceKey: `lobby:${g.id}`,
      },
    ]);
    this.attachCommand(this.data.outbox.at(-1),commandMessageId);
  }

  /** One current board per lobby, with bounded coalescing under group-wide spam. */
  private queueLobbyBoard(g: RoomGame, commandMessageId?:number): void {
    const key=lobbyRef(g.id);
    const pending=this.data.outbox.find(o=>o.storeRefAs===key);
    if(pending){this.attachCommand(pending,commandMessageId);return;}
    const v=this.lobbyView(g);
    this.send(this.chatId,v.text,v.keyboard,{storeRefAs:key});
    const queued=this.data.outbox.at(-1)!;
    this.attachCommand(queued,commandMessageId);
    if(this.data.refs[key]) queued.notBefore=Math.max(this.now,(this.data.lobbyPostedAt??0)+2000);
  }

  private lobbyTask(kind: LobbyTask['kind'], ref: {chatId:number;messageId:number}, number:number): void {
    const tasks=this.data.lobbyTasks??=[];
    if(tasks.some(x=>x.kind===kind&&x.chatId===ref.chatId&&x.messageId===ref.messageId))return;
    tasks.push({id:this.data.nextId++,kind,chatId:ref.chatId,messageId:ref.messageId,number,attempts:0,at:this.now});
  }
  private retireBoard(ref: {chatId:number;messageId:number}, number:number): void {
    this.data.lobbyTasks=(this.data.lobbyTasks??[]).filter(x=>!(x.kind==='pin'&&x.chatId===ref.chatId&&x.messageId===ref.messageId));
    this.lobbyTask('clear',ref,number);
    this.lobbyTask('unpin',ref,number);
  }
  private closeLobby(g:RoomGame):void {
    const key=lobbyRef(g.id), ref=this.data.refs[key];
    this.data.outbox=this.data.outbox.filter(o=>o.storeRefAs!==key&&!(o.payload.kind==='EDIT'&&o.payload.refKey===key));
    if(ref)this.retireBoard(ref,g.number);
    delete this.data.refs[key];
  }
  private async refreshLobby(g:RoomGame,commandMessageId?:number):Promise<RoomResult<{number:number;hostJoined:boolean;refreshed?:boolean}>> {
    if(g.status!=='LOBBY'||this.starting)return {ok:false,error:'GROUP_ACTIVE_GAME'};
    this.queueLobbyBoard(g,commandMessageId);
    await this.commit();
    return {ok:true,number:g.number,hostJoined:false,refreshed:true};
  }

  // ───────────────────────────── Lobby ─────────────────────────────

  async createLobby(input: { title: string; host: UserInfo; isAdmin: boolean; mode?: GameMode; v2Mode?: V2Mode; quick?: boolean; commandMessageId?:number }): Promise<RoomResult<{ number: number; hostJoined: boolean; refreshed?: boolean }>> {
    if (input.host.banned) return { ok: false, error: 'BANNED' };
    if (this.data.game) return this.refreshLobby(this.data.game,input.commandMessageId);
    const settings = await this.deps.registry.getSettings(this.chatId);
    const number = await this.deps.registry.allocateGame(this.chatId);
    // await davomida boshqa /game kelgan bo'lishi mumkin
    if (this.data.game) {
      await this.deps.registry.releaseGame(number, 'CANCELLED');
      return this.refreshLobby(this.data.game,input.commandMessageId);
    }
    const mode = input.mode ?? settings.mode;
    const config: ConfigSnapshot = { ...settingsToConfig(settings, mode, input.quick), lobby: { lobbySec: settings.lobbySec, autostart: false, ...(input.quick ? { quick: true } : {}) } };
    const g: RoomGame = {
      id: `${this.chatId}-${number}`,
      number,
      status: 'LOBBY',
      mode,
      ...(input.v2Mode?{v2Mode:input.v2Mode}:{}),
      config:input.v2Mode?{...config,minPlayers:4,maxPlayers:30}:config,
      silenceDead: settings.silenceDead,
      silenceNight: settings.silenceNight,
      hostId: input.host.id,
      hostName: input.host.name,
      deadline: null,
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
    if(this.data.game!==g||g.status!=='LOBBY')return {ok:false,error:'NOT_LOBBY'};
    this.queueLobbyBoard(g,input.commandMessageId);
    await this.commit();
    return { ok: true, number, hostJoined };
  }

  async join(user: UserInfo, number?: number, commandMessageId?:number): Promise<RoomResult<{ title: string }>> {
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (g.status !== 'LOBBY' || this.starting) return { ok: false, error: 'NOT_LOBBY' };
    if (!user.dmAvailable) return { ok: false, error: 'NEED_DM' };
    if (user.banned) return { ok: false, error: 'BANNED' };
    if (g.players.some((p) => p.id === user.id)) return { ok: false, error: 'ALREADY_JOINED' };
    if(this.data.ops.some(op=>op.type==='release'&&op.tgId===user.id&&op.number===g.number))return {ok:false,error:'IN_OTHER_GAME'};
    if (g.players.length >= g.config.maxPlayers) return { ok: false, error: 'FULL' };
    const c = await this.deps.registry.claim(user.id, this.chatId, g.number);
    if (c === 'BUSY') return { ok: false, error: 'IN_OTHER_GAME', details:{number:g.number} };
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
    this.lobbyEdit(g,commandMessageId);
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
    if(g.v2Session&&g.status==='RUNNING'){
      if(g.v2Session.night||this.v2Pending(g.number))return {ok:false,error:'STALE_PHASE'};
      let next:V2RoomTransition;
      try{next=v2RoomLeave(g.v2Session,tgId,this.now);}catch{return {ok:false,error:'NOT_JOINED'};}
      this.acceptV2(g,next);
      this.addOp({type:'release',tgId,number:g.number});
      const due=this.v2Due(next.room);
      if(due!==null&&due<=this.now)this.tickV2(g);
      await this.commit();return {ok:true};
    }
    return {ok:false,error:'NOT_LOBBY',details:{running:1}};
  }

  /** Source room is authoritative: never transfer a running or starting participant. */
  async leaveLobbyForTransfer(tgId:number,number:number):Promise<RoomResult> {
    const g=this.data.game;
    if(!g||g.number!==number||g.status!=='LOBBY'||this.starting)return {ok:false,error:'NOT_LOBBY'};
    if(g.players.some(p=>p.id===tgId)){
      const result=await this.leave(tgId,number);
      if(!result.ok)return result;
    }else if(!this.data.ops.some(op=>op.type==='release'&&op.tgId===tgId&&op.number===number))return {ok:false,error:'NOT_JOINED'};
    // The durable release op must finish before the target can acquire a claim.
    this.externalCalls=0;
    await this.processOps();
    await this.commit();
    if(this.data.ops.some(op=>op.type==='release'&&op.tgId===tgId&&op.number===number))return {ok:false,error:'IN_OTHER_GAME'};
    return {ok:true};
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

  async start(trigger: { by: number; isAdmin: boolean; commandMessageId?:number } | 'auto', number?: number): Promise<RoomResult> {
    if (trigger === 'auto' || trigger?.isAdmin !== true) return {ok:false,error:'NO_PERMISSION'};
    if (this.starting) return { ok: false, error: 'NOT_LOBBY' };
    this.starting = true;
    try {
      return await this.startOnce(trigger, number);
    } finally {
      this.starting = false;
    }
  }

  private async startOnce(trigger: { by: number; isAdmin: boolean; commandMessageId?:number }, number?: number): Promise<RoomResult> {
    this.externalCalls = 0;
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (g.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
    if (!trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
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
      this.attachCommand(this.data.outbox.at(-1),trigger.commandMessageId);
      this.lobbyEdit(g);
      await this.commit();
      return { ok: false, error: 'DM_FAILED', details: { names: removed.map((p) => p.name).join(', ') } };
    }

    if(g.v2Mode)return this.startV2Preview(g,trigger.commandMessageId);

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
    this.closeLobby(g);
    const firstId=this.data.nextId;
    this.applyState(g, null, pp.state, pp.events);
    this.attachCommand(this.data.outbox.find(o=>o.id>=firstId&&o.chatId===this.chatId&&o.payload.kind==='SEND'&&!o.payload.visual),trigger.commandMessageId);
    this.addOp({ type: 'running', number: g.number, players: g.players.length });
    await this.commit();
    return { ok: true };
  }

  async cancel(trigger: { by: number; isAdmin: boolean; commandMessageId?:number } | 'timeout', text?: string, number?: number): Promise<RoomResult> {
    const g = this.data.game;
    if (!g || (number !== undefined && g.number !== number)) return { ok: false, error: 'NOT_FOUND' };
    if (trigger !== 'timeout' && !trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
    if (g.status === 'RUNNING' && (trigger === 'timeout' || !trigger.isAdmin)) return { ok: false, error: 'NO_PERMISSION' };
    if(g.v2Session?.state.phase==='ENDED')return {ok:false,error:'STALE_PHASE'};
    if(this.v2Pending(g.number)){
      if(trigger==='timeout'||!g.v2Session)return {ok:false,error:'STALE_PHASE'};
      if(!g.v2DeferredStop){
        g.v2DeferredStop=true;
        this.send(this.chatId,'⏳ Hisob-kitob tekshirilgach o‘yin xavfsiz bekor qilinadi.');
        this.attachCommand(this.data.outbox.at(-1),trigger.commandMessageId);
      }
      await this.commit();return {ok:true};
    }
    if(g.status==='LOBBY')this.closeLobby(g);
    this.send(this.chatId, text ?? (g.status === 'RUNNING' ? t('game.cancelled_admin') : t('lobby.cancelled')));
    if(trigger!=='timeout')this.attachCommand(this.data.outbox.at(-1),trigger.commandMessageId);
    if(g.v2Ledger&&g.v2Session)this.addOp({type:'settleItems',number:g.number,used:usedV2Items(g)});
    this.addOp({ type: 'releaseGame', number: g.number, status: 'CANCELLED' });
    this.data.game = null;
    await this.commit();
    return { ok: true };
  }

  /** Old durable snapshots may contain an enabled registration timer. Disable it without starting or cancelling. */
  private clearLegacyLobbyTimer(): boolean {
    const g=this.data.game;
    if(g?.status!=='LOBBY'||(!g.config.lobby.autostart&&g.deadline===null))return false;
    g.config.lobby.autostart=false;
    g.deadline=null;
    g.version++;
    this.lobbyEdit(g);
    return true;
  }

  /** Superguruhga ko'chish: eski chatdagi o'yin bekor qilinadi (yangi chatda qayta boshlanadi). */
  async migrate(newChatId: number): Promise<void> {
    const g = this.data.game;
    if (g) {
      // A committed external receipt must be reconciled before discarding the room.
      if(this.v2Pending(g.number)){g.v2DeferredMigration=newChatId;await this.commit();return;}
      if(g.status==='LOBBY')this.closeLobby(g);
      if(g.v2Ledger&&g.v2Session)this.addOp({type:'settleItems',number:g.number,used:usedV2Items(g)});
      this.addOp({ type: 'releaseGame', number: g.number, status: 'CANCELLED' });
      this.data.game = null;
    }
    this.data.outbox = [];
    this.send(newChatId, `${t('group.migrated')}\n${g ? t('lobby.cancelled') : ''}`);
    await this.commit();
  }

  // ───────────────────────────── O'yin ─────────────────────────────

  /** Preview uses real durable rooms and Telegram, but no wallet or rating changes.
   * It must remain opt-in until production receipts and result migration are ready.
   */
  private async startV2Preview(g:RoomGame,commandMessageId?:number):Promise<RoomResult>{
    if(!g.v2Mode||g.players.length<4||(g.v2Mode==='VS'&&g.players.length%2))return {ok:false,error:'NOT_ENOUGH',details:{min:4,count:g.players.length}};
    const ledger=this.deps.v2Settlement;
    if(ledger&&g.players.some(p=>p.fake))return {ok:false,error:'NOT_LOBBY'};
    const roster=g.players.map(p=>p.id),version=g.version;
    const snapshots=ledger?await ledger.snapshots(roster):{};
    if(this.data.game!==g||g.status!=='LOBBY'||g.version!==version||JSON.stringify(g.players.map(p=>p.id))!==JSON.stringify(roster))return {ok:false,error:'NOT_LOBBY'};
    const now=this.now;
    const next=createV2RoomSession(g.number,this.chatId,g.v2Mode,g.players,now,this.deps.rng);
    if(ledger){
      for(const p of next.room.state.players){const h=snapshots[p.id];if(h){p.heroDefense=h.defense;p.heroCharges=h.charges;p.heroDamage=h.damage;}}
      g.v2Ledger=true;
    }
    g.status='RUNNING';g.startedAt=now;g.deadline=null;g.silenceDead=true;g.silenceNight=true;
    this.closeLobby(g);
    this.send(this.chatId,'🧪 V2 SINOV — '+g.v2Mode+(ledger?'\nIchki test hisobi.':'\nDollar, Olmos, geroy va reyting o‘zgarmaydi.'));
    this.attachCommand(this.data.outbox.at(-1),commandMessageId);
    this.acceptV2(g,next);
    if(g.v2Ledger)this.addOp({type:'v2Running',number:g.number,chatId:this.chatId,ids:g.players.map(p=>p.id),allowItems:g.config.allowArcadeItems});
    else this.addOp({type:'running',number:g.number,players:g.players.length});
    await this.commit();return {ok:true};
  }
  /** Deferred commands survive restarts. Never discard an uncertain debit or shot. */
  private async resumeV2Deferred():Promise<void>{
    const g=this.data.game;
    if(!g||this.v2Pending(g.number))return;
    if(g.v2DeferredMigration!==undefined){await this.migrate(g.v2DeferredMigration);return;}
    if(g.v2DeferredStop){
      // If the reconciled action naturally ended the match, preserve the result.
      if(g.v2Session?.state.phase==='ENDED'){delete g.v2DeferredStop;await this.commit();return;}
      await this.cancel({by:g.hostId,isAdmin:true});
    }
  }
  private v2Pending(number:number):boolean{
    return this.data.ops.some(op=>(op.type==='v2Night'||op.type==='v2Hero'||op.type==='v2Buy'||op.type==='v2Record'||op.type==='v2Running')&&op.number===number);
  }
  private v2Due(s:V2RoomSession):number|null{
    if(s.state.phase==='ENDED'){
      const pending=Object.values(s.lastWords).filter(w=>!w.sent&&w.until>this.now);
      return pending.length?Math.max(...pending.map(w=>w.until)):this.now;
    }
    if(s.night&&v2NightSessionReady(s.night,this.now))return this.now;
    if(!s.night&&v2CanEndNight(s.state))return this.now;
    return v2RoomDeadline(s);
  }
  private acceptV2(g:RoomGame,next:V2RoomTransition){
    g.v2Session=next.room;g.version++;
    if(next.room.state.phase==='ENDED'&&g.v2FinishedAt===undefined)g.v2FinishedAt=this.now;
    const fakes=new Set(g.players.filter(p=>p.fake).map(p=>p.id));
    this.enqueue(next.outbox.filter(o=>!fakes.has(Number(o.chatId))));
  }
  private finishV2(g:RoomGame){
    if(g.v2Ledger){
      const input=buildV2Result(g,this.chatId,g.v2FinishedAt??this.now);
      this.addOp({type:'v2Record',number:g.number,input});
    }else{
      this.addOp({type:'releaseGame',number:g.number,status:'FINISHED'});
      this.data.game=null;
    }
  }
  private tickV2(g:RoomGame){
    const s=g.v2Session;if(!s||this.v2Pending(g.number))return;
    if(s.state.phase==='ENDED'){
      if(!Object.values(s.lastWords).some(w=>!w.sent&&w.until>this.now))this.finishV2(g);
      return;
    }
    const next=v2RoomTick(s,this.now,this.deps.rng,new Map(),!!g.v2Ledger);
    this.acceptV2(g,next);
    if(next.room.night&&v2NightSessionReady(next.room.night,this.now)&&(g.v2Ledger||next.debits.length)){
      this.addOp({type:'v2Night',number:g.number,pending:prepareV2NightSettlement(next.room,this.now)});
    }
  }
  async v2Button(input:{tgId:number;privateChatId:number;number:number;raw:string}):Promise<RoomResult>{
    const g=this.data.game;
    if(!g||g.number!==input.number||!g.v2Session||g.status!=='RUNNING'||g.v2DeferredStop||g.v2DeferredMigration!==undefined||this.v2Pending(g.number))return {ok:false,error:'STALE_PHASE'};
    try{
      if(input.raw.startsWith('v2s:')){
        const button=decodeSellerButton(input.raw),s=g.v2Session.state;
        const offer=g.v2Offers?.find(o=>o.id===button?.offer&&o.buyer===input.tgId);
        const living=(id:number)=>s.players.some(p=>p.id===String(id)&&p.hp>0&&!p.left);
        if(!g.v2Ledger||!this.deps.v2Settlement||!button||button.game!==g.number||input.privateChatId!==input.tgId||
          !offer||offer.expires<=this.now||offer.round!==s.round||!['DAWN','DISCUSSION'].includes(s.phase)||s.deadline===null||this.now>=s.deadline||
          !living(offer.buyer)||!living(offer.seller))return {ok:false,error:'STALE_PHASE'};
        this.addOp({type:'v2Buy',number:g.number,buyer:input.tgId,offer:offer.id,code:button.code});
        await this.commit();return {ok:true};
      }
      if(decodeV2Button(input.raw)?.op==='H'){
        if(!g.v2Ledger||!this.deps.v2Settlement)return {ok:false,error:'STALE_PHASE'};
        const pending=prepareV2HeroShot(g.v2Session,input.tgId,input.privateChatId,input.raw,this.now);
        this.addOp({type:'v2Hero',number:g.number,pending});
        await this.commit();return {ok:true};
      }
      const next=v2RoomButton(g.v2Session,input.tgId,input.privateChatId,input.raw,this.now);
      this.acceptV2(g,next);
      const due=this.v2Due(next.room);
      if(due!==null&&due<=this.now)this.tickV2(g);
      await this.commit();return {ok:true};
    }catch{return {ok:false,error:'STALE_PHASE'};}
  }


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
    if(g?.v2Session&&g.status==='RUNNING'){
      if(this.v2Pending(g.number))return false;
      const v=g.v2Session,id=String(input.tgId),me=v.state.players.find(p=>p.id===id);
      if(!me)return false;
      const word=v.lastWords[id];
      if(word&&!word.sent&&word.until>this.now){try{this.acceptV2(g,v2RoomLastWord(v,input.tgId,input.text,this.now));await this.commit();return true;}catch{return false;}}
      if(v.state.phase!=='NIGHT'||me.hp<=0||me.left||me.blockedUntil>=v.state.round||V2_DEFS[me.role].faction!=='MAFIA')return false;
      for(const p of v.state.players)if(p.id!==id&&p.hp>0&&!p.left&&p.blockedUntil<v.state.round&&v2SameMafia(v.state,me,p)&&!g.players.some(u=>u.fake&&String(u.id)===p.id))this.send(Number(p.id),t('dm.mafia_chat',{name:escapeHtml(v.names[id]??'O‘yinchi'),text:escapeHtml(input.text.slice(0,1000))}));
      await this.commit();return true;
    }
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
    if(g?.v2Session&&g.status==='RUNNING'&&g.v2Session.state.phase!=='ENDED'){
      const s=g.v2Session.state;return {running:true,phase:s.phase,players:g.players.map(p=>p.id),alive:s.players.filter(p=>p.hp>0&&!p.left&&p.blockedUntil<s.round).map(p=>Number(p.id)),silenceDead:true,silenceNight:true,until:this.now+1000};
    }
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
    if(g.v2Session)return v2PublicPhaseView(g.v2Session.state,g.v2Session.names).text;
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
    await this.resumeV2Deferred();
    this.clearLegacyLobbyTimer();
    const g2 = this.data.game;
    if(g2?.status==='RUNNING'&&g2.v2Session&&!this.v2Pending(g2.number)){
      const due=this.v2Due(g2.v2Session);
      if(due!==null&&due<=this.now){this.tickV2(g2);await this.deps.store.save(this.data);}
    }
    if (g2?.status === 'RUNNING' && g2.state?.phaseEndsAt && g2.state.phaseEndsAt <= this.now + 500) {
      const seq = g2.state.phaseSeq;
      await this.mutate(null, (s, now, rng) => advancePhase(s, now, rng, seq));
    }
    await this.processOps();
    await this.processLobbyTasks(4);
    await this.flush(Math.max(0, SEND_BUDGET - this.externalCalls - 8));
    await this.processLobbyTasks(4);
    await this.commit();
  }

  /** Registry amallari (at-least-once, idempotent). */
  private async processOps(): Promise<void> {
    if(this.processingOps)return;
    this.processingOps=true;
    try { await this.processOpsOnce(); } finally { this.processingOps=false; }
  }
  private async processOpsOnce(): Promise<void> {
    if (this.data.v2RecoveryHold||(this.data.opsRetryAt ?? 0) > this.now) return;
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
          case 'v2Running': {
            const ledger=this.deps.v2Settlement;
            if(!ledger)throw Error('missing v2 ledger');
            await this.deps.store.save(this.data);
            const items=await ledger.markRunning(op.number,op.chatId,op.ids,!!op.allowItems);
            const g=this.data.game;
            if(!g||g.number!==op.number||!g.v2Session||!g.v2Ledger)throw Error('v2 start room changed');
            applyV2Loadout(g,items);
            // Restart the first phase clock after the start receipt, not before an unavailable ledger.
            g.startedAt=this.now;g.v2Session.state.deadline=this.now+30000;
            const all=Object.values(items);
            if(all.some(x=>x.shield||x.fakeDocument||x.voteShield||x.heroShield))this.send(this.chatId,t('game.arcade_items',{shields:all.filter(x=>x.shield).length,docs:all.filter(x=>x.fakeDocument).length,votes:all.filter(x=>x.voteShield).length}));
            break;
          }
          case 'v2Record': {
            const g=this.data.game,ledger=this.deps.v2Settlement;
            if(!g||g.number!==op.number||!g.v2Ledger||!ledger)throw Error('result settlement unavailable');
            await this.deps.store.save(this.data);
            const result=await ledger.recordResult(op.input);
            if(this.data.game!==g)throw Error('result room changed');
            for(const p of result.players)this.send(p.tgId,t('reward.v7',{outcome:t('dm.outcome.'+p.outcome),dollars:p.coins,points:(p.points!>0?'+':'')+(p.points??0)}));
            for(const ref of result.referrals)this.send(ref.referrerId,t('invite.reward_dm',{name:escapeHtml(ref.referredName),games:REFERRAL.gamesRequired,reward:ref.reward}));
            const migration=g.v2DeferredMigration;
            this.data.game=null;
            if(migration!==undefined)this.send(migration,t('group.migrated'));
            break;
          }
          case 'v2Night': {
            const g=this.data.game;
            if(!g||g.number!==op.number||!g.v2Session)throw Error('missing night settlement room');
            const p=op.pending,ledger=this.deps.v2Settlement;
            if(g.v2Ledger&&!ledger)throw Error('v2 ledger unavailable');
            // Even if another alarm entered while an earlier op was in flight, persist this exact plan before any external write.
            await this.deps.store.save(this.data);
            const receipt:GrenchBatchReceipt=g.v2Ledger
              ?await ledger!.settleNight(p.game,p.round,p.debits)
              :{status:'OK',game:p.game,round:p.round,entries:p.debits.map(d=>({...d,status:'INSUFFICIENT' as const}))};
            if(this.data.game!==g||!g.v2Session)throw Error('settlement room changed');
            const resolved=finalizeV2NightSettlement(g.v2Session,p,receipt,this.now);
            if(g.v2Ledger){
              const living=(id:string)=>resolved.room.state.players.some(x=>x.id===id&&x.hp>0&&!x.left);
              const actions:DawnRoleAction[]=resolved.effects.flatMap((e):DawnRoleAction[]=>{
                if(e.kind==='KLAUS')return [{kind:e.kind,actor:Number(e.actor),target:Number(e.target),amount:e.amount}];
                if(e.kind==='SELLER'&&living(e.actor)&&living(e.target))return [{kind:e.kind,actor:Number(e.actor),target:Number(e.target)}];
                return [];
              });
              if(actions.length){
                // The persisted seeded night plan plus Grench receipt deterministically
                // reproduces the exact role effects after a lost response/restart.
                const dawn=await ledger!.settleDawn(p.game,p.round,actions);
                if(dawn.status!=='OK'||dawn.game!==p.game||dawn.round!==p.round||dawn.entries.length!==actions.length)throw Error('dawn receipt unavailable');
                for(let i=0;i<actions.length;i++){
                  const a=actions[i]!,entry=dawn.entries[i]!;
                  if(a.kind!==entry.kind||a.actor!==entry.actor||a.target!==entry.target)throw Error('dawn receipt mismatch');
                  if(a.kind==='KLAUS'&&(entry.kind!=='KLAUS'||a.amount!==entry.amount))throw Error('gift receipt mismatch');
                  if(entry.kind==='SELLER'&&(!Number.isSafeInteger(entry.offer)||entry.offer<1||!Number.isSafeInteger(entry.expires)))throw Error('offer receipt mismatch');
                }
                if(this.data.game!==g||!g.v2Session)throw Error('settlement room changed');
                const fresh=finalizeV2NightSettlement(g.v2Session,p,receipt,this.now);
                this.acceptV2(g,fresh);
                for(const entry of dawn.entries){
                  if(entry.kind==='KLAUS'){
                    this.send(entry.target,'🎁 Klaus sizga '+entry.amount+' Dollar sovg‘a qildi.');
                    this.send(entry.actor,'🎁 '+entry.amount+' Dollar sovg‘angiz yetkazildi.');
                  }else if(entry.expires>this.now){
                    const offer={id:entry.offer,seller:entry.actor,buyer:entry.target,expires:entry.expires,round:p.round};
                    g.v2Offers=[...(g.v2Offers??[]).filter(o=>o.expires>this.now&&o.id!==offer.id),offer];
                    this.send(entry.target,'🛒 Sotuvchidan 50% chegirmali taklif. Bitta buyum tanlang. Xarid keyingi o‘yinlar inventariga qo‘shiladi.',sellerKeyboard(g.number,offer.id));
                  }
                }
                break;
              }
            }
            this.acceptV2(g,resolved);
            break;
          }
          case 'v2Buy': {
            const g=this.data.game,ledger=this.deps.v2Settlement;
            if(!g||g.number!==op.number||!g.v2Ledger||!ledger)throw Error('offer settlement unavailable');
            const offer=g.v2Offers?.find(o=>o.id===op.offer&&o.buyer===op.buyer);
            if(!offer)throw Error('missing offer');
            await this.deps.store.save(this.data);
            const status=await ledger.buyOffer(op.number,op.id,op.buyer,op.offer,op.code);
            if(this.data.game!==g)throw Error('settlement room changed');
            if(status==='PAID'){
              g.v2Offers=(g.v2Offers??[]).filter(o=>o.id!==offer.id);
              this.send(op.buyer,'✅ Chegirmali xarid bajarildi.');
              this.send(offer.seller,'✅ Sotuvchi taklifingiz xarid qilindi. Komissiya hisoblandi.');
            }else if(status==='INSUFFICIENT'){
              this.send(op.buyer,'Mablag‘ yetarli emas. Taklif muddati tugamagan bo‘lsa, qayta urinishingiz mumkin.');
            }else if(status==='UNAVAILABLE'||status==='CONFLICT'){
              g.v2Offers=(g.v2Offers??[]).filter(o=>o.id!==offer.id);
              this.send(op.buyer,'Bu taklif endi mavjud emas.');
            }else throw Error('unknown purchase receipt');
            break;
          }
          case 'v2Hero': {
            const g=this.data.game,ledger=this.deps.v2Settlement;
            if(!g||g.number!==op.number||!g.v2Session||!g.v2Ledger||!ledger)throw Error('hero settlement unavailable');
            await this.deps.store.save(this.data);
            const receipt=await ledger.settleHero(op.pending.request);
            if(this.data.game!==g||!g.v2Session)throw Error('settlement room changed');
            this.acceptV2(g,finalizeV2HeroShot(g.v2Session,op.pending,receipt));
            break;
          }
        }
      } catch {
        const failures = Math.min(6, (this.data.opsFailures ?? 0) + 1);
        this.data.opsFailures = failures;
        this.data.opsRetryAt = this.now + Math.min(60_000, 1000 * 2 ** failures);
        const v2=op.type==='v2Night'||op.type==='v2Hero'||op.type==='v2Buy'||op.type==='v2Running'||op.type==='v2Record';
        if(v2&&failures>=6){
          const hold:V2RecoveryHold={game:op.number,op:op.id,kind:op.type,since:this.now,failures};
          this.data.v2RecoveryHold=hold;
          this.send(this.chatId,'⏸ Hisob-kitob vaqtincha to‘xtatildi. O‘yin #'+op.number+' xavfsiz holatda; bot egasi tekshirishi kerak.');
          await this.deps.store.save(this.data);
          this.deps.reportV2Hold?.(hold);
        }else await this.deps.store.save(this.data);
        this.deps.reportRegistryFailure?.();
        return;
      }
      this.data.ops = this.data.ops.filter((x) => x.id !== op.id);
      delete this.data.opsRetryAt;
      delete this.data.opsFailures;
      // The receipt, new room state, outbox and removed pending operation are one durable write.
      await this.deps.store.save(this.data);
      await this.resumeV2Deferred();
    }
  }

  /** Internal owner command: inspect metadata, then retry the exact persisted
   * operation. No option to discard, refund or fabricate a receipt. */
  v2RecoveryStatus(game:number):V2RecoveryHold|null{
    const hold=this.data.v2RecoveryHold;
    return hold?.game===game?{...hold}:null;
  }
  async retryV2Recovery(game:number,op:number):Promise<boolean>{
    const hold=this.data.v2RecoveryHold,head=this.data.ops[0];
    if(this.processingOps||!hold||hold.game!==game||hold.op!==op||!head||head.id!==op||!('number' in head)||head.number!==game)return false;
    delete this.data.v2RecoveryHold;
    // One deliberate retry; if it fails it is held again rather than looping.
    this.data.opsRetryAt=this.now;
    await this.commit();
    return true;
  }
  /** Non-critical Telegram pin/cleanup retries cannot block game delivery or erase unrelated pins. */
  private async processLobbyTasks(budget:number):Promise<void>{
    for(let i=0;i<budget;i++){
      const task=(this.data.lobbyTasks??[]).find(x=>x.at<=this.now);
      if(!task)break;
      const g=this.data.game;
      const ref=g&&this.data.refs[lobbyRef(g.id)];
      if(task.kind==='pin'&&(!g||g.status!=='LOBBY'||g.number!==task.number||ref?.messageId!==task.messageId)){
        this.data.lobbyTasks=this.data.lobbyTasks!.filter(x=>x.id!==task.id);continue;
      }
      try{
        const method=task.kind==='pin'?'pinChatMessage':task.kind==='unpin'?'unpinChatMessage':task.kind==='deleteCommand'?'deleteMessage':'editMessageReplyMarkup';
        await this.deps.telegram.call(method,{chat_id:task.chatId,message_id:task.messageId,...(task.kind==='pin'?{disable_notification:true}:task.kind==='clear'?{reply_markup:{inline_keyboard:[]}}:{})});
        // A lobby may close during the Telegram call. Unpin precisely that message again.
        if(task.kind==='pin'&&(this.data.game!==g||g?.status!=='LOBBY'||this.data.refs[lobbyRef(g.id)]?.messageId!==task.messageId))this.lobbyTask('unpin',task,task.number);
        this.data.lobbyTasks=this.data.lobbyTasks!.filter(x=>x.id!==task.id);
      }catch(e){
        const err=e instanceof TgError?e:new TgError(0,String(e));
        task.attempts++;
        if(err.code===400||err.code===403||task.attempts>=5)this.data.lobbyTasks=this.data.lobbyTasks!.filter(x=>x.id!==task.id);
        else task.at=this.now+Math.max(1000*(2**task.attempts),(err.retryAfter??0)*1000);
      }
      await this.deps.store.save(this.data);
    }
  }

  /** Navbatdagi xabarlarni yuborish: FIFO, EDIT birlashtiriladi, 429 / 403 hisobga olinadi. */
  async flush(budget = SEND_BUDGET): Promise<number> {
    let sent = 0;
    while (this.data.outbox.length > 0 && sent < budget) {
      const item = this.data.outbox[0]!;
      if (item.notBefore > this.now) break;
      const successor=item.coalesceKey?this.data.outbox.find(o=>o.id>item.id&&o.coalesceKey===item.coalesceKey):undefined;
      if(successor){
        for(const id of item.commandMessageIds??[])this.attachCommand(successor,id);
        this.drop(item.id);
        continue;
      }
      try {
        sent++;
        const delivered=await this.deliver(item);
        if(delivered)for(const id of item.commandMessageIds??[])this.lobbyTask('deleteCommand',{chatId:item.chatId,messageId:id},0);
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
          if(item.payload.kind==='EDIT'&&desc.includes('message is not modified'))for(const id of item.commandMessageIds??[])this.lobbyTask('deleteCommand',{chatId:item.chatId,messageId:id},0);
          this.drop(item.id);
          continue;
        }
        item.attempts++;
        if (item.attempts > 5) this.drop(item.id);
        else item.notBefore = this.now + Math.min(60_000, 1000 * 2 ** item.attempts);
        break;
      }
    }
    // Once all edits have drained, discard obsolete v2 message references.
    if(!this.data.outbox.length){
      const room=this.data.game?.v2Session;
      for(const key of Object.keys(this.data.refs))if(key.startsWith('v2choice:')||key.startsWith('v2phase:')){
        const [,game,seq]=key.split(':');
        if(!room||game!==String(room.game)||seq!==String(room.state.seq))delete this.data.refs[key];
      }
    }
    await this.deps.store.save(this.data);
    return sent;
  }

  private drop(id: number): void {
    const item=this.data.outbox.find(o=>o.id===id);
    const payload=item?.payload;
    if(payload?.kind==='EDIT'&&payload.refKey.startsWith('v2choice:'))delete this.data.refs[payload.refKey];
    this.data.outbox = this.data.outbox.filter((o) => o.id !== id);
  }

  private async deliver(item: OutItem): Promise<boolean> {
    let p = item.payload;
    const key=item.storeRefAs;
    // Real group-message link, not a guessed chat URL. Only supergroup IDs have t.me/c links.
    const choice=p.kind==='SEND'?key:p.kind==='EDIT'?p.refKey:undefined;
    if(choice?.startsWith('v2choice:')&&(p.kind==='SEND'||p.kind==='EDIT')){
      const [,game,seq]=choice.split(':');
      const ref=this.data.refs['v2phase:'+game+':'+seq];
      if(ref&&String(ref.chatId).startsWith('-100'))p={...p,keyboard:[...(p.keyboard??[]),[{text:'Guruhga o‘tish',url:'https://t.me/c/'+String(ref.chatId).slice(4)+'/'+ref.messageId}]]};
    }
    const lobbySend=p.kind==='SEND'&&key?.startsWith('lobby:');
    const lobby=lobbySend?this.data.game:null;
    if(lobbySend){
      if(!lobby||lobby.status!=='LOBBY'||key!==lobbyRef(lobby.id))return false;
      const v=this.lobbyView(lobby);
      p={kind:'SEND',text:v.text,keyboard:v.keyboard};
    }
    if (p.kind === 'SEND') {
      if (p.visual) {
        if (this.deps.visuals) await sendVisual(this.deps.telegram, item.chatId, p.visual, undefined, p.keyboard);
        return false;
      }
      const res = await this.deps.telegram.call<{ message_id: number }>('sendMessage', {
        chat_id: item.chatId,
        text: p.text.length > 4096 ? `${p.text.slice(0, 4095)}…` : p.text,
        ...HTML,
        ...(p.keyboard ? { reply_markup: { inline_keyboard: p.keyboard } } : {}),
      });
      if(lobbySend&&lobby&&key){
        const fresh={chatId:item.chatId,messageId:res.message_id};
        if(this.data.game!==lobby||lobby.status!=='LOBBY')this.retireBoard(fresh,lobby.number);
        else{
          const old=this.data.refs[key];
          if(old&&old.messageId!==fresh.messageId)this.retireBoard(old,lobby.number);
          this.data.refs[key]=fresh;
          this.data.lobbyPostedAt=this.now;
          this.lobbyTask('pin',fresh,lobby.number);
        }
      }else if (item.storeRefAs) this.data.refs[item.storeRefAs] = { chatId: item.chatId, messageId: res.message_id };
      return true;
    }
    const ref = this.data.refs[p.refKey];
    if (!ref) return false; // asl xabar yuborilmagan — tahrirlash shart emas
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
    return true;
  }

  /** Faqat testlar uchun: joriy muddatni hozirga surish. */
  async forceDeadline(): Promise<void> {
    const g = this.data.game;
    if (g?.status === 'RUNNING' && g.state?.phaseEndsAt) g.state.phaseEndsAt = this.now;
    if(g?.v2Session&&!this.v2Pending(g.number)){if(g.v2Session.night)g.v2Session.night.deadline=this.now;else if(g.v2Session.state.deadline!==null)g.v2Session.state.deadline=this.now;}
    await this.alarm();
  }
}
