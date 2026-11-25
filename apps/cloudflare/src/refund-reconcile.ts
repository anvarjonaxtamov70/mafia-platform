import type { Telegram } from './telegram';

interface PendingRefund { chargeId: string; tgId: number; amount: number }
interface StarTransaction {
  id: string;
  amount: number;
  nanostar_amount?: number;
  receiver?: { type: string; user?: { id: number } };
  source?: unknown;
}

/** Read-only provider lookup. Never issues refunds or assumes an absent transaction failed. */
export async function reconcileRefunds(
  tg: Telegram,
  pending: readonly PendingRefund[],
  mark: (chargeId: string) => Promise<boolean>,
): Promise<number> {
  if (!pending.length) return 0;
  const remaining = new Map(pending.map((p) => [p.chargeId, p]));
  let matched = 0;
  // Bounded work per scheduled invocation; old unmatched refunds remain visible for review.
  for (let offset = 0; offset < 300 && remaining.size; offset += 100) {
    const result = await tg.call<{ transactions: StarTransaction[] }>('getStarTransactions', { offset, limit: 100 });
    if (!Array.isArray(result?.transactions)) throw new Error('invalid Stars transactions');
    for (const tx of result.transactions) {
      const p = remaining.get(tx.id);
      if (!p || tx.source || tx.receiver?.type !== 'user' || tx.receiver.user?.id !== p.tgId ||
          Math.abs(tx.amount) !== p.amount || (tx.nanostar_amount ?? 0) !== 0) continue;
      if (await mark(p.chargeId)) matched++;
      remaining.delete(p.chargeId);
    }
    if (result.transactions.length < 100) break;
  }
  return matched;
}
