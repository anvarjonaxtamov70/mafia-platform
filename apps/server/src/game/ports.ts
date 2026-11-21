/** Ilova servislari tashqi tizimlar bilan shu interfeyslar orqali ishlaydi (testda almashtiriladi). */

export interface TimerJob {
  gameId: string;
  phaseSeq: number;
  at: Date;
}

export interface TimerScheduler {
  schedule(job: TimerJob): Promise<void>;
}

/** Shaxsiy chat ochiqligini tekshirish (sendChatAction). Muvaffaqiyatsizlarini qaytaradi. */
export interface DmProbe {
  failing(telegramIds: bigint[]): Promise<bigint[]>;
}

export interface OutboxNotifier {
  kick(): void;
}

export type Clock = () => number;

export const noopNotifier: OutboxNotifier = { kick() {} };

export class MemoryScheduler implements TimerScheduler {
  readonly jobs: TimerJob[] = [];
  async schedule(job: TimerJob): Promise<void> {
    this.jobs.push(job);
  }
}
