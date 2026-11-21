import type { Api } from 'grammy';
import type { DmProbe } from '../game/ports';

/** Shaxsiy chat ochiqligini sendChatAction orqali tekshiradi (xabar yubormaydi). */
export class TelegramDmProbe implements DmProbe {
  constructor(private readonly api: Api) {}

  async failing(telegramIds: bigint[]): Promise<bigint[]> {
    const results = await Promise.all(
      telegramIds.map(async (id) => {
        try {
          await this.api.sendChatAction(Number(id), 'typing');
          return null;
        } catch (e) {
          const code = (e as { error_code?: number }).error_code;
          // Tarmoq xatosida o'yinchini chiqarib yubormaymiz
          return code === 403 || code === 400 ? id : null;
        }
      }),
    );
    return results.filter((x): x is bigint => x !== null);
  }
}

/**
 * Guruh admin tekshiruvi (§25): getChatMember, qisqa muddatli kesh (eski ruxsat cheksiz saqlanmaydi).
 */
export class AdminChecker {
  private readonly cache = new Map<string, { value: boolean; expires: number }>();

  constructor(
    private readonly api: Api,
    private readonly superadmins: ReadonlySet<string>,
    private readonly ttlMs = 60_000,
  ) {}

  isSuperadmin(userId: number | bigint): boolean {
    return this.superadmins.has(String(userId));
  }

  async isChatAdmin(chatId: number, userId: number): Promise<boolean> {
    if (this.isSuperadmin(userId)) return true;
    const key = `${chatId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    let value: boolean;
    try {
      const m = await this.api.getChatMember(chatId, userId);
      value = m.status === 'creator' || m.status === 'administrator';
    } catch {
      value = false;
    }
    this.cache.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.cache.size > 10_000) this.cache.clear();
    return value;
  }

  invalidate(chatId: number, userId: number): void {
    this.cache.delete(`${chatId}:${userId}`);
  }
}

/** Oddiy token-bucket: foydalanuvchi bo'yicha tugma bosish tezligini cheklash (§31.7). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear();
    return true;
  }
}
