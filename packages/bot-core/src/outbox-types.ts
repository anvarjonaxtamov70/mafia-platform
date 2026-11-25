export type Button = { text: string; callback_data: string } | { text: string; url: string };

export type Keyboard = Button[][];

export type OutboxPayload =
  | { kind: 'SEND'; text: string; keyboard?: Keyboard; visual?: string }
  /** refKey — oldin yuborilgan xabar (message_refs) */
  | { kind: 'EDIT'; refKey: string; text: string; keyboard?: Keyboard }
  | { kind: 'CLEAR_KEYBOARD'; refKey: string }
  | { kind: 'DELETE'; refKey: string };

export interface OutboxDraft {
  chatId: bigint;
  payload: OutboxPayload;
  dedupeKey: string;
  coalesceKey?: string;
  storeRefAs?: string;
  gameId?: string;
}

/** Tugmalarni n tadan qatorlarga bo'lish */
export function rows(buttons: Button[], perRow = 2): Keyboard {
  const out: Keyboard = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
}

/** Tugma matni (HTML emas) — uzun ismlarni qisqartirish */
export function buttonLabel(text: string, max = 28): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
