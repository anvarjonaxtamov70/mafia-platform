/**
 * Bosqich taymerlari (§29): BullMQ (Redis) + bazadagi deadline bo'yicha sweeper.
 * Taymer xotirada (setTimeout) emas, navbatda saqlanadi; restartdan keyin sweeper yetib kelgan bosqichlarni yakunlaydi.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Db } from '@mafia/database';
import type { TimerJob, TimerScheduler } from '../game/ports';
import type { Logger } from './logger';

export const TIMER_QUEUE = 'game-timers';

export type TimerHandler = (job: { gameId: string; phaseSeq: number }) => Promise<void>;

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  };
}

export class BullTimerScheduler implements TimerScheduler {
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(private readonly connection: ConnectionOptions, private readonly logger: Logger) {
    this.queue = new Queue(TIMER_QUEUE, { connection });
    this.queue.on('error', (e) => this.logger.warn({ err: String(e) }, 'timer queue error'));
  }

  async schedule(job: TimerJob): Promise<void> {
    await this.queue.add(
      'phase',
      { gameId: job.gameId, phaseSeq: job.phaseSeq },
      {
        // Bir bosqich uchun bitta job — takroriy rejalashtirish dedupe qilinadi
        jobId: `t-${job.gameId}-${job.phaseSeq}`,
        delay: Math.max(0, job.at.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  startWorker(handler: TimerHandler, concurrency = 20): void {
    this.worker = new Worker(
      TIMER_QUEUE,
      async (job) => {
        await handler(job.data as { gameId: string; phaseSeq: number });
      },
      { connection: this.connection, concurrency },
    );
    this.worker.on('error', (e) => this.logger.warn({ err: String(e) }, 'timer worker error'));
    this.worker.on('failed', (job, e) => this.logger.warn({ jobId: job?.id, err: String(e) }, 'timer job failed'));
  }

  async ping(): Promise<boolean> {
    try {
      await Promise.race([
        this.queue.getJobCounts('delayed'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('redis ping timeout')), 2000)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Sweeper: deadline o'tgan o'yinlarni topib, bosqichni yakunlaydi. Redis ishlamasa ham o'yin to'xtab qolmaydi.
 * Handler idempotent (phaseSeq va qulf bilan), shuning uchun BullMQ bilan birga ishlashi xavfsiz.
 */
export class Sweeper {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly db: Db,
    private readonly handler: TimerHandler,
    private readonly logger: Logger,
    private readonly opts: { intervalMs?: number; graceMs?: number } = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.sweep(), this.opts.intervalMs ?? 3000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(now = Date.now()): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const due = await this.db.game.findMany({
        where: { status: { in: ['LOBBY', 'RUNNING'] }, phaseDeadlineAt: { lte: new Date(now - (this.opts.graceMs ?? 1500)) } },
        select: { id: true, phaseSeq: true, status: true },
        orderBy: { phaseDeadlineAt: 'asc' },
        take: 100,
      });
      for (const g of due) {
        try {
          await this.handler({ gameId: g.id, phaseSeq: g.status === 'LOBBY' ? 0 : g.phaseSeq });
        } catch (e) {
          this.logger.error({ gameId: g.id, err: String(e) }, 'sweeper handler failed');
        }
      }
      return due.length;
    } finally {
      this.busy = false;
    }
  }

  /** Restartdan keyin barcha faol o'yinlar taymerlarini qayta rejalashtirish (dedupe jobId bilan). */
  async rescheduleAll(scheduler: TimerScheduler): Promise<number> {
    const active = await this.db.game.findMany({
      where: { status: { in: ['LOBBY', 'RUNNING'] }, phaseDeadlineAt: { not: null } },
      select: { id: true, phaseSeq: true, status: true, phaseDeadlineAt: true },
    });
    for (const g of active) {
      await scheduler
        .schedule({ gameId: g.id, phaseSeq: g.status === 'LOBBY' ? 0 : g.phaseSeq, at: g.phaseDeadlineAt! })
        .catch((e) => this.logger.warn({ err: String(e) }, 'reschedule failed'));
    }
    return active.length;
  }
}
