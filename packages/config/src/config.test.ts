import { describe, expect, it } from 'vitest';
import { loadEnv } from './index';

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_-12';

describe('loadEnv', () => {
  it('to‘g‘ri muhitni qabul qiladi', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, SUPERADMIN_IDS: '1, 2,abc' });
    expect(env.APP_ROLE).toBe('all');
    expect(env.SUPERADMIN_IDS).toEqual(['1', '2']);
  });

  it('token yo‘q bo‘lsa xato beradi va qiymatni oshkor qilmaydi', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x' })).toThrow(/BOT_TOKEN/);
    try {
      loadEnv({ DATABASE_URL: 'postgresql://x', BOT_TOKEN: 'secret-wrong' });
    } catch (e) {
      expect(String(e)).not.toContain('secret-wrong');
    }
  });

  it('productionda DEV_FAKE_PLAYERS taqiqlangan', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, DEV_FAKE_PLAYERS: 'true' }),
    ).toThrow(/DEV_FAKE_PLAYERS/);
  });

  it('bo‘sh qiymatlar o‘rnatilmagan deb hisoblanadi (.env.example dan nusxa)', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, WEBHOOK_URL: '', WEBHOOK_SECRET: '', BOT_USERNAME: '', SUPERADMIN_IDS: '' });
    expect(env.WEBHOOK_URL).toBeUndefined();
    expect(env.SUPERADMIN_IDS).toEqual([]);
  });

  it('LOG_LEVEL katta harfda ham qabul qilinadi', () => {
    expect(loadEnv({ DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, LOG_LEVEL: 'INFO' }).LOG_LEVEL).toBe('info');
  });

  it('webhook rejimida secret talab qilinadi', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x', BOT_TOKEN: TOKEN, TELEGRAM_MODE: 'webhook' })).toThrow(/WEBHOOK/);
  });
});
