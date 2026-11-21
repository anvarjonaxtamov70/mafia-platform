/**
 * GameService — o'yin holatini bazada xavfsiz o'zgartirish.
 *
 * Har bir buyruq:
 *  1. games qatorini SELECT … FOR UPDATE bilan qulflaydi (parallel worker/serverlar bitta bosqichni ikki marta hisoblamaydi)
 *  2. Engine funksiyasini qo'llaydi (sof)
 *  3. Holat, o'yinchilar, hodisalar, outbox xabarlari va natijalarni BITTA tranzaksiyada yozadi (versiya tekshiruvi bilan)
 *  4. Commitdan keyin keyingi bosqich taymerini rejalashtiradi
 */
import {
  advancePhase,
  autoplayPlayers,
  canEndPhaseEarly,
  cryptoRng,
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
  type GameState,
  type Rng,
} from '@mafia/game-engine';
import type { Db, Prisma, Tx } from '@mafia/database';
import { escapeHtml, t } from '@mafia/localization';
import type { Logger } from '../infra/logger';
import { writeOutbox } from './outbox';
import { present, type PresentUser } from '@mafia/bot-core';
import type { Clock, OutboxNotifier, TimerScheduler } from './ports';
import { StatsService } from './stats.service';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[]; playerId: string | null }
  | { ok: false; error: EngineErrorCode | 'NOT_FOUND' | 'CONFLICT' };

type GameRow = Prisma.GameGetPayload<{ include: { players: { include: { user: true } } } }>;

interface MutateContext {
  game: GameRow;
  now: number;
  rng: Rng;
  /** Buyruq beruvchi o'yinchi (User.id) */
  playerId: string | null;
}

type Mutator = (state: GameState, ctx: MutateContext) => EngineResult;
type AfterApply = (tx: Tx, ctx: MutateContext, before: GameState, after: GameState) => Promise<void>;

export function userMap(game: GameRow): Map<string, PresentUser> {
  return new Map(game.players.map((p) => [p.userId, { telegramId: p.user.telegramId, isFake: p.user.isFake }]));
}

export interface PostProcessResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Bot-o'yinchilar (faqat dev) yangi bosqichda harakat qiladi, hamma harakat qilgan bo'lsa bosqich erta tugaydi.
 * `alreadyPlayedSeq` — shu bosqichda bot-o'yinchilar allaqachon o'ynagan.
 */
export function postProcess(state: GameState, events: GameEvent[], fakes: ReadonlySet<string>, alreadyPlayedSeq: number, now: number, rng: Rng): PostProcessResult {
  let s = state;
  const out = [...events];
  let played = alreadyPlayedSeq;
  for (let i = 0; i < 30 && s.status === 'RUNNING'; i++) {
    if (fakes.size > 0 && s.phaseSeq !== played) {
      s = autoplayPlayers(s, fakes, rng, now);
      played = s.phaseSeq;
    }
    if (!canEndPhaseEarly(s)) break;
    const r = advancePhase(s, now, rng);
    if (!r.ok) break;
    s = r.state;
    out.push(...r.events);
  }
  return { state: s, events: out };
}

export class GameService {
  private readonly stats = new StatsService();

  constructor(
    private readonly db: Db,
    private readonly timers: TimerScheduler,
    private readonly notifier: OutboxNotifier,
    private readonly logger: Logger,
    private readonly clock: Clock = Date.now,
    private readonly rng: Rng = cryptoRng,
  ) {}

