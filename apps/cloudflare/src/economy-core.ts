/**
 * EconomyCore — Coins ledger, kunlik mukofot, vazifalar, do'kon, inventar, Arcade buyumlari,
 * VIP obunalar, Telegram Stars to'lovlari, referal va murojaatlar (Registry DO ichida, SQLite).
 *
 * Qoidalar:
 *  - Balans faqat wallet_tx orqali o'zgaradi; har bir yozuvning noyob idempotency kaliti bor.
 *  - Balans manfiy bo'lmaydi (tekshiruv + CHECK constraint).
 *  - Xarid va buyumni berish bitta tranzaksiyada.
 *  - To'lov faqat Telegram successful_payment bilan tasdiqlanadi; bitta charge_id bir marta.
 */
import {
  ARCADE_FIELD,
  catalogItem,
  DAILY_QUESTS,
  dailyAmount,
  DAY_MS,
  gameCoins,
  isAvailable,
  prevDay,
  REFERRAL,
  starsProduct,
  tashkentDay,
  tashkentDayStart,
  TICKETS_PER_DAY,
  TIER_RANK,
  type DailyInfo,
  type InventoryInfo,
  type ItemKind,
  type PaidTier,
  type QuestCode,
  type ReferralInfo,
  type RoleStatRow,
  type StarsProduct,
  type Tier,
  type WalletInfo,
} from '@mafia/bot-core';
import type { Sql, SqlParam } from './sql';

