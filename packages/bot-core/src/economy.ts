/**
 * Iqtisodiyot qoidalari va katalog (§17–§23). Runtime-mustaqil: Cloudflare va Node versiyalari uchun bitta manba.
 *
 *  - Coins: o'yin ichidagi valyuta, haqiqiy pulga almashtirilmaydi.
 *  - Telegram Stars (XTR): faqat VIP obuna. Coins bilan bitta balansda saqlanmaydi.
 *  - O'yin natijasiga ta'sir qiluvchi buyumlar faqat ARCADE rejimida ishlaydi (§1.2).
 */

export type Tier = 'FREE' | 'VIP' | 'VIP_PRO';
export type PaidTier = Exclude<Tier, 'FREE'>;

export const TIER_RANK: Record<Tier, number> = { FREE: 0, VIP: 1, VIP_PRO: 2 };
export const TIER_BADGE: Record<Tier, string> = { FREE: '', VIP: '👑', VIP_PRO: '💎' };

export function tierAllows(tier: Tier, need: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[need];
}

// ───────────────────────────── Katalog (Coins) ─────────────────────────────

export type ItemKind = 'FRAME' | 'TITLE' | 'ARCADE';

export interface CatalogItem {
  code: string;
  kind: ItemKind;
  emoji: string;
  /** Coins narxi; null — sotilmaydi (tarif bilan ochiladi) */
  price: number | null;
  /** Shu tarif faol bo'lsa bepul ochiladi */
  tier?: PaidTier;
}

export const CATALOG: readonly CatalogItem[] = [
  { code: 'BRONZE', kind: 'FRAME', emoji: '🥉', price: 300 },
  { code: 'SILVER', kind: 'FRAME', emoji: '🥈', price: 800 },
  { code: 'GOLD', kind: 'FRAME', emoji: '🥇', price: 2000 },
  { code: 'DIAMOND', kind: 'FRAME', emoji: '💎', price: null, tier: 'VIP' },
  { code: 'MAFIA_KING', kind: 'FRAME', emoji: '🎩', price: null, tier: 'VIP' },
  { code: 'LEGENDARY', kind: 'FRAME', emoji: '🌟', price: null, tier: 'VIP_PRO' },
  { code: 'CITY_HERO', kind: 'TITLE', emoji: '🏙', price: 1500 },
  { code: 'NIGHT_HUNTER', kind: 'TITLE', emoji: '🌙', price: 1500 },
  { code: 'DETECTIVE_MASTER', kind: 'TITLE', emoji: '🕵️', price: 2500 },
  { code: 'MAFIA_BOSS', kind: 'TITLE', emoji: '🎩', price: 2500 },
  { code: 'LEGENDARY_PLAYER', kind: 'TITLE', emoji: '🌟', price: null, tier: 'VIP_PRO' },
  { code: 'SHIELD', kind: 'ARCADE', emoji: '🛡', price: 300 },
  { code: 'FAKE_DOC', kind: 'ARCADE', emoji: '📜', price: 200 },
];

export function catalogItem(code: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.code === code);
}

/** Arcade buyumi → engine dagi maydon */
export const ARCADE_FIELD: Record<string, 'shield' | 'fakeDocument'> = { SHIELD: 'shield', FAKE_DOC: 'fakeDocument' };

// ───────────────────────────── Telegram Stars ─────────────────────────────

export type StarsProductCode = 'VIP_30' | 'VIP_PRO_30' | 'TEST_1';

export interface StarsProduct {
  code: StarsProductCode;
  stars: number;
  tier?: PaidTier;
  days?: number;
  /** Faqat bot egalari uchun (to'lov tizimini sinash) */
  adminOnly?: boolean;
}

export const STARS_PRODUCTS: readonly StarsProduct[] = [
  { code: 'VIP_30', stars: 99, tier: 'VIP', days: 30 },
  { code: 'VIP_PRO_30', stars: 249, tier: 'VIP_PRO', days: 30 },
  { code: 'TEST_1', stars: 1, adminOnly: true },
];

export function starsProduct(code: string): StarsProduct | undefined {
  return STARS_PRODUCTS.find((p) => p.code === code);
}