  /** Umumiy mutatsiya: qulf → engine → yozish → taymer. */
  async mutate(
    where: { id: string } | { number: number },
    actorTelegramId: bigint | null,
    mutator: Mutator,
    afterApply?: AfterApply,
  ): Promise<CommandResult> {
    const now = this.clock();
    let schedule: { gameId: string; phaseSeq: number; at: Date } | null = null;
    const result = await this.db.$transaction(
      async (tx): Promise<CommandResult> => {
        const head = await tx.game.findUnique({ where, select: { id: true } });
        if (!head) return { ok: false, error: 'NOT_FOUND' };
        await tx.$queryRaw`SELECT id FROM games WHERE id = ${head.id} FOR UPDATE`;
        const game = await tx.game.findUnique({
          where: { id: head.id },
          include: { players: { include: { user: true } } },
        });
        if (!game || game.status !== 'RUNNING' || !game.state) return { ok: false, error: 'GAME_FINISHED' };
        const before = game.state as unknown as GameState;
        const playerId =
          actorTelegramId === null ? null : (game.players.find((p) => p.user.telegramId === actorTelegramId)?.userId ?? null);
        if (actorTelegramId !== null && !playerId) return { ok: false, error: 'NOT_A_PLAYER' };
        const ctx: MutateContext = { game, now, rng: this.rng, playerId };
        const r = mutator(before, ctx);
        if (!r.ok) return { ok: false, error: r.error };

        const fakes = new Set(game.players.filter((p) => p.user.isFake).map((p) => p.userId));
        const pp = postProcess(r.state, r.events, fakes, before.phaseSeq, now, this.rng);
        await this.persist(tx, game, before, pp.state, pp.events, now);
        if (afterApply) await afterApply(tx, ctx, before, pp.state);
        if (pp.state.status === 'RUNNING' && pp.state.phaseSeq !== before.phaseSeq && pp.state.phaseEndsAt) {
          schedule = { gameId: game.id, phaseSeq: pp.state.phaseSeq, at: new Date(pp.state.phaseEndsAt) };
        }
        return { ok: true, state: pp.state, events: pp.events, playerId };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
    if (result.ok) {
      this.notifier.kick();
      if (schedule) await this.safeSchedule(schedule);
    }
    return result;
  }

  async safeSchedule(job: { gameId: string; phaseSeq: number; at: Date }): Promise<void> {
    try {
      await this.timers.schedule(job);
    } catch (e) {
      // Taymer navbati ishlamasa ham sweeper bazadagi deadline bo'yicha bosqichni yakunlaydi
      this.logger.warn({ err: String(e), gameId: job.gameId }, 'timer schedule failed; sweeper will handle');
    }
  }

  /** Holatni va unga bog'liq barcha yozuvlarni saqlash (tranzaksiya ichida). */
  async persist(tx: Tx, game: GameRow, before: GameState | null, state: GameState, events: GameEvent[], now: number): Promise<void> {
    const finished = state.status === 'FINISHED';
    const version = game.version + 1;
    const updated = await tx.game.updateMany({
      where: { id: game.id, version: game.version },
      data: {
        state: state as unknown as object,
        status: finished ? 'FINISHED' : 'RUNNING',
        phase: state.phase,
        phaseSeq: state.phaseSeq,
        phaseDeadlineAt: state.phaseEndsAt ? new Date(state.phaseEndsAt) : null,
        version,
        ...(finished
          ? { finishedAt: new Date(now), winnerType: state.result?.outcome ?? null, activeGroupKey: null }
          : {}),
      },
    });
    if (updated.count !== 1) throw new Error('CONFLICT: game version changed');

    // O'yinchilar holatini sinxronlash
    for (const p of state.players) {
      const prev = before?.players.find((x) => x.id === p.id);
      const row = game.players.find((x) => x.userId === p.id);
      if (!row) continue;
      const statusChanged = !prev || prev.status !== p.status;
      if (!statusChanged && !finished) continue;
      await tx.gamePlayer.update({
        where: { id: row.id },
        data: {
          status: p.status,
          seatNumber: p.seat,
          roleId: p.role,
          faction: p.faction,
          ...(p.status === 'DEAD' && prev?.status !== 'DEAD' ? { diedAt: new Date(now), exitReason: p.death?.cause ?? null } : {}),
          ...(p.status === 'LEFT' ? { exitReason: 'LEFT' } : {}),
          ...(p.status === 'PERSONAL_WIN_EXIT' ? { exitReason: 'PERSONAL_WIN' } : {}),
          // O'yindan chiqqan (LEFT) yoki o'yin tugagan bo'lsa, boshqa o'yinga qo'shila oladi
          ...(finished || p.status === 'LEFT' ? { activeUserKey: null } : {}),
        },
      });
    }

    // Hodisalar jurnali (audit, tarixni tiklash)
    if (events.length > 0) {
      await tx.gameEvent.createMany({
        data: events.map((e, i) => {
          const { audience, ...body } = e;
          return {
            gameId: game.id,
            sequence: version * 1000 + i,
            phaseSeq: state.phaseSeq,
            eventType: e.type,
            visibility: audience.kind === 'public' ? 'PUBLIC' : audience.kind === 'mafia' ? 'MAFIA' : 'PRIVATE',
            recipientUserId: audience.kind === 'private' ? audience.playerId : null,
            payload: body as object,
          };
        }),
      });
    }

    const users = userMap(game);
    const drafts = present({
      game: { id: game.id, number: game.number, chatId: game.chatId },
      version,
      state,
      events,
      users,
      prevPhaseSeq: before?.phaseSeq ?? 0,
    });
    await writeOutbox(tx, drafts);

    if (finished && before?.status !== 'FINISHED') {
      const resultDrafts = await this.stats.recordGame(tx, { id: game.id, groupId: game.groupId }, state, users);
      await writeOutbox(tx, resultDrafts);
    }
  }

  /** Faqat o'qish: UI uchun joriy holat (tugma klaviaturalarini qurish). */
  async peek(gameNumber: number): Promise<{ id: string; number: number; status: string; state: GameState | null } | null> {
    const g = await this.db.game.findUnique({ where: { number: gameNumber }, select: { id: true, number: true, status: true, state: true } });
    if (!g) return null;
    return { id: g.id, number: g.number, status: g.status, state: (g.state as unknown as GameState) ?? null };
  }

  /** Foydalanuvchining faol (RUNNING) o'yini — Mafia chat relay va guruh jimligi uchun. */
  async activeRunningGameOf(userId: string): Promise<{ id: string; number: number; chatId: bigint; state: GameState } | null> {
    const gp = await this.db.gamePlayer.findUnique({ where: { activeUserKey: userId }, include: { game: true } });
    if (!gp || gp.game.status !== 'RUNNING' || !gp.game.state) return null;
    return { id: gp.game.id, number: gp.game.number, chatId: gp.game.chatId, state: gp.game.state as unknown as GameState };
  }

  /** Tunda Mafia a'zosi shaxsiy chatga yozgan matn tirik jamoadoshlarga yetkaziladi (§8). */
  async relayMafiaChat(userId: string, messageId: number, text: string): Promise<boolean> {
    const g = await this.activeRunningGameOf(userId);
    if (!g || g.state.phase !== 'NIGHT') return false;
    const me = g.state.players.find((p) => p.id === userId);
    if (!me || me.status !== 'ALIVE' || me.faction !== 'MAFIA') return false;
    const mates = g.state.players.filter((p) => p.faction === 'MAFIA' && p.status === 'ALIVE' && p.id !== userId);
    const users = await this.db.user.findMany({ where: { id: { in: mates.map((m) => m.id) }, isFake: false } });
    const body = t('dm.mafia_chat', { name: escapeHtml(me.name), text: escapeHtml(text.slice(0, 1000)) });
    await this.db.$transaction((tx) =>
      writeOutbox(
        tx,
        users.map((u) => ({
          chatId: u.telegramId,
          payload: { kind: 'SEND' as const, text: body },
          dedupeKey: `mchat:${g.id}:${userId}:${messageId}:${u.id}`,
          gameId: g.id,
        })),
      ),
    );
    this.notifier.kick();
    return true;
  }

  // ───────────────────────────── Buyruqlar ─────────────────────────────

  private seatToId(state: GameState, seat: number): string | null {
    return state.players.find((p) => p.seat === seat)?.id ?? null;
  }

  async nightAction(gameNumber: number, telegramId: bigint, kind: ActionKind, seats: number[], phaseSeq: number): Promise<CommandResult> {
    return this.mutate(
      { number: gameNumber },
      telegramId,
      (state, ctx) => {
        const targetIds = seats.map((s) => this.seatToId(state, s));
        if (targetIds.some((x) => x === null)) return { ok: false, error: 'INVALID_TARGET', state };
        return submitNightAction(state, { actorId: ctx.playerId!, kind, targetIds: targetIds as string[], now: ctx.now, phaseSeq });
      },
      async (tx, ctx, before) => {
        await tx.roleAction.create({
          data: {
            gameId: ctx.game.id,
            phaseNumber: phaseSeq,
            nightNumber: before.nightNumber,
            actorUserId: ctx.playerId!,
            actionType: kind,
            targetIds: seats.map((s) => this.seatToId(before, s)),
            status: 'SUBMITTED',
            idempotencyKey: `${ctx.game.id}:${phaseSeq}:${ctx.playerId}:${before.actionSeq + 1}`,
          },
        });
      },
    );
  }

  async skip(gameNumber: number, telegramId: bigint, phaseSeq: number): Promise<CommandResult> {
    return this.mutate({ number: gameNumber }, telegramId, (state, ctx) => skipNightAction(state, ctx.playerId!, phaseSeq));
  }

  async mafiaVote(gameNumber: number, telegramId: bigint, seat: number, phaseSeq: number): Promise<CommandResult> {
    return this.mutate({ number: gameNumber }, telegramId, (state, ctx) => {
      const target = seat === 0 ? null : this.seatToId(state, seat);
      if (seat !== 0 && !target) return { ok: false, error: 'INVALID_TARGET', state };
      return submitMafiaVote(state, ctx.playerId!, target, phaseSeq);
    });
  }

  async dayVote(gameNumber: number, telegramId: bigint, seat: number, phaseSeq: number): Promise<CommandResult> {
    return this.mutate(
      { number: gameNumber },
      telegramId,
      (state, ctx) => {
        const choice = seat === 0 ? 'NONE' : this.seatToId(state, seat);
        if (!choice) return { ok: false, error: 'INVALID_TARGET', state };
        return submitDayVote(state, ctx.playerId!, choice, phaseSeq);
      },
      async (tx, ctx, before) => {
        const target = seat === 0 ? null : this.seatToId(before, seat);
        await tx.vote.upsert({
          where: { gameId_dayNumber_voterUserId: { gameId: ctx.game.id, dayNumber: before.dayNumber, voterUserId: ctx.playerId! } },
          create: { gameId: ctx.game.id, dayNumber: before.dayNumber, voterUserId: ctx.playerId!, targetUserId: target, choice: target ? 'PLAYER' : 'NONE' },
          update: { targetUserId: target, choice: target ? 'PLAYER' : 'NONE', submittedAt: new Date(ctx.now) },
        });
      },
    );
  }

  async revealMayor(gameNumber: number, telegramId: bigint): Promise<CommandResult> {
    return this.mutate({ number: gameNumber }, telegramId, (state, ctx) => revealMayor(state, ctx.playerId!));
  }

  async judgeVeto(gameNumber: number, telegramId: bigint, phaseSeq: number): Promise<CommandResult> {
    return this.mutate({ number: gameNumber }, telegramId, (state, ctx) => {
      if (state.phaseSeq !== phaseSeq) return { ok: false, error: 'STALE_PHASE', state };
      return judgeVeto(state, ctx.playerId!, ctx.now, ctx.rng);
    });
  }

  async leave(gameId: string, telegramId: bigint): Promise<CommandResult> {
    return this.mutate({ id: gameId }, telegramId, (state, ctx) => leaveGame(state, ctx.playerId!, ctx.now, ctx.rng));
  }

  /** Taymer yoki sweeper chaqiradi. Eskirgan (stale) taymerlar e'tiborsiz qoldiriladi. */
  async onPhaseTimer(gameId: string, phaseSeq: number): Promise<CommandResult> {
    return this.mutate({ id: gameId }, null, (state, ctx) => {
      if (state.phaseSeq !== phaseSeq) return { ok: false, error: 'STALE_PHASE', state };
      if (state.phaseEndsAt && state.phaseEndsAt > ctx.now + 1000) return { ok: false, error: 'WRONG_PHASE', state };
      return advancePhase(state, ctx.now, ctx.rng, phaseSeq);
    });
  }

  /** Favqulodda bekor qilish (admin). */
  async cancelRunning(gameId: string, reason: string, chatText: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${gameId} FOR UPDATE`;
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game || game.status !== 'RUNNING') return false;
      await tx.game.update({
        where: { id: gameId },
        data: { status: 'CANCELLED', cancelReason: reason, activeGroupKey: null, phaseDeadlineAt: null, finishedAt: new Date(), version: { increment: 1 } },
      });
      await tx.gamePlayer.updateMany({ where: { gameId }, data: { activeUserKey: null } });
      await writeOutbox(tx, [{ chatId: game.chatId, payload: { kind: 'SEND', text: chatText }, dedupeKey: `g:${gameId}:cancel`, gameId }]);
      return true;
    });
  }
}
