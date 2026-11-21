import { randomInt } from 'node:crypto';
import type { Rng } from './types';

/** Production uchun kriptografik xavfsiz RNG (§11.3). */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return randomInt(maxExclusive);
  },
};

/** Testlar va simulyatsiya uchun takrorlanadigan (seed) RNG — mulberry32. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(maxExclusive: number): number {
      if (maxExclusive <= 1) return 0;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * maxExclusive);
    },
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[rng.int(items.length)];
}

/** Og'irlik bo'yicha tanlash (qaytarmasdan). */
export function weightedPick<T>(items: readonly { item: T; weight: number }[], rng: Rng): T | undefined {
  const total = items.reduce((s, x) => s + Math.max(0, Math.round(x.weight * 100)), 0);
  if (total <= 0) return undefined;
  let r = rng.int(total);
  for (const x of items) {
    const w = Math.max(0, Math.round(x.weight * 100));
    if (r < w) return x.item;
    r -= w;
  }
  return items[items.length - 1]?.item;
}
