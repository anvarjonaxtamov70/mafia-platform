/**
 * Composition root: barcha servislarni yig'adi va APP_ROLE bo'yicha ishga tushiradi.
 *  - all    — bot + worker bitta jarayonda (development)
 *  - bot    — faqat Telegram update larni qabul qiladi
 *  - worker — taymerlar, sweeper, outbox dispatcher
 * Bir nechta nusxa ishlashi mumkin: holat PostgreSQLda, qulflar va SKIP LOCKED bilan.
 */
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { Api, Bot, webhookCallback } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AppEnv } from '@mafia/config';
import { createPrismaClient, type Db } from '@mafia/database';
import { GameService } from './game/game.service';
import { LobbyService } from './game/lobby.service';
import { MemoryScheduler, noopNotifier, type DmProbe, type OutboxNotifier, type TimerScheduler } from './game/ports';
import { QueriesService } from './game/queries.service';
import { UsersService } from './game/users.service';
import { createLogger, scrubSecrets, type Logger } from './infra/logger';
import { BullTimerScheduler, redisConnection, Sweeper } from './infra/timers';
import { createBot, registerCommands } from './telegram/bot';
import { OutboxDispatcher } from './telegram/dispatcher';
import { AdminChecker, TelegramDmProbe } from './telegram/helpers';

export class Runtime {
  readonly logger: Logger;
  readonly db: Db;
  readonly startedAt = Date.now();
  api: Api | null = null;
  bot: Bot | null = null;
  botInfo: UserFromGetMe | null = null;
  dispatcher: OutboxDispatcher | null = null;
  timers: TimerScheduler = new MemoryScheduler();
  bull: BullTimerScheduler | null = null;
  sweeper: Sweeper | null = null;
  games!: GameService;
  lobby!: LobbyService;
  users!: UsersService;
  queries!: QueriesService;
  webhookHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null;

  constructor(readonly env: AppEnv) {
    this.logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
    this.db = createPrismaClient(env.DATABASE_URL, { poolSize: 10 });
  }

  get runsBot(): boolean {
    return this.env.APP_ROLE === 'all' || this.env.APP_ROLE === 'bot';
  }

  get runsWorker(): boolean {
    return this.env.APP_ROLE === 'all' || this.env.APP_ROLE === 'worker';
  }

