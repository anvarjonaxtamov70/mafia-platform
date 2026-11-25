/**
 * LobbyService (§3.4, §3.5): o'yin yaratish, qo'shilish, chiqish, boshlash, bekor qilish.
 */
import { createGame, cryptoRng, type GameMode, type Rng } from '@mafia/game-engine';
import { Prisma, type Db, type Group } from '@mafia/database';
import { escapeHtml, t } from '@mafia/localization';
import type { Logger } from '../infra/logger';
import { renderLobby, type ConfigSnapshot, type Keyboard, type LobbyError, type OutboxDraft } from '@mafia/bot-core';
import { GameService, postProcess } from './game.service';
import { loadGroupSettings, settingsToConfig } from './group-settings';
import { writeOutbox } from './outbox';
import type { Clock, DmProbe, OutboxNotifier, TimerScheduler } from './ports';
import { displayName, UsersService, type TgUser } from './users.service';

export type { LobbyError } from '@mafia/bot-core';

export type LobbyResult<T = object> = ({ ok: true } & T) | { ok: false; error: LobbyError; details?: Record<string, string | number> };

export function lobbyRef(gameId: string): string {
  return `lobby:${gameId}`;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface LobbyOptions {
  botUsername: string;
  devFakePlayers: boolean;
}

export class LobbyService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersService,
    private readonly games: GameService,
    private readonly timers: TimerScheduler,
    private readonly notifier: OutboxNotifier,
    private readonly dmProbe: DmProbe,
    private readonly logger: Logger,
    private readonly opts: LobbyOptions,
    private readonly clock: Clock = Date.now,
    private readonly rng: Rng = cryptoRng,
  ) {}

  async ensureGroup(chatId: number | bigint, title: string): Promise<Group> {
    return this.db.group.upsert({
      where: { telegramChatId: BigInt(chatId) },
      create: { telegramChatId: BigInt(chatId), title },
      update: { title, status: 'ACTIVE' },
    });
  }

  /** Oddiy guruh superguruhga ko'chganda chat ID yangilanadi (§27.3). */
  async migrateChat(oldChatId: number, newChatId: number): Promise<void> {
    const old = await this.db.group.findUnique({ where: { telegramChatId: BigInt(oldChatId) } });
    if (!old) return;
    const exists = await this.db.group.findUnique({ where: { telegramChatId: BigInt(newChatId) } });
    if (exists) return;
    await this.db.$transaction([
      this.db.group.update({ where: { id: old.id }, data: { telegramChatId: BigInt(newChatId), migratedToChatId: null } }),
      this.db.game.updateMany({ where: { groupId: old.id, status: { in: ['LOBBY', 'RUNNING'] } }, data: { chatId: BigInt(newChatId) } }),
    ]);
  }

  // ───────────────────────────── Ko'rinish ─────────────────────────────

  renderLobby(game: { number: number; mode: string; config: ConfigSnapshot; hostName: string; deadline: Date | null }, names: string[]): { text: string; keyboard: Keyboard } {
    return renderLobby({ ...game, deadline: game.deadline ? game.deadline.getTime() : null }, names, { now: this.clock(), botUsername: this.opts.botUsername });
  }

  private async lobbyDraft(gameId: string, tx: Prisma.TransactionClient = this.db): Promise<OutboxDraft | null> {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: { host: true, players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!game || game.status !== 'LOBBY') return null;
    const view = this.renderLobby(
      {
        number: game.number,
        mode: game.mode,
        config: game.configSnapshot as unknown as ConfigSnapshot,
        hostName: displayName(game.host),
        deadline: game.phaseDeadlineAt,
      },
      game.players.map((p) => p.displayName),
    );
    return {
      chatId: game.chatId,
      payload: { kind: 'EDIT', refKey: lobbyRef(game.id), text: view.text, keyboard: view.keyboard },
      dedupeKey: `lobby-edit:${game.id}:${game.version}:${game.players.length}:${this.clock()}`,
      coalesceKey: `lobby-edit:${game.id}`,
      gameId: game.id,
    };
  }

  // ───────────────────────────── Yaratish ─────────────────────────────

  async createLobby(input: { chatId: number; title: string; host: TgUser; isAdmin: boolean; mode?: GameMode; quick?: boolean }): Promise<LobbyResult<{ gameId: string; number: number; hostJoined: boolean }>> {
    const group = await this.ensureGroup(input.chatId, input.title);
    const settings = await loadGroupSettings(this.db, group.id);
    const host = await this.users.upsert(input.host);
    if (await this.users.isBanned(host.id)) return { ok: false, error: 'BANNED' };
    const mode = input.mode ?? settings.mode;
    const config: ConfigSnapshot = { ...settingsToConfig(settings, mode, input.quick), lobby: { lobbySec: settings.lobbySec, autostart: false, ...(input.quick ? { quick: true } : {}) } };
    const deadline: Date | null = null;

    let created: { id: string; number: number; hostJoined: boolean };
    try {
      created = await this.db.$transaction(async (tx) => {
        const active = await tx.game.findUnique({ where: { activeGroupKey: group.id } });
        if (active) throw new LobbyConflict('GROUP_ACTIVE_GAME');
        const game = await tx.game.create({
          data: {
            groupId: group.id,
            chatId: BigInt(input.chatId),
            hostUserId: host.id,
            mode,
            status: 'LOBBY',
            phase: 'LOBBY',
            phaseDeadlineAt: deadline,
            activeGroupKey: group.id,
            configSnapshot: config as unknown as object,
            balanceVersion: 'v1.1',
          },
        });
        let hostJoined = false;
        if (host.dmAvailable) {
          const busy = await tx.gamePlayer.findUnique({ where: { activeUserKey: host.id } });
          if (!busy) {
            await tx.gamePlayer.create({
              data: { gameId: game.id, userId: host.id, displayName: displayName(host), activeUserKey: host.id },
            });
            hostJoined = true;
          }
        }
        const view = this.renderLobby(
          { number: game.number, mode, config, hostName: displayName(host), deadline },
          hostJoined ? [displayName(host)] : [],
        );
        await writeOutbox(tx, [
          {
            chatId: game.chatId,
            payload: { kind: 'SEND', text: view.text, keyboard: view.keyboard },
            dedupeKey: `lobby-send:${game.id}`,
            storeRefAs: lobbyRef(game.id),
            gameId: game.id,
          },
        ]);
        return { id: game.id, number: game.number, hostJoined };
      });
    } catch (e) {
      if (e instanceof LobbyConflict) return { ok: false, error: e.code };
      if (isUniqueViolation(e)) return { ok: false, error: 'GROUP_ACTIVE_GAME' };
      throw e;
    }
    this.notifier.kick();

    return { ok: true, gameId: created.id, number: created.number, hostJoined: created.hostJoined };
  }

  private async findLobby(where: { number: number } | { chatId: number | bigint }) {
    if ('number' in where) return this.db.game.findUnique({ where: { number: where.number } });
    const group = await this.db.group.findUnique({ where: { telegramChatId: BigInt(where.chatId) } });
    if (!group) return null;
    return this.db.game.findUnique({ where: { activeGroupKey: group.id } });
  }

  // ───────────────────────────── Qo'shilish / chiqish ─────────────────────────────

  async join(where: { number: number } | { chatId: number | bigint }, from: TgUser, opts: { dmOpened?: boolean } = {}): Promise<LobbyResult<{ gameId: string; groupTitle: string }>> {
    const user = await this.users.upsert(from, opts);
    if (!user.dmAvailable) return { ok: false, error: 'NEED_DM' };
    if (await this.users.isBanned(user.id)) return { ok: false, error: 'BANNED' };
    const found = await this.findLobby(where);
    if (!found) return { ok: false, error: 'NOT_FOUND' };
    try {
      const r = await this.db.$transaction(async (tx): Promise<LobbyResult<{ gameId: string; groupTitle: string }>> => {
        await tx.$queryRaw`SELECT id FROM games WHERE id = ${found.id} FOR UPDATE`;
        const game = await tx.game.findUnique({ where: { id: found.id }, include: { group: true, _count: { select: { players: true } } } });
        if (!game || game.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
        const cfg = game.configSnapshot as unknown as ConfigSnapshot;
        const mine = await tx.gamePlayer.findUnique({ where: { gameId_userId: { gameId: game.id, userId: user.id } } });
        if (mine) return { ok: false, error: 'ALREADY_JOINED' };
        const busy = await tx.gamePlayer.findUnique({ where: { activeUserKey: user.id } });
        if (busy) return { ok: false, error: 'IN_OTHER_GAME' };
        if (game._count.players >= cfg.maxPlayers) return { ok: false, error: 'FULL' };
        await tx.gamePlayer.create({ data: { gameId: game.id, userId: user.id, displayName: displayName(user), activeUserKey: user.id } });
        await tx.game.update({ where: { id: game.id }, data: { version: { increment: 1 } } });
        const draft = await this.lobbyDraft(game.id, tx);
        if (draft) await writeOutbox(tx, [draft]);
        return { ok: true, gameId: game.id, groupTitle: game.group.title };
      });
      if (r.ok) this.notifier.kick();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: 'IN_OTHER_GAME' };
      throw e;
    }
  }

  async leave(where: { number: number } | { chatId: number | bigint }, from: TgUser): Promise<LobbyResult> {
    const user = await this.users.upsert(from);
    const found = await this.findLobby(where);
    if (!found) return { ok: false, error: 'NOT_FOUND' };
    if (found.status === 'RUNNING') {
      const r = await this.games.leave(found.id, BigInt(from.id));
      return r.ok ? { ok: true } : { ok: false, error: 'NOT_JOINED' };
    }
    const r = await this.db.$transaction(async (tx): Promise<LobbyResult> => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${found.id} FOR UPDATE`;
      const game = await tx.game.findUnique({ where: { id: found.id } });
      if (!game || game.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
      const del = await tx.gamePlayer.deleteMany({ where: { gameId: game.id, userId: user.id } });
      if (del.count === 0) return { ok: false, error: 'NOT_JOINED' };
      await tx.game.update({ where: { id: game.id }, data: { version: { increment: 1 } } });
      const draft = await this.lobbyDraft(game.id, tx);
      if (draft) await writeOutbox(tx, [draft]);
      return { ok: true };
    });
    if (r.ok) this.notifier.kick();
    return r;
  }

  /** Faqat development: bot-o'yinchilar bilan to'ldirish. */
  async devFill(chatId: number, count: number): Promise<LobbyResult<{ added: number }>> {
    if (!this.opts.devFakePlayers) return { ok: false, error: 'NO_PERMISSION' };
    const found = await this.findLobby({ chatId });
    if (!found || found.status !== 'LOBBY') return { ok: false, error: 'NOT_FOUND' };
    const cfg = found.configSnapshot as unknown as ConfigSnapshot;
    const r = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${found.id} FOR UPDATE`;
      const current = await tx.gamePlayer.count({ where: { gameId: found.id } });
      const toAdd = Math.max(0, Math.min(count, cfg.maxPlayers - current));
      for (let i = 0; i < toAdd; i++) {
        const telegramId = 9_000_000_000_000n + BigInt(found.number) * 100n + BigInt(current + i);
        const u = await tx.user.upsert({
          where: { telegramId },
          create: { telegramId, firstName: `🤖 Bot ${current + i + 1}`, isFake: true, dmAvailable: true, profile: { create: {} } },
          update: {},
        });
        await tx.gamePlayer.create({ data: { gameId: found.id, userId: u.id, displayName: u.firstName, activeUserKey: u.id } });
      }
      await tx.game.update({ where: { id: found.id }, data: { version: { increment: 1 } } });
      const draft = await this.lobbyDraft(found.id, tx);
      if (draft) await writeOutbox(tx, [draft]);
      return toAdd;
    });
    this.notifier.kick();
    return { ok: true, added: r };
  }

  // ───────────────────────────── Boshlash ─────────────────────────────

  async start(where: { number: number } | { chatId: number | bigint } | { id: string }, trigger: { telegramId: bigint; isAdmin: boolean } | 'auto'): Promise<LobbyResult<{ gameId: string }>> {
    if(trigger==='auto'||trigger?.isAdmin!==true)return {ok:false,error:'NO_PERMISSION'};
    const found = 'id' in where ? await this.db.game.findUnique({ where: { id: where.id } }) : await this.findLobby(where);
    if (!found) return { ok: false, error: 'NOT_FOUND' };
    if (found.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
    const game0 = await this.db.game.findUnique({ where: { id: found.id }, include: { host: true, players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } } });
    if (!game0) return { ok: false, error: 'NOT_FOUND' };
    const cfg = game0.configSnapshot as unknown as ConfigSnapshot;
    if (game0.players.length < cfg.minPlayers) return { ok: false, error: 'NOT_ENOUGH', details: { min: cfg.minPlayers, count: game0.players.length } };

    // Rollarni yuborishdan oldin shaxsiy chat ochiqligini tekshirish (§3.5)
    const real = game0.players.filter((p) => !p.user.isFake);
    const failing = new Set((await this.dmProbe.failing(real.map((p) => p.user.telegramId))).map(String));
    if (failing.size > 0) {
      const removed = real.filter((p) => failing.has(String(p.user.telegramId)));
      await this.db.$transaction(async (tx) => {
        await tx.gamePlayer.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } });
        await tx.user.updateMany({ where: { id: { in: removed.map((p) => p.userId) } }, data: { dmAvailable: false } });
        await tx.game.update({ where: { id: game0.id }, data: { version: { increment: 1 } } });
        await writeOutbox(tx, [
          {
            chatId: game0.chatId,
            payload: { kind: 'SEND', text: t('lobby.dm_failed', { names: removed.map((p) => escapeHtml(p.displayName)).join(', ') }) },
            dedupeKey: `lobby-dmfail:${game0.id}:${game0.version}`,
            gameId: game0.id,
          },
        ]);
        const draft = await this.lobbyDraft(game0.id, tx);
        if (draft) await writeOutbox(tx, [draft]);
      });
      this.notifier.kick();
      return { ok: false, error: 'DM_FAILED', details: { names: removed.map((p) => p.displayName).join(', ') } };
    }

    let schedule: { gameId: string; phaseSeq: number; at: Date } | null = null;
    const r = await this.db.$transaction(
      async (tx): Promise<LobbyResult<{ gameId: string }>> => {
        await tx.$queryRaw`SELECT id FROM games WHERE id = ${game0.id} FOR UPDATE`;
        const game = await tx.game.findUnique({ where: { id: game0.id }, include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } } });
        if (!game || game.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
        if (game.players.length < cfg.minPlayers) return { ok: false, error: 'NOT_ENOUGH', details: { min: cfg.minPlayers, count: game.players.length } };
        const now = this.clock();
        const { lobby: _lobby, ...config } = cfg;
        void _lobby;
        const created = createGame({
          id: game.id,
          mode: game.mode as GameMode,
          players: game.players.map((p) => ({ id: p.userId, name: p.displayName })),
          config,
          now,
          rng: this.rng,
        });
        if (!created.ok) return { ok: false, error: 'NOT_ENOUGH' };
        const fakes = new Set(game.players.filter((p) => p.user.isFake).map((p) => p.userId));
        const pp = postProcess(created.state, created.events, fakes, -1, now, this.rng);
        await tx.game.update({ where: { id: game.id }, data: { startedAt: new Date(now) } });
        await this.games.persist(tx, game, null, pp.state, pp.events, now);
        await writeOutbox(tx, [
          { chatId: game.chatId, payload: { kind: 'CLEAR_KEYBOARD', refKey: lobbyRef(game.id) }, dedupeKey: `lobby-close:${game.id}`, gameId: game.id },
        ]);
        if (pp.state.status === 'RUNNING' && pp.state.phaseEndsAt) {
          schedule = { gameId: game.id, phaseSeq: pp.state.phaseSeq, at: new Date(pp.state.phaseEndsAt) };
        }
        return { ok: true, gameId: game.id };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    if (r.ok) {
      this.notifier.kick();
      if (schedule) await this.games.safeSchedule(schedule);
      this.logger.info({ gameId: game0.id, players: game0.players.length }, 'game started');
    }
    return r;
  }

  // ───────────────────────────── Bekor qilish ─────────────────────────────

  async cancel(where: { number: number } | { chatId: number | bigint } | { id: string }, trigger: { telegramId: bigint; isAdmin: boolean } | 'timeout', text?: string): Promise<LobbyResult> {
    const found = 'id' in where ? await this.db.game.findUnique({ where: { id: where.id }, include: { host: true } }) : await this.findLobbyWithHost(where);
    if (!found) return { ok: false, error: 'NOT_FOUND' };
    if (trigger !== 'timeout' && !trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
    if (found.status === 'RUNNING') {
      if (trigger === 'timeout' || !trigger.isAdmin) return { ok: false, error: 'NO_PERMISSION' };
      const ok = await this.games.cancelRunning(found.id, 'ADMIN', t('game.cancelled_admin'));
      if (ok) this.notifier.kick();
      return ok ? { ok: true } : { ok: false, error: 'NOT_LOBBY' };
    }
    const r = await this.db.$transaction(async (tx): Promise<LobbyResult> => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${found.id} FOR UPDATE`;
      const game = await tx.game.findUnique({ where: { id: found.id } });
      if (!game || game.status !== 'LOBBY') return { ok: false, error: 'NOT_LOBBY' };
      await tx.game.update({
        where: { id: game.id },
        data: { status: 'CANCELLED', activeGroupKey: null, phaseDeadlineAt: null, cancelReason: trigger === 'timeout' ? 'TIMEOUT' : 'HOST', version: { increment: 1 } },
      });
      await tx.gamePlayer.updateMany({ where: { gameId: game.id }, data: { activeUserKey: null } });
      await writeOutbox(tx, [
        { chatId: game.chatId, payload: { kind: 'CLEAR_KEYBOARD', refKey: lobbyRef(game.id) }, dedupeKey: `lobby-close:${game.id}`, gameId: game.id },
        { chatId: game.chatId, payload: { kind: 'SEND', text: text ?? t('lobby.cancelled') }, dedupeKey: `lobby-cancel:${game.id}`, gameId: game.id },
      ]);
      return { ok: true };
    });
    if (r.ok) this.notifier.kick();
    return r;
  }

  private async findLobbyWithHost(where: { number: number } | { chatId: number | bigint }) {
    const g = await this.findLobby(where);
    if (!g) return null;
    return this.db.game.findUnique({ where: { id: g.id }, include: { host: true } });
  }

  /** Legacy scheduled registration jobs are harmless after manual-start migration. */
  async onLobbyTimeout(gameId: string): Promise<void> {
    await this.db.game.updateMany({where:{id:gameId,status:'LOBBY'},data:{phaseDeadlineAt:null}});
  }
}

class LobbyConflict extends Error {
  constructor(readonly code: LobbyError) {
    super(code);
  }
}
