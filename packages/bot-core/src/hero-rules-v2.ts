/** Proposed persistent hero economy for parity v16. Pure calculations; not yet wired into live game or wallet. */
export const HERO_V2_PRICE = 90;
export const HERO_V2_MAX_CHARGES = 10;
export const HERO_V2_RENAME_PRICE = 780;
export const HERO_V2_XP_PACKS = [{ points: 500, diamonds: 35 }, { points: 1000, diamonds: 65 }] as const;
function positiveLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError('invalid hero level');
  return level;
}
function safe(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('hero value exceeds safe integer storage');
  return n;
}
function rawThreshold(level: number): number {
  const over = Math.max(0, level - 50);
  return 1100 * (level - 1) + 25 * over * (over + 1);
}
export function heroV2Threshold(level: number): number {
  return safe(rawThreshold(positiveLevel(level)));
}
export function heroV2Level(points: number): number {
  safe(points);
  let lo = 1;
  let hi = 2;
  while (rawThreshold(hi) <= points) { lo = hi; hi *= 2; }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (rawThreshold(mid) <= points) lo = mid;
    else hi = mid;
  }
  return lo;
}
export function heroV2Stats(level: number) {
  positiveLevel(level);
  const damage = level >= 10 ? 100 : Math.round((405 + 55 * (level - 1)) / 9);
  const maxDefense = safe(Math.floor((25 * level) / 3));
  const killPoints = safe(30 + Math.floor((level - 1) / 10) + Math.floor(Math.sqrt(Math.max(0, level - 50))));
  const restorePrice = safe(100 * (level + 1));
  return { level, damage, maxDefense, killPoints, restorePrice, reloadPrice: safe(restorePrice + 5), maxCharges: HERO_V2_MAX_CHARGES };
}
export function heroV2CanShoot(role: string): boolean {
  return role === 'DON' || role === 'COMMISSAR' || role === 'MERGAN';
}
/** Hero damage only; normal role damage must bypass the hero's persistent defense. */
export function heroV2Hit(hp: number, defense: number, damage: number) {
  safe(hp); safe(defense); safe(damage);
  if (hp > 100 || damage > 100) throw new RangeError('invalid hit');
  const absorbed = hp === 0 ? 0 : Math.min(defense, damage);
  const lostHp = hp === 0 ? 0 : Math.min(hp, damage - absorbed);
  return { hp: hp - lostHp, defense: defense - absorbed, absorbed, lostHp, killed: hp > 0 && lostHp === hp };
}
