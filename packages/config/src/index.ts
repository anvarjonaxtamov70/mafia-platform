/**
 * Muhit o'zgaruvchilari validatsiyasi (zod). Maxfiy qiymatlar faqat .env / muhitdan olinadi.
 */
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const idList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^\d+$/.test(x)),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ROLE: z.enum(['all', 'bot', 'worker']).default('all'),
    LOG_LEVEL: z.preprocess(
      (v) => (typeof v === 'string' ? v.toLowerCase() : v),
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    ),
    HTTP_PORT: z.coerce.number().int().positive().default(3000),

    BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'BOT_TOKEN formati noto‘g‘ri').optional(),
    BOT_USERNAME: z.string().optional(),
    TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
    WEBHOOK_URL: z.url().optional(),
    WEBHOOK_SECRET: z.string().min(16).optional(),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

    SUPERADMIN_IDS: idList,
    DEFAULT_LOCALE: z.enum(['uz', 'ru', 'en']).default('uz'),
    TIMEZONE: z.string().default('Asia/Tashkent'),

    /** Faqat development: bot-o'yinchilar bilan sinash (productionda taqiqlangan) */
    DEV_FAKE_PLAYERS: bool,
  })
  .superRefine((env, ctx) => {
    if (env.APP_ROLE !== 'worker' && env.NODE_ENV !== 'test' && !env.BOT_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['BOT_TOKEN'], message: 'BOT_TOKEN kerak' });
    }
    if (env.TELEGRAM_MODE === 'webhook' && (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['WEBHOOK_URL'], message: 'webhook rejimida WEBHOOK_URL va WEBHOOK_SECRET kerak' });
    }
    if (env.NODE_ENV === 'production' && env.DEV_FAKE_PLAYERS) {
      ctx.addIssue({ code: 'custom', path: ['DEV_FAKE_PLAYERS'], message: 'productionda ruxsat etilmaydi' });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Xato xabarida qiymatlar emas, faqat kalit nomlari ko'rsatiladi (token logga tushmasin). */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Konfiguratsiya xatosi: ${issues}`);
  }
  return parsed.data;
}
