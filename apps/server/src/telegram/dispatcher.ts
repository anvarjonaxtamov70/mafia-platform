/**
 * OutboxDispatcher (§30): outbox navbatidagi xabarlarni Telegramga yuboradi.
 *  - har bir chat uchun tartib saqlanadi (ketma-ket), chatlar parallel
 *  - EDIT lar birlashtiriladi (faqat eng oxirgisi yuboriladi)
 *  - 429 da retry_after hisobga olinadi, xatolarda cheklangan qayta urinish
 *  - botni bloklagan foydalanuvchiga qayta-qayta yuborilmaydi
 *  - bir nechta worker: SELECT … FOR UPDATE SKIP LOCKED
 */
import type { Db, OutboxMessage } from '@mafia/database';
import type { Logger } from '../infra/logger';
import { scrubSecrets } from '../infra/logger';
import type { OutboxNotifier } from '../game/ports';
import type { Keyboard, OutboxPayload } from '@mafia/bot-core';

export interface SendOptions {
  parse_mode: 'HTML';
  reply_markup?: { inline_keyboard: Keyboard };
  link_preview_options?: { is_disabled: boolean };
}

export interface TelegramSender {
  sendMessage(chatId: number, text: string, other: SendOptions): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, other: SendOptions): Promise<unknown>;
  editMessageReplyMarkup(chatId: number, messageId: number, other: { reply_markup?: { inline_keyboard: Keyboard } }): Promise<unknown>;
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
}

interface TelegramErrorShape {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

const MAX_ATTEMPTS = 6;
const MAX_REF_WAIT_ATTEMPTS = 10;
const TEXT_LIMIT = 4096;

function truncate(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
}

type Outcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'RETRY'; delayMs: number; reason: string };

export class OutboxDispatcher implements OutboxNotifier {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private kicked = false;
  private stopped = true;

