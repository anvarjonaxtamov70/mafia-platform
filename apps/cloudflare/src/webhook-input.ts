import type { TgUpdate } from './router';

const MAX_BYTES = 256 * 1024;
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const positive = (v: unknown): v is number => id(v) && v > 0;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const optionalStr = (v: unknown, max: number): boolean => v === undefined || (typeof v === 'string' && v.length <= max);
const user = (v: unknown): v is Obj => obj(v) && positive(v['id']) && typeof v['first_name'] === 'string' && v['first_name'].length <= 512 && optionalStr(v['last_name'], 512) && optionalStr(v['username'], 128) && optionalStr(v['language_code'], 64) && (v['is_bot'] === undefined || typeof v['is_bot'] === 'boolean');
const chat = (v: unknown): v is Obj => obj(v) && id(v['id']) && v['id'] !== 0 && ['private','group','supergroup','channel'].includes(String(v['type'])) && optionalStr(v['title'], 512);
const purchase = (v: Obj): boolean => str(v['currency'], 16) && positive(v['total_amount']) && str(v['invoice_payload'], 256);
const status = (v: unknown): boolean => obj(v) && str(v['status'], 32);

export function validTelegramUpdate(v: unknown): v is TgUpdate {
  if (!obj(v) || !id(v['update_id']) || v['update_id'] < 0) return false;
  const events = ['message','callback_query','pre_checkout_query','my_chat_member'].filter((k) => v[k] !== undefined);
  if (events.length > 1) return false;
  const m = v['message'];
  if (m !== undefined) {
    if (!obj(m) || !id(m['message_id']) || !chat(m['chat']) || !optionalStr(m['text'], 16384)) return false;
    if (m['from'] !== undefined && !user(m['from'])) return false;
    if (m['sender_chat'] !== undefined && !chat(m['sender_chat'])) return false;
    if (m['migrate_to_chat_id'] !== undefined && (!id(m['migrate_to_chat_id']) || m['migrate_to_chat_id'] >= 0)) return false;
    const refund = m['refunded_payment'];
    if (refund !== undefined && (!obj(refund) || !purchase(refund) || !str(refund['telegram_payment_charge_id'], 256) || m['chat']['type'] !== 'private' || m['successful_payment'] !== undefined)) return false;
    if (refund === undefined && m['chat']['type'] === 'private' && (!user(m['from']) || m['from']['id'] !== m['chat']['id'])) return false;
    const p = m['successful_payment'];
    if (p !== undefined && (!obj(p) || !purchase(p) || !str(p['telegram_payment_charge_id'], 256) || !user(m['from']) || m['chat']['type'] !== 'private')) return false;
  }
  const c = v['callback_query'];
  if (c !== undefined) {
    if (!obj(c) || !str(c['id'], 128) || !user(c['from']) || !optionalStr(c['data'], 64)) return false;
    const msg = c['message'];
    if (msg !== undefined && (!obj(msg) || !id(msg['message_id']) || !chat(msg['chat']))) return false;
  }
  const q = v['pre_checkout_query'];
  if (q !== undefined && (!obj(q) || !str(q['id'], 128) || !user(q['from']) || !purchase(q))) return false;
  const member = v['my_chat_member'];
  if (member !== undefined && (!obj(member) || !chat(member['chat']) || !user(member['from']) || !status(member['old_chat_member']) || !status(member['new_chat_member']))) return false;
  return true;
}

/** Bound the actual streamed body, not only the optional Content-Length header. */
export async function readTelegramUpdate(request: Request): Promise<{ ok: true; update: TgUpdate } | { ok: false; status: 400 | 413 }> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  try {
    let size = 0;
    let body = '';
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const update: unknown = JSON.parse(body);
    return validTelegramUpdate(update) ? { ok: true, update } : { ok: false, status: 400 };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}