/** off — to'lov yopiq; admins — faqat bot egalari (sinov); all — hamma */
export type StarsMode = 'off' | 'admins' | 'all';

export function parseStarsMode(v: string | undefined): StarsMode {
  return v === 'off' || v === 'all' ? v : 'admins';
}

// ───────────────────────────── Mukofotlar ─────────────────────────────

/** 1–7-kun ketma-ket kunlik mukofot (§22.1); 7-kundan keyin yana 1-kundan */
export const DAILY_REWARDS = [50, 75, 100, 125, 150, 200, 300] as const;

export function dailyAmount(streak: number): number {
  return DAILY_REWARDS[(Math.max(1, streak) - 1) % DAILY_REWARDS.length]!;
}

export type QuestCode = 'PLAY_2' | 'WIN_1' | 'SURVIVE_1';

export interface QuestDef {
  code: QuestCode;
  target: number;
  reward: number;
}

export const DAILY_QUESTS: readonly QuestDef[] = [
  { code: 'PLAY_2', target: 2, reward: 60 },
  { code: 'WIN_1', target: 1, reward: 80 },
  { code: 'SURVIVE_1', target: 1, reward: 50 },
];

export const COIN_RULES = { finished: 10, win: 15 } as const;

export const REFERRAL = { gamesRequired: 2, reward: 100 } as const;

/** Bir foydalanuvchi bir kunda yuborishi mumkin bo'lgan murojaatlar */
export const TICKETS_PER_DAY = 5;

export function gameCoins(r: { outcome: string; left: boolean }): number {
  if (r.left) return 0;
  const won = r.outcome === 'WIN' || r.outcome === 'PERSONAL_WIN';
  return COIN_RULES.finished + (won ? COIN_RULES.win : 0);
}

// ───────────────────────────── Vaqt (Toshkent, UTC+5, yozgi vaqt yo'q) ─────────────────────────────

export const DAY_MS = 86_400_000;
export const TASHKENT_OFFSET_MS = 5 * 3_600_000;

export function tashkentDay(ts: number): string {
  return new Date(ts + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

export function prevDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Toshkent kuni boshlanishi (UTC ms) */
export function tashkentDayStart(ts: number): number {
  return Date.parse(`${tashkentDay(ts)}T00:00:00Z`) - TASHKENT_OFFSET_MS;
}

export function formatDate(ts: number): string {
  const d = new Date(ts + TASHKENT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ───────────────────────────── Referal ─────────────────────────────

export function refCode(tgId: number): string {
  return tgId.toString(36);
}

export function parseRefPayload(payload: string): number | null {
  const m = /^ref_([0-9a-z]{1,12})$/.exec(payload.trim());
  if (!m) return null;
  const id = parseInt(m[1]!, 36);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ───────────────────────────── Ko'rinishlar uchun ma'lumot ─────────────────────────────

export interface WalletInfo {
  /** Effective display balance; owner allowance is not part of the earned ledger. */
  coins: number;
  /** Separate in-game premium currency, not real money. */
  diamonds?: number;
  permanentOwner?: boolean;
  frame: string | null;
  title: string | null;
  tier: Tier;
  vipUntil: number | null;
  proUntil: number | null;
}

export interface InventoryInfo extends WalletInfo {
  items: { code: string; qty: number; armed: boolean }[];
}

export interface QuestState extends QuestDef {
  progress: number;
  claimed: boolean;
}

export interface DailyInfo {
  coins: number;
  claimedToday: boolean;
  /** Bugun olinadigan (yoki ertaga olinadigan) mukofot */
  nextAmount: number;
  nextStreak: number;
  quests: QuestState[];
}

export interface ReferralInfo {
  invited: number;
  rewarded: number;
}

export interface RoleStatRow {
  role: string;
  played: number;
  won: number;
}

/** Buyum foydalanuvchida bormi (sotib olingan yoki tarif bilan ochilgan) */
export function isAvailable(item: CatalogItem, inv: Pick<InventoryInfo, 'tier' | 'items'>): boolean {
  if (item.tier) return tierAllows(inv.tier, item.tier);
  return (inv.items.find((x) => x.code === item.code)?.qty ?? 0) > 0;
}