  async start(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`;
    this.logger.info({ appRole: this.env.APP_ROLE }, 'database connected');

    if (this.env.BOT_TOKEN) {
      this.api = new Api(this.env.BOT_TOKEN);
      this.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 30 }));
      this.api.config.use(apiThrottler());
      this.botInfo = await this.api.getMe();
      this.logger.info({ username: this.botInfo.username }, 'telegram connected');
    }

    // Taymerlar: Redis mavjud bo'lsa BullMQ, aks holda faqat sweeper (bazadagi deadline)
    try {
      const bull = new BullTimerScheduler(redisConnection(this.env.REDIS_URL), this.logger);
      if (await bull.ping()) {
        this.bull = bull;
        this.timers = bull;
      } else {
        await bull.close().catch(() => undefined);
        this.logger.warn('redis unavailable: timers fall back to database sweeper');
      }
    } catch (e) {
      this.logger.warn({ err: String(e) }, 'redis init failed: sweeper only');
    }

    this.users = new UsersService(this.db);
    let notifier: OutboxNotifier = noopNotifier;
    if (this.api && this.runsWorker) {
      const api = this.api;
      this.dispatcher = new OutboxDispatcher(
        this.db,
        {
          sendMessage: (chatId, text, other) => api.sendMessage(chatId, text, other),
          editMessageText: (chatId, messageId, text, other) => api.editMessageText(chatId, messageId, text, other),
          editMessageReplyMarkup: (chatId, messageId, other) => api.editMessageReplyMarkup(chatId, messageId, other),
          deleteMessage: (chatId, messageId) => api.deleteMessage(chatId, messageId),
        },
        this.logger,
        (chatId) => this.users.markDmBlocked(chatId),
      );
      notifier = this.dispatcher;
    }
    const dmProbe: DmProbe = this.api ? new TelegramDmProbe(this.api) : { failing: async () => [] };
    this.games = new GameService(this.db, this.timers, notifier, this.logger);
    this.lobby = new LobbyService(this.db, this.users, this.games, this.timers, notifier, dmProbe, this.logger, {
      botUsername: this.botInfo?.username ?? this.env.BOT_USERNAME ?? '',
      devFakePlayers: this.env.DEV_FAKE_PLAYERS && this.env.NODE_ENV !== 'production',
    });
    this.queries = new QueriesService(this.db);

    if (this.runsWorker) {
      const handler = async (job: { gameId: string; phaseSeq: number }) => {
        const g = await this.db.game.findUnique({ where: { id: job.gameId }, select: { status: true } });
        if (!g) return;
        if (g.status === 'LOBBY') await this.lobby.onLobbyTimeout(job.gameId);
        else if (g.status === 'RUNNING') await this.games.onPhaseTimer(job.gameId, job.phaseSeq);
      };
      this.bull?.startWorker(handler);
      this.sweeper = new Sweeper(this.db, handler, this.logger);
      // Restart: faol o'yinlarni tiklash (§29)
      const n = await this.sweeper.rescheduleAll(this.timers);
      await this.sweeper.sweep();
      this.sweeper.start();
      this.dispatcher?.start();
      this.logger.info({ activeGames: n }, 'worker started, active games recovered');
    }

    if (this.runsBot && this.env.BOT_TOKEN && this.botInfo) {
      const superadmins = new Set(this.env.SUPERADMIN_IDS);
      this.bot = createBot(this.env.BOT_TOKEN, {
        env: this.env,
        db: this.db,
        users: this.users,
        lobby: this.lobby,
        games: this.games,
        queries: this.queries,
        admin: new AdminChecker(this.api!, superadmins),
        logger: this.logger,
        botUsername: this.botInfo.username,
        botInfo: this.botInfo,
      });
      this.bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 30 }));
      await registerCommands(this.bot).catch((e) => this.logger.warn({ err: scrubSecrets(String(e)) }, 'setMyCommands failed'));
      const allowed = ['message', 'callback_query', 'my_chat_member'] as const;
      if (this.env.TELEGRAM_MODE === 'webhook') {
        await this.bot.api.setWebhook(this.env.WEBHOOK_URL!, { secret_token: this.env.WEBHOOK_SECRET!, allowed_updates: [...allowed] });
        this.webhookHandler = webhookCallback(this.bot, 'express', { secretToken: this.env.WEBHOOK_SECRET! }) as never;
        this.logger.info('webhook mode');
      } else {
        // Polling va webhook aralashmasligi uchun avval webhookni o'chiramiz (§31.2)
        await this.bot.api.deleteWebhook();
        void this.bot.start({ allowed_updates: [...allowed], onStart: () => this.logger.info('polling started') }).catch((e) => {
          this.logger.error({ err: scrubSecrets(String(e)) }, 'polling stopped with error');
        });
      }
    } else if (this.runsBot) {
      this.logger.warn('BOT_TOKEN not set: Telegram bot is not started');
    }
  }

  async health(): Promise<{ status: 'ok' | 'degraded'; db: boolean; redis: boolean | null; telegram: boolean; uptimeSec: number }> {
    const db = await this.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = this.bull ? await this.bull.ping() : null;
    return {
      status: db ? 'ok' : 'degraded',
      db,
      redis,
      telegram: !!this.botInfo,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async stop(): Promise<void> {
    this.logger.info('graceful shutdown');
    await this.bot?.stop().catch(() => undefined);
    this.sweeper?.stop();
    await this.dispatcher?.stop();
    await this.bull?.close().catch(() => undefined);
    await this.db.$disconnect();
  }
}
