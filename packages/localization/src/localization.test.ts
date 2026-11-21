import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from '@mafia/game-engine';
import { allKeys, escapeHtml, hasKey, t } from './index';

describe('localization', () => {
  it('parametrlarni qo‘yadi', () => {
    expect(t('lobby.need_more', { min: 4 })).toContain('4');
  });

  it('noma’lum til kaliti uz ga qaytadi', () => {
    expect(t('menu.play', {}, 'ru')).toBe(t('menu.play'));
  });

  it('30 ta rolning nomi, tavsifi va so‘rovi bor', () => {
    for (const code of ROLE_CODES) {
      expect(hasKey(`role.${code}.name`)).toBe(true);
      expect(hasKey(`role.${code}.desc`)).toBe(true);
      expect(hasKey(`role.${code}.prompt`)).toBe(true);
    }
  });

  it('bo‘sh qiymatli kalit yo‘q (prompt dan tashqari)', () => {
    for (const k of allKeys()) if (!k.endsWith('.prompt')) expect(t(k).length).toBeGreaterThan(0);
  });

  it('HTML escape', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
  });
});
