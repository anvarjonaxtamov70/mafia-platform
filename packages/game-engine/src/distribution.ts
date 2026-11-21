/**
 * RoleDistributionService (§11, v1.1 T3/T6/T7).
 * Tasodifiy, lekin balans cheklovlariga bo'ysunadigan rol taqsimoti.
 */
import { factionPlan } from './config';
import { ALL_ROLES, getRole } from './roles';
import type { RoleDefinition } from './roles/role';
import { weightedPick } from './rng';
import type { GameConfig, GameMode, Rng, RoleCode } from './types';

export class DistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DistributionError';
  }
}

export interface DistributionInput {
  playerCount: number;
  mode: GameMode;
  config: Pick<GameConfig, 'disabledRoles'>;
  rng: Rng;
}

const SIMPLE_MODES: GameMode[] = ['CLASSIC', 'ARCADE', 'TOURNAMENT'];

function specialCityRatio(mode: GameMode): number {
  if (SIMPLE_MODES.includes(mode)) return 0.5;
  if (mode === 'CHAOS') return 0.85;
  return 0.6;
}

function specialMafiaCount(mode: GameMode, mafia: number): number {
  const rest = Math.max(0, mafia - 1);
  if (SIMPLE_MODES.includes(mode)) return 0;
  if (mode === 'CHAOS') return rest;
  return rest - Math.floor(rest / 3);
}

function isEnabled(r: RoleDefinition, input: DistributionInput): boolean {
  return (
    r.modes.includes(input.mode) &&
    !input.config.disabledRoles.includes(r.code) &&
    input.playerCount >= r.minPlayers
  );
}

function pickFromPool(pool: RoleDefinition[], rng: Rng): RoleDefinition | undefined {
  return weightedPick(
    pool.map((r) => ({ item: r, weight: r.weight })),
    rng,
  );
}

/** Rollar ro'yxatini qaytaradi (hali o'yinchilarga biriktirilmagan). */
export function distributeRoles(input: DistributionInput): RoleCode[] {
  const n = input.playerCount;
  const plan = factionPlan(n);
  const roles: RoleCode[] = [];

  // ── Mafia ──
  const mafia: RoleCode[] = [];
  if (plan.mafia > 0) mafia.push(input.config.disabledRoles.includes('DON') ? 'MAFIOSO' : 'DON');
  let mafiaPool = ALL_ROLES.filter(
    (r) => r.faction === 'MAFIA' && r.code !== 'DON' && r.code !== 'MAFIOSO' && isEnabled(r, input),
  );
  let specials = specialMafiaCount(input.mode, plan.mafia);
  while (specials > 0 && mafiaPool.length > 0) {
    const r = pickFromPool(mafiaPool, input.rng);
    if (!r) break;
    mafia.push(r.code);
    mafiaPool = mafiaPool.filter((x) => x !== r);
    specials--;
  }
  while (mafia.length < plan.mafia) mafia.push('MAFIOSO');

  // ── Mustaqil ──
  const neutral: RoleCode[] = [];
  let neutralPool = ALL_ROLES.filter((r) => r.faction === 'NEUTRAL' && isEnabled(r, input));
  const maxKillers = n >= 20 ? 2 : 1;
  let killers = 0;
  while (neutral.length < plan.neutral && neutralPool.length > 0) {
    const r = pickFromPool(neutralPool, input.rng);
    if (!r) break;
    neutralPool = neutralPool.filter((x) => x !== r);
    if (r.isNeutralKiller) {
      if (killers >= maxKillers) continue;
      killers++;
    }
    neutral.push(r.code);
  }

  // ── Shahar ──
  const citySlots = n - mafia.length - neutral.length;
  const city: RoleCode[] = [];
  for (const req of ['COMMISSAR', 'DOCTOR'] as const) {
    if (city.length < citySlots && isEnabled(getRole(req), input)) city.push(req);
  }
  const specialCount = Math.min(citySlots, Math.max(city.length, Math.ceil(citySlots * specialCityRatio(input.mode))));
  let cityPool = ALL_ROLES.filter(
    (r) =>
      (r.faction === 'CITY') &&
      r.code !== 'CITIZEN' &&
      !city.includes(r.code) &&
      isEnabled(r, input),
  );
  while (city.length < specialCount && cityPool.length > 0) {
    const r = pickFromPool(cityPool, input.rng);
    if (!r) break;
    cityPool = cityPool.filter((x) => x !== r);
    if (r.slots === 2) {
      if (specialCount - city.length < 2) continue;
      city.push(r.code, r.code);
    } else {
      city.push(r.code);
    }
  }
  while (city.length < citySlots) city.push('CITIZEN');

  roles.push(...mafia, ...neutral, ...city);
  validateComposition(roles, n);
  return roles;
}

/** Taqsimotdan keyingi qat'iy tekshiruv (§11.3: noto'g'ri o'yin yashirincha yaratilmasin). */
export function validateComposition(roles: RoleCode[], n: number): void {
  if (roles.length !== n) throw new DistributionError(`role count ${roles.length} != players ${n}`);
  const counts = new Map<RoleCode, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  const mafiaCount = roles.filter((r) => getRole(r).faction === 'MAFIA').length;
  if (mafiaCount < 1) throw new DistributionError('no mafia');
  if (mafiaCount >= n - mafiaCount) throw new DistributionError('mafia already at parity');
  if ((counts.get('DON') ?? 0) > 1) throw new DistributionError('more than one Don');
  const twins = counts.get('TWIN') ?? 0;
  if (twins !== 0 && twins !== 2) throw new DistributionError('twins must be a pair');
  for (const [code, c] of counts) {
    const def = getRole(code);
    if (def.unique && def.slots === 1 && c > 1) throw new DistributionError(`duplicate unique role ${code}`);
  }
}

/** Har qanday holatda ishlaydigan xavfsiz kombinatsiya (fallback). */
export function safeComposition(n: number): RoleCode[] {
  const plan = factionPlan(n);
  const roles: RoleCode[] = ['DON'];
  while (roles.length < plan.mafia) roles.push('MAFIOSO');
  roles.push('COMMISSAR', 'DOCTOR');
  while (roles.length < n) roles.push('CITIZEN');
  validateComposition(roles, n);
  return roles;
}
