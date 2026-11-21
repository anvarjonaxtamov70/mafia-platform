import { describe, expect, it } from 'vitest';
import { factionPlan } from '../config';
import { distributeRoles, safeComposition, validateComposition } from '../distribution';
import { getRole, ALL_ROLES } from '../roles';
import { seededRng } from '../rng';
import { ROLE_CODES, type GameMode } from '../types';

describe('Rollar katalogi', () => {
  it('30 xil rol: 13 shahar, 8 mafia, 6 mustaqil, 3 maxsus', () => {
    expect(ROLE_CODES).toHaveLength(30);
    expect(ALL_ROLES).toHaveLength(30);
    const by = (c: string) => ALL_ROLES.filter((r) => r.category === c).length;
    expect(by('CITY')).toBe(13);
    expect(by('MAFIA')).toBe(8);
    expect(by('NEUTRAL')).toBe(6);
    expect(by('SPECIAL')).toBe(3);
  });
});

describe('RoleDistributionService (§11)', () => {
  const modes: GameMode[] = ['CLASSIC', 'ADVANCED', 'CHAOS', 'ARCADE', 'PRIVATE', 'TOURNAMENT'];

  it('4–30 o‘yinchi, barcha rejimlar, 200 seed: kompozitsiya har doim to‘g‘ri', () => {
    for (const mode of modes) {
      for (let n = 4; n <= 30; n++) {
        for (let seed = 1; seed <= 200; seed++) {
          const roles = distributeRoles({ playerCount: n, mode, config: { disabledRoles: [] }, rng: seededRng(seed * 31 + n) });
          expect(() => validateComposition(roles, n)).not.toThrow();
          const plan = factionPlan(n);
          expect(roles.filter((r) => getRole(r).faction === 'MAFIA')).toHaveLength(plan.mafia);
          expect(roles.filter((r) => r === 'DON')).toHaveLength(1);
          for (const r of roles) expect(getRole(r).minPlayers <= n).toBe(true);
        }
      }
    }
  }, 60_000);

  it('Classic rejimda faqat Classic rollari (T3)', () => {
    const classic = new Set(['CITIZEN', 'MAFIOSO', 'DON', 'COMMISSAR', 'DOCTOR', 'BODYGUARD', 'SHERIFF', 'DETECTIVE', 'JESTER']);
    for (let n = 4; n <= 30; n++) {
      for (let seed = 1; seed <= 50; seed++) {
        const roles = distributeRoles({ playerCount: n, mode: 'CLASSIC', config: { disabledRoles: [] }, rng: seededRng(seed) });
        for (const r of roles) expect(classic.has(r)).toBe(true);
        if (n < 12) expect(roles).not.toContain('JESTER');
      }
    }
  }, 30_000);

  it('Manyak faqat 15+ va Advanced/Chaos rejimida (T7)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r14 = distributeRoles({ playerCount: 14, mode: 'ADVANCED', config: { disabledRoles: [] }, rng: seededRng(seed) });
      expect(r14).not.toContain('SERIAL_KILLER');
      const c30 = distributeRoles({ playerCount: 30, mode: 'CLASSIC', config: { disabledRoles: [] }, rng: seededRng(seed) });
      expect(c30).not.toContain('SERIAL_KILLER');
    }
  });

  it('20 dan kam o‘yinchida bittadan ortiq o‘ldiruvchi mustaqil yo‘q', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const roles = distributeRoles({ playerCount: 19, mode: 'CHAOS', config: { disabledRoles: [] }, rng: seededRng(seed) });
      expect(roles.filter((r) => r === 'SERIAL_KILLER' || r === 'HUNTER').length).toBeLessThanOrEqual(1);
    }
  });

  it('o‘chirilgan rollar taqsimlanmaydi', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const roles = distributeRoles({
        playerCount: 20,
        mode: 'ADVANCED',
        config: { disabledRoles: ['TWIN', 'SERIAL_KILLER', 'CUPID'] },
        rng: seededRng(seed),
      });
      expect(roles).not.toContain('TWIN');
      expect(roles).not.toContain('SERIAL_KILLER');
      expect(roles).not.toContain('CUPID');
    }
  });

  it('safeComposition har bir son uchun ishlaydi', () => {
    for (let n = 4; n <= 30; n++) expect(safeComposition(n)).toHaveLength(n);
  });

  it('8 kishilik Classic: 2 Mafia, Komissar va Doktor bor', () => {
    const roles = distributeRoles({ playerCount: 8, mode: 'CLASSIC', config: { disabledRoles: [] }, rng: seededRng(5) });
    expect(roles).toContain('COMMISSAR');
    expect(roles).toContain('DOCTOR');
    expect(roles.filter((r) => getRole(r).faction === 'MAFIA')).toHaveLength(2);
  });
});