  constructor(
    private readonly db: Db,
    private readonly sender: TelegramSender,
    private readonly logger: Logger,
    private readonly onBlocked: (chatId: bigint) => Promise<void>,
    private readonly opts: { intervalMs?: number; batch?: number; concurrency?: number } = {},
  ) {}

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs ?? 400);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (let i = 0; i < 50 && this.running; i++) await new Promise((r) => setTimeout(r, 100));
  }

  kick(): void {
    if (this.stopped) return;
    this.kicked = true;
    setImmediate(() => void this.tick());
  }

  /** Bir partiya xabarni yuboradi. Qaytaradi: qayta ishlangan xabarlar soni. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      for (let round = 0; round < 20; round++) {
        this.kicked = false;
        const batch = await this.claim();
        if (batch.length === 0) break;
        processed += batch.length;
        await this.processBatch(batch);
        if (batch.length < (this.opts.batch ?? 50) && !this.kicked) break;
      }
    } catch (e) {
      this.logger.error({ err: scrubSecrets(String(e)) }, 'outbox tick failed');
    } finally {
      this.running = false;
    }
    return processed;
  }

  private async claim(): Promise<OutboxMessage[]> {
    // Uzoq "SENDING" holatida qolganlar (masalan, jarayon o'lgan) qayta navbatga
    await this.db.$executeRaw`UPDATE outbox_messages SET status = 'PENDING' WHERE status = 'SENDING' AND locked_at < now() - interval '2 minutes'`;
    const limit = this.opts.batch ?? 50;
    const rows = await this.db.$queryRaw<{ id: bigint }[]>`
      UPDATE outbox_messages SET status = 'SENDING', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_messages
        WHERE status = 'PENDING' AND next_attempt_at <= now()
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (rows.length === 0) return [];
    return this.db.outboxMessage.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { id: 'asc' } });
  }

  private async processBatch(batch: OutboxMessage[]): Promise<void> {
    const byChat = new Map<string, OutboxMessage[]>();
    for (const m of batch) {
      const k = String(m.chatId);
      byChat.set(k, [...(byChat.get(k) ?? []), m]);
    }
    const queues = [...byChat.values()];
    const concurrency = this.opts.concurrency ?? 8;
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, queues.length) }, async () => {
      while (idx < queues.length) {
        const q = queues[idx++]!;
        let chatBlocked = false;
        for (const m of q) {
          if (chatBlocked) {
            await this.finish(m, { status: 'FAILED', reason: 'chat blocked' });
            continue;
          }
          const outcome = await this.deliver(m);
          await this.finish(m, outcome);
          if (outcome.status === 'FAILED' && outcome.reason === 'blocked') chatBlocked = true;
        }
      }
    });
    await Promise.all(workers);
  }

  private async finish(m: OutboxMessage, o: Outcome): Promise<void> {
    if (o.status === 'RETRY') {
      await this.db.outboxMessage.update({
        where: { id: m.id },
        data: { status: 'PENDING', nextAttemptAt: new Date(Date.now() + o.delayMs), lastError: o.reason.slice(0, 500) },
      });
      return;
    }
    await this.db.outboxMessage.update({
      where: { id: m.id },
      data: {
        status: o.status,
        sentAt: o.status === 'SENT' ? new Date() : null,
        lastError: o.status === 'SENT' ? null : o.reason.slice(0, 500),
      },
    });
  }

  private async deliver(m: OutboxMessage): Promise<Outcome> {
    const payload = m.payload as unknown as OutboxPayload;
    const chatId = Number(m.chatId);
    try {
      if (m.coalesceKey) {
        const newer = await this.db.outboxMessage.findFirst({
          where: { coalesceKey: m.coalesceKey, id: { gt: m.id }, status: { in: ['PENDING', 'SENDING'] } },
          select: { id: true },
        });
        if (newer) return { status: 'SKIPPED', reason: 'superseded' };
      }
      if (payload.kind === 'SEND') {
        const res = await this.sender.sendMessage(chatId, truncate(payload.text), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(payload.keyboard ? { reply_markup: { inline_keyboard: payload.keyboard } } : {}),
        });
        if (m.storeRefAs) {
          await this.db.messageRef.upsert({
            where: { key: m.storeRefAs },
            create: { key: m.storeRefAs, chatId: m.chatId, messageId: res.message_id },
            update: { chatId: m.chatId, messageId: res.message_id },
          });
        }
        return { status: 'SENT' };
      }
      const ref = await this.db.messageRef.findUnique({ where: { key: payload.refKey } });
      if (!ref) {
        // Asl xabar hali yuborilmagan bo'lishi mumkin
        if (m.attempts < MAX_REF_WAIT_ATTEMPTS) return { status: 'RETRY', delayMs: 1500, reason: 'ref not ready' };
        return { status: 'SKIPPED', reason: 'ref missing' };
      }
      const refChat = Number(ref.chatId);
      if (payload.kind === 'EDIT') {
        await this.sender.editMessageText(refChat, ref.messageId, truncate(payload.text), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(payload.keyboard ? { reply_markup: { inline_keyboard: payload.keyboard } } : {}),
        });
      } else if (payload.kind === 'CLEAR_KEYBOARD') {
        await this.sender.editMessageReplyMarkup(refChat, ref.messageId, { reply_markup: { inline_keyboard: [] } });
      } else {
        await this.sender.deleteMessage(refChat, ref.messageId);
      }
      return { status: 'SENT' };
    } catch (e) {
      return this.classify(e, m);
    }
  }

  private async classify(e: unknown, m: OutboxMessage): Promise<Outcome> {
    const err = (e ?? {}) as TelegramErrorShape;
    const code = err.error_code;
    const desc = (err.description ?? String(e)).toLowerCase();
    if (code === 403) {
      if (m.chatId > 0n) await this.onBlocked(m.chatId).catch(() => undefined);
      return { status: 'FAILED', reason: 'blocked' };
    }
    if (code === 400) {
      if (desc.includes('message is not modified')) return { status: 'SENT' };
      if (desc.includes('message to edit not found') || desc.includes("message can't be edited") || desc.includes('message to delete not found')) {
        return { status: 'SKIPPED', reason: desc };
      }
      if (desc.includes('chat not found') || desc.includes('bot was kicked')) return { status: 'FAILED', reason: desc };
      return { status: 'FAILED', reason: scrubSecrets(desc) };
    }
    if (code === 429) {
      const after = (err.parameters?.retry_after ?? 3) * 1000;
      return { status: 'RETRY', delayMs: after, reason: '429' };
    }
    if (m.attempts >= MAX_ATTEMPTS) return { status: 'FAILED', reason: scrubSecrets(desc) };
    this.logger.warn({ id: String(m.id), code, err: scrubSecrets(desc) }, 'outbox send failed, will retry');
    return { status: 'RETRY', delayMs: Math.min(60_000, 1000 * 2 ** m.attempts), reason: scrubSecrets(desc) };
  }
}
