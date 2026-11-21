import { afterAll, describe, expect, it } from 'vitest';
import { BullTimerScheduler, redisConnection } from '../infra/timers';
import { silentLogger } from './test-utils';

describe('BullMQ taymerlari (§29)', () => {
  const scheduler = new BullTimerScheduler(redisConnection(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'), silentLogger);

  afterAll(async () => {
    await scheduler.close();
  });

  it('kechiktirilgan job vaqtida ishlaydi; bir bosqich uchun takroriy rejalashtirish bitta job beradi', async () => {
    expect(await scheduler.ping()).toBe(true);
    const fired: string[] = [];
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    scheduler.startWorker(async (job) => {
      fired.push(`${job.gameId}:${job.phaseSeq}`);
      resolve();
    });
    const gameId = `g${Date.now()}`;
    const at = new Date(Date.now() + 300);
    await scheduler.schedule({ gameId, phaseSeq: 3, at });
    await scheduler.schedule({ gameId, phaseSeq: 3, at });
    await scheduler.schedule({ gameId, phaseSeq: 3, at });
    await done;
    await new Promise((r) => setTimeout(r, 700));
    expect(fired).toEqual([`${gameId}:3`]);
  });
});
