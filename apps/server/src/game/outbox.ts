import type { Tx } from '@mafia/database';
import type { OutboxDraft } from '../telegram/outbox-types';

/** Outbox yozuvlarini tranzaksiya ichida qo'shadi. dedupe_key takrorlarni o'tkazib yuboradi. */
export async function writeOutbox(tx: Tx, drafts: OutboxDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  await tx.outboxMessage.createMany({
    data: drafts.map((d) => ({
      chatId: d.chatId,
      kind: d.payload.kind,
      payload: d.payload as object,
      dedupeKey: d.dedupeKey,
      coalesceKey: d.coalesceKey ?? null,
      storeRefAs: d.storeRefAs ?? null,
      gameId: d.gameId ?? null,
    })),
    skipDuplicates: true,
  });
}
