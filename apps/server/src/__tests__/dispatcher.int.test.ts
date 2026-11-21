import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeOutbox } from '../game/outbox';
import { OutboxDispatcher, type TelegramSender } from '../telegram/dispatcher';
import { resetDb, silentLogger, testDb } from './test-utils';

const db = testDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDb(db);
});

class FakeSender implements TelegramSender {
  sent: { chatId: number; text: string }[] = [];
  edits: { chatId: number; messageId: number; text: string }[] = [];
  failWith: Record<number, { error_code: number; description: string; parameters?: { retry_after: number } }> = {};
  private nextId = 100;

  async sendMessage(chatId: number, text: string) {
    const f = this.failWith[chatId];
    if (f) throw f;
    this.sent.push({ chatId, text });
    return { message_id: this.nextId++ };
  }
  async editMessageText(chatId: number, messageId: number, text: string) {
    this.edits.push({ chatId, messageId, text });
    return true;
  }
  async editMessageReplyMarkup() {
    return true;
  }
  async deleteMessage() {
    return true;
  }
}

describe('OutboxDispatcher (§30)', () => {
  it('yuboradi, xabar ID ni saqlaydi, EDIT birlashtiriladi (faqat oxirgisi)', async () => {
    const sender = new FakeSender();
    const d = new OutboxDispatcher(db, sender, silentLogger, async () => {});
    await db.$transaction((tx) =>
      writeOutbox(tx, [
        { chatId: -1n, payload: { kind: 'SEND', text: 'lobby' }, dedupeKey: 'a', storeRefAs: 'lobby:x' },
        { chatId: -1n, payload: { kind: 'EDIT', refKey: 'lobby:x', text: 'e1' }, dedupeKey: 'b', coalesceKey: 'L' },
        { chatId: -1n, payload: { kind: 'EDIT', refKey: 'lobby:x', text: 'e2' }, dedupeKey: 'c', coalesceKey: 'L' },
        { chatId: -1n, payload: { kind: 'EDIT', refKey: 'lobby:x', text: 'e3' }, dedupeKey: 'd', coalesceKey: 'L' },
      ]),
    );
    await d.tick();
    expect(sender.sent.map((s) => s.text)).toEqual(['lobby']);
    expect(sender.edits.map((e) => e.text)).toEqual(['e3']);
    expect(await db.messageRef.findUnique({ where: { key: 'lobby:x' } })).not.toBeNull();
    expect(await db.outboxMessage.count({ where: { status: 'SKIPPED' } })).toBe(2);
  });

  it('dedupe: bir xil kalit ikki marta yozilmaydi', async () => {
    await db.$transaction((tx) => writeOutbox(tx, [{ chatId: 1n, payload: { kind: 'SEND', text: 'x' }, dedupeKey: 'same' }]));
    await db.$transaction((tx) => writeOutbox(tx, [{ chatId: 1n, payload: { kind: 'SEND', text: 'x' }, dedupeKey: 'same' }]));
    expect(await db.outboxMessage.count()).toBe(1);
  });

  it('403: foydalanuvchi bloklangan deb belgilanadi, qayta urinilmaydi', async () => {
    const sender = new FakeSender();
    sender.failWith[555] = { error_code: 403, description: 'Forbidden: bot was blocked by the user' };
    const blocked: bigint[] = [];
    const d = new OutboxDispatcher(db, sender, silentLogger, async (id) => {
      blocked.push(id);
    });
    await db.$transaction((tx) =>
      writeOutbox(tx, [
        { chatId: 555n, payload: { kind: 'SEND', text: '1' }, dedupeKey: '1' },
        { chatId: 555n, payload: { kind: 'SEND', text: '2' }, dedupeKey: '2' },
      ]),
    );
    await d.tick();
    expect(blocked).toEqual([555n]);
    expect(await db.outboxMessage.count({ where: { status: 'FAILED' } })).toBe(2);
  });

  it('429: retry_after bo‘yicha keyinroq qayta uriniladi', async () => {
    const sender = new FakeSender();
    sender.failWith[777] = { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } };
    const d = new OutboxDispatcher(db, sender, silentLogger, async () => {});
    await db.$transaction((tx) => writeOutbox(tx, [{ chatId: 777n, payload: { kind: 'SEND', text: 'x' }, dedupeKey: 'r' }]));
    await d.tick();
    const m = await db.outboxMessage.findFirstOrThrow();
    expect(m.status).toBe('PENDING');
    expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3000);
  });

  it('bir chat ichida tartib saqlanadi', async () => {
    const sender = new FakeSender();
    const d = new OutboxDispatcher(db, sender, silentLogger, async () => {});
    await db.$transaction((tx) =>
      writeOutbox(
        tx,
        Array.from({ length: 30 }, (_, i) => ({ chatId: -5n, payload: { kind: 'SEND' as const, text: `m${i}` }, dedupeKey: `o${i}` })),
      ),
    );
    await d.tick();
    expect(sender.sent.map((s) => s.text)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
  });
});