export const ECONOMY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS wallets (
    telegram_id INTEGER PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0), frame TEXT, title TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_tx (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
    type TEXT NOT NULL, ref TEXT, idem TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS wallet_tx_user ON wallet_tx (telegram_id, id)`,
  `CREATE TABLE IF NOT EXISTS inventory (
    telegram_id INTEGER NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), armed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_id, item)
  )`,
  `CREATE TABLE IF NOT EXISTS item_reservations (
    game_number INTEGER NOT NULL, telegram_id INTEGER NOT NULL, item TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (game_number, telegram_id, item)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_claims (
    telegram_id INTEGER NOT NULL, day TEXT NOT NULL, streak INTEGER NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS user_quests (
    telegram_id INTEGER NOT NULL, day TEXT NOT NULL, code TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER,
    PRIMARY KEY (telegram_id, day, code)
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, tier TEXT NOT NULL, starts_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, charge_id TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (telegram_id, tier, expires_at)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL, product TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, paid_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    charge_id TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL, order_id TEXT, product TEXT, amount INTEGER NOT NULL,
    currency TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, refunded_at INTEGER, refunded_by TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS payments_user ON payments (telegram_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS referrals (
    referred_id INTEGER PRIMARY KEY, referrer_id INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING', created_at INTEGER NOT NULL, rewarded_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id)`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN', answer TEXT, answered_by TEXT, created_at INTEGER NOT NULL, answered_at INTEGER
  )`,
];

/** Buyurtma amal qilish muddati (pre_checkout tekshiruvi) */
export const ORDER_TTL_MS = 24 * 3_600_000;

export type BuyResult =
  | { ok: true; balance: number; code: string }
  | { ok: false; error: 'UNKNOWN' | 'TIER_ONLY' | 'OWNED' | 'INSUFFICIENT'; balance: number; price?: number };

export type ClaimDailyResult = { ok: true; amount: number; streak: number; balance: number } | { ok: false; error: 'ALREADY' };

export type CheckOrderResult = { ok: true; product: StarsProduct } | { ok: false; reason: string };

export interface PaymentInput {
  tgId: number;
  payload: string;
  amount: number;
  currency: string;
  chargeId: string;
}

export type PaymentResult =
  | { status: 'GRANTED' | 'DUPLICATE'; product: StarsProduct['code']; until: number | null }
  | { status: 'UNMATCHED' };

export interface PaymentRow {
  chargeId: string;
  tgId: number;
  product: string | null;
  amount: number;
  status: string;
  createdAt: number;
}

export interface GameRewardInput {
  number: number;
  tgId: number;
  outcome: string;
  survived: boolean;
  left: boolean;
}

export interface GameRewardResult {
  coins: number;
  referral: { referrerId: number; reward: number } | null;
}

class InsufficientFunds extends Error {}

function defaultRandomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class EconomyCore {
  constructor(
    private readonly sql: Sql,
    private readonly clock: () => number = Date.now,
    private readonly randomId: () => string = defaultRandomId,
    private readonly owners: ReadonlySet<number> = new Set<number>(),
  ) {}

  isOwner(tgId: number): boolean {
    return this.owners.has(tgId);
  }

  /** Virtual owner allowance; never minted into the transferable/earned ledger. */
  spendableCoins(tgId: number): number {
    return this.isOwner(tgId) ? 1_000_000_000 : this.coins(tgId);
  }

  migrate(): void {
    for (const q of ECONOMY_SCHEMA) this.sql.exec(q);
  }

  private one<T>(q: string, ...p: SqlParam[]): T | undefined {
    return this.sql.exec<T>(q, ...p)[0];
  }

  // ───────────────────────────── Ledger ─────────────────────────────

  coins(tgId: number): number {
    return this.one<{ coins: number }>(`SELECT coins FROM wallets WHERE telegram_id = ?`, tgId)?.coins ?? 0;
  }

  /** Balansni o'zgartirish (yagona yo'l). Bir xil idem bilan takroriy chaqiruv hech narsa o'zgartirmaydi. */
  credit(tgId: number, amount: number, type: string, ref: string | null, idem: string): { balance: number; duplicate: boolean } {
    if (!Number.isInteger(amount)) throw new Error('amount must be integer');
    return this.sql.tx(() => {
      if (this.one(`SELECT 1 AS x FROM wallet_tx WHERE idem = ?`, idem)) return { balance: this.coins(tgId), duplicate: true };
      this.sql.exec(`INSERT OR IGNORE INTO wallets (telegram_id) VALUES (?)`, tgId);
      const next = this.coins(tgId) + amount;
      if (next < 0) throw new InsufficientFunds();
      this.sql.exec(`UPDATE wallets SET coins = ? WHERE telegram_id = ?`, next, tgId);
      this.sql.exec(
        `INSERT INTO wallet_tx (telegram_id, amount, balance_after, type, ref, idem, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        tgId,
        amount,
        next,
        type,
        ref,
        idem,
        this.clock(),
      );
      return { balance: next, duplicate: false };
    });
  }

  /** Kesh balans ledger bilan mosligini tekshirish (audit) */
  ledgerBalance(tgId: number): number {
    return this.one<{ s: number | null }>(`SELECT SUM(amount) AS s FROM wallet_tx WHERE telegram_id = ?`, tgId)?.s ?? 0;
  }

  // ───────────────────────────── Tarif (VIP) ─────────────────────────────

  tierInfo(tgId: number): { tier: Tier; vipUntil: number | null; proUntil: number | null } {
    const now = this.clock();
    const rows = this.sql.exec<{ tier: string; active: number; until: number }>(
      `SELECT tier, MAX(CASE WHEN starts_at <= ? AND expires_at > ? THEN 1 ELSE 0 END) AS active, MAX(expires_at) AS until
       FROM subscriptions WHERE telegram_id = ? AND status = 'ACTIVE' AND expires_at > ? GROUP BY tier`,
      now,
      now,
      tgId,
      now,
    );
    let tier: Tier = 'FREE';
    let vipUntil: number | null = null;
    let proUntil: number | null = null;
    for (const r of rows) {
      if (r.tier === 'VIP') {
        vipUntil = r.until;
        if (r.active && TIER_RANK[tier] < TIER_RANK.VIP) tier = 'VIP';
      } else if (r.tier === 'VIP_PRO') {
        proUntil = r.until;
        if (r.active) tier = 'VIP_PRO';
      }
    }
    return { tier: this.isOwner(tgId) ? 'VIP_PRO' : tier, vipUntil, proUntil };
  }

  wallet(tgId: number): WalletInfo {
    const w = this.one<{ coins: number; frame: string | null; title: string | null }>(`SELECT coins, frame, title FROM wallets WHERE telegram_id = ?`, tgId);
    const tiers = this.tierInfo(tgId);
    const items = this.items(tgId);
    const ok = (code: string | null | undefined) => {
      const it = code ? catalogItem(code) : undefined;
      return it && isAvailable(it, { tier: tiers.tier, items }) ? code! : null;
    };
    return { coins: this.isOwner(tgId) ? this.spendableCoins(tgId) : w?.coins ?? 0, frame: ok(w?.frame), title: ok(w?.title), ...tiers, ...(this.isOwner(tgId) ? { permanentOwner: true } : {}) };
  }

  private items(tgId: number): InventoryInfo['items'] {
    return this.sql
      .exec<{ code: string; qty: number; armed: number }>(`SELECT item AS code, qty, armed FROM inventory WHERE telegram_id = ? ORDER BY item`, tgId)
      .map((r) => ({ code: r.code, qty: r.qty, armed: r.armed === 1 }));
  }

  inventory(tgId: number): InventoryInfo {
    return { ...this.wallet(tgId), items: this.items(tgId) };
  }

  // ───────────────────────────── Do'kon ─────────────────────────────

  buy(tgId: number, code: string, idem: string): BuyResult {
    const item = catalogItem(code);
    if (!item) return { ok: false, error: 'UNKNOWN', balance: this.spendableCoins(tgId) };
    if (item.price === null) return { ok: false, error: 'TIER_ONLY', balance: this.spendableCoins(tgId) };
    const price = item.price;
    return this.sql.tx((): BuyResult => {
      if (this.one(`SELECT 1 AS x FROM wallet_tx WHERE idem = ?`, idem)) return { ok: true, balance: this.spendableCoins(tgId), code };
      const owned = this.one<{ qty: number }>(`SELECT qty FROM inventory WHERE telegram_id = ? AND item = ?`, tgId, code)?.qty ?? 0;
      if (item.kind !== 'ARCADE' && owned > 0) return { ok: false, error: 'OWNED', balance: this.spendableCoins(tgId) };
      let balance: number;
      try {
        this.credit(tgId, this.isOwner(tgId) ? 0 : -price, this.isOwner(tgId) ? 'OWNER_PURCHASE' : 'PURCHASE', code, idem);
        balance = this.spendableCoins(tgId);
      } catch (e) {
        if (e instanceof InsufficientFunds) return { ok: false, error: 'INSUFFICIENT', balance: this.spendableCoins(tgId), price };
        throw e;
      }
      this.sql.exec(
        `INSERT INTO inventory (telegram_id, item, qty) VALUES (?, ?, 1) ON CONFLICT (telegram_id, item) DO UPDATE SET qty = qty + 1`,
        tgId,
        code,
      );
      return { ok: true, balance, code };
    });
  }

  toggleArm(tgId: number, code: string): boolean {
    const item = catalogItem(code);
    if (!item || item.kind !== 'ARCADE') return false;
    return this.sql.exec(`UPDATE inventory SET armed = 1 - armed WHERE telegram_id = ? AND item = ? RETURNING armed`, tgId, code).length > 0;
  }

  equip(tgId: number, kind: Extract<ItemKind, 'FRAME' | 'TITLE'>, code: string | null): boolean {
    const column = kind === 'FRAME' ? 'frame' : 'title';
    if (code !== null) {
      const item = catalogItem(code);
      if (!item || item.kind !== kind) return false;
      const inv = this.inventory(tgId);
      if (!isAvailable(item, inv)) return false;
    }
    this.sql.exec(`INSERT OR IGNORE INTO wallets (telegram_id) VALUES (?)`, tgId);
    this.sql.exec(`UPDATE wallets SET ${column} = ? WHERE telegram_id = ?`, code, tgId);
    return true;
  }

  // ───────────────────────────── Kunlik mukofot ─────────────────────────────

  dailyInfo(tgId: number): DailyInfo {
    const today = tashkentDay(this.clock());
    const last = this.one<{ day: string; streak: number }>(`SELECT day, streak FROM daily_claims WHERE telegram_id = ? ORDER BY day DESC LIMIT 1`, tgId);
    const claimedToday = last?.day === today;
    const continues = last && (last.day === today || last.day === prevDay(today));
    const nextStreak = continues ? last!.streak + 1 : 1;
    const quests = DAILY_QUESTS.map((q) => {
      const r = this.one<{ progress: number; claimed_at: number | null }>(
        `SELECT progress, claimed_at FROM user_quests WHERE telegram_id = ? AND day = ? AND code = ?`,
        tgId,
        today,
        q.code,
      );
      return { ...q, progress: r?.progress ?? 0, claimed: r?.claimed_at != null };
    });
    return { coins: this.spendableCoins(tgId), claimedToday, nextAmount: dailyAmount(nextStreak), nextStreak, quests };
  }

  claimDaily(tgId: number): ClaimDailyResult {
    const today = tashkentDay(this.clock());
    return this.sql.tx((): ClaimDailyResult => {
      if (this.one(`SELECT 1 AS x FROM daily_claims WHERE telegram_id = ? AND day = ?`, tgId, today)) return { ok: false, error: 'ALREADY' };
      const last = this.one<{ day: string; streak: number }>(`SELECT day, streak FROM daily_claims WHERE telegram_id = ? ORDER BY day DESC LIMIT 1`, tgId);
      const streak = last && last.day === prevDay(today) ? last.streak + 1 : 1;
      const amount = dailyAmount(streak);
      this.sql.exec(`INSERT INTO daily_claims (telegram_id, day, streak, amount, created_at) VALUES (?, ?, ?, ?, ?)`, tgId, today, streak, amount, this.clock());
      this.credit(tgId, amount, 'DAILY', today, `daily:${tgId}:${today}`);
      return { ok: true, amount, streak, balance: this.spendableCoins(tgId) };
    });
  }

  // ───────────────────────────── Vazifalar ─────────────────────────────

  private questProgress(tgId: number, code: QuestCode, delta: number): void {
    const def = DAILY_QUESTS.find((q) => q.code === code)!;
    const day = tashkentDay(this.clock());
    this.sql.exec(
      `INSERT INTO user_quests (telegram_id, day, code, progress) VALUES (?, ?, ?, MIN(?, ?))
       ON CONFLICT (telegram_id, day, code) DO UPDATE SET progress = MIN(user_quests.progress + ?, ?)`,
      tgId,
      day,
      code,
      delta,
      def.target,
      delta,
      def.target,
    );
  }

  claimQuest(tgId: number, code: string): { ok: true; reward: number; balance: number } | { ok: false } {
    const def = DAILY_QUESTS.find((q) => q.code === code);
    if (!def) return { ok: false };
    const day = tashkentDay(this.clock());
    return this.sql.tx(() => {
      const claimed = this.sql.exec(
        `UPDATE user_quests SET claimed_at = ? WHERE telegram_id = ? AND day = ? AND code = ? AND progress >= ? AND claimed_at IS NULL RETURNING code`,
        this.clock(),
        tgId,
        day,
        code,
        def.target,
      );
      if (claimed.length === 0) return { ok: false as const };
      this.credit(tgId, def.reward, 'QUEST', code, `quest:${tgId}:${day}:${code}`);
      return { ok: true as const, reward: def.reward, balance: this.spendableCoins(tgId) };
    });
  }

  // ───────────────────────────── O'yin mukofotlari (recordGame ichida) ─────────────────────────────

  /** O'yin yakuni: coins, vazifa progressi va referal (bir o'yin uchun bir marta — idem). */
  gameReward(r: GameRewardInput): GameRewardResult {
    const coins = gameCoins(r);
    if (coins > 0) this.credit(r.tgId, coins, 'GAME', String(r.number), `game:${r.number}:${r.tgId}`);
    if (!r.left) this.questProgress(r.tgId, 'PLAY_2', 1);
    if (r.outcome === 'WIN' || r.outcome === 'PERSONAL_WIN') this.questProgress(r.tgId, 'WIN_1', 1);
    if (r.survived && !r.left) this.questProgress(r.tgId, 'SURVIVE_1', 1);

    let referral: GameRewardResult['referral'] = null;
    if (!r.left) {
      const ref = this.one<{ referrer_id: number; games: number; status: string }>(
        `UPDATE referrals SET games = games + 1 WHERE referred_id = ? AND status = 'PENDING' RETURNING referrer_id, games, status`,
        r.tgId,
      );
      if (ref && ref.games >= REFERRAL.gamesRequired) {
        const rewarded = this.sql.exec(
          `UPDATE referrals SET status = 'REWARDED', rewarded_at = ? WHERE referred_id = ? AND status = 'PENDING' RETURNING referrer_id`,
          this.clock(),
          r.tgId,
        );
        if (rewarded.length > 0) {
          this.credit(ref.referrer_id, REFERRAL.reward, 'REFERRAL', String(r.tgId), `ref:${r.tgId}`);
          referral = { referrerId: ref.referrer_id, reward: REFERRAL.reward };
        }
      }
    }
    return { coins, referral };
  }

  // ───────────────────────────── Arcade buyumlari ─────────────────────────────

  /** O'yin boshlanishida yoqilgan (armed) buyumlarni band qilish: har turdan bittadan. Idempotent. */
  reserveArcade(number: number, tgIds: number[]): Record<string, { shield: boolean; fakeDocument: boolean }> {
    return this.sql.tx(() => {
      const out: Record<string, { shield: boolean; fakeDocument: boolean }> = {};
      for (const tgId of tgIds) {
        const got = { shield: false, fakeDocument: false };
        for (const [code, field] of Object.entries(ARCADE_FIELD)) {
          const already = this.one(`SELECT 1 AS x FROM item_reservations WHERE game_number = ? AND telegram_id = ? AND item = ?`, number, tgId, code);
          if (already) {
            got[field] = true;
            continue;
          }
          const taken = this.sql.exec(
            `UPDATE inventory SET qty = qty - 1 WHERE telegram_id = ? AND item = ? AND armed = 1 AND qty > 0 RETURNING qty`,
            tgId,
            code,
          );
          if (taken.length === 0) continue;
          this.sql.exec(`INSERT INTO item_reservations (game_number, telegram_id, item, created_at) VALUES (?, ?, ?, ?)`, number, tgId, code, this.clock());
          got[field] = true;
        }
        if (got.shield || got.fakeDocument) out[String(tgId)] = got;
      }
      return out;
    });
  }

  /** O'yin yakuni: ishlatilgan buyumlar sarflanadi, qolganlari inventarga qaytadi. Idempotent. */
  settleArcade(number: number, used: Record<string, string[]>): void {
    this.sql.tx(() => {
      const rows = this.sql.exec<{ telegram_id: number; item: string }>(
        `DELETE FROM item_reservations WHERE game_number = ? RETURNING telegram_id, item`,
        number,
      );
      for (const r of rows) {
        if ((used[String(r.telegram_id)] ?? []).includes(r.item)) continue;
        this.sql.exec(`UPDATE inventory SET qty = qty + 1 WHERE telegram_id = ? AND item = ?`, r.telegram_id, r.item);
      }
    });
  }

  /** O'yin boshlanmadi / bekor qilindi: barcha band qilingan buyumlar qaytariladi. */
  releaseArcade(number: number): void {
    this.settleArcade(number, {});
  }

  // ───────────────────────────── Telegram Stars ─────────────────────────────

  createOrder(tgId: number, code: string): { ok: true; id: string; payload: string; product: StarsProduct } | { ok: false } {
    const product = starsProduct(code);
    if (!product) return { ok: false };
    const id = this.randomId();
    this.sql.exec(
      `INSERT INTO orders (id, telegram_id, product, amount, currency, status, created_at) VALUES (?, ?, ?, ?, 'XTR', 'CREATED', ?)`,
      id,
      tgId,
      product.code,
      product.stars,
      this.clock(),
    );
    return { ok: true, id, payload: `o:${id}`, product };
  }

  private orderOf(payload: string) {
    const m = /^o:([0-9a-f]{8,64})$/.exec(payload);
    if (!m) return undefined;
    return this.one<{ id: string; telegram_id: number; product: string; amount: number; currency: string; status: string; created_at: number }>(
      `SELECT * FROM orders WHERE id = ?`,
      m[1]!,
    );
  }

  /** pre_checkout_query: tez tekshiruv (Telegram 10 soniya ichida javob kutadi). */
  checkOrder(payload: string, tgId: number, amount: number, currency: string): CheckOrderResult {
    const o = this.orderOf(payload);
    if (!o) return { ok: false, reason: 'NO_ORDER' };
    if (o.telegram_id !== tgId) return { ok: false, reason: 'WRONG_USER' };
    if (o.status !== 'CREATED') return { ok: false, reason: 'NOT_PAYABLE' };
    if (currency !== 'XTR' || o.currency !== 'XTR' || amount !== o.amount) return { ok: false, reason: 'AMOUNT' };
    if (this.clock() - o.created_at > ORDER_TTL_MS) return { ok: false, reason: 'EXPIRED' };
    const product = starsProduct(o.product);
    if (!product || product.stars !== amount) return { ok: false, reason: 'PRODUCT' };
    return { ok: true, product };
  }

  /** successful_payment: mahsulotni bir marta berish (telegram_payment_charge_id — noyob). */
  completePayment(p: PaymentInput): PaymentResult {
    return this.sql.tx((): PaymentResult => {
      const existing = this.one<{ product: string | null; status: string }>(`SELECT product, status FROM payments WHERE charge_id = ?`, p.chargeId);
      if (existing) {
        const prod = existing.product ? starsProduct(existing.product) : undefined;
        if (!prod) return { status: 'UNMATCHED' };
        return { status: 'DUPLICATE', product: prod.code, until: this.untilOf(p.tgId, prod) };
      }
      const now = this.clock();
      const o = this.orderOf(p.payload);
      const product = o ? starsProduct(o.product) : undefined;
      const matches = !!o && !!product && o.status === 'CREATED' && o.telegram_id === p.tgId && o.currency === 'XTR' && p.currency === 'XTR' && p.amount === o.amount;
      this.sql.exec(
        `INSERT INTO payments (charge_id, telegram_id, order_id, product, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        p.chargeId,
        p.tgId,
        o?.id ?? null,
        matches ? product!.code : null,
        p.amount,
        p.currency,
        matches ? 'PAID' : 'UNMATCHED',
        now,
      );
      if (!matches) return { status: 'UNMATCHED' };
      this.sql.exec(`UPDATE orders SET status = 'PAID', paid_at = ? WHERE id = ?`, now, o!.id);
      if (product!.tier && product!.days) this.extendTier(p.tgId, product!.tier, product!.days, p.chargeId);
      return { status: 'GRANTED', product: product!.code, until: this.untilOf(p.tgId, product!) };
    });
  }

  private untilOf(tgId: number, product: StarsProduct): number | null {
    if (!product.tier) return null;
    const t = this.tierInfo(tgId);
    return product.tier === 'VIP_PRO' ? t.proUntil : t.vipUntil;
  }

  /** Yangi davr joriy obuna tugagan joydan boshlanadi (muddat qo'shiladi). */
  private extendTier(tgId: number, tier: PaidTier, days: number, chargeId: string): void {
    const now = this.clock();
    const last = this.one<{ e: number | null }>(
      `SELECT MAX(expires_at) AS e FROM subscriptions WHERE telegram_id = ? AND tier = ? AND status = 'ACTIVE'`,
      tgId,
      tier,
    )?.e;
    const starts = Math.max(now, last ?? 0);
    this.sql.exec(
      `INSERT INTO subscriptions (telegram_id, tier, starts_at, expires_at, charge_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      tgId,
      tier,
      starts,
      starts + days * DAY_MS,
      chargeId,
      now,
    );
  }

  paymentInfo(chargeId: string): PaymentRow | null {
    const r = this.one<{ charge_id: string; telegram_id: number; product: string | null; amount: number; status: string; created_at: number }>(
      `SELECT * FROM payments WHERE charge_id = ?`,
      chargeId,
    );
    return r ? { chargeId: r.charge_id, tgId: r.telegram_id, product: r.product, amount: r.amount, status: r.status, createdAt: r.created_at } : null;
  }

  pendingRefunds(): { chargeId: string; tgId: number; amount: number }[] {
    return this.sql.exec<{ charge_id: string; telegram_id: number; amount: number }>(`SELECT charge_id, telegram_id, amount FROM payments WHERE status = 'REFUND_PENDING' ORDER BY created_at DESC LIMIT 100`).map((p) => ({ chargeId: p.charge_id, tgId: p.telegram_id, amount: p.amount }));
  }

  /** Atomic reservation prevents concurrent administrators from refunding the same payment. */
  beginRefund(chargeId: string): boolean {
    return this.sql.exec(`UPDATE payments SET status = 'REFUND_PENDING' WHERE charge_id = ? AND status IN ('PAID', 'UNMATCHED') RETURNING charge_id`, chargeId).length === 1;
  }

  /** Telegram refundStarPayment muvaffaqiyatli bo'lgandan keyin: to'lov va obuna davri bekor qilinadi. */
  markRefunded(chargeId: string, by: string): boolean {
    return this.sql.tx(() => {
      const now = this.clock();
      const done = this.sql.exec(
        `UPDATE payments SET status = 'REFUNDED', refunded_at = ?, refunded_by = ? WHERE charge_id = ? AND status <> 'REFUNDED' RETURNING telegram_id`,
        now,
        by,
        chargeId,
      );
      if (done.length === 0) return false;
      const sub = this.one<{ id: number; telegram_id: number; tier: string; starts_at: number; expires_at: number }>(
        `SELECT id, telegram_id, tier, starts_at, expires_at FROM subscriptions WHERE charge_id = ? AND status = 'ACTIVE'`,
        chargeId,
      );
      if (sub) {
        this.sql.exec(`UPDATE subscriptions SET status = 'REFUNDED' WHERE id = ?`, sub.id);
        // Keyingi (ketma-ket qo'shilgan) davrlar bo'shliq qolmasligi uchun oldinga suriladi
        const removed = sub.expires_at - Math.max(now, sub.starts_at);
        if (removed > 0) {
          this.sql.exec(
            `UPDATE subscriptions SET starts_at = starts_at - ?, expires_at = expires_at - ?
             WHERE telegram_id = ? AND tier = ? AND status = 'ACTIVE' AND starts_at >= ?`,
            removed,
            removed,
            sub.telegram_id,
            sub.tier,
            sub.expires_at,
          );
        }
      }
      return true;
    });
  }

  recentPayments(limit = 10, tgId?: number): PaymentRow[] {
    type Row = { charge_id: string; telegram_id: number; product: string | null; amount: number; status: string; created_at: number };
    const rows =
      tgId === undefined
        ? this.sql.exec<Row>(`SELECT * FROM payments ORDER BY created_at DESC LIMIT ?`, limit)
        : this.sql.exec<Row>(`SELECT * FROM payments WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?`, tgId, limit);
    return rows.map((r) => ({ chargeId: r.charge_id, tgId: r.telegram_id, product: r.product, amount: r.amount, status: r.status, createdAt: r.created_at }));
  }

  // ───────────────────────────── Referal ─────────────────────────────

  /** Faqat hali o'ynamagan, hech kim taklif qilmagan va o'zi bo'lmagan foydalanuvchi uchun. */
  applyReferral(newTgId: number, referrerId: number): boolean {
    if (newTgId === referrerId) return false;
    return this.sql.tx(() => {
      if (!this.one(`SELECT 1 AS x FROM users WHERE telegram_id = ? AND deleted_at IS NULL`, referrerId)) return false;
      if (this.one(`SELECT 1 AS x FROM referrals WHERE referred_id = ?`, newTgId)) return false;
      const played = this.one<{ games_played: number }>(`SELECT games_played FROM profiles WHERE telegram_id = ?`, newTgId)?.games_played ?? 0;
      if (played > 0) return false;
      this.sql.exec(`INSERT INTO referrals (referred_id, referrer_id, created_at) VALUES (?, ?, ?)`, newTgId, referrerId, this.clock());
      return true;
    });
  }

  referralInfo(tgId: number): ReferralInfo {
    const r = this.one<{ invited: number; rewarded: number | null }>(
      `SELECT COUNT(*) AS invited, SUM(CASE WHEN status = 'REWARDED' THEN 1 ELSE 0 END) AS rewarded FROM referrals WHERE referrer_id = ?`,
      tgId,
    );
    return { invited: r?.invited ?? 0, rewarded: r?.rewarded ?? 0 };
  }

  // ───────────────────────────── Murojaatlar ─────────────────────────────

  createTicket(tgId: number, category: string, message: string): { ok: true; id: number } | { ok: false } {
    const since = tashkentDayStart(this.clock());
    const count = this.one<{ c: number }>(`SELECT COUNT(*) AS c FROM tickets WHERE telegram_id = ? AND created_at >= ?`, tgId, since)!.c;
    if (count >= TICKETS_PER_DAY) return { ok: false };
    const r = this.one<{ id: number }>(
      `INSERT INTO tickets (telegram_id, category, message, created_at) VALUES (?, ?, ?, ?) RETURNING id`,
      tgId,
      category,
      message.slice(0, 2000),
      this.clock(),
    )!;
    return { ok: true, id: r.id };
  }

  answerTicket(id: number, by: string, answer: string): { tgId: number } | null {
    const r = this.one<{ telegram_id: number }>(
      `UPDATE tickets SET status = 'ANSWERED', answer = ?, answered_by = ?, answered_at = ? WHERE id = ? RETURNING telegram_id`,
      answer.slice(0, 2000),
      by,
      this.clock(),
      id,
    );
    return r ? { tgId: r.telegram_id } : null;
  }

  // ───────────────────────────── Statistika ─────────────────────────────

  roleStats(tgId: number): RoleStatRow[] {
    return this.sql.exec<RoleStatRow>(`SELECT role, played, won FROM role_stats WHERE telegram_id = ?`, tgId);
  }
}
